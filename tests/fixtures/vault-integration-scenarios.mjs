import { createExperimentalAccount } from '../../experimental/finance-vault-persistence.js';
import { normalizarEstado, validarBackup } from '../../finance-core.js';
import { makeOperation, recordEntityKey } from '../../sync-core.js';
import { simulatedVaultTransport } from './vault-simulated-transport.mjs';

export const integrationOwner = { projectId: 'demo-vault-integration', uid: 'synthetic-integration-A' };
export const integrationPassword = 'synthetic-integration-passphrase';
export const financialMarker = 'SYNTHETIC FINANCIAL VAULT MARKER';
export const month = '2026-10';
export function integrationDocuments(uid = integrationOwner.uid) {
    const state = normalizarEstado({ versao: 3, categorias: ['recoveryKeys'], orcamentos: { padrao: { recoveryKeys: 100 }, meses: {} }, meses: { [month]: { receitas: [], despesas: [] } } });
    if (!validarBackup(state)) throw new Error('Invalid synthetic fixture');
    return { [`estado:${uid}`]: { revisao: 0, dados: state, origem: 'synthetic-integration' },
        [`fila:${uid}`]: { generation: 'synthetic-generation-1', outbox: [], conflicts: [], attempted: {}, remoteRevisions: {}, recoveryKeys: [],
            automaticHistory: [], automaticResolutions: [], conflictDecisions: [], backupJobs: [], unknownLegacy: { preserved: true, optional: undefined } } };
}
export async function editIntegration(session, uid, mutate) {
    const current = await session.db.ler(`estado:${uid}`), desired = structuredClone(current.dados); mutate(desired.meses[month], desired);
    return session.service.aplicarEdicao(uid, current.dados, desired, (changes, queue) => changes.map(change =>
        makeOperation(recordEntityKey(change), change, queue.remoteRevisions[recordEntityKey(change)] || null)), () => {}, session.isCurrent, 'synthetic-generation-1');
}
export const addIncome = (session, uid = integrationOwner.uid, id = 'synthetic-income') => editIntegration(session, uid,
    data => data.receitas.push({ id, nome: financialMarker, valor: 1234.56, recebido: false }));
const ok = value => { if (!value) throw new Error('Synthetic integration assertion failed'); };
const same = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Synthetic integration comparison failed'); };
async function rejects(operation, codes) {
    let error; try { await operation(); } catch (e) { error = e; } ok(error);
    if (codes) ok([].concat(codes).includes(error.code)); return error;
}
export function integrationCases({ makeStore, crypto }) {
    const cases = [], accounts = [];
    const account = (store, owner = integrationOwner) => {
        const result = createExperimentalAccount({ store, owner, crypto, channelFactory: () => null }); accounts.push(result); return result;
    };
    const add = (name, run) => cases.push({ name, run: async () => { try { await run(); } finally { accounts.splice(0).forEach(a => a.close()); } } });
    async function source(owner = integrationOwner) {
        const storage = await makeStore(), a = account(storage.store, owner), created = await a.create({ password: integrationPassword,
            generation: 'synthetic-generation-1', documents: integrationDocuments(owner.uid) });
        return { storage, a, created, session: created.session };
    }
    const state = (s, uid = integrationOwner.uid) => s.db.ler(`estado:${uid}`);
    const queue = (s, uid = integrationOwner.uid) => s.service.lerFila(uid);

    add('creation, wrong password and unlock never silently initialize an empty vault', async () => {
        const s = await source(); await addIncome(s.session); await s.a.lock();
        await rejects(() => s.a.unlockWithPassword('synthetic-wrong-password'), 'unlock-failed');
        same((await s.a.vault.status()).state, 'locked'); same((await s.storage.inspect()).snapshots.length, 1);
        const current = await s.a.unlockWithPassword(integrationPassword); same((await state(current)).dados.meses[month].receitas.length, 1);
        await rejects(() => state(s.session), 'persistence/cancelled');
    });
    add('real atomic service persists income, expenses and exact operation IDs with financial state', async () => {
        const s = await source(); await addIncome(s.session);
        await editIntegration(s.session, integrationOwner.uid, data => data.despesas.push({ id: 'synthetic-expense', nome: 'Synthetic expense', valor: 42.17, categoria: 'recoveryKeys', pago: false }));
        const saved = await state(s.session), q = await queue(s.session);
        same(saved.dados.meses[month].receitas[0].valor, 1234.56); same(saved.dados.meses[month].despesas[0].valor, 42.17);
        same(q.outbox.length, 2); ok(q.outbox.every(op => op.generation === 'synthetic-generation-1')); same(saved.revisao, 2);
    });
    add('offline edits and deletion retain a durable tombstone and preserve optional legacy fields', async () => {
        const s = await source(); await addIncome(s.session);
        await editIntegration(s.session, integrationOwner.uid, data => { data.receitas[0].valor = 99.13; });
        same((await queue(s.session)).outbox.length, 1);
        await editIntegration(s.session, integrationOwner.uid, data => { data.receitas = []; });
        const q = await queue(s.session); same(q.outbox.length, 1); ok(q.outbox[0].value.deleted);
        same((await state(s.session)).dados.meses[month].receitas.length, 0); ok(Object.hasOwn(q.unknownLegacy, 'optional'));
    });
    add('connection restart keeps offline operation identity, attempts and financial state', async () => {
        const s = await source(); await addIncome(s.session); const before = await queue(s.session);
        s.a.close(); const reopened = account(await s.storage.reopen()); same((await reopened.vault.status()).state, 'locked');
        const current = await reopened.unlockWithPassword(integrationPassword); same(await queue(current), before);
        same((await state(current)).dados.meses[month].receitas[0].nome, financialMarker);
    });
    add('account A-B-A shares a synthetic database but never leases, state or offline queues', async () => {
        const s = await source(); await addIncome(s.session); const aQueue = await queue(s.session); await s.a.lock();
        const ownerB = { ...integrationOwner, uid: 'synthetic-integration-B' }, b = account(await s.storage.reopen(), ownerB);
        const createdB = await b.create({ password: integrationPassword, generation: 'synthetic-generation-1', documents: integrationDocuments(ownerB.uid) });
        await addIncome(createdB.session, ownerB.uid, 'synthetic-income-B');
        const remote = simulatedVaultTransport(); await createdB.session.synchronize(remote);
        same(remote.inspect(integrationOwner).writes, 0); same(remote.inspect(ownerB).writes, 1);
        await rejects(() => createdB.session.db.ler(`estado:${integrationOwner.uid}`), 'context-mismatch');
        await rejects(() => state(s.session), 'persistence/cancelled'); await b.lock();
        const returned = await s.a.unlockWithPassword(integrationPassword); same(await queue(returned), aQueue);
        await rejects(() => queue(createdB.session, ownerB.uid), 'persistence/cancelled');
    });
    add('late remote ACK after lock and same-account unlock cannot confirm the new session', async () => {
        const s = await source(); await addIncome(s.session); const remote = simulatedVaultTransport();
        let entered, release; const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
        const old = s.session.synchronize({ commit: async (...args) => { const ack = await remote.commit(...args); entered(); await gate; return ack; } }).then(() => null, e => e.code);
        await started; await s.a.lock(); const current = await s.a.unlockWithPassword(integrationPassword); release();
        same(await old, 'persistence/cancelled'); same((await queue(current)).outbox.length, 1);
        await current.synchronize(remote); same((await queue(current)).outbox.length, 0); same(remote.inspect(integrationOwner).writes, 1);
    });
    add('lost ACK retries the same durable operation without a duplicate remote write', async () => {
        const s = await source(); await addIncome(s.session); const original = (await queue(s.session)).outbox[0], remote = simulatedVaultTransport();
        remote.loseNextAcknowledgement(); await rejects(() => s.session.synchronize(remote), 'unavailable');
        const retained = await queue(s.session); same(retained.outbox[0].id, original.id); ok(retained.attempted[original.id]);
        await s.session.synchronize(remote); same((await queue(s.session)).outbox.length, 0); same(remote.inspect(integrationOwner).writes, 1);
        await s.session.synchronize(remote); same(remote.inspect(integrationOwner).writes, 1);
    });
    add('remote conflict is retained without silently overwriting local financial data', async () => {
        const s = await source(); await addIncome(s.session); const op = (await queue(s.session)).outbox[0], remote = simulatedVaultTransport();
        const competing = { ...op.value, record: { ...op.value.record, valor: 888.88 } };
        await remote.commit(integrationOwner, makeOperation(op.entityKey, competing));
        await s.session.synchronize(remote); const q = await queue(s.session);
        same(q.outbox.length, 0); same(q.conflicts.length, 1); same(q.conflicts[0].operation.id, op.id);
        same((await state(s.session)).dados.meses[month].receitas[0].valor, 1234.56);
        await s.a.lock(); const resumed = await s.a.unlockWithPassword(integrationPassword); same((await queue(resumed)).conflicts, q.conflicts);
    });
    add('two simulated tabs merge independent financial intents through bounded CAS retry', async () => {
        const s = await source(), b = account(await s.storage.reopen()), bs = await b.unlockWithPassword(integrationPassword);
        await Promise.all([addIncome(s.session, integrationOwner.uid, 'synthetic-tab-a'), addIncome(bs, integrationOwner.uid, 'synthetic-tab-b')]);
        same((await state(s.session)).dados.meses[month].receitas.length, 2); same((await queue(bs)).outbox.length, 2);
    });
    add('conflicting local edits are rejected and archived with offline work intact', async () => {
        const s = await source(); await addIncome(s.session); const b = account(await s.storage.reopen()), bs = await b.unlockWithPassword(integrationPassword);
        const base = (await state(bs)).dados, desired = structuredClone(base); desired.meses[month].receitas[0].valor = 5;
        await editIntegration(s.session, integrationOwner.uid, data => { data.receitas[0].valor = 6; });
        const error = await rejects(() => bs.service.aplicarEdicao(integrationOwner.uid, base, desired)); same(error.name, 'ConflitoEdicao');
        await bs.service.preservarEdicaoRejeitada(integrationOwner.uid, base, desired, 'synthetic-edit-conflict');
        const q = await queue(bs); same(q.recoveryKeys.length, 1); same((await bs.db.ler(q.recoveryKeys[0])).proposta, desired);
        same((await state(bs)).dados.meses[month].receitas[0].valor, 6); same(q.outbox.length, 1);
    });
    add('durable epoch fences another tab even when all BroadcastChannel hints are missed', async () => {
        const s = await source(), b = account(await s.storage.reopen()), bs = await b.unlockWithPassword(integrationPassword);
        const snapshot = await b.vault.read(), token = await b.vault.prepare({ expectedRevision: snapshot.catalog.revision, generation: snapshot.generation, updates: {} });
        await s.a.lock(); await rejects(() => b.vault.commit(token), 'cancelled');
        await rejects(() => state(bs), ['locked', 'cancelled']);
        const resumed = await b.unlockWithPassword(integrationPassword); same((await queue(resumed)).outbox.length, 0);
    });
    add('quota during local ACK commit preserves attempted offline work for idempotent retry', async () => {
        const s = await source(); await addIncome(s.session); const remote = simulatedVaultTransport();
        await rejects(() => s.session.synchronize({ commit: async (...args) => {
            const result = await remote.commit(...args); s.storage.setFaults({ beforePut() { throw Object.assign(new Error('Synthetic quota'), { name: 'QuotaExceededError' }); } }); return result;
        } }), 'quota-exceeded');
        s.storage.setFaults({}); same((await queue(s.session)).outbox.length, 1); same(remote.inspect(integrationOwner).writes, 1);
        await s.session.synchronize(remote); same((await queue(s.session)).outbox.length, 0); same(remote.inspect(integrationOwner).writes, 1);
    });
    add('aborted financial write commits neither state nor queue and preserves previous bytes', async () => {
        const s = await source(), before = JSON.stringify((await s.storage.inspect()).snapshots);
        s.storage.setFaults({ afterPut(tx) { tx.abort(); } }); await rejects(() => addIncome(s.session)); s.storage.setFaults({});
        same(JSON.stringify((await s.storage.inspect()).snapshots), before); same((await state(s.session)).dados.meses[month].receitas.length, 0); same((await queue(s.session)).outbox.length, 0);
    });
    add('read failure blocks the lease without creating a replacement empty vault', async () => {
        const s = await source(); await addIncome(s.session); const before = JSON.stringify((await s.storage.inspect()).snapshots);
        s.storage.setFaults({ afterRead() { throw new Error('Synthetic read failure'); } }); await rejects(() => state(s.session)); s.storage.setFaults({});
        same(JSON.stringify((await s.storage.inspect()).snapshots), before);
        const resumed = await s.a.unlockWithPassword(integrationPassword); same((await queue(resumed)).outbox.length, 1);
    });
    add('interrupted restore preserves source and retries into a fresh destination without loss', async () => {
        const s = await source(); await addIncome(s.session); const pack = await s.a.vault.exportRecoveryPackage(), destStore = await makeStore(), dest = account(destStore.store);
        destStore.setFaults({ beforePut() { throw new Error('Synthetic interruption'); } });
        await rejects(() => dest.restore(pack, { recoverySecret: s.created.recoverySecret, newPassword: integrationPassword }));
        destStore.setFaults({}); same((await destStore.inspect()).snapshots.length, 0); same((await queue(s.session)).outbox.length, 1);
        const restored = await dest.restore(pack, { recoverySecret: s.created.recoverySecret, newPassword: integrationPassword });
        same((await queue(restored.session)).outbox.length, 1); ok((await dest.vault.read()).catalog.keyId !== (await s.a.vault.read()).catalog.keyId);
        await editIntegration(restored.session, integrationOwner.uid, data => { data.receitas[0].valor = 77.77; });
        const repeated = await dest.restore(pack, { recoverySecret: s.created.recoverySecret, newPassword: integrationPassword });
        ok(repeated.alreadyRestored); same((await state(repeated.session)).dados.meses[month].receitas[0].valor, 77.77);
    });
    add('independent recovery and password rewrap preserve the complete encrypted financial graph', async () => {
        const s = await source(); await addIncome(s.session); const before = await queue(s.session); await s.a.lock();
        await s.a.unlockWithRecovery(s.created.recoverySecret); const newPassword = 'synthetic-integration-new-password';
        const changed = await s.a.changePassword(integrationPassword, newPassword); same(await queue(changed), before);
        await s.a.lock(); await rejects(() => s.a.unlockWithPassword(integrationPassword), 'unlock-failed');
        const current = await s.a.unlockWithPassword(newPassword); same(await queue(current), before);
        await s.a.lock(); const recovered = await s.a.unlockWithRecovery(s.created.recoverySecret); same(await queue(recovered), before);
    });
    add('all persisted stores contain ciphertext, never financial documents or independent secrets', async () => {
        const s = await source(); await addIncome(s.session); const raw = JSON.stringify(await s.storage.inspect());
        for (const value of [financialMarker, '1234.56', 'synthetic-income', integrationPassword, s.created.recoverySecret, 'unknownLegacy']) ok(!raw.includes(value));
        ok(raw.includes('AES-256-GCM')); ok(raw.includes('ciphertext')); ok(raw.includes('wrappedKey'));
        await s.a.lock(); await rejects(() => state(s.session), 'persistence/cancelled');
    });
    add('synthetic-only adapter rejects production-looking owners and asynchronous transaction callbacks', async () => {
        const storage = await makeStore();
        await rejects(() => createExperimentalAccount({ store: storage.store, owner: { projectId: 'real-project', uid: 'real-user' }, crypto }), 'synthetic-only');
        const s = await source(), before = JSON.stringify((await s.storage.inspect()).snapshots);
        await rejects(() => s.session.db.alterarDocumentos([`estado:${integrationOwner.uid}`], async docs => docs), 'invalid-input');
        same(JSON.stringify((await s.storage.inspect()).snapshots), before);
    });
    add('transaction results cannot be changed by a callback retaining and mutating its input', async () => {
        const s = await source(), id = `estado:${integrationOwner.uid}`;
        const result = await s.session.db.alterarDocumentos([id], records => {
            const escaped = records.get(id); escaped.syntheticExtra = 'confirmed';
            queueMicrotask(() => { escaped.syntheticExtra = 'uncommitted-late-mutation'; }); return records;
        });
        same(result.get(id).syntheticExtra, 'confirmed'); same((await state(s.session)).syntheticExtra, 'confirmed');
    });
    add('without Web Locks concurrent writers fail closed or merge; explicit retry preserves both intents', async () => {
        const storage = await makeStore();
        const a = createExperimentalAccount({ store: storage.store, owner: integrationOwner, crypto, channelFactory: () => null, locks: null }); accounts.push(a);
        const as = (await a.create({ password: integrationPassword, generation: 'synthetic-generation-1', documents: integrationDocuments() })).session;
        const b = createExperimentalAccount({ store: await storage.reopen(), owner: integrationOwner, crypto, channelFactory: () => null, locks: null }); accounts.push(b);
        const bs = await b.unlockWithPassword(integrationPassword), ids = ['synthetic-uncoordinated-a', 'synthetic-uncoordinated-b'];
        const results = await Promise.allSettled([addIncome(as, integrationOwner.uid, ids[0]), addIncome(bs, integrationOwner.uid, ids[1])]);
        ok(results.some(r => r.status === 'fulfilled'));
        for (let i = 0; i < results.length; i++) if (results[i].status === 'rejected') {
            ok(['cancelled', 'stale-revision'].includes(results[i].reason.code));
            const current = await a.unlockWithPassword(integrationPassword);
            const existing = (await state(current)).dados.meses[month].receitas;
            if (!existing.some(r => r.id === ids[i])) await addIncome(current, integrationOwner.uid, ids[i]);
        }
        const current = await a.unlockWithPassword(integrationPassword);
        same((await state(current)).dados.meses[month].receitas.map(r => r.id).sort(), ids); same((await queue(current)).outbox.length, 2);
    });
    return cases;
}
