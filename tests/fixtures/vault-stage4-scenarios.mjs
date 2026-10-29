import { createVaultController } from '../../finance-vault-controller.js';
import { createFinancialCodec } from '../../finance-vault-codec.js';
import { VaultStoreError } from '../../finance-vault-store.js';
import { createVaultBackend } from '../../finance-vault-backend.js';
import { preservationFixture } from './vault-contract.mjs';
export const stage4Owner = { projectId: 'demo-cf-vault', uid: 'synthetic-A' };
export const stage4Password = 'synthetic-stage-four-passphrase';
export const stage4Vault = 'synthetic-stage-four';
export class SyntheticTimestamp {
    constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
}
export const stage4Codec = () => createFinancialCodec({ adapters: [{ tag: 'custom:timestamp:v1',
    matches: value => value instanceof SyntheticTimestamp,
    encode: value => ({ seconds: value.seconds, nanoseconds: value.nanoseconds }),
    decode: value => { if (!Number.isSafeInteger(value.seconds) || !Number.isInteger(value.nanoseconds) || value.nanoseconds < 0 || value.nanoseconds >= 1e9) throw new Error('invalid timestamp'); return new SyntheticTimestamp(value.seconds, value.nanoseconds); }
}] });
export function stage4Documents() {
    const docs = preservationFixture().documents;
    docs['estado:synthetic-A'].legacyOptional = undefined;
    docs['estado:synthetic-A'].legacyDate = new Date('2026-10-29T12:00:00.123Z');
    docs['estado:synthetic-A'].sdkTimestamp = new SyntheticTimestamp(1793275200, 123456789);
    docs['estado:synthetic-A'].sdkTimestamp.optionalLegacyField = { preserved: true, optional: undefined };
    docs['estado:synthetic-A'].dados.meses = { '2026-10': { receitas: [{ id: 'legacy-without-recebido', nome: 'Synthetic income', valor: 0.1 + 0.2 }], despesas: [{ id: 'legacy-expense', pago: false, valor: 42.17 }] } };
    return docs;
}
const ok = value => { if (!value) throw new Error('Synthetic assertion failed'); };
const equal = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Synthetic comparison failed'); };
async function rejects(fn, code) { let error; try { await fn(); } catch (e) { error = e; } ok(error); if (code) equal(error.code, code); return error; }
const flip = text => (text[0] === 'A' ? 'B' : 'A') + text.slice(1);
const modifyPackage = (bytes, transform) => { const value = JSON.parse(new TextDecoder().decode(bytes)); transform(value); return new TextEncoder().encode(JSON.stringify(value)); };

export function stage4Cases({ makeStore, crypto, channelFactory = () => null }) {
    const cases = [], controllers = [];
    const controller = (store, options = {}) => {
        const result = createVaultController({ store, owner: stage4Owner, vaultId: stage4Vault, codec: stage4Codec(), crypto, channelFactory, ...options }); controllers.push(result); return result;
    };
    const add = (name, run) => cases.push({ name, run: async () => { try { await run(); } finally { controllers.splice(0).forEach(c => c.close()); } } });
    async function source() {
        const storage = await makeStore(), c = controller(storage.store);
        const created = await c.create({ password: stage4Password, generation: 'generation-a', documents: stage4Documents() });
        return { storage, c, created };
    }
    const update = () => ({ 'estado:synthetic-A': { ...stage4Documents()['estado:synthetic-A'], syntheticUpdate: true } });
    add('catalog creation, restart discovery and authenticated lossless read', async () => {
        const s = await source();
        equal(await s.c.status(), { state: 'unlocked', authenticated: true });
        const raw = await s.storage.inspect(); equal(raw.catalogs.length, 1);
        const text = JSON.stringify(raw); ok(!text.includes(stage4Password)); ok(!text.includes(s.created.recoverySecret)); ok(!text.includes('synthetic-pending')); ok(!text.includes('1234.56'));
        s.c.close(); const resumed = controller(await s.storage.reopen());
        equal(await resumed.status(), { state: 'locked', authenticated: false }); await resumed.unlockWithPassword(stage4Password);
        const read = await resumed.read(); equal(read.documents['estado:synthetic-A'].legacyDate.toISOString(), stage4Documents()['estado:synthetic-A'].legacyDate.toISOString());
        ok(read.documents['estado:synthetic-A'].sdkTimestamp instanceof SyntheticTimestamp);
        ok(Object.hasOwn(read.documents['estado:synthetic-A'], 'legacyOptional')); equal(read.documents['estado:synthetic-A'].legacyOptional, undefined);
        equal(read.documents['fila:synthetic-A'].outbox, stage4Documents()['fila:synthetic-A'].outbox);
    });
    add('wrong password does not unlock, recovery authenticates the same catalog', async () => {
        const s = await source(); await s.c.lock();
        await rejects(() => s.c.unlockWithPassword('synthetic-wrong-password'), 'unlock-failed');
        equal((await s.c.status()).state, 'locked');
        await s.c.unlockWithRecovery(s.created.recoverySecret); equal((await s.c.read()).catalog.revision, 1);
    });
    for (const field of ['version', 'password', 'recovery', 'generation', 'owner']) add(`catalog ${field} tampering never becomes empty`, async () => {
        const s = await source(); await s.c.lock();
        await s.storage.mutateCatalog(locator => {
            if (field === 'version') locator.catalog.version = 999;
            if (field === 'password') locator.catalog.password.wrappedKey = flip(locator.catalog.password.wrappedKey);
            if (field === 'recovery') locator.catalog.recovery.kdf.info = 'bad-domain';
            if (field === 'generation') locator.catalog.generation = 'bad-generation';
            if (field === 'owner') locator.catalog.owner.uid = 'synthetic-B';
        });
        equal((await s.c.status()).state, 'corrupted');
        await rejects(() => s.c.unlockWithPassword(stage4Password));
        await rejects(() => s.c.create({ password: stage4Password, generation: 'generation-a', documents: stage4Documents() }));
        equal((await s.storage.inspect()).snapshots.length, 1);
    });
    add('persistent catalog plus raw metadata tampering is caught by authenticated manifest', async () => {
        const s = await source(); await s.c.lock();
        await s.storage.mutateCatalog(l => { l.catalog.recovery.wrappedKey = flip(l.catalog.recovery.wrappedKey); });
        await s.storage.mutate(raw => { raw.catalog.recovery.wrappedKey = flip(raw.catalog.recovery.wrappedKey); });
        equal((await s.c.status()).state, 'locked'); // structural equality is not authentication
        await rejects(() => s.c.unlockWithPassword(stage4Password), 'corruption');
    });
    add('catalog rollback without rolling back durable head is rejected', async () => {
        const s = await source(), old = structuredClone((await s.storage.inspect()).catalogs[0][1]);
        await s.c.commit(await s.c.prepare({ expectedRevision: 1, generation: 'generation-a', updates: update() })); await s.c.lock();
        await s.storage.mutateCatalog(l => { Object.assign(l, old); }); equal((await s.c.status()).state, 'corrupted');
    });
    add('legacy snapshot without catalog requires recovery instead of automatic initialization', async () => {
        const storage = await makeStore(), context = { owner: stage4Owner, vaultId: stage4Vault, keyId: 'synthetic-stage3-key' };
        const old = createVaultBackend({ store: storage.store, context, crypto }); await old.createKey();
        await old.initialize({ generation: 'generation-a', documents: preservationFixture().documents }); old.lock();
        const c = controller(storage.store); equal((await c.status()).state, 'recovery-required');
        await rejects(() => c.create({ password: stage4Password, generation: 'generation-a', documents: stage4Documents() }), 'recovery-required');
    });
    add('read failure does not authorize creation of an empty catalog', async () => {
        const storage = await makeStore(), c = controller(storage.store);
        storage.setFaults({ afterRead() { throw new Error('synthetic read failure'); } });
        await rejects(() => c.status(), 'read-failed'); await rejects(() => c.create({ password: stage4Password, generation: 'generation-a', documents: stage4Documents() }), 'read-failed');
        storage.setFaults({}); equal((await storage.inspect()).snapshots.length, 0);
    });
    add('encrypted external package restores all offline data with a fresh DEK and is idempotent', async () => {
        const s = await source(), pack = await s.c.exportRecoveryPackage(), destStorage = await makeStore(), dest = controller(destStorage.store);
        ok(!new TextDecoder().decode(pack).includes(s.created.recoverySecret)); ok(!new TextDecoder().decode(pack).includes('synthetic-pending'));
        const result = await dest.importRecoveryPackage(pack, { recoverySecret: s.created.recoverySecret, newPassword: stage4Password }); ok(!result.alreadyRestored);
        const restored = await dest.read(), original = await s.c.read();
        equal([...stage4Codec().encode(restored.documents)], [...stage4Codec().encode(original.documents)]);
        ok(restored.catalog.keyId !== original.catalog.keyId);
        const before = JSON.stringify((await destStorage.inspect()).snapshots);
        const repeat = await dest.importRecoveryPackage(pack, { recoverySecret: s.created.recoverySecret, newPassword: stage4Password }); ok(repeat.alreadyRestored);
        equal(JSON.stringify((await destStorage.inspect()).snapshots), before);
        const renewed = await dest.renewRecovery();
        const custody = await dest.confirmRecoveryCustody(renewed.operationId, { recoverySecret: renewed.recoverySecret, externalCustodyConfirmed: true });
        await dest.activateRecovery(custody);
        await dest.lock(); await dest.unlockWithRecovery(renewed.recoverySecret); equal((await dest.read()).documents['fila:synthetic-A'].outbox, original.documents['fila:synthetic-A'].outbox);
    });
    for (const kind of ['incomplete', 'ciphertext', 'seal', 'owner', 'version']) add(`external package ${kind} is rejected before activation`, async () => {
        const s = await source(), pack = await s.c.exportRecoveryPackage();
        const bad = modifyPackage(pack, p => {
            if (kind === 'incomplete') p.snapshot.documents.pop();
            if (kind === 'ciphertext') p.snapshot.documents[0].ciphertext = flip(p.snapshot.documents[0].ciphertext);
            if (kind === 'seal') p.seal.ciphertext = flip(p.seal.ciphertext);
            if (kind === 'owner') p.snapshot.catalog.owner.uid = 'synthetic-B';
            if (kind === 'version') p.version = 2;
        });
        const storage = await makeStore(), c = controller(storage.store);
        await rejects(() => c.importRecoveryPackage(bad, { recoverySecret: s.created.recoverySecret, newPassword: stage4Password }), 'invalid-package');
        equal((await storage.inspect()).snapshots.length, 0); equal((await c.status()).state, 'missing');
    });
    add('interrupted restore has no half-catalog; retry succeeds with complete graph', async () => {
        const s = await source(), pack = await s.c.exportRecoveryPackage(), storage = await makeStore(), c = controller(storage.store);
        storage.setFaults({ afterPut(tx) { tx.abort(); } });
        await rejects(() => c.importRecoveryPackage(pack, { recoverySecret: s.created.recoverySecret, newPassword: stage4Password }), 'write-failed');
        storage.setFaults({}); const raw = await storage.inspect(); equal(raw.snapshots.length, 0); equal(raw.catalogs.length, 0); equal(raw.controls.length, 0);
        await c.importRecoveryPackage(pack, { recoverySecret: s.created.recoverySecret, newPassword: stage4Password }); equal((await c.read()).documents['fila:synthetic-A'].outbox.length, 2);
    });
    add('lost restore acknowledgement retries idempotently without overwriting later offline operations', async () => {
        const s = await source(), pack = await s.c.exportRecoveryPackage(), storage = await makeStore(); let lose = true;
        const wrapped = { ...storage.store, compareAndSwap: async (...args) => { const result = await storage.store.compareAndSwap(...args); if (lose) { lose = false; throw new VaultStoreError('write-failed'); } return result; } };
        const c = controller(wrapped);
        await rejects(() => c.importRecoveryPackage(pack, { recoverySecret: s.created.recoverySecret, newPassword: stage4Password }), 'write-failed');
        await c.unlockWithPassword(stage4Password);
        await c.commit(await c.prepare({ expectedRevision: 1, generation: 'generation-a', updates: update() }));
        const repeat = await c.importRecoveryPackage(pack, { recoverySecret: s.created.recoverySecret, newPassword: stage4Password }); ok(repeat.alreadyRestored);
        equal((await c.read()).documents['estado:synthetic-A'].syntheticUpdate, true);
    });
    add('existing destination and wrong recovery secret never replace offline data', async () => {
        const s = await source(), other = await source(), pack = await s.c.exportRecoveryPackage(), before = JSON.stringify((await other.storage.inspect()).snapshots);
        await rejects(() => other.c.importRecoveryPackage(pack, { recoverySecret: flip(s.created.recoverySecret), newPassword: stage4Password }), 'invalid-package');
        await rejects(() => other.c.importRecoveryPackage(pack, { recoverySecret: s.created.recoverySecret, newPassword: stage4Password }), 'already-exists'); equal(JSON.stringify((await other.storage.inspect()).snapshots), before);
    });
    add('dropped lock message still fences old writes, reads and A-B-A tokens', async () => {
        const s = await source(), other = controller(await s.storage.reopen()); await other.unlockWithPassword(stage4Password);
        const token = await other.prepare({ expectedRevision: 1, generation: 'generation-a', updates: update() }); await s.c.lock();
        await rejects(() => other.commit(token), 'cancelled'); await rejects(() => other.read(), 'locked');
        const b = controller(await s.storage.reopen(), { owner: { ...stage4Owner, uid: 'synthetic-B' } }); equal((await b.status()).state, 'missing');
        await other.unlockWithPassword(stage4Password); await rejects(() => other.commit(token), 'invalid-input'); equal((await other.read()).documents['fila:synthetic-A'].outbox.length, 2);
    });
    add('durable fence blocks lock between final guard and IndexedDB commit', async () => {
        const s = await source(); let armed = false;
        const wrapped = { ...await s.storage.reopen(), compareAndSwap: async (...args) => { if (armed) { armed = false; await s.c.lock(); } return s.storage.store.compareAndSwap(...args); } };
        const other = controller(wrapped); await other.unlockWithPassword(stage4Password);
        const token = await other.prepare({ expectedRevision: 1, generation: 'generation-a', updates: update() }); armed = true;
        await rejects(() => other.commit(token), 'cancelled');
        await other.unlockWithPassword(stage4Password); equal((await other.read()).catalog.revision, 1);
    });
    add('two tabs and stale revisions keep exactly one committed financial update', async () => {
        const s = await source(), other = controller(await s.storage.reopen()); await other.unlockWithPassword(stage4Password);
        const args = { expectedRevision: 1, generation: 'generation-a', updates: update() };
        const [a, b] = await Promise.all([s.c.prepare(args), other.prepare(args)]);
        const results = await Promise.allSettled([s.c.commit(a), other.commit(b)]); equal(results.filter(r => r.status === 'fulfilled').length, 1);
        await rejects(() => s.c.prepare(args));
        const read = await s.c.read(); equal(read.catalog.revision, 2); equal(read.documents['fila:synthetic-A'].outbox.length, 2);
    });
    add('generation switch and restart invalidate old sessions without losing queues', async () => {
        const s = await source(), other = controller(await s.storage.reopen()); await other.unlockWithPassword(stage4Password);
        const queue = { ...stage4Documents()['fila:synthetic-A'], generation: 'generation-b', restoreJob: null };
        await s.c.commit(await s.c.prepare({ expectedRevision: 1, generation: 'generation-b', updates: { 'fila:synthetic-A': queue } }));
        await rejects(() => other.read(), 'cancelled'); other.close();
        const resumed = controller(await s.storage.reopen()); await resumed.unlockWithPassword(stage4Password);
        equal((await resumed.read()).generation, 'generation-b'); equal((await resumed.read()).documents['fila:synthetic-A'].outbox.length, 2);
    });
    add('remote lock during package authentication invalidates the original import even without messages', async () => {
        const s = await source(), pack = await s.c.exportRecoveryPackage(), storage = await makeStore();
        let release, entered, gated = true;
        const waiting = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
        const provider = { randomUUID: () => crypto.randomUUID(), getRandomValues: bytes => crypto.getRandomValues(bytes), subtle: new Proxy(crypto.subtle, {
            get(target, name) { if (name === 'decrypt') return async (...args) => { if (gated) { gated = false; entered(); await gate; } return target.decrypt(...args); }; const fn = target[name]; return typeof fn === 'function' ? fn.bind(target) : fn; }
        }) };
        const target = controller(storage.store, { crypto: provider, channelFactory: () => null });
        const locker = controller(await storage.reopen(), { channelFactory: () => null });
        const pending = rejects(() => target.importRecoveryPackage(pack, { recoverySecret: s.created.recoverySecret, newPassword: stage4Password }), 'cancelled');
        await waiting; await locker.lock(); release(); await pending;
        equal((await storage.inspect()).snapshots.length, 0);
    });
    add('explicit recovery into a fresh vault ID preserves a corrupted original in the same database', async () => {
        const s = await source(), pack = await s.c.exportRecoveryPackage(); await s.c.lock();
        await s.storage.mutateCatalog(l => { l.catalog.password.wrappedKey = flip(l.catalog.password.wrappedKey); });
        const beforeRows = (await s.storage.inspect()).snapshots, originalScope = beforeRows[0][0], before = JSON.stringify(beforeRows);
        const restored = controller(await s.storage.reopen(), { vaultId: 'synthetic-recovered-vault' });
        await rejects(() => restored.importRecoveryPackage(pack, { recoverySecret: s.created.recoverySecret, newPassword: stage4Password }), 'invalid-package');
        await restored.importRecoveryPackage(pack, { recoverySecret: s.created.recoverySecret, newPassword: stage4Password, sourceVaultId: stage4Vault });
        equal((await restored.read()).documents['fila:synthetic-A'].outbox.length, 2);
        const raw = await s.storage.inspect(); equal(raw.snapshots.length, 2); equal(JSON.stringify(raw.snapshots.filter(([scope]) => scope === originalScope)), before);
        equal((await s.c.status()).state, 'corrupted');
        const wrongOwner = controller(await s.storage.reopen(), { owner: { ...stage4Owner, uid: 'synthetic-B' }, vaultId: 'synthetic-other-owner' });
        await rejects(() => wrongOwner.importRecoveryPackage(pack, { recoverySecret: s.created.recoverySecret, newPassword: stage4Password, sourceVaultId: stage4Vault }), 'invalid-package');
        equal((await s.storage.inspect()).snapshots.length, 2);
    });
    add('atomic password replacement rejects the old password and fences other tabs while preserving offline work', async () => {
        const s = await source(), other = controller(await s.storage.reopen()); await other.unlockWithPassword(stage4Password);
        const nextPassword = 'synthetic-new-stage-four-password';
        await s.c.changePassword(stage4Password, nextPassword);
        await rejects(() => other.read(), 'cancelled');
        await rejects(() => other.unlockWithPassword(stage4Password), 'unlock-failed');
        await other.unlockWithPassword(nextPassword); const read = await other.read(); equal(read.catalog.password.wrapRevision, 2);
        equal(read.documents['fila:synthetic-A'].outbox.length, 2); equal(read.catalog.keyId, (await s.c.read()).catalog.keyId);
        const before = JSON.stringify((await s.storage.inspect()).snapshots);
        await rejects(() => other.changePassword(stage4Password, stage4Password), 'unlock-failed');
        equal(JSON.stringify((await s.storage.inspect()).snapshots), before);
    });
    add('recovery preparation survives restart; custody and activation retain prior recovery', async () => {
        const s = await source(), before = (await s.c.read()).documents;
        const renewal = await s.c.renewRecovery();
        await rejects(() => s.c.confirmRecoveryCustody(renewal.operationId, { recoverySecret: renewal.recoverySecret }), 'invalid-input');
        await rejects(() => s.c.confirmRecoveryCustody(renewal.operationId, { recoverySecret: s.created.recoverySecret, externalCustodyConfirmed: true }), 'recovery-failed');
        await s.c.lock(); await rejects(() => s.c.unlockWithRecovery(renewal.recoverySecret), 'recovery-failed');
        await s.c.unlockWithRecovery(s.created.recoverySecret);
        const stale = await s.c.confirmRecoveryCustody(renewal.operationId, { recoverySecret: renewal.recoverySecret, externalCustodyConfirmed: true });
        await s.c.lock(); await s.c.unlockWithRecovery(s.created.recoverySecret);
        await rejects(() => s.c.activateRecovery(stale), 'cancelled');
        s.c.close(); const resumed = controller(await s.storage.reopen()); await resumed.unlockWithRecovery(s.created.recoverySecret);
        const token = await resumed.confirmRecoveryCustody(renewal.operationId, { recoverySecret: renewal.recoverySecret, externalCustodyConfirmed: true });
        await resumed.activateRecovery(token);
        await rejects(() => resumed.activateRecovery(token), 'invalid-input');
        await resumed.lock(); await resumed.unlockWithRecovery(s.created.recoverySecret);
        equal((await resumed.read()).documents, before);
        await resumed.lock(); await resumed.unlockWithRecovery(renewal.recoverySecret);
        const pack = await resumed.exportRecoveryPackage();
        const dest = controller((await makeStore()).store);
        await dest.importRecoveryPackage(pack, { recoverySecret: s.created.recoverySecret, newPassword: stage4Password });
        equal((await dest.read()).documents, before);
    });
    add('cancelled recovery preparation preserves active recovery and permits another preparation', async () => {
        const s = await source(), renewal = await s.c.renewRecovery();
        await rejects(() => s.c.cancelRecoveryPreparation('wrong-id'), 'invalid-input');
        await s.c.cancelRecoveryPreparation(renewal.operationId);
        await s.c.lock(); await s.c.unlockWithRecovery(s.created.recoverySecret);
        const next = await s.c.renewRecovery(); ok(next.operationId !== renewal.operationId);
    });
    add('free financial category namespaces do not become internal references', async () => {
        const storage = await makeStore(), c = controller(storage.store), docs = stage4Documents();
        for (const name of ['recoveryKeys', 'queue', 'generation', 'catalog', 'constructor', '__proto__']) {
            Object.defineProperty(docs['estado:synthetic-A'], name, { value: { recoveryKeys: 42 }, enumerable: true });
        }
        await c.create({ password: stage4Password, generation: 'generation-a', documents: docs });
        equal((await c.read()).documents['estado:synthetic-A'].recoveryKeys, { recoveryKeys: 42 });
    });
    add('aggregate capacity failure preserves prior snapshot and offline operations', async () => {
        const s = await source(), before = JSON.stringify((await s.storage.inspect()).snapshots);
        const updates = { 'snapshot:synthetic-A:capacity-a': { payload: 'x'.repeat(5 * 1024 * 1024) }, 'snapshot:synthetic-A:capacity-b': { payload: 'y'.repeat(5 * 1024 * 1024) } };
        await rejects(() => s.c.prepare({ expectedRevision: 1, generation: 'generation-a', updates }));
        equal(JSON.stringify((await s.storage.inspect()).snapshots), before);
        equal((await s.c.read()).documents['fila:synthetic-A'].outbox.length, 2);
    });
    add('lost activation acknowledgement retains both cryptographically verified recovery paths', async () => {
        const storage = await makeStore(); let lose = false;
        const store = { ...storage.store, compareAndSwap: async (...args) => {
            const result = await storage.store.compareAndSwap(...args);
            if (lose) { lose = false; throw new VaultStoreError('write-failed'); } return result;
        } };
        const c = controller(store), created = await c.create({ password: stage4Password, generation: 'generation-a', documents: stage4Documents() });
        const renewal = await c.renewRecovery();
        const token = await c.confirmRecoveryCustody(renewal.operationId, { recoverySecret: renewal.recoverySecret, externalCustodyConfirmed: true });
        lose = true; await rejects(() => c.activateRecovery(token), 'write-failed');
        await c.lock(); await c.unlockWithRecovery(created.recoverySecret);
        equal((await c.read()).documents['fila:synthetic-A'].outbox.length, 2);
        await c.lock(); await c.unlockWithRecovery(renewal.recoverySecret);
        equal((await c.read()).catalog.recoveryPending, null);
    });
    add('typed Timestamp bounds reject malformed semantic properties before and after decoding', async () => {
        const codec = stage4Codec();
        for (const [seconds, nanos] of [[-62135596800, 0], [253402300799, 999999999]]) {
            const value = new SyntheticTimestamp(seconds, nanos); equal(codec.decode(codec.encode(value)), value);
        }
        for (const [seconds, nanos] of [[NaN, 0], [Infinity, 0], [1.5, 0], [-62135596801, 0], [253402300800, 0], [0, -1], [0, 1e9], [0, NaN], [0, 0.1]]) {
            await rejects(() => codec.encode(new SyntheticTimestamp(seconds, nanos)), 'codec-invalid');
        }
    });
    return cases;
}
