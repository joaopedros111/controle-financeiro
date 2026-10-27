import test from 'node:test';
import assert from 'node:assert/strict';
import { withFinanceGenerations } from '../finance-generation-transport.js';
import { AutomaticFinanceSync } from '../automatic-finance-sync.js';
import { ServicoFinanceiroAtomico } from '../financial-atomic-service.js';
import { normalizarEstado, validarBackup } from '../finance-core.js';
import { prepareGenerationRestore, financeSettings } from '../automatic-sync-policy.js';
import { recordEntityKey, makeOperation, registrosFinanceiros } from '../sync-core.js';

const clone = value => structuredClone(value);
const stamp = { seconds: 100, nanoseconds: 0 };
const row = (id, valor, extra = {}) => ({ id, nome: id, valor, ...extra });
const state = (receitas = [], despesas = [], extra = {}) => normalizarEstado({
    versao: 3, tema: 'claro', categorias: ['Casa'], meses: { '2026-10': { receitas, despesas } }, ...extra
});
const backup = () => state([row('same', 10, { recebido: true }), row('deleted-before', 25)],
    [row('expense', 7, { pago: true, categoria: 'Casa' })], { orcamentos: { padrao: { Casa: 200 }, meses: { '2026-10': { Casa: 150 } } } });
function transport() {
    const data = new Map(); let chain = Promise.resolve(), failNext = false, loseActivation = false;
    const snap = key => ({ exists: () => data.has(key), data: () => clone(data.get(key)), metadata: { fromCache: false, hasPendingWrites: false } });
    const prefix = key => [...data].filter(([path]) => path.startsWith(key + '/') && !path.slice(key.length + 1).includes('/'));
    const sdk = {
        doc: (...parts) => parts.filter(part => typeof part === 'string').join('/'),
        collection: (...parts) => parts.filter(part => typeof part === 'string').join('/'),
        getDocFromServer: async key => snap(key),
        getDocsFromServer: async key => { const docs = prefix(key).map(([path, value]) => ({ id: path.split('/').at(-1), data: () => clone(value) })); return { docs, size: docs.length, metadata: { fromCache: false, hasPendingWrites: false } }; },
        serverTimestamp: () => stamp, Timestamp: { now: () => stamp }, onSnapshot: () => () => {},
        runTransaction(_db, callback) {
            const next = chain.then(async () => {
                const writes = [];
                const result = await callback({ get: async key => snap(key), set: (key, value) => writes.push([key, clone(value)]),
                    update: (key, value) => writes.push([key, { ...clone(data.get(key)), ...clone(value) }]) });
                if (writes.length && failNext) { failNext = false; throw Object.assign(new Error('offline'), { code: 'unavailable' }); }
                for (const [key, value] of writes) data.set(key, value);
                if (loseActivation && writes.some(([key]) => key.endsWith('/control/restore'))) { loseActivation = false; throw Object.assign(new Error('lost ACK'), { code: 'unavailable' }); }
                return result;
            }); chain = next.catch(() => {}); return next;
        }
    };
    const legacy = {
        list: async () => prefix('users/alice/records').map(([path, value]) => ({ ...clone(value), _docId: path.split('/').at(-1) })),
        getSettings: async () => ({ ...financeSettings(state()), revision: 'legacy-settings', updatedAt: stamp }),
        listConflicts: async () => [], listen: () => () => {}, listenSettings: () => () => {}, listenConflicts: () => () => {},
        listAutomaticHistory: async () => [], commit: async () => ({ acknowledged: true })
    };
    const client = withFinanceGenerations(legacy, {}, uid => { assert.equal(uid, 'alice'); }, sdk);
    return { data, client, sdk, failNext: () => { failNext = true; }, loseActivation: () => { loseActivation = true; } };
}
function localDatabase() {
    const data = new Map(); let chain = Promise.resolve();
    return { data, ler: async key => clone(data.get(key) ?? null), alterar(key, fn) {
        return this.alterarDocumentos([key], docs => { docs.set(key, fn(docs.get(key))); return docs; }).then(docs => docs.get(key));
    }, alterarDocumentos(keys, fn) {
        const next = chain.then(() => { const docs = fn(new Map(keys.map(key => [key, clone(data.get(key) ?? null)])));
            for (const [key, value] of docs) data.set(key, clone(value)); return docs; });
        chain = next.catch(() => {}); return next;
    } };
}
async function controller(client, initial, queue = {}) {
    const db = localDatabase();
    const service = new ServicoFinanceiroAtomico(db, validarBackup, q => Array.isArray(q.outbox) && Array.isArray(q.conflicts), { request: (_key, fn) => fn() });
    await service.inicializar('alice', initial, { outbox: [], conflicts: [], remoteRevisions: {}, initialized: true, ...queue });
    const visible = [], metadata = [], statuses = [];
    const sync = new AutomaticFinanceSync({ client, db, service, readLegacy: () => ({ estado: 'ausente' }), onAccount() {}, onState: (value, meta) => { visible.push(clone(value)); metadata.push(clone(meta)); }, onStatus: message => statuses.push(message), connectivity: { navigator: { onLine: false } } });
    sync.session = { uid: 'alice', stops: [], attempt: 0, ready: false };
    sync.request = () => {};
    return { sync, db, service, visible, metadata, statuses };
}

test('complete replacement preserves IDs, resurrects tombstones, replaces values and carries all financial settings', async () => {
    const h = transport();
    for (const item of registrosFinanceiros(state([row('same', 999), row('absent', 50)]))) h.data.set(`users/alice/records/${recordEntityKey(item)}`, { ...item, deleted: false, revision: 'old', updatedAt: stamp });
    const dead = registrosFinanceiros(state([row('deleted-before', 1)]))[0];
    h.data.set(`users/alice/records/${recordEntityKey(dead)}`, { ...dead, record: undefined, deleted: true, revision: 'dead', updatedAt: stamp });
    await h.client.publishRestore('alice', { generation: 'restore-1', baseGeneration: 'legacy', state: backup() });
    const remote = await h.client.generationSnapshot('alice');
    assert.equal(remote.generation, 'restore-1');
    assert.deepEqual(remote.records.map(item => item.id).sort(), ['deleted-before', 'expense', 'same']);
    assert.equal(remote.records.find(item => item.id === 'same').record.valor, 10);
    assert.equal(remote.records.find(item => item.id === 'same').record.recebido, true);
    assert.equal(remote.records.find(item => item.id === 'expense').record.pago, true);
    assert.deepEqual(remote.settings.budgets, backup().orcamentos);
    assert.deepEqual(remote.settings.categories, ['Casa']);
    assert.ok(h.data.has(`users/alice/records/${recordEntityKey(dead)}`), 'previous remote namespace is recoverable');
    const recovery = await h.client.readGenerationRecovery('alice', 'legacy');
    assert.equal(recovery.meses['2026-10'].receitas.find(item => item.id === 'same').valor, 999);
    assert.equal((await h.client.listAutomaticHistory('alice')).at(-1).type, 'generation-recovery');
});

test('preparation interruption exposes only the old generation and resumes idempotently', async () => {
    const h = transport(), job = { generation: 'restore-resume', baseGeneration: 'legacy', state: backup() };
    let checks = 0;
    await assert.rejects(h.client.publishRestore('alice', job, () => ++checks < 5));
    assert.equal((await h.client.generationSnapshot('alice')).generation, 'legacy');
    await h.client.publishRestore('alice', job);
    await h.client.publishRestore('alice', job);
    assert.equal((await h.client.generationSnapshot('alice')).records.length, 3);
});

test('a lost activation ACK resumes safely, while concurrent restores cannot replace a newer generation', async () => {
    const h = transport(), job = { generation: 'restore-ack', baseGeneration: 'legacy', state: backup() };
    h.loseActivation(); await assert.rejects(h.client.publishRestore('alice', job), /lost ACK/);
    await h.client.publishRestore('alice', job);
    await assert.rejects(h.client.publishRestore('alice', { ...job, generation: 'competing' }), { code: 'sync/restore-conflict' });
    assert.equal((await h.client.generationSnapshot('alice')).generation, 'restore-ack');
});

test('old offline operations are fenced; normal create, edit, delete and monthly settings continue in the new generation', async () => {
    const h = transport(); await h.client.publishRestore('alice', { generation: 'active', baseGeneration: 'legacy', state: backup() });
    const value = { ...registrosFinanceiros(state([row('new', 9)]))[0], deleted: false };
    const op = makeOperation(recordEntityKey(value), value, null);
    await assert.rejects(h.client.commit('alice', op), { code: 'sync/generation-changed' });
    const created = { ...op, generation: 'active' }; await h.client.commit('alice', created);
    const changed = { ...value, record: { ...value.record, valor: 15 } };
    const edit = { ...makeOperation(op.entityKey, changed, op.id), generation: 'active' }; await h.client.commit('alice', edit);
    const deleted = { ...makeOperation(op.entityKey, { month: value.month, type: value.type, id: value.id, deleted: true }, edit.id), generation: 'active' };
    await h.client.commit('alice', deleted);
    const remote = await h.client.generationSnapshot('alice'); assert.equal(remote.records.find(item => item.id === 'new').deleted, true);
    const nextSettings = financeSettings(backup()); nextSettings.budgets.meses['2026-11'] = { Casa: 80 };
    await h.client.saveSettings('alice', nextSettings, remote.settings.revision, () => true, 'active');
    assert.equal((await h.client.generationSnapshot('alice')).settings.budgets.meses['2026-11'].Casa, 80);
});

test('offline local replacement archives the old state and queue and resumes after reopening', async () => {
    const h = transport(), initial = state([row('absent', 99)]);
    const old = { ...registrosFinanceiros(initial)[0], deleted: false };
    const pending = makeOperation(recordEntityKey(old), old, null);
    const c = await controller(h.client, initial, { outbox: [pending] });
    await c.sync.importBackup(backup(), () => true);
    const saved = await c.service.lerFila('alice');
    assert.equal(saved.outbox.length, 0); assert.ok(saved.restoreJob);
    assert.deepEqual((await c.db.ler(saved.recoveryKeys[0])).state, initial);
    assert.equal((await c.db.ler(saved.recoveryKeys[0])).queue.outbox[0].id, pending.id);
    await assert.rejects(c.service.aplicarEdicao('alice', initial, initial), { code: 'sync/restore-in-progress' });
    const reopened = new AutomaticFinanceSync({ client: h.client, db: c.db, service: c.service, onState() {}, onStatus() {}, connectivity: { navigator: { onLine: true } } });
    reopened.request = () => {}; reopened.session = { uid: 'alice', stops: [], attempt: 0, ready: false };
    await reopened.cycle(reopened.session);
    assert.equal((await c.service.lerFila('alice')).restoreJob, null);
    assert.deepEqual((await c.db.ler('estado:alice')).dados.orcamentos, backup().orcamentos);
    assert.equal((await h.client.generationSnapshot('alice')).records.length, 3);
});

test('another offline device archives its obsolete queue instead of reintroducing old records', async () => {
    const h = transport();
    const stale = state([row('offline-only', 100)], [], { tema: 'rosa' }), item = { ...registrosFinanceiros(stale)[0], deleted: false };
    const c = await controller(h.client, stale, { outbox: [makeOperation(recordEntityKey(item), item, null)] });
    c.sync.online = true;
    await h.client.publishRestore('alice', { generation: 'remote-restore', baseGeneration: 'legacy', state: backup() });
    await c.sync.cycle(c.sync.session);
    const queue = await c.service.lerFila('alice');
    assert.equal(queue.generation, 'remote-restore'); assert.equal(queue.outbox.length, 0);
    assert.equal((await c.db.ler(queue.recoveryKeys[0])).queue.outbox.length, 1);
    assert.equal((await c.db.ler('estado:alice')).dados.meses['2026-10'].receitas.some(item => item.id === 'offline-only'), false);
    assert.equal((await c.db.ler('estado:alice')).dados.tema, 'rosa');
    assert.equal(queue.recoveryNotices.filter(item => !item.acknowledged).length, 1);
    assert.equal(c.metadata.at(-1).recoveryNotices[0].code, 'archived-offline');
    assert.match(c.statuses.at(-1), /somente no histórico/);
    await c.sync.cycle(c.sync.session);
    assert.equal((await c.service.lerFila('alice')).recoveryNotices.length, 1);
    await assert.rejects(c.service.aplicarEdicao('alice', stale, stale, () => [], () => {}, () => true, 'legacy'), { code: 'sync/generation-changed' });
});

test('two tabs resuming the same completed restore preserve later legitimate edits and settings', async () => {
    const h = transport(), c = await controller(h.client, state());
    await c.sync.importBackup(backup(), () => true);
    const job = (await c.service.lerFila('alice')).restoreJob;
    const peer = new AutomaticFinanceSync({ client: h.client, db: c.db, service: c.service, onState() {}, onStatus() {} });
    peer.session = { uid: 'alice', stops: [], ready: false };
    const finish = async sync => {
        try { await sync.resumeRestore(sync.session, job); }
        catch (error) {
            assert.equal(error.code, 'sync/generation-changed'); // Another tab activated while this one was preparing.
            await sync.resumeRestore(sync.session, job);
        }
    };
    await Promise.all([finish(c.sync), finish(peer)]);
    const later = clone((await c.db.ler('estado:alice')).dados);
    later.meses['2026-10'].receitas[0].valor = 999;
    await c.service.aplicarEdicao('alice', backup(), later, () => [], queue => {
        queue.automaticSettingsDirty = true; queue.automaticSettingsValue = { later: true };
    });
    const before = clone([...c.db.data]);
    await c.sync.resumeRestore(c.sync.session, job);
    assert.deepEqual([...c.db.data], before);
    assert.notEqual(c.sync.session.permanent, true);
    await c.service.alterarFila('alice', queue => { queue.restoreJob = { ...job, generation: 'different-job' }; return queue; });
    await assert.rejects(c.sync.resumeRestore(c.sync.session, job), { code: 'sync/restore-conflict' });
});

test('unsupported running protocol blocks writes durably, preserves pending data and recovers after an updated client', async () => {
    const h = transport(), initial = state([row('pending-local', 7)]);
    const value = { ...registrosFinanceiros(initial)[0], deleted: false }, operation = { ...makeOperation(recordEntityKey(value), value, null), generation: 'future' };
    const c = await controller(h.client, initial, { generation: 'future', outbox: [operation] });
    c.sync.online = true;
    await h.client.publishRestore('alice', { generation: 'future', baseGeneration: 'legacy', state: backup() });
    const future = await h.client.generationSnapshot('alice');
    h.data.set('users/alice/control/restore', { protocol: 3, activeGeneration: 'future' });
    await c.sync.run(c.sync.session);
    assert.equal((await c.service.lerFila('alice')).compatibilityBlocked.code, 'sync/upgrade-required');
    assert.deepEqual((await c.service.lerFila('alice')).outbox, [operation]);
    assert.deepEqual((await c.db.ler('estado:alice')).dados, initial);
    assert.equal(c.metadata.at(-1).compatibilityBlocked, true);
    assert.match(c.statuses.at(-1), /Atualização obrigatória/);
    await assert.rejects(c.service.aplicarEdicao('alice', initial, initial), { code: 'sync/upgrade-required' });
    await assert.rejects(c.sync.importBackup(backup(), () => true), { code: 'sync/upgrade-required' });
    // Simulate a freshly loaded compatible transport against the same local store.
    const updatedClient = { ...h.client, protocolVersion: 3,
        generationSnapshot: async () => ({ ...future, protocol: 3 }),
        generationMarker: async () => ({ protocol: 3, activeGeneration: 'future' }) };
    const updated = new AutomaticFinanceSync({ client: updatedClient, db: c.db, service: c.service, onState() {}, onStatus() {}, connectivity: { navigator: { onLine: true } } });
    updated.request = () => {}; updated.session = { uid: 'alice', stops: [], attempt: 0, ready: false };
    await updated.cycle(updated.session);
    const queue = await c.service.lerFila('alice');
    assert.equal(queue.compatibilityBlocked, undefined); assert.equal(queue.generation, 'future');
    assert.equal(queue.outbox.length, 0);
    assert.ok(queue.recoveryKeys.some(key => c.db.data.get(key).queue.outbox.some(item => item.id === operation.id)));
    const before = (await c.db.ler('estado:alice')).dados, edited = clone(before);
    edited.meses['2026-10'].receitas[0].valor = 123;
    await c.service.aplicarEdicao('alice', before, edited, changes => changes.map(value => makeOperation(recordEntityKey(value), value, null)), () => {}, () => true, 'future');
    assert.equal((await c.service.lerFila('alice')).outbox[0].generation, 'future');
});

test('validation and cancellation do not modify any local or remote document', async () => {
    const h = transport(), c = await controller(h.client, state());
    const before = JSON.stringify([...c.db.data]);
    await assert.rejects(c.sync.importBackup({ meses: { bad: {} } }, () => true));
    assert.equal(await c.sync.importBackup(backup(), () => false), null);
    assert.equal(JSON.stringify([...c.db.data]), before); assert.equal(h.data.size, 0);
    assert.equal(prepareGenerationRestore(backup()).meses['2026-10'].receitas[0].recebido, true);
});

test('a competing restore pauses safely and a newly confirmed retry keeps both recovery copies', async () => {
    const h = transport(), c = await controller(h.client, state([row('before', 99)]));
    await c.sync.importBackup(backup(), () => true);
    await h.client.publishRestore('alice', { generation: 'other-device', baseGeneration: 'legacy', state: state([row('other', 50)]) });
    await assert.rejects(c.sync.cycle(c.sync.session), { code: 'sync/restore-conflict' });
    c.sync.online = true;
    await c.sync.importBackup(backup(), () => true);
    const queue = await c.service.lerFila('alice');
    assert.equal(queue.recoveryKeys.length, 2);
    assert.equal(queue.restoreJob.baseGeneration, 'other-device');
    await c.sync.cycle(c.sync.session);
    assert.equal((await h.client.generationSnapshot('alice')).records.length, 3);
});

test('an incompatibility detected by another tab during restore confirmation cannot be bypassed', async () => {
    const h = transport(), original = state([row('keep', 9)]), c = await controller(h.client, original);
    c.sync.online = true;
    h.client.generationMarker = async () => {
        await c.service.alterarFila('alice', queue => { queue.compatibilityBlocked = { code: 'sync/upgrade-required' }; return queue; });
        return null;
    };
    await assert.rejects(c.sync.importBackup(backup(), () => true), { code: 'sync/upgrade-required' });
    assert.deepEqual((await c.db.ler('estado:alice')).dados, original);
    assert.equal((await c.service.lerFila('alice')).restoreJob, undefined);
    assert.equal((await c.service.lerFila('alice')).compatibilityBlocked.code, 'sync/upgrade-required');
});
