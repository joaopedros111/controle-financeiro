import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntegratedSession, validateIntegratedConfiguration } from '../experimental/finance-vault-integrated-session.js';
import { memoryVaultFactory } from './fixtures/vault-memory-store.mjs';
import { realContractClient } from './fixtures/vault-real-client.mjs';
const password = 'synthetic-integrated-password', accounts = ['synthetic-integrated-node-A', 'synthetic-integrated-node-B'];
const config = { experimentalVault: true, projectId: 'demo-vault-integration', authEmulator: 'http://127.0.0.1:9099', firestoreEmulator: 'http://127.0.0.1:8080', databaseName: 'controleFinanceiro:cofre-isolado:v1:synthetic-integrated-node', accounts };
async function wait(fn) { for (let i = 0; i < 250; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('Synthetic phase timeout'); }
async function setup(online = false) {
    const stores = new Map(), observers = new Set(), clients = new Map(); let user = null, view;
    const notify = next => { user = next; for (const fn of [...observers]) fn(user); };
    const client = new Proxy({ ready: async () => user, onUser(fn) { observers.add(fn); queueMicrotask(() => { if (observers.has(fn)) fn(user); }); return () => observers.delete(fn); }, protocolVersion: 2 }, {
        get(target, key) { if (key in target) return target[key]; if (typeof key === 'symbol') return undefined;
            return (uid, ...args) => { if (uid !== user?.uid) throw new Error('Synthetic auth mismatch'); if (!clients.has(uid)) clients.set(uid, realContractClient({ projectId: config.projectId, uid }).client); return clients.get(uid)[key]?.(uid, ...args); };
        }
    });
    const session = createIntegratedSession({ config, client, auth: { login: async uid => { if (user?.uid !== uid) notify({ uid }); return user; }, logout: async () => notify(null) },
        connectivity: { navigator: { onLine: online }, addEventListener() {}, removeEventListener() {} },
        makeStore: async name => { if (!stores.has(name)) stores.set(name, memoryVaultFactory()); return stores.get(name).store; }, onView: v => { view = v; }
    });
    await session.start(); await wait(() => view?.phase === 'signed-out');
    return { session, stores, get view() { return view; } };
}
async function create(h, uid = accounts[0]) { await h.session.login(uid); await wait(() => h.view.phase === 'missing'); const result = await h.session.create(password); await h.session.confirmCustody(result.recoverySecret, true); return result.recoverySecret; }
test('integrated configuration requires explicit opt-in, dedicated DB, demo project and exact loopback', () => {
    validateIntegratedConfiguration(config);
    for (const patch of [{ experimentalVault: false }, { projectId: 'production' }, { databaseName: 'controleFinanceiro:integridade:v1' }, { accounts: ['real-user'] }, { authEmulator: 'https://identitytoolkit.googleapis.com' }]) assert.throws(() => validateIntegratedConfiguration({ ...config, ...patch }));
});
test('creation is explicit, independent recovery precedes custody and locked is not empty', async () => {
    const h = await setup(); try {
        await h.session.login(accounts[0]); await wait(() => h.view.phase === 'missing'); assert.equal(h.view.data, null); await assert.rejects(h.session.snapshot());
        const { recoverySecret } = await h.session.create(password); assert.equal(h.view.phase, 'custody'); assert.equal(h.view.data, null); await assert.rejects(h.session.confirmCustody(recoverySecret, false));
        await h.session.confirmCustody(recoverySecret, true); assert.ok(h.view.data); assert.ok(h.stores.size >= 2); await h.session.lock(); assert.equal(h.view.phase, 'locked'); assert.equal(h.view.data, null);
    } finally { await h.session.shutdown(); }
});
test('wrong password preserves encrypted data; recovery secret opens the latest offline operation', async () => {
    const h = await setup(); try {
        const secret = await create(h); await h.session.edit(s => s.meses['2026-11'].receitas.push({ id: 'synthetic-unit-income', nome: 'SYNTHETIC UNIT INCOME', valor: 12.34, recebido: false }));
        const before = await h.session.snapshot(); await h.session.lock(); await assert.rejects(h.session.create(password)); await assert.rejects(h.session.unlock('synthetic-wrong-password')); assert.equal(h.view.data, null);
        await h.session.recover(secret); const after = await h.session.snapshot(); assert.deepEqual(after.documents[`estado:${accounts[0]}`], before.documents[`estado:${accounts[0]}`]);
        assert.deepEqual(after.documents[`fila:${accounts[0]}`].outbox, before.documents[`fila:${accounts[0]}`].outbox);
    } finally { await h.session.shutdown(); }
});
test('A-B-A clears the interface immediately, preserves both accounts and never permits old-session edits', async () => {
    const h = await setup(); try {
        await create(h); await h.session.edit(s => s.meses['2026-11'].receitas.push({ id: 'synthetic-A', nome: 'SYNTHETIC A', valor: 10 }));
        const before = await h.session.snapshot(); await h.session.login(accounts[1]); assert.equal(h.view.data, null); assert.equal(h.view.generation, null); await wait(() => h.view.phase === 'missing');
        const created = await h.session.create(password); await h.session.confirmCustody(created.recoverySecret, true); assert.equal(h.view.data.meses['2026-11'].receitas.length, 0);
        await h.session.login(accounts[0]); assert.equal(h.view.data, null); await wait(() => h.view.phase === 'locked'); await h.session.unlock(password);
        assert.deepEqual((await h.session.snapshot()).documents[`estado:${accounts[0]}`], before.documents[`estado:${accounts[0]}`]); await h.session.logout(); assert.equal(h.view.data, null); await assert.rejects(h.session.edit(() => {}));
    } finally { await h.session.shutdown(); }
});
test('quota rejects the whole financial/queue mutation and preserves recovery references', async () => {
    const h = await setup(); try {
        await create(h); const before = await h.session.snapshot(); h.stores.get(config.databaseName).setFaults({ beforePut() { throw Object.assign(new Error('Synthetic quota'), { name: 'QuotaExceededError' }); } });
        await assert.rejects(h.session.edit(s => s.meses['2026-11'].receitas.push({ id: 'synthetic-failed', nome: 'SYNTHETIC FAILED', valor: 5 })));
        h.stores.get(config.databaseName).setFaults({}); assert.equal(h.view.data, null); await h.session.unlock(password);
        assert.deepEqual((await h.session.snapshot()).documents[`estado:${accounts[0]}`], before.documents[`estado:${accounts[0]}`]);
        assert.deepEqual((await h.session.snapshot()).documents[`fila:${accounts[0]}`].outbox, before.documents[`fila:${accounts[0]}`].outbox);
        let failRead = true; h.stores.get(config.databaseName).setFaults({ afterRead() { if (failRead) { failRead = false; throw new Error('Synthetic read failure'); } } });
        await assert.rejects(h.session.edit(() => {})); assert.equal(h.view.data, null); await wait(() => h.view.phase === 'error');
        h.stores.get(config.databaseName).setFaults({}); await h.session.unlock(password); assert.deepEqual((await h.session.snapshot()).documents[`estado:${accounts[0]}`], before.documents[`estado:${accounts[0]}`]);
    } finally { await h.session.shutdown(); }
});
test('custody interrupted before confirmation resumes with the independently held secret', async () => {
    const h = await setup(); try {
        await h.session.login(accounts[0]); await wait(() => h.view.phase === 'missing'); const created = await h.session.create(password);
        await h.session.lock(); await h.session.unlock(password); assert.equal(h.view.phase, 'recovery-required'); assert.equal(h.view.data, null);
        await h.session.recover(created.recoverySecret); assert.equal(h.view.phase, 'custody'); await h.session.confirmCustody(created.recoverySecret, true); assert.ok(h.view.data);
    } finally { await h.session.shutdown(); }
});
test('live automatic synchronization reaches global ACK for canonical income and expense records', async () => {
    const h = await setup(true); try {
        await create(h); await wait(() => h.view.phase === 'synced');
        await h.session.edit(s => s.meses['2026-11'].receitas.push({ id: 'synthetic-live-income', nome: 'SYNTHETIC LIVE INCOME', valor: 12.34, recebido: false }));
        await wait(() => h.view.phase === 'synced');
        await h.session.edit(s => s.meses['2026-11'].despesas.push({ id: 'synthetic-live-expense', nome: 'SYNTHETIC LIVE EXPENSE', valor: 5.67, categoria: 'Casa', pago: false, fixa: false, serie: null, parcela: null }));
        await wait(() => h.view.phase === 'synced'); assert.equal((await h.session.snapshot()).documents[`fila:${accounts[0]}`].outbox.length, 0);
    } finally { await h.session.shutdown(); }
});
test('rapid authentication intents cannot reopen the superseded account', async () => {
    const h = await setup(); try {
        const results = await Promise.allSettled([h.session.login(accounts[0]), h.session.login(accounts[1]), h.session.login(accounts[0])]);
        await wait(() => h.view.phase === 'missing'); assert.equal(h.view.uid, accounts[0]); assert.equal(results.at(-1).status, 'fulfilled'); assert.equal(h.view.data, null);
        const created = await h.session.create(password); await h.session.confirmCustody(created.recoverySecret, true);
        await h.session.login(accounts[0]); await wait(() => h.view.phase === 'locked'); assert.equal(h.view.data, null);
    } finally { await h.session.shutdown(); }
});
test('invalid encrypted catalog is an error, never an empty account or permission to recreate', async () => {
    const h = await setup(); try {
        await create(h); await h.session.edit(s => s.meses['2026-11'].receitas.push({ id: 'synthetic-corruption-pending', nome: 'SYNTHETIC PENDING', valor: 20 }));
        await h.session.lock(); const storage = h.stores.get(config.databaseName); await storage.mutate(s => { s.catalog.version = 999; });
        const before = structuredClone((await storage.inspect()).snapshots); await h.session.login(accounts[0]); await wait(() => h.view.phase === 'error');
        assert.equal(h.view.data, null); await assert.rejects(h.session.create(password)); assert.deepEqual((await storage.inspect()).snapshots, before);
    } finally { await h.session.shutdown(); }
});
