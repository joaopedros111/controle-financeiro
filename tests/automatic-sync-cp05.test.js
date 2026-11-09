import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealVaultAdapter } from '../experimental/finance-vault-real-adapter.js';
import { memoryVaultFactory } from './fixtures/vault-memory-store.mjs';
import { realContractClient } from './fixtures/vault-real-client.mjs';
import { owner, password, documents, income, month } from './fixtures/vault-real-scenarios.mjs';
import { makeOperation, recordEntityKey, registrosFinanceiros, recordsEquivalent } from '../sync-core.js';

// Real synchronizer, atomic service and crypto; only SDK I/O and IDB are modeled.
async function setup(t) {
    const storage = memoryVaultFactory(), backend = realContractClient(owner);
    const a = createRealVaultAdapter({ store: storage.store, owner });
    const b = createRealVaultAdapter({ store: storage.store, owner });
    t.after(() => { a.close(); b.close(); });
    const created = await a.create({ password, generation: 'legacy', documents: documents() });
    async function connect(adapter, session) {
        const statuses = [], client = { ...backend.client };
        const sync = session.attachSync({ client, readLegacyMetadata: () => ({}),
            connectivity: { navigator: { onLine: true } }, onAccount() {}, onState() {},
            onStatus: (...args) => statuses.push(args) });
        // These races drive each cycle explicitly; offline must not stand in for a paused scheduler.
        sync.request = () => {};
        await sync.useAccount({ uid: owner.uid });
        const h = { adapter, session, sync, client, owner, statuses, confirmations: 0 };
        const confirm = session.service.confirmarSincronizacao.bind(session.service);
        session.service.confirmarSincronizacao = (...args) => { h.confirmations++; return confirm(...args); };
        return h;
    }
    const h = await connect(a, created.session), peer = await connect(b, await b.unlock(password));
    await income(h, 'synthetic-cp05-existing'); await h.sync.cycle(h.sync.session);
    h.statuses.length = 0; h.confirmations = 0;
    return { h, peer, backend };
}
const cycle = h => { h.sync.session.again = false; return h.sync.cycle(h.sync.session); };
const state = h => h.session.db.ler(`estado:${owner.uid}`);
const queue = h => h.session.service.lerFila(owner.uid);
function retainSnapshot(t, h, call) {
    let enter, release, calls = 0;
    const entered = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; });
    const original = h.client.generationSnapshot;
    h.client.generationSnapshot = async (...args) => {
        const captured = await original(...args);
        if (++calls === call) { enter(captured); await gate; }
        return captured;
    };
    t.after(release);
    return { entered, release, calls: () => calls };
}
async function orphan(h, id) {
    await h.session.db.alterarDocumentos([`estado:${owner.uid}`], docs => {
        const stored = docs.get(`estado:${owner.uid}`);
        stored.dados.meses[month].receitas.push({ id, nome: 'SYNTHETIC UNTRACKED', valor: 7, recebido: false });
        stored.revisao++;
        docs.set(`estado:${owner.uid}`, stored); return docs;
    });
}

test('CP-05 old snapshot after another tab ACK retries without error or false confirmation', async t => {
    const { h, peer, backend } = await setup(t), held = retainSnapshot(t, h, 2);
    const running = cycle(h); await held.entered;
    await income(peer, 'synthetic-cp05-confirmed-by-peer'); await cycle(peer);
    const committed = await state(h), acknowledged = await queue(h);
    assert.equal(acknowledged.outbox.length, 0);
    held.release(); await running;
    assert.equal(held.calls(), 3, 'the stale comparison requires a server recheck');
    assert.equal(h.sync.session.again, true); assert.equal(h.sync.session.permanent, false);
    assert.equal(h.confirmations, 0, 'no confirmation against the obsolete snapshot');
    assert.deepEqual((await state(h)).dados, committed.dados);
    assert.equal((await queue(h)).lastConfirmed, acknowledged.lastConfirmed);
    h.sync.online = true; await cycle(h);
    assert.ok(h.statuses.some(([message]) => message === 'Sincronizado'));
    const local = registrosFinanceiros((await state(h)).dados), remote = (await backend.client.generationSnapshot(owner.uid)).records;
    assert.equal(local.length, 2); assert.equal(remote.length, 2);
    for (const item of local) assert.ok(remote.some(r => recordEntityKey(r) === recordEntityKey(item) && recordsEquivalent(r.record, item.record)));
    assert.equal((await queue(h)).outbox.length, 0);
});

test('CP-05 stable legitimate untracked data still fails permanently and preserves local finances', async t => {
    const { h } = await setup(t); await orphan(h, 'synthetic-real-divergence');
    const before = await state(h), beforeQueue = await queue(h), held = retainSnapshot(t, h, -1);
    await assert.rejects(cycle(h), { code: 'sync/untracked-data' });
    assert.equal(held.calls(), 3);
    assert.equal(h.confirmations, 0); assert.deepEqual((await state(h)).dados, before.dados);
    assert.deepEqual((await queue(h)).outbox, beforeQueue.outbox);
    assert.deepEqual((await queue(h)).conflicts, beforeQueue.conflicts);
    h.sync.online = true; await h.sync.run(h.sync.session);
    assert.equal(h.sync.session.permanent, true);
    assert.ok(h.statuses.some(([, failed]) => failed));
    assert.ok(!h.statuses.some(([message]) => message === 'Sincronizado'));
});

test('CP-05 revision change during the recheck defers diagnosis but a stable divergence still fails', async t => {
    const { h } = await setup(t); await orphan(h, 'synthetic-untracked-first');
    const held = retainSnapshot(t, h, 3), running = cycle(h); await held.entered;
    await orphan(h, 'synthetic-untracked-newer'); const newer = await state(h);
    held.release(); await running;
    assert.equal(h.sync.session.again, true); assert.equal(h.confirmations, 0);
    assert.deepEqual(await state(h), newer, 'the newer revision is never overwritten');
    await assert.rejects(cycle(h), { code: 'sync/untracked-data' });
});

test('CP-05 newly queued tracking during the recheck survives unchanged and requires its own ACK', async t => {
    const { h } = await setup(t); await orphan(h, 'synthetic-later-tracked');
    const held = retainSnapshot(t, h, 3), running = cycle(h); await held.entered;
    const item = registrosFinanceiros((await state(h)).dados).find(r => r.id === 'synthetic-later-tracked');
    const operation = makeOperation(recordEntityKey(item), { ...item, deleted: false }, null);
    await h.session.service.enfileirar(owner.uid, operation); const before = await queue(h);
    held.release(); await running;
    assert.equal(h.sync.session.again, true); assert.equal(h.confirmations, 0);
    assert.deepEqual(await queue(h), before);
    await cycle(h); assert.equal((await queue(h)).outbox.length, 0);
    assert.equal((await queue(h)).remoteRevisions[operation.entityKey], operation.id);
});

test('CP-05 a failed server recheck propagates and never confirms or erases local data', async t => {
    const { h } = await setup(t); await orphan(h, 'synthetic-recheck-network');
    const original = h.client.generationSnapshot; let calls = 0;
    h.client.generationSnapshot = (...args) => {
        if (++calls === 3) throw Object.assign(new Error('Synthetic unavailable'), { code: 'unavailable' });
        return original(...args);
    };
    const before = await state(h), beforeQueue = await queue(h);
    await assert.rejects(cycle(h), { code: 'unavailable' });
    assert.equal(h.confirmations, 0); assert.deepEqual((await state(h)).dados, before.dados);
    assert.deepEqual(await queue(h), beforeQueue);
});

test('CP-05 logout during the recheck prevents all later persistence and confirmation', async t => {
    const { h } = await setup(t); await orphan(h, 'synthetic-recheck-logout');
    const held = retainSnapshot(t, h, 3), running = cycle(h); await held.entered;
    const before = await state(h), beforeQueue = await queue(h);
    h.sync.closeSession(); held.release();
    await assert.rejects(running, { code: 'persistence/cancelled' });
    assert.equal(h.confirmations, 0); assert.deepEqual(await state(h), before);
    assert.deepEqual(await queue(h), beforeQueue);
});
