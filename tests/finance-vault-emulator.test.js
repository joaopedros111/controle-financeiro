import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { doc, getDocFromServer, getDocsFromServer, collection, setDoc, deleteDoc } from 'firebase/firestore';
import { signInWithCustomToken } from 'firebase/auth';
import { createVaultEmulatorTransport } from '../experimental/finance-vault-emulator-transport.js';
import { createExperimentalAccount } from '../experimental/finance-vault-persistence.js';
import { memoryVaultFactory } from './fixtures/vault-memory-store.mjs';
import { integrationDocuments, integrationPassword, addIncome, integrationOwner, month } from './fixtures/vault-integration-scenarios.mjs';
import { applyRemoteRecord, makeOperation } from '../sync-core.js';

test('synthetic Auth/Firestore Emulator integration with isolated encrypted persistence', { skip: process.env.LOCAL_VAULT_EMULATORS !== '1' }, async t => {
    const uidA = 'synthetic-emulator-A', uidB = 'synthetic-emulator-B', clients = [], accounts = [];
    const ownerA = { ...integrationOwner, uid: uidA }, ownerB = { ...integrationOwner, uid: uidB };
    const makeClient = async uid => { const client = await createVaultEmulatorTransport(uid); clients.push(client); return client; };
    async function makeAccount(owner) {
        const storage = memoryVaultFactory(), account = createExperimentalAccount({ store: storage.store, owner, crypto: webcrypto, channelFactory: () => null });
        accounts.push(account); const created = await account.create({ password: integrationPassword, generation: 'synthetic-generation-1', documents: integrationDocuments(owner.uid) });
        return { account, storage, session: created.session };
    }
    try {
        const a = await makeClient(uidA), b = await makeClient(uidB), device = await makeClient(uidA);
        const localA = await makeAccount(ownerA), localB = await makeAccount(ownerB), localDevice = await makeAccount(ownerA);
        let op;
        await t.test('real Auth UID and lost remote ACK retry retain one immutable receipt and record', async () => {
            assert.equal(a.auth.currentUser.uid, uidA); assert.equal(b.auth.currentUser.uid, uidB);
            await addIncome(localA.session, uidA); op = (await localA.session.service.lerFila(uidA)).outbox[0];
            await assert.rejects(localA.session.synchronize({ commit: async (...args) => { await a.commit(...args); throw Object.assign(new Error('Synthetic lost ACK'), { code: 'unavailable' }); } }), { code: 'unavailable' });
            assert.equal((await localA.session.service.lerFila(uidA)).outbox[0].id, op.id);
            await localA.session.synchronize(a); assert.equal((await localA.session.service.lerFila(uidA)).outbox.length, 0);
            assert.equal((await getDocsFromServer(collection(a.db, 'users', uidA, 'records'))).size, 1);
            assert.equal((await getDocsFromServer(collection(a.db, 'users', uidA, 'operations'))).size, 1);
        });
        await t.test('rules deny direct cross-account read, write and delete independently of the adapter', async () => {
            const pathA = ['users', uidA, 'records', op.entityKey], pathB = ['users', uidB, 'records', op.entityKey];
            await assert.rejects(getDocFromServer(doc(b.db, ...pathA)), { code: 'permission-denied' });
            await assert.rejects(setDoc(doc(b.db, ...pathA), {}), { code: 'permission-denied' });
            await assert.rejects(deleteDoc(doc(b.db, ...pathA)), { code: 'permission-denied' });
            await assert.rejects(getDocFromServer(doc(a.db, ...pathB)), { code: 'permission-denied' });
            await assert.rejects(a.commit(ownerB, op), { code: 'session-changed' });
        });
        await t.test('same user on a second device downloads into an independently encrypted vault', async () => {
            const remote = (await getDocFromServer(doc(device.db, 'users', uidA, 'records', op.entityKey))).data();
            const before = await localDevice.session.db.ler(`estado:${uidA}`), next = applyRemoteRecord(before.dados, remote);
            await localDevice.session.service.aplicar(uidA, before.revisao, next, []);
            assert.equal((await localDevice.session.db.ler(`estado:${uidA}`)).dados.meses[month].receitas[0].valor, 1234.56);
            assert.notEqual((await localDevice.account.vault.read()).catalog.keyId, (await localA.account.vault.read()).catalog.keyId);
            assert.equal((await localDevice.session.service.lerFila(uidA)).outbox.length, 0);
        });
        await t.test('server conflict preserves financial state and persists a reviewable local conflict', async () => {
            const competing = { ...op.value, record: { ...op.value.record, valor: 19.19 } };
            const result = await a.commit(ownerA, makeOperation(op.entityKey, competing, op.id)); assert.equal(result.acknowledged, true);
            await addIncome(localDevice.session, uidA, 'synthetic-other-device-income');
            const staleOperation = { ...makeOperation(op.entityKey, op.value, op.id), generation: 'synthetic-generation-1' };
            await localDevice.session.service.alterarFila(uidA, queue => { queue.outbox.push(staleOperation); return queue; });
            await localDevice.session.synchronize(device);
            const q = await localDevice.session.service.lerFila(uidA); assert.equal(q.outbox.length, 0); assert.equal(q.conflicts.length, 1);
            assert.equal(q.conflicts[0].operation.id, staleOperation.id);
            assert.equal((await localA.session.db.ler(`estado:${uidA}`)).dados.meses[month].receitas[0].valor, 1234.56);
        });
        await t.test('logout and same UID login fence a delayed ACK without losing offline operations', async () => {
            await addIncome(localA.session, uidA, 'synthetic-after-first-sync');
            let release, entered; const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
            const old = localA.session.synchronize({ commit: async (...args) => { const ack = await a.commit(...args); entered(); await gate; return ack; } }).then(() => null, error => error.code);
            await started; await a.logout(); await localA.account.lock(); await a.login();
            const current = await localA.account.unlockWithPassword(integrationPassword); release(); assert.equal(await old, 'persistence/cancelled');
            assert.equal((await current.service.lerFila(uidA)).outbox.length, 1); await current.synchronize(a);
            assert.equal((await current.service.lerFila(uidA)).outbox.length, 0);
            assert.equal((await localB.session.service.lerFila(uidB)).outbox.length, 0);
        });
        await t.test('same Auth instance switches A-B-A while financial leases remain account-bound', async () => {
            await localA.account.lock();
            await signInWithCustomToken(a.auth, JSON.stringify({ uid: uidB }));
            await addIncome(localB.session, uidB, 'synthetic-only-account-B'); await localB.session.synchronize(a);
            assert.equal((await getDocsFromServer(collection(a.db, 'users', uidB, 'records'))).size, 1);
            await assert.rejects(getDocFromServer(doc(a.db, 'users', uidA, 'records', op.entityKey)), { code: 'permission-denied' });
            await localB.account.lock(); await a.logout(); await a.login();
            const returned = await localA.account.unlockWithPassword(integrationPassword);
            const financial = await returned.db.ler(`estado:${uidA}`);
            assert.equal(financial.dados.meses[month].receitas.length, 2);
            assert.equal(financial.dados.meses[month].receitas.some(r => r.id === 'synthetic-only-account-B'), false);
            await assert.rejects(localB.session.service.lerFila(uidB), { code: 'persistence/cancelled' });
            const ownRecords = await getDocsFromServer(collection(a.db, 'users', uidA, 'records'));
            assert.deepEqual(ownRecords.docs.map(d => d.data().id).sort(), ['synthetic-after-first-sync', 'synthetic-income', 'synthetic-other-device-income']);
        });
    } finally { accounts.forEach(account => account.close()); for (const client of clients) await client.close(); }
});
