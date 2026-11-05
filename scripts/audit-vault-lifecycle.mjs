// Separate adversarial probes. This is an automated harness, not an external audit.
import assert from 'node:assert/strict';
import { createVaultLifecycle } from '../experimental/finance-vault-lifecycle.js';
import { createRealVaultAdapter } from '../experimental/finance-vault-real-adapter.js';
import { memoryVaultFactory } from '../tests/fixtures/vault-memory-store.mjs';
import { documents, password, month } from '../tests/fixtures/vault-real-scenarios.mjs';
const owner = { projectId: 'demo-lifecycle-audit', uid: 'synthetic-lifecycle-audit' };
let passed = 0;
async function run(name, probe) {
    const storage = memoryVaultFactory(), docs = documents(owner.uid);
    docs[`snapshot:${owner.uid}:lifecycle-owner`] = { format: 'synthetic-authenticated-owner-v1', owner };
    const adapter = createRealVaultAdapter({ store: storage.store, owner });
    await adapter.create({ password, generation: 'legacy', documents: docs }); await adapter.lock(); adapter.close();
    const make = () => createVaultLifecycle({ openAdapter: async o => createRealVaultAdapter({ store: storage.store, owner: o }), revocationScope: 'owner-vault-all-tabs' });
    const c = make(); c.start();
    try { await probe({ c, make, storage }); passed++; console.log(JSON.stringify({ name, secure: true })); }
    finally { await c.close('logout'); }
}
const login = async c => { await c.identify({ kind: 'confirmed', owner }); await c.unlock(password); };
const add = c => c.edit(s => s.meses[month].receitas.push({ id: 'synthetic-independent-item', nome: 'SYNTHETIC AUDIT', valor: 19.27 }));
const q = async c => (await c.read()).documents[`fila:${owner.uid}`];
await run('LC-01 old queued identities cannot override logout, lock or suspension', async ({ c }) => {
    await login(c);
    for (const reason of ['lock', 'suspend', 'logout']) {
        const old = c.identify({ kind: 'confirmed', owner }).then(() => null, e => e.code);
        await c.close(reason); assert.equal(await old, 'lifecycle/stale-session');
        assert.equal(c.state().phase, reason === 'logout' ? 'signed-out' : reason === 'suspend' ? 'suspended' : 'locked');
        await assert.rejects(c.read());
        if (reason === 'logout') assert.equal(c.state().owner, null);
        else await login(c);
    }
});
await run('auth failure is not empty and cannot initialize', async ({ c, storage }) => {
    const before = await storage.inspect(); await c.identify({ kind: 'failed' }); await assert.rejects(c.unlock(password)); await assert.rejects(c.read());
    assert.equal(c.state().data, null); assert.equal(c.state().phase, 'error'); assert.deepEqual(await storage.inspect(), before);
});
await run('revoked tab has no channel and cannot commit after durable epoch changes', async ({ c, make, storage }) => {
    await login(c); const peer = make(); peer.start(); await login(peer); await add(c);
    const before = await q(c), epochs = (await storage.inspect()).controls;
    await c.close('logout'); const bumped = (await storage.inspect()).controls; assert.ok(bumped[0][1].epoch > epochs[0][1].epoch);
    await assert.rejects(add(peer)); await peer.close(); await login(peer); assert.deepEqual(await q(peer), before); await peer.close('logout');
});
await run('hung network ACK is excluded from drain and remains pending across new session', async ({ c }) => {
    await login(c); await add(c); let release, entered;
    const gate = new Promise(r => { release = r; }), began = new Promise(r => { entered = r; });
    const pending = c.send(async () => { entered(); await gate; return { acknowledged: true }; }).then(() => null, e => e.code);
    await began; const before = await q(c); await c.close('logout'); await login(c); release();
    assert.equal(await pending, 'lifecycle/stale-session'); assert.deepEqual(await q(c), before); assert.equal(c.state().phase, 'ready');
});
console.log(JSON.stringify({ summary: { passed, failed: 0, skipped: 0, storage: 'Node transactional model' } }));
