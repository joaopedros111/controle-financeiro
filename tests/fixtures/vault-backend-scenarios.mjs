import { createVaultBackend } from '../../finance-vault-backend.js';
import { createVaultCrypto } from '../../finance-vault-crypto.js';
import { preservationFixture } from './vault-contract.mjs';

// All backend data is synthetic and JSON-compatible.
export const vaultContext = uid => ({ owner: { projectId: 'demo-cf-vault', uid }, vaultId: `vault-${uid}`, keyId: `dek-${uid}` });
export const vaultPassword = 'synthetic-vault-passphrase-only';
const equal = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Synthetic comparison failed'); };
const ok = v => { if (!v) throw new Error('Synthetic assertion failed'); };
async function rejects(operation, code) {
    let failure; try { await operation(); } catch (error) { failure = error; }
    ok(failure); if (code) equal(failure.code, code); return failure;
}
function flip(value) { return (value[0] === 'A' ? 'B' : 'A') + value.slice(1); }
export function backendCases({ makeStore, crypto }) {
    const cases = [], add = (name, run) => cases.push({ name, run });
    async function setup(provider = crypto) {
        const fixture = preservationFixture(), context = vaultContext(fixture.owner.uid), storage = await makeStore();
        const backend = createVaultBackend({ store: storage.store, context, crypto: provider });
        await backend.createKey();
        const envelope = await backend.protectWithPassword(vaultPassword);
        await backend.initialize({ generation: 'generation-a', documents: fixture.documents });
        return { backend, storage, context, envelope, fixture, provider };
    }
    const updates = s => ({ [`estado:${s.context.owner.uid}`]: { ...s.fixture.documents[`estado:${s.context.owner.uid}`], syntheticUpdate: 42.17 } });
    const prepare = s => s.backend.prepare({ expectedRevision: 1, generation: 'generation-a', updates: updates(s) });
    add('encrypted write/read preserves exact state, outbox, conflicts and recovery graph', async () => {
        const s = await setup(), read = await s.backend.read();
        equal(JSON.parse(JSON.stringify(read.documents)), JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(s.fixture.documents).sort()))));
        equal(read.revision, 1); equal(read.generation, 'generation-a'); await s.backend.close();
    });
    add('physical storage has ciphertext and public metadata, no financial plaintext', async () => {
        const s = await setup(), raw = JSON.stringify(await s.storage.inspect());
        for (const secret of ['1234.56', '42.17', 'synthetic-pending', 'synthetic-conflict', 'Categoria sintética', vaultPassword, 'syntheticRejected', 'outbox']) ok(!raw.includes(secret));
        ok(raw.includes('AES-256-GCM')); await s.backend.close();
    });
    add('state and queue updates commit together and retain omitted recoveries', async () => {
        const s = await setup(), queue = structuredClone(s.fixture.documents['fila:synthetic-A']);
        queue.outbox.push({ id: 'synthetic-next-op', record: { amount: 100.07 } });
        const token = await s.backend.prepare({ expectedRevision: 1, generation: 'generation-a', updates: { ...updates(s), 'fila:synthetic-A': queue } });
        equal((await s.backend.read()).revision, 1);
        equal(await s.backend.commit(token), 2);
        const read = await s.backend.read(); equal(read.documents['estado:synthetic-A'].syntheticUpdate, 42.17);
        equal(read.documents['fila:synthetic-A'].outbox.at(-1).id, 'synthetic-next-op');
        equal(read.documents['restore-recovery:synthetic-A:edit-one'], s.fixture.documents['restore-recovery:synthetic-A:edit-one']);
        await rejects(() => s.backend.commit(token), 'invalid-operation'); await s.backend.close();
    });
    add('two instances preparing the same revision produce exactly one winning commit', async () => {
        const s = await setup(), otherStore = await s.storage.reopen();
        const other = createVaultBackend({ store: otherStore, context: s.context, crypto });
        await other.unlockWithPassword(s.envelope, vaultPassword);
        const [a, b] = await Promise.all([prepare(s), other.prepare({ expectedRevision: 1, generation: 'generation-a', updates: { 'estado:synthetic-A': { syntheticWinner: 'B' } } })]);
        const results = await Promise.allSettled([s.backend.commit(a), other.commit(b)]);
        equal(results.filter(r => r.status === 'fulfilled').length, 1);
        equal(results.find(r => r.status === 'rejected').reason.code, 'stale-revision');
        equal((await other.read()).revision, 2); await other.close(); await s.backend.close();
    });
    add('stale revision never prepares a replacement or resets previous state', async () => {
        const s = await setup(); await s.backend.commit(await prepare(s));
        const before = await s.backend.read(); await rejects(() => prepare(s), 'stale-revision'); equal(await s.backend.read(), before); await s.backend.close();
    });
    add('restart preserves financial snapshot and durable nonce reservations', async () => {
        const s = await setup(), before = await s.backend.read(); await s.backend.close();
        const reopened = createVaultBackend({ store: await s.storage.reopen(), context: s.context, crypto });
        await rejects(() => reopened.read(), 'locked');
        await reopened.unlockWithPassword(s.envelope, vaultPassword); equal(await reopened.read(), before);
        const token = await reopened.prepare({ expectedRevision: 1, generation: 'generation-a', updates: updates(s) });
        await reopened.commit(token); equal((await reopened.read()).revision, 2); await reopened.close();
    });
    add('wrong unlock and wrong recovery leave ciphertext unchanged and backend locked', async () => {
        const s = await setup(), recovery = await s.backend.protectWithRecovery(), before = JSON.stringify((await s.storage.inspect()).snapshots);
        await rejects(() => s.backend.unlockWithPassword(s.envelope, 'synthetic-wrong-passphrase'), 'unlock-failed');
        await rejects(() => s.backend.read(), 'locked');
        await rejects(() => s.backend.unlockWithRecovery(recovery.envelope, flip(recovery.recoverySecret)), 'recovery-failed');
        equal(JSON.stringify((await s.storage.inspect()).snapshots), before);
        await s.backend.unlockWithRecovery(recovery.envelope, recovery.recoverySecret); equal((await s.backend.read()).revision, 1); await s.backend.close();
    });
    add('missing, locked, failed read and corruption are distinct and never auto-initialize', async () => {
        const storage = await makeStore(), backend = createVaultBackend({ store: storage.store, context: vaultContext('synthetic-A'), crypto });
        await rejects(() => backend.read(), 'locked'); await backend.createKey(); await rejects(() => backend.read(), 'missing');
        equal((await storage.inspect()).snapshots.length, 0);
        storage.setFaults({ afterRead() { throw new Error('synthetic-read-error'); } });
        await rejects(() => backend.read(), 'read-failed'); storage.setFaults({});
        equal((await storage.inspect()).snapshots.length, 0); await backend.close();
    });
    for (const fault of ['beforePut', 'afterPut', 'abort', 'quota']) add(`failed ${fault} commit preserves ALL previous documents and consumes reservations`, async () => {
        const s = await setup(), before = await s.backend.read(), beforeRaw = JSON.stringify((await s.storage.inspect()).snapshots);
        const n = (await s.storage.inspect()).nonces.length, token = await prepare(s);
        ok((await s.storage.inspect()).nonces.length > n);
        s.storage.setFaults(fault === 'abort' ? { afterPut(tx) { tx.abort(); } }
            : fault === 'quota' ? { afterPut() { throw new DOMException('synthetic-quota', 'QuotaExceededError'); } }
            : { [fault]() { throw new Error('synthetic-failure'); } });
        await rejects(() => s.backend.commit(token), fault === 'quota' ? 'quota-exceeded' : 'write-failed');
        s.storage.setFaults({}); equal(await s.backend.read(), before); equal(JSON.stringify((await s.storage.inspect()).snapshots), beforeRaw);
        ok((await s.storage.inspect()).nonces.length > n); await s.backend.close();
    });
    add('preparation crypto failure after reservations preserves previous snapshot', async () => {
        let failEncrypt = false, calls = 0;
        const provider = { getRandomValues: bytes => crypto.getRandomValues(bytes), subtle: new Proxy(crypto.subtle, {
            get(target, name) {
                if (name === 'encrypt') return (...args) => { if (failEncrypt && ++calls === 2) throw new Error('synthetic-encryption-failure'); return target.encrypt(...args); };
                const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
            }
        }) };
        const s = await setup(provider), before = await s.backend.read(), n = (await s.storage.inspect()).nonces.length;
        failEncrypt = true; await rejects(() => prepare(s), 'crypto-failed'); failEncrypt = false;
        equal(await s.backend.read(), before); ok((await s.storage.inspect()).nonces.length > n); await s.backend.close();
    });
    add('failed recovery reference validation preserves the full old graph', async () => {
        const s = await setup(), before = await s.backend.read(), queue = structuredClone(s.fixture.documents['fila:synthetic-A']);
        queue.recoveryKeys.push('restore-recovery:synthetic-A:missing');
        await rejects(() => s.backend.prepare({ expectedRevision: 1, generation: 'generation-a', updates: { 'fila:synthetic-A': queue } }), 'invalid-input');
        equal(await s.backend.read(), before); await s.backend.close();
    });
    for (const change of ['ciphertext', 'revision', 'owner', 'document', 'manifest', 'generation']) add(`stored ${change} adulteration is corruption, not missing`, async () => {
        const s = await setup();
        await s.storage.mutate(raw => {
            if (change === 'ciphertext') raw.documents[0].ciphertext = flip(raw.documents[0].ciphertext);
            if (change === 'revision') raw.documents[0].revision--;
            if (change === 'owner') raw.documents[0].owner.uid = 'synthetic-B';
            if (change === 'document') raw.documents.reverse();
            if (change === 'manifest') raw.manifest.ciphertext = flip(raw.manifest.ciphertext);
            if (change === 'generation') raw.generation = 'other-generation';
        });
        await rejects(() => s.backend.read(), 'corruption');
        await rejects(() => prepare(s), 'corruption'); await s.backend.close();
    });
    add('replaying an old document or old bundle cannot bypass revision checks', async () => {
        const s = await setup(), old = structuredClone((await s.storage.inspect()).snapshots[0][1]);
        await s.backend.commit(await prepare(s));
        await s.storage.mutate(raw => { raw.documents[0] = old.documents[0]; });
        await rejects(() => s.backend.read(), 'corruption');
        await s.storage.mutate(raw => { Object.assign(raw, old); });
        await rejects(() => s.backend.read(), 'corruption'); await s.backend.close();
    });
    add('account B cannot open A envelopes, overwrite A snapshot or import A recoveries', async () => {
        const s = await setup(), other = createVaultBackend({ store: await s.storage.reopen(), context: vaultContext('synthetic-B'), crypto });
        await rejects(() => other.unlockWithPassword(s.envelope, vaultPassword), 'context-mismatch');
        await other.createKey(); await rejects(() => other.read(), 'missing');
        await rejects(() => other.initialize({ generation: 'generation-a', documents: s.fixture.documents }), 'invalid-input');
        equal((await s.backend.read()).revision, 1); await other.close(); await s.backend.close();
    });
    add('lock after preparation rejects commit and preserves offline operations', async () => {
        const s = await setup(), before = await s.backend.read(), token = await prepare(s);
        s.backend.lock(); await rejects(() => s.backend.commit(token), 'locked');
        await s.backend.unlockWithPassword(s.envelope, vaultPassword); equal(await s.backend.read(), before); await s.backend.close();
    });
    add('durable nonce registry rejects duplicate candidates across instances and restart', async () => {
        const storage = await makeStore(), fingerprint = 'A'.repeat(43), iv = 'B'.repeat(16);
        const results = await Promise.all([storage.store.reserveIV({ keyFingerprint: fingerprint, iv }), (await storage.reopen()).reserveIV({ keyFingerprint: fingerprint, iv })]);
        equal(results.sort(), [false, true]); storage.store.close();
        const reopened = await storage.reopen(); equal(await reopened.reserveIV({ keyFingerprint: fingerprint, iv }), false); reopened.close();
    });
    add('failed reservation never starts encryption and is not falsely acknowledged', async () => {
        const storage = await makeStore(); let encrypts = 0;
        const provider = { getRandomValues: bytes => crypto.getRandomValues(bytes), subtle: new Proxy(crypto.subtle, {
            get(target, name) { if (name === 'encrypt') return (...args) => { encrypts++; return target.encrypt(...args); }; const fn = target[name]; return typeof fn === 'function' ? fn.bind(target) : fn; }
        }) };
        const api = createVaultCrypto({ crypto: provider, reserveIV: value => storage.store.reserveIV(value) });
        const context = vaultContext('synthetic-A'), key = await api.generateDataKey(context);
        storage.setFaults({ afterReserve(tx) { tx.abort(); } });
        await rejects(() => api.encryptDocument(key, new Uint8Array([1]), { ...context, documentId: 'estado:synthetic-A', schemaVersion: 1, revision: 1, generation: 'generation-a' }), 'reservation-failed');
        equal(encrypts, 0); equal((await storage.inspect()).nonces.length, 0);
        api.destroyKey(key); storage.store.close();
    });
    add('reused RNG candidate after successful reservation and crash cannot encrypt again', async () => {
        const storage = await makeStore(), context = vaultContext('synthetic-A');
        const provider = { subtle: crypto.subtle, getRandomValues: bytes => bytes.fill(9) };
        const a = createVaultCrypto({ crypto: provider, reserveIV: r => storage.store.reserveIV(r) });
        const keyA = await a.generateDataKey(context), doc = { ...context, documentId: 'estado:synthetic-A', schemaVersion: 1, revision: 1, generation: 'generation-a' };
        await a.encryptDocument(keyA, new Uint8Array([1]), doc); a.destroyKey(keyA); storage.store.close();
        const nextStore = await storage.reopen(), b = createVaultCrypto({ crypto: provider, reserveIV: r => nextStore.reserveIV(r) });
        const keyB = await b.generateDataKey(context); // identical synthetic DEK, brand-new factory
        await rejects(() => b.encryptDocument(keyB, new Uint8Array([2]), doc), 'nonce-unavailable');
        b.destroyKey(keyB); nextStore.close();
    });
    add('same key under different labels still shares a durable nonce namespace', async () => {
        const storage = await makeStore(), provider = { subtle: crypto.subtle, getRandomValues: bytes => bytes.fill(7) };
        const a = createVaultCrypto({ crypto: provider, reserveIV: r => storage.store.reserveIV(r) });
        const first = vaultContext('synthetic-A'), key = await a.generateDataKey(first);
        await a.encryptDocument(key, new Uint8Array(), { ...first, documentId: 'estado:synthetic-A', schemaVersion: 1, revision: 1, generation: 'generation-a' });
        const b = createVaultCrypto({ crypto: provider, reserveIV: r => storage.store.reserveIV(r) });
        const second = vaultContext('synthetic-B'), other = await b.generateDataKey(second);
        await rejects(() => b.encryptDocument(other, new Uint8Array(), { ...second, documentId: 'estado:synthetic-B', schemaVersion: 1, revision: 1, generation: 'generation-a' }), 'nonce-unavailable');
        a.destroyKey(key); b.destroyKey(other); storage.store.close();
    });
    add('failure after IV reservation but before encryption cannot recycle the candidate on restart', async () => {
        const storage = await makeStore(), context = vaultContext('synthetic-A');
        const broken = { getRandomValues: bytes => bytes.fill(6), subtle: new Proxy(crypto.subtle, {
            get(target, name) { if (name === 'encrypt') return () => { throw new Error('synthetic-provider-crash'); }; const fn = target[name]; return typeof fn === 'function' ? fn.bind(target) : fn; }
        }) };
        const a = createVaultCrypto({ crypto: broken, reserveIV: r => storage.store.reserveIV(r) });
        const key = await a.generateDataKey(context), doc = { ...context, documentId: 'estado:synthetic-A', schemaVersion: 1, revision: 1, generation: 'generation-a' };
        await rejects(() => a.encryptDocument(key, new Uint8Array(), doc), 'crypto-failed');
        equal((await storage.inspect()).nonces.length, 1); storage.store.close();
        const nextStore = await storage.reopen();
        const b = createVaultCrypto({ crypto: { subtle: crypto.subtle, getRandomValues: bytes => bytes.fill(6) }, reserveIV: r => nextStore.reserveIV(r) });
        const next = await b.generateDataKey(context);
        await rejects(() => b.encryptDocument(next, new Uint8Array(), doc), 'nonce-unavailable');
        a.destroyKey(key); b.destroyKey(next); nextStore.close();
    });
    add('generation mismatch and lossy JSON types are rejected without writes', async () => {
        const s = await setup(), before = await s.backend.read();
        await rejects(() => s.backend.prepare({ expectedRevision: 1, generation: 'other', updates: updates(s) }), 'invalid-input');
        for (const value of [new Date(), undefined, NaN, -0, 1n]) {
            await rejects(() => s.backend.prepare({ expectedRevision: 1, generation: 'generation-a', updates: { 'estado:synthetic-A': { value } } }), 'invalid-input');
        }
        equal(await s.backend.read(), before); await s.backend.close();
    });
    add('quota failure during nonce reservation cannot produce ciphertext', async () => {
        const s = await setup(), before = await s.backend.read();
        s.storage.setFaults({ afterReserve() { throw new DOMException('synthetic-quota', 'QuotaExceededError'); } });
        await rejects(() => prepare(s), 'quota-exceeded');
        s.storage.setFaults({}); equal(await s.backend.read(), before); await s.backend.close();
    });
    return cases;
}
