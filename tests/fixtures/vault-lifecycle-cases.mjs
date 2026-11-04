import { createVaultLifecycle } from '../../experimental/finance-vault-lifecycle.js';
import { createRealVaultAdapter } from '../../experimental/finance-vault-real-adapter.js';
import { realContractClient } from './vault-real-client.mjs';
import { documents, password, month, equal, ok, rejects, serialLocks } from './vault-real-scenarios.mjs';
export { password, month, equal, ok, rejects };
export const ownerA = { projectId: 'demo-lifecycle', uid: 'synthetic-lifecycle-A' };
export const ownerB = { ...ownerA, uid: 'synthetic-lifecycle-B' };
export const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
export function enrollmentDocuments(owner) {
    const docs = documents(owner.uid);
    docs[`snapshot:${owner.uid}:lifecycle-owner`] = { format: 'synthetic-authenticated-owner-v1', owner };
    docs[`snapshot:${owner.uid}:synthetic-preserved`] = { synthetic: 'SYNTHETIC RECOVERY RETAINED' };
    const q = docs[`fila:${owner.uid}`]; q.recoveryKeys.push(`snapshot:${owner.uid}:synthetic-preserved`);
    q.conflicts.push({ id: 'synthetic-existing-conflict', kind: 'synthetic-preserved' });
    return docs;
}
export async function enroll(store, owner, crypto, locks) {
    const a = createRealVaultAdapter({ store, owner, crypto, locks });
    await a.create({ password, generation: 'legacy', documents: enrollmentDocuments(owner) }); await a.lock(); a.close();
}
export const income = (c, id = 'synthetic-lifecycle-income') => c.edit(s => {
    s.meses[month].receitas.push({ id, nome: 'SYNTHETIC LIFECYCLE INCOME', valor: 321.09, recebido: false });
});
export const queue = async c => (await c.read()).documents[`fila:${c.state().owner.uid}`];
export const ack = op => ({ acknowledged: true, operationId: op.id, generation: op.generation || 'legacy', revision: op.id });
export async function makeLifecycle(storage, owner, { crypto, locks = serialLocks(), onState, wrap = s => s } = {}) {
    const c = createVaultLifecycle({ revocationScope: 'owner-vault-all-tabs', onState,
        openAdapter: async selected => createRealVaultAdapter({ store: wrap(await storage.reopen()), owner: selected, crypto, locks }) });
    c.start(); if (owner) await c.identify({ kind: 'confirmed', owner }); return c;
}
export function lifecycleCases({ makeStore, crypto = globalThis.crypto, locks = serialLocks() }) {
    const cases = [], closers = [];
    function add(name, fn) { cases.push({ name, run: async () => { try { await fn(); } finally { for (const c of closers.splice(0)) await c.close('logout').catch(() => {}); } } }); }
    async function setup(owner = ownerA, opts = {}) {
        const storage = await makeStore(); await enroll(await storage.reopen(), owner, crypto, locks);
        const c = await makeLifecycle(storage, owner, { crypto, locks, ...opts }); closers.push(c); return { storage, c };
    }
    add('explicit synthetic scope and owner are mandatory', async () => {
        await rejects(() => createVaultLifecycle({ openAdapter() {} })); const { c } = await setup();
        await rejects(() => c.identify({ kind: 'confirmed', owner: { ...ownerA, uid: 'real-person' } }));
        await c.identify({ kind: 'none' }); equal(c.state().phase, 'signed-out'); equal(c.state().ownership, 'none'); await rejects(() => c.unlock(password));
    });
    add('LC-01 latest logout supersedes queued identity; latest A-B-A intent wins', async () => {
        const { c } = await setup();
        const pending = c.identify({ kind: 'confirmed', owner: ownerA }).then(() => null, e => e.code);
        await c.close('logout'); equal(await pending, 'lifecycle/stale-session'); equal(c.state().phase, 'signed-out'); equal(c.state().owner, null);
        const a = c.identify({ kind: 'confirmed', owner: ownerA }).then(() => null, e => e.code);
        const b = c.identify({ kind: 'confirmed', owner: ownerB }).then(() => null, e => e.code);
        const last = c.identify({ kind: 'confirmed', owner: ownerA }); await last;
        equal(await a, 'lifecycle/stale-session'); equal(await b, 'lifecycle/stale-session'); equal(c.state().owner, ownerA);
        await c.unlock(password); await income(c); ok((await queue(c)).outbox.length === 1);
    });
    add('LC-01 lock and suspension supersede queued identities before they can change owner', async () => {
        const { c } = await setup();
        for (const reason of ['lock', 'suspend']) {
            const stale = c.identify({ kind: 'confirmed', owner: ownerB }).then(() => null, e => e.code);
            await c.close(reason); equal(await stale, 'lifecycle/stale-session'); equal(c.state().owner, ownerA);
            equal(c.state().phase, reason === 'lock' ? 'locked' : 'suspended'); await rejects(() => c.read());
            await c.identify({ kind: 'confirmed', owner: ownerA });
        }
        await c.unlock(password); await income(c); equal((await queue(c)).outbox.length, 1);
    });
    add('LC-01 logout wins while identity and local commit are both queued without deadlock or queue loss', async () => {
        const entered = deferred(), release = deferred(); let hold = false;
        const { c } = await setup(ownerA, { wrap: s => ({ ...s, async compareAndSwap(...args) {
            if (hold) { entered.resolve(); await release.promise; } return s.compareAndSwap(...args);
        } }) });
        await c.unlock(password); hold = true; const write = income(c); await entered.promise;
        const stale = c.identify({ kind: 'confirmed', owner: ownerB }).then(() => null, e => e.code);
        const closing = c.close('logout'); equal(c.state().phase, 'closing');
        await rejects(() => income(c, 'synthetic-after-logout')); release.resolve();
        equal((await write).durable, true); await closing; equal(await stale, 'lifecycle/stale-session');
        equal(c.state().phase, 'signed-out'); equal(c.state().owner, null); hold = false;
        await c.identify({ kind: 'unconfirmed', owner: ownerA }); await c.unlock(password);
        equal((await queue(c)).outbox.length, 1); equal((await queue(c)).conflicts, enrollmentDocuments(ownerA)[`fila:${ownerA.uid}`].conflicts);
    });
    add('LC-01 logout cancels blocked unlock and stale completion cannot install its key', async () => {
        const entered = deferred(), release = deferred(); let block = true;
        const { c } = await setup(ownerA, { wrap: s => ({ ...s, async loadCatalog(...args) {
            if (block) { block = false; entered.resolve(); await release.promise; } return s.loadCatalog(...args);
        } }) });
        const unlocking = c.unlock(password).then(() => null, e => e.code); await entered.promise;
        await c.close('logout'); equal(c.state().owner, null); release.resolve();
        equal(await unlocking, 'lifecycle/stale-session'); equal(c.state().phase, 'signed-out'); await rejects(() => c.read());
        await c.identify({ kind: 'confirmed', owner: ownerA }); await c.unlock(password); await income(c);
        equal((await queue(c)).outbox.length, 1);
    });
    add('locked reads nothing financial; wrong password and auth error never produce empty state', async () => {
        let reads = 0; const { c } = await setup(ownerA, { wrap: s => ({ ...s, load(...args) { reads++; return s.load(...args); } }) });
        equal(reads, 0); await rejects(() => c.read()); equal(reads, 0); await rejects(() => c.unlock('synthetic-wrong-password'));
        equal(c.state().data, null); await c.identify({ kind: 'failed' }); equal(c.state().phase, 'error'); await rejects(() => c.read());
    });
    add('explicit offline owner plus secret opens only authenticated matching owner binding', async () => {
        const { c } = await setup(); await c.identify({ kind: 'unconfirmed', owner: ownerA }); await c.unlock(password);
        equal(c.state().ownership, 'unconfirmed'); await income(c); const before = await queue(c);
        await rejects(() => c.send(() => { throw new Error('must not call remote'); })); equal((await queue(c)).outbox, before.outbox);
        await c.close('logout'); await c.identify({ kind: 'unconfirmed', owner: ownerA }); await c.unlock(password); equal((await queue(c)).outbox, before.outbox);
    });
    add('forged or missing encrypted enrollment binding cannot authorize offline owner', async () => {
        const storage = await makeStore(); const a = createRealVaultAdapter({ store: await storage.reopen(), owner: ownerA, crypto, locks });
        await a.create({ password, generation: 'legacy', documents: documents(ownerA.uid) }); a.close();
        const c = await makeLifecycle(storage, ownerA, { crypto, locks }); closers.push(c);
        await rejects(() => c.unlock(password)); equal(c.state().phase, 'error'); await rejects(() => c.read());
    });
    add('SDK-shaped ACK without echoed ID uses the exact commit invocation and duplicate retry is idempotent', async () => {
        const { c } = await setup(); await c.unlock(password); await income(c);
        const remote = realContractClient(ownerA), before = await queue(c); remote.remote.loseNextAck();
        await rejects(() => c.send((uid, op) => remote.client.commit(uid, op))); await c.close();
        await c.identify({ kind: 'confirmed', owner: ownerA }); await c.unlock(password); equal((await queue(c)).outbox, before.outbox);
        await c.send((uid, op) => remote.client.commit(uid, op)); equal((await queue(c)).outbox.length, 0); equal(remote.remote.inspect(ownerA).records.length, 1);
    });
    add('drain waits local commit, gates new work, and preserves exact state and queue', async () => {
        const entered = deferred(), release = deferred(); let hold = false;
        const { c } = await setup(ownerA, { wrap: s => ({ ...s, async compareAndSwap(...args) { if (hold) { entered.resolve(); await release.promise; } return s.compareAndSwap(...args); } }) });
        await c.unlock(password); hold = true; const write = income(c); await entered.promise;
        let ended = false; const closing = c.close('logout').then(() => { ended = true; });
        equal(c.state().phase, 'closing'); await rejects(() => income(c, 'synthetic-too-late')); ok(!ended);
        release.resolve(); equal((await write).durable, true); await closing; equal(c.state().phase, 'signed-out');
        hold = false; await c.identify({ kind: 'confirmed', owner: ownerA }); await c.unlock(password);
        const q = await queue(c); equal(q.outbox.length, 1); equal(q.conflicts, enrollmentDocuments(ownerA)[`fila:${ownerA.uid}`].conflicts); equal(q.recoveryKeys.length, 1);
    });
    add('remote ACK is not part of local drain and cannot affect reopened same-UID session', async () => {
        const { c } = await setup(); await c.unlock(password); await income(c); const before = await queue(c), entered = deferred(), release = deferred();
        const send = c.send(async (_uid, op) => { entered.resolve(); await release.promise; return ack(op); }).then(() => null, e => e.code);
        await entered.promise; await c.close('logout'); await c.identify({ kind: 'confirmed', owner: ownerA }); await c.unlock(password);
        const pending = await queue(c); ok(pending.attempted[before.outbox[0].id]); release.resolve(); equal(await send, 'lifecycle/stale-session'); equal((await queue(c)).outbox, pending.outbox);
        await c.send(async (_uid, op) => ack(op)); equal((await queue(c)).outbox.length, 0); equal((await queue(c)).conflicts, before.conflicts);
    });
    add('wrong, absent and rejected ACKs preserve exact operation; valid individual ACK drains only its item', async () => {
        const { c } = await setup(); await c.unlock(password); await income(c, 'synthetic-ack-1'); await income(c, 'synthetic-ack-2'); const before = await queue(c);
        for (const result of [{}, { acknowledged: true, operationId: 'other', generation: 'legacy' }, { acknowledged: true, operationId: before.outbox[0].id, generation: 'wrong' }]) {
            await rejects(() => c.send(async () => result)); equal((await queue(c)).outbox, before.outbox);
        }
        let count = 0; await rejects(() => c.send(async (_uid, op) => { if (++count === 2) throw Object.assign(new Error('Synthetic network'), { code: 'unavailable' }); return ack(op); }));
        await c.close(); await c.identify({ kind: 'confirmed', owner: ownerA }); await c.unlock(password); equal((await queue(c)).outbox.map(o => o.id), [before.outbox[1].id]);
    });
    add('durable epoch rejects peer without any channel, then explicit reopen preserves tombstone', async () => {
        const { c, storage } = await setup(); await c.unlock(password); const peer = await makeLifecycle(storage, ownerA, { crypto, locks }); closers.push(peer); await peer.unlock(password);
        await income(c); await peer.edit(s => { s.meses[month].receitas = []; }); const before = await peer.read();
        ok(before.documents[`fila:${ownerA.uid}`].outbox.some(o => o.value.deleted)); await c.close('logout');
        await rejects(() => income(peer, 'synthetic-stale-peer')); await rejects(() => peer.read());
        await peer.close(); await peer.identify({ kind: 'confirmed', owner: ownerA }); await peer.unlock(password);
        equal((await peer.read()).documents, before.documents);
    });
    add('suspended prepared write loses CAS to durable peer revoke; no success is reported', async () => {
        const entered = deferred(), release = deferred(); let hold = false;
        const { c, storage } = await setup(ownerA, { wrap: s => ({ ...s, async compareAndSwap(...args) { if (hold) { entered.resolve(); await release.promise; } return s.compareAndSwap(...args); } }) });
        await c.unlock(password); await income(c); const before = (await c.read()).documents;
        const peer = await makeLifecycle(storage, ownerA, { crypto, locks }); closers.push(peer); await peer.unlock(password);
        hold = true; const write = income(c, 'synthetic-not-committed').then(() => null, e => e.code); await entered.promise;
        await peer.close('logout'); release.resolve(); ok(await write); await c.close(); hold = false;
        await c.identify({ kind: 'confirmed', owner: ownerA }); await c.unlock(password); equal((await c.read()).documents, before);
    });
    add('A-B-A never infers owner or loses pending operations', async () => {
        const { c, storage } = await setup(); await enroll(await storage.reopen(), ownerB, crypto, locks); await c.unlock(password); await income(c); const before = (await c.read()).documents;
        await c.identify({ kind: 'confirmed', owner: ownerB }); equal(c.state().data, null); await rejects(() => c.read()); await c.unlock(password);
        equal((await queue(c)).outbox.length, 0); await income(c, 'synthetic-account-B'); await c.identify({ kind: 'confirmed', owner: ownerA }); await c.unlock(password); equal((await c.read()).documents, before);
    });
    add('suspend and resume require a fresh secret and remote owner confirmation', async () => {
        const { c } = await setup(); await c.unlock(password); await income(c); const before = (await c.read()).documents;
        await c.suspend(); equal(c.state().phase, 'suspended'); await c.resume(); equal(c.state().phase, 'locked'); await rejects(() => c.read()); await c.unlock(password);
        equal(c.state().ownership, 'unconfirmed'); equal((await c.read()).documents, before); await rejects(() => c.send(async (_uid, op) => ack(op)));
    });
    add('quota failure has no durable receipt, does not drop existing queue and recovery', async () => {
        const { c, storage } = await setup(); await c.unlock(password); await income(c); const before = (await c.read()).documents;
        storage.setFaults({ beforePut() { throw Object.assign(new Error('Synthetic quota'), { name: 'QuotaExceededError' }); } });
        await rejects(() => income(c, 'synthetic-quota')); storage.setFaults({}); await c.close(); await c.identify({ kind: 'confirmed', owner: ownerA }); await c.unlock(password); equal((await c.read()).documents, before);
    });
    add('failed durable revoke blocks closure and account transition until retry succeeds', async () => {
        let failBump = false; const { c } = await setup(ownerA, { wrap: s => ({ ...s, bumpEpoch(...args) { if (failBump) return Promise.reject(Object.assign(new Error('Synthetic fence failure'), { code: 'write-failed' })); return s.bumpEpoch(...args); } }) });
        await c.unlock(password); await income(c); failBump = true; await rejects(() => c.close('logout')); equal(c.state().phase, 'error'); await rejects(() => c.read());
        await rejects(() => c.identify({ kind: 'confirmed', owner: ownerB })); equal(c.state().owner, ownerA);
        failBump = false; await c.close('logout'); equal(c.state().phase, 'signed-out');
    });
    return cases;
}
