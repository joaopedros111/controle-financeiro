import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRealEmulatorFactory } from './fixtures/vault-real-emulator-factory.mjs';
import { createRealVaultAdapter } from '../experimental/finance-vault-real-adapter.js';
import { memoryVaultFactory } from './fixtures/vault-memory-store.mjs';
import { documents, password, income, connect, edit, month } from './fixtures/vault-real-scenarios.mjs';
test('real Firebase factory + AutomaticFinanceSync + encrypted vault, isolated SDK/Emulator', { skip: process.env.LOCAL_VAULT_EMULATORS !== '1' }, async t => {
    const values = new Map(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) } });
    const sdk = await loadRealEmulatorFactory(), uid = `synthetic-real-${crypto.randomUUID()}`, owner = { projectId: 'demo-vault-integration', uid };
    const client = sdk.criarFirebaseSync({ projectId: owner.projectId, apiKey: 'demo-only', appId: 'synthetic-real-adapters' });
    const store = memoryVaultFactory(), locks = { request: (_name, fn) => fn() }, adapter = createRealVaultAdapter({ store: store.store, owner, locks });
    try {
        await client.ready(); // Official runtime: real authStateReady, synthetic redirect completion.
        await sdk.login(uid); const created = await adapter.create({ password, generation: 'legacy', documents: documents(uid) });
        const h = { owner, session: created.session, client }; connect(h); await h.sync.useAccount({ uid });
        await t.test('real factory confirms records/settings only after SDK transaction ACK', async () => {
            await income(h); await h.sync.cycle(h.sync.session); assert.equal((await h.session.service.lerFila(uid)).outbox.length, 0);
            assert.equal((await client.generationSnapshot(uid)).records.length, 1); assert.equal(values.size, 0);
        });
        await t.test('actual SDK lost ACK replays immutable receipt and preserves the operation', async () => {
            await income(h, 'synthetic-lost-ack'); const original = client.commit, operation = (await h.session.service.lerFila(uid)).outbox[0]; let lose = true;
            client.commit = async (...args) => { const result = await original(...args); if (lose) { lose = false; throw Object.assign(new Error('Synthetic lost ACK'), { code: 'unavailable' }); } return result; };
            await assert.rejects(h.sync.cycle(h.sync.session)); assert.equal((await h.session.service.lerFila(uid)).outbox[0].id, operation.id);
            await h.sync.cycle(h.sync.session); client.commit = original; assert.equal((await client.list(uid)).filter(r => r.id === 'synthetic-lost-ack').length, 1);
        });
        await t.test('real generation restore publishes after interruption and retains archived offline work', async () => {
            await income(h, 'synthetic-before-restore'); const backup = (await h.session.db.ler(`estado:${uid}`)).dados;
            backup.meses[month].receitas[0].valor = 54.32; await h.sync.importBackup(backup, () => true);
            const original = client.publishRestore; let fail = true;
            client.publishRestore = async (...args) => { if (fail) { fail = false; throw Object.assign(new Error('Synthetic interrupted restore'), { code: 'unavailable' }); } return original(...args); };
            await assert.rejects(h.sync.cycle(h.sync.session)); assert.ok((await h.session.service.lerFila(uid)).restoreJob);
            await h.sync.cycle(h.sync.session); client.publishRestore = original;
            const q = await h.session.service.lerFila(uid), snapshot = await adapter.read(); assert.equal(q.restoreJob, null); assert.equal(snapshot.generation, q.generation);
            assert.ok(snapshot.documents[q.recoveryKeys.at(-1)].queue.outbox.length); assert.equal((await client.generationSnapshot(uid)).records.find(r => r.id === 'synthetic-real-income').record.valor, 54.32);
        });
        await t.test('same SDK Auth A-B-A with vault revocation preserves A and rejects old leases', async () => {
            const old = h.session; await h.sync.useAccount(null); await adapter.lock(); await client.logout();
            const b = `synthetic-real-B-${crypto.randomUUID()}`; await sdk.login(b); assert.equal((await client.generationSnapshot(b)).records.length, 0);
            await assert.rejects(client.list(uid)); await client.logout(); await sdk.login(uid);
            h.session = await adapter.unlock(password); connect(h); await h.sync.useAccount({ uid }); await assert.rejects(old.db.ler(`estado:${uid}`));
            await edit(h, m => { m.receitas[0].valor = 65.43; }); await h.sync.cycle(h.sync.session); assert.equal((await client.generationSnapshot(uid)).records.find(r => r.id === 'synthetic-real-income').record.valor, 65.43);
        });
    } finally { adapter.close(); await sdk.close(); }
});
