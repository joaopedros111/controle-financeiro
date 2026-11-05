import { createSyntheticMigrator, migrationCanonicalBytes } from '../../experimental/finance-vault-migration.js';
import { syntheticSourceCapability, syntheticTargetCapability, SYNTHETIC_SOURCE_PREFIX, SYNTHETIC_TARGET_PREFIX } from '../../experimental/finance-vault-migration-storage.js';
import { createFinancialCodec } from '../../finance-vault-codec.js';
import { createVaultController } from '../../finance-vault-controller.js';
import { realFinancialFixture, auditOwner } from './vault-independent-audit.mjs';
export const migrationOwner = auditOwner;
export const migrationPassword = 'synthetic-migration-passphrase';
const codec = createFinancialCodec();
export function migrationSourceFixture() {
    const documents = realFinancialFixture('recoveryKeys'), uid = migrationOwner.uid;
    documents[`estado:${uid}`].unknownLegacy = { optional: undefined, date: new Date('2026-10-29T12:34:56.789Z'), bytes: new Uint8Array([0, 127, 255]), exactDouble: 0.1 + 0.2 };
    documents[`conflicts:${uid}:synthetic-history`] = { historicalDecision: { id: 'synthetic-decision', pending: true }, tombstone: { id: 'synthetic-old-deletion', deleted: true } };
    documents[`snapshot:${uid}:synthetic-existing`] = { state: structuredClone(documents[`estado:${uid}`]), queue: { recoveryKeys: [...documents[`fila:${uid}`].recoveryKeys] }, createdAt: new Date('2026-10-28T00:00:00Z') };
    return { format: 'cf-synthetic-financial-source', version: 1, owner: { ...migrationOwner }, sourceId: 'synthetic-current-financial-format',
        revision: 17, financialVersion: 3, generation: 'legacy', documents };
}
export function memoryMigrationSource(snapshot = migrationSourceFixture(), crypto = globalThis.crypto) {
    let current = structuredClone(snapshot), readFailure = false;
    const read = async () => { if (readFailure) throw new Error('Synthetic source failure'); return structuredClone(current); };
    return { source: syntheticSourceCapability({ id: `${SYNTHETIC_SOURCE_PREFIX}${crypto.randomUUID()}`, read }), read,
        async editForTest(mutate) { const copy = structuredClone(current), revision = copy.revision + 1; mutate(copy); copy.revision = revision; current = copy; },
        failReads(value) { readFailure = value; }, close() {} };
}
const ok = value => { if (!value) throw new Error('Synthetic migration assertion failed'); };
const equal = (a, b) => {
    const first = migrationCanonicalBytes(codec, a), second = migrationCanonicalBytes(codec, b);
    try { if (first.length !== second.length || first.some((v, i) => v !== second[i])) throw new Error('Synthetic migration equivalence failed'); }
    finally { first.fill(0); second.fill(0); }
};
async function rejects(fn, codes) { let error; try { await fn(); } catch (e) { error = e; } ok(error); if (codes) ok([].concat(codes).includes(error.code)); return error; }
export function migrationCases({ makeStore, makeSource = async () => memoryMigrationSource(), crypto }) {
    const cases = [], closers = [];
    const add = (name, run) => cases.push({ name, run: async () => { try { await run(); } finally { closers.splice(0).reverse().forEach(close => close()); } } });
    async function destination() {
        const storage = await makeStore();
        const target = syntheticTargetCapability({ id: storage.name || `${SYNTHETIC_TARGET_PREFIX}${crypto.randomUUID()}`, store: storage.store });
        closers.push(() => storage.store.close()); return { storage, target };
    }
    async function setup(options = {}) {
        const origin = await makeSource(); closers.push(() => origin.close());
        const dest = await destination();
        const migrate = createSyntheticMigrator({ source: origin.source, target: dest.target, owner: migrationOwner, crypto, ...options }); closers.push(() => migrate.close());
        return { ...dest, origin, migrate };
    }
    const scratch = async () => (await destination()).target;
    async function activate(s, prepared, extra = {}) {
        return s.migrate.activate({ password: migrationPassword, recoverySecret: prepared.recoverySecret, externalCustodyConfirmed: true, recoveryTarget: await scratch(), ...extra });
    }
    async function sourcePreserved(origin, before) { equal(await origin.read(), before); }

    add('copy, independent recovery and read-only activation preserve every real-format document', async () => {
        const s = await setup(), before = await s.origin.read(), result = await s.migrate.prepare({ password: migrationPassword });
        ok(!result.alreadyCopied); ok(/^[a-f0-9]{64}$/.test(result.evidence.sourceDigest)); equal(result.evidence.counts, { documents: 5, income: 2, expense: 1, offlineOperations: 2, conflicts: 1, queuedTombstones: 1, recoveryDocuments: 1 });
        const active = await activate(s, result); ok(active.evidence.recoveryVerified); equal(await active.read(), before.documents); await sourcePreserved(s.origin, before);
        equal(s.migrate.deactivate(), { state: 'inactive', sourcePreserved: true }); await rejects(() => active.read(), 'cancelled');
    });
    add('repeated copying is idempotent and never replaces credentials or valid snapshots', async () => {
        const s = await setup(), first = await s.migrate.prepare({ password: migrationPassword }), raw = JSON.stringify((await s.storage.inspect()).snapshots);
        const second = await s.migrate.prepare({ password: migrationPassword }); ok(second.alreadyCopied); equal(second.recoverySecret, null); equal(second.evidence, first.evidence);
        equal(JSON.stringify((await s.storage.inspect()).snapshots), raw); equal((await s.storage.inspect()).snapshots.length, 1); await activate(s, first);
    });
    for (const phase of ['source-read', 'before-create']) add(`interruption at ${phase} writes no financial destination and preserves source`, async () => {
        const s = await setup({ onPhase(name) { if (name === phase) throw new Error('Synthetic interruption'); } }), before = await s.origin.read();
        await rejects(() => s.migrate.prepare({ password: migrationPassword }), 'interrupted'); equal((await s.storage.inspect()).snapshots.length, 0); await sourcePreserved(s.origin, before);
    });
    add('failed durable nonce reservation during cryptographic preparation leaves source and destination untouched', async () => {
        const s = await setup(), before = await s.origin.read(); s.storage.setFaults({ afterReserve() { throw new Error('Synthetic preparation failure'); } });
        await rejects(() => s.migrate.prepare({ password: migrationPassword }), 'reservation-failed'); s.storage.setFaults({}); equal((await s.storage.inspect()).snapshots.length, 0); await sourcePreserved(s.origin, before);
        await s.migrate.prepare({ password: migrationPassword });
    });
    for (const fault of ['quota', 'abort']) add(`${fault} at commit leaves no partial copy and retry preserves all documents`, async () => {
        const s = await setup(), before = await s.origin.read();
        s.storage.setFaults(fault === 'quota' ? { beforePut() { throw Object.assign(new Error('Synthetic quota'), { name: 'QuotaExceededError' }); } } : { afterPut(tx) { tx.abort(); } });
        await rejects(() => s.migrate.prepare({ password: migrationPassword }), fault === 'quota' ? 'quota-exceeded' : undefined);
        s.storage.setFaults({}); equal((await s.storage.inspect()).snapshots.length, 0); await sourcePreserved(s.origin, before);
        const prepared = await s.migrate.prepare({ password: migrationPassword }); equal(await (await activate(s, prepared)).read(), before.documents);
    });
    add('restart rediscovers a staged copy but requires fresh recovery proof before activation', async () => {
        const s = await setup(), before = await s.origin.read(), prepared = await s.migrate.prepare({ password: migrationPassword }); s.migrate.close();
        const reopened = createSyntheticMigrator({ source: s.origin.source, target: syntheticTargetCapability({ id: s.target.id, store: await s.storage.reopen() }), owner: migrationOwner, crypto }); closers.push(() => reopened.close());
        const repeated = await reopened.prepare({ password: migrationPassword }); ok(repeated.alreadyCopied); equal(repeated.recoverySecret, null);
        await rejects(() => reopened.activate({ password: migrationPassword, recoveryTarget: s.target }), 'recovery-required');
        const active = await reopened.activate({ password: migrationPassword, recoverySecret: prepared.recoverySecret, externalCustodyConfirmed: true, recoveryTarget: await scratch() });
        equal(await active.read(), before.documents); await sourcePreserved(s.origin, before);
    });
    for (const phase of ['before-create', 'copy-committed', 'before-activation']) add(`source modification at ${phase} blocks activation without overwriting either side`, async () => {
        let origin, enabled = false;
        const s = await setup({ onPhase: async name => { if (enabled && name === phase) await origin.editForTest(value => { value.documents[`estado:${migrationOwner.uid}`].unknownNewEdit = 'synthetic-later'; }); } }); origin = s.origin;
        if (phase === 'before-activation') {
            const prepared = await s.migrate.prepare({ password: migrationPassword }); enabled = true; await rejects(() => activate(s, prepared), 'source-changed');
        } else { enabled = true; await rejects(() => s.migrate.prepare({ password: migrationPassword }), 'source-changed'); }
        equal((await origin.read()).documents[`estado:${migrationOwner.uid}`].unknownNewEdit, 'synthetic-later');
        if (phase === 'before-create') equal((await s.storage.inspect()).snapshots.length, 0);
        else { equal((await s.storage.inspect()).snapshots.length, 1); await rejects(() => s.migrate.prepare({ password: migrationPassword }), 'destination-exists'); }
    });
    add('two migration instances race for one target; loser retries without a second financial snapshot', async () => {
        const s = await setup(), other = createSyntheticMigrator({ source: s.origin.source, target: syntheticTargetCapability({ id: s.target.id, store: await s.storage.reopen() }), owner: migrationOwner, crypto }); closers.push(() => other.close());
        const results = await Promise.allSettled([s.migrate.prepare({ password: migrationPassword }), other.prepare({ password: migrationPassword })]);
        ok(results.some(r => r.status === 'fulfilled')); for (const r of results) if (r.status === 'rejected') ok(['cancelled', 'already-exists', 'stale-revision'].includes(r.reason.code));
        equal((await s.storage.inspect()).snapshots.length, 1); ok((await s.migrate.prepare({ password: migrationPassword })).alreadyCopied);
    });
    add('an unrelated existing vault is authenticated and refused without any overwrite', async () => {
        const s = await setup(), c = createVaultController({ store: { ...s.target.store, close() {} }, owner: migrationOwner, vaultId: 'synthetic-migration', crypto, channelFactory: () => null }); closers.push(() => c.close());
        await c.create({ password: migrationPassword, generation: 'legacy', documents: (await s.origin.read()).documents });
        const before = JSON.stringify((await s.storage.inspect()).snapshots); await rejects(() => s.migrate.prepare({ password: migrationPassword }), 'destination-exists');
        equal(JSON.stringify((await s.storage.inspect()).snapshots), before);
    });
    add('ciphertext corruption rejects activation and is never replaced with an empty vault', async () => {
        const s = await setup(), prepared = await s.migrate.prepare({ password: migrationPassword });
        await s.storage.mutate(raw => { const text = raw.documents[0].ciphertext; raw.documents[0].ciphertext = (text[0] === 'A' ? 'B' : 'A') + text.slice(1); });
        const before = JSON.stringify((await s.storage.inspect()).snapshots); await rejects(() => activate(s, prepared)); await rejects(() => s.migrate.prepare({ password: migrationPassword }));
        equal(JSON.stringify((await s.storage.inspect()).snapshots), before);
    });
    add('missing custody, wrong password and unavailable recovery key all reject activation', async () => {
        const s = await setup(), prepared = await s.migrate.prepare({ password: migrationPassword }), before = JSON.stringify((await s.storage.inspect()).snapshots);
        await rejects(() => activate(s, prepared, { externalCustodyConfirmed: false }), 'recovery-required');
        await rejects(() => activate(s, prepared, { password: 'synthetic-incorrect-password' }), 'unlock-failed');
        await rejects(() => activate(s, prepared, { recoverySecret: 'A'.repeat(43) }), 'invalid-package');
        equal(JSON.stringify((await s.storage.inspect()).snapshots), before); await activate(s, prepared);
    });
    add('interrupted recovery never activates; another dedicated recovery target succeeds', async () => {
        const s = await setup(), before = await s.origin.read(), prepared = await s.migrate.prepare({ password: migrationPassword }), recovery = await destination();
        recovery.storage.setFaults({ beforePut() { throw new Error('Synthetic recovery interruption'); } });
        await rejects(() => activate(s, prepared, { recoveryTarget: recovery.target })); recovery.storage.setFaults({});
        equal((await recovery.storage.inspect()).snapshots.length, 0); equal((await s.storage.inspect()).snapshots.length, 1); await sourcePreserved(s.origin, before);
        equal(await (await activate(s, prepared)).read(), before.documents);
    });
    add('deactivation fences pending preparation before the first financial commit', async () => {
        let entered, release; const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
        const s = await setup({ onPhase: async name => { if (name === 'before-create') { entered(); await gate; } } });
        const pending = s.migrate.prepare({ password: migrationPassword }).then(() => null, error => error.code); await started; s.migrate.deactivate(); release();
        equal(await pending, 'cancelled'); equal((await s.storage.inspect()).snapshots.length, 0);
    });
    add('source A-B-A revision changes invalidate an active lease even when the documents return to the same values', async () => {
        const s = await setup(), original = await s.origin.read(), prepared = await s.migrate.prepare({ password: migrationPassword }), active = await activate(s, prepared);
        await s.origin.editForTest(value => { value.documents[`estado:${migrationOwner.uid}`].unknownExtra = true; });
        await s.origin.editForTest(value => { value.documents = structuredClone(original.documents); });
        await rejects(() => active.read(), 'source-changed'); equal((await s.origin.read()).documents, original.documents);
    });
    for (const invalid of ['owner', 'missing-state', 'generation', 'version', 'foreign-document']) add(`ambiguous source ${invalid} is refused before any financial destination exists`, async () => {
        const s = await setup(); await s.origin.editForTest(value => {
            if (invalid === 'owner') value.owner.uid = 'synthetic-other-owner';
            if (invalid === 'missing-state') delete value.documents[`estado:${migrationOwner.uid}`];
            if (invalid === 'generation') delete value.documents[`fila:${migrationOwner.uid}`].generation;
            if (invalid === 'version') value.financialVersion = 99;
            if (invalid === 'foreign-document') value.documents['estado:synthetic-other-owner'] = {};
        });
        const before = await s.origin.read(); await rejects(() => s.migrate.prepare({ password: migrationPassword }), invalid === 'owner' ? 'owner-mismatch' : 'source-invalid');
        equal((await s.storage.inspect()).snapshots.length, 0); await sourcePreserved(s.origin, before);
    });
    add('encrypted target contains hashes and data only inside authenticated ciphertext, never financial plaintext or secrets', async () => {
        const s = await setup(), prepared = await s.migrate.prepare({ password: migrationPassword }), text = JSON.stringify(await s.storage.inspect());
        for (const forbidden of ['Synthetic income', '1234.56', 'synthetic-income', 'unknownLegacy', prepared.recoverySecret, migrationPassword, prepared.evidence.sourceDigest]) ok(!text.includes(forbidden));
        ok(text.includes('AES-256-GCM')); ok(text.includes('ciphertext'));
    });
    add('a committed copy with lost acknowledgement remains staged and never invents a recovery secret', async () => {
        const origin = await makeSource(), storage = await makeStore(); closers.push(() => origin.close(), () => storage.store.close()); let lose = true;
        const target = syntheticTargetCapability({ id: storage.name || `${SYNTHETIC_TARGET_PREFIX}${crypto.randomUUID()}`, store: { ...storage.store,
            compareAndSwap: async (...args) => { const result = await storage.store.compareAndSwap(...args); if (lose) { lose = false; throw Object.assign(new Error('Synthetic lost ACK'), { code: 'write-failed' }); } return result; } } });
        const migrate = createSyntheticMigrator({ source: origin.source, target, owner: migrationOwner, crypto }); closers.push(() => migrate.close());
        const before = await origin.read(); await rejects(() => migrate.prepare({ password: migrationPassword }), 'write-failed');
        equal((await storage.inspect()).snapshots.length, 1); const raw = JSON.stringify((await storage.inspect()).snapshots);
        const repeated = await migrate.prepare({ password: migrationPassword }); ok(repeated.alreadyCopied); equal(repeated.recoverySecret, null);
        await rejects(async () => migrate.activate({ password: migrationPassword, recoveryTarget: await scratch() }), 'recovery-required');
        equal(JSON.stringify((await storage.inspect()).snapshots), raw); await sourcePreserved(origin, before);
    });
    add('legitimate authenticated destination changes invalidate activation without rollback or lost edits', async () => {
        let external;
        const s = await setup({ onPhase: async name => { if (name === 'recovery-restored') {
            const read = await external.read(), documents = structuredClone(read.documents), id = `estado:${migrationOwner.uid}`;
            documents[id].syntheticLaterEdit = 'preserve-this-change';
            await external.commit(await external.prepare({ expectedRevision: read.catalog.revision, generation: read.generation, updates: { [id]: documents[id] } }));
        } } });
        const before = await s.origin.read(), prepared = await s.migrate.prepare({ password: migrationPassword });
        external = createVaultController({ store: { ...s.target.store, close() {} }, owner: migrationOwner, vaultId: 'synthetic-migration', crypto, channelFactory: () => null }); closers.push(() => external.close());
        await external.unlockWithPassword(migrationPassword);
        await rejects(() => activate(s, prepared), 'equivalence-failed');
        equal((await external.read()).documents[`estado:${migrationOwner.uid}`].syntheticLaterEdit, 'preserve-this-change'); await sourcePreserved(s.origin, before);
        const raw = JSON.stringify((await s.storage.inspect()).snapshots); await rejects(() => s.migrate.prepare({ password: migrationPassword }), 'equivalence-failed'); equal(JSON.stringify((await s.storage.inspect()).snapshots), raw);
    });
    add('an already active read lease rejects later destination changes and preserves them', async () => {
        const s = await setup(), prepared = await s.migrate.prepare({ password: migrationPassword }), active = await activate(s, prepared);
        const c = createVaultController({ store: { ...s.target.store, close() {} }, owner: migrationOwner, vaultId: 'synthetic-migration', crypto, channelFactory: () => null }); closers.push(() => c.close());
        await c.unlockWithPassword(migrationPassword); const before = await c.read();
        await c.commit(await c.prepare({ expectedRevision: before.catalog.revision, generation: before.generation, updates: {} }));
        await rejects(() => active.read(), 'destination-changed'); equal((await c.read()).catalog.revision, before.catalog.revision + 1);
    });
    add('late source read failure from an old activation lease cannot revoke its replacement', async () => {
        const origin = await makeSource(), d = await destination(); closers.push(() => origin.close());
        let armed = false, entered, release; const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
        const source = syntheticSourceCapability({ id: origin.source.id, read: async () => {
            if (armed) { armed = false; entered(); await gate; throw new Error('Synthetic delayed read failure'); } return origin.source.read();
        } });
        const migrate = createSyntheticMigrator({ source, target: d.target, owner: migrationOwner, crypto }); closers.push(() => migrate.close());
        const prepared = await migrate.prepare({ password: migrationPassword });
        const args = async () => ({ password: migrationPassword, recoverySecret: prepared.recoverySecret, externalCustodyConfirmed: true, recoveryTarget: await scratch() });
        const old = await migrate.activate(await args()); armed = true;
        const pending = old.read().then(() => null, error => error.code); await started;
        const replacement = await migrate.activate(await args()); release(); equal(await pending, 'source-unavailable');
        equal(await replacement.read(), (await origin.read()).documents);
    });
    add('missing source data and source read failures never authorize an empty destination', async () => {
        const d = await destination();
        for (const read of [async () => null, async () => { throw new Error('Synthetic unavailable source'); }]) {
            const source = syntheticSourceCapability({ id: `${SYNTHETIC_SOURCE_PREFIX}${crypto.randomUUID()}`, read });
            const migrate = createSyntheticMigrator({ source, target: d.target, owner: migrationOwner, crypto }); closers.push(() => migrate.close());
            await rejects(() => migrate.prepare({ password: migrationPassword }), ['source-invalid', 'source-unavailable']);
        }
        equal((await d.storage.inspect()).snapshots.length, 0);
    });
    add('canonical comparison ignores object insertion order but preserves dates, optional fields, array order and exact types', async () => {
        equal({ second: undefined, first: { number: 0.1 + 0.2, date: new Date('2026-10-29T00:00:00Z') } },
            { first: { date: new Date('2026-10-29T00:00:00Z'), number: 0.1 + 0.2 }, second: undefined });
        await rejects(() => equal([1, 2], [2, 1])); await rejects(() => equal({ optional: undefined }, {}));
        await rejects(() => equal({ value: -0 }, { value: 0 })); await rejects(() => equal(new Date('2026-10-29T00:00:00Z'), '2026-10-29T00:00:00.000Z'));
    });
    return cases;
}
