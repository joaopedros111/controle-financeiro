import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticFinanceSync } from '../automatic-finance-sync.js';
import { ServicoFinanceiroAtomico } from '../financial-atomic-service.js';
import { normalizarEstado, validarBackup } from '../finance-core.js';
import { financeSettings } from '../automatic-sync-policy.js';
import { makeOperation, recordEntityKey } from '../sync-core.js';

const clone = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const failure = code => Object.assign(new Error(`Synthetic ${code}`), { code });
const month = '2026-10', stamp = { seconds: 100, nanoseconds: 0 };
const row = id => ({ id, nome: `Synthetic ${id}`, valor: 10 });
const entry = id => ({ month, type: 'receitas', id, record: row(id), deleted: false });
const state = ids => normalizarEstado({ versao: 3, meses: { [month]: { receitas: ids.map(row), despesas: [] } } });
const operation = id => makeOperation(recordEntityKey(entry(id)), entry(id), null);
const settle = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };
const advance = async (t, ms) => { t.mock.timers.tick(ms); await settle(); };

function memoryDatabase() {
    const data = new Map(); let previous = Promise.resolve();
    return { data, ler: async key => clone(data.get(key) ?? null),
        alterarDocumentos(keys, transform) {
            const next = previous.then(() => {
                const docs = transform(new Map(keys.map(key => [key, clone(data.get(key) ?? null)])));
                for (const [key, value] of docs) data.set(key, clone(value));
                return docs;
            });
            previous = next.catch(() => {}); return next;
        },
        alterar(key, transform) {
            return this.alterarDocumentos([key], docs => { docs.set(key, transform(docs.get(key))); return docs; }).then(docs => docs.get(key));
        }
    };
}

async function harness(t, ids = [], options = {}) {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    const db = memoryDatabase(), initial = state(ids), records = new Map(), statuses = [], frames = [], commits = [];
    let lockTail = Promise.resolve(), activeLocks = 0, snapshots = 0, logouts = 0;
    const locks = { request(_name, task) {
        const next = lockTail.then(async () => { activeLocks++; try { return await task(); } finally { activeLocks--; } });
        lockTail = next.catch(() => {}); return next;
    } };
    const service = new ServicoFinanceiroAtomico(db, validarBackup, q => Array.isArray(q?.outbox) && Array.isArray(q?.conflicts), locks);
    await service.inicializar('alice', initial, { initialized: true, automaticPolicyInitialized: true, automaticHasLocalSettings: true,
        outbox: ids.map(operation), conflicts: [], remoteRevisions: {}, settingsBaseline: financeSettings(initial), lastConfirmed: null });
    const user = { uid: 'alice' }, connectivity = new EventTarget(), document = new EventTarget();
    connectivity.navigator = { onLine: true }; connectivity.document = document;
    document.hidden = false; document.visibilityState = 'visible';
    let settings = { ...financeSettings(initial), revision: 'settings-base', updatedAt: stamp };
    const client = {
        protocolVersion: 2, ready: async () => {}, onUser(callback) { queueMicrotask(() => callback(user)); return () => {}; },
        async logout() { logouts++; },
        async generationSnapshot(uid) { assert.equal(uid, 'alice'); snapshots++; return { generation: 'legacy', records: clone([...records.values()]), settings: clone(settings), conflicts: [] }; },
        async commit(uid, op) {
            assert.equal(uid, 'alice'); commits.push(clone(op));
            records.set(op.entityKey, { ...clone(op.value), _docId: op.entityKey, revision: op.id, updatedAt: stamp });
            return { acknowledged: true, revision: op.id };
        },
        async saveSettings(uid, value) { assert.equal(uid, 'alice'); settings = { ...clone(value), revision: 'settings-new', updatedAt: stamp }; return { acknowledged: true, revision: settings.revision }; },
        async saveAutomaticHistory() { return { acknowledged: true }; }, async resolveConflict() { return true; },
        listen: () => () => {}, listenSettings: () => () => {}, listenConflicts: () => () => {}
    };
    const sync = new AutomaticFinanceSync({ client, db, service, connectivity, readLegacy: () => ({ estado: 'ausente' }), readLegacyMetadata: () => ({}),
        onAccount() {}, onState: value => frames.push(clone(value)), onStatus: (...args) => statuses.push(args),
        networkTimeoutMs: 25, retryBaseMs: 100, delayMs: 1, maxDelayMs: 250, random: () => 0.5, ...options });
    sync.session = { uid: 'alice', user, generation: 'legacy', stops: [], attempt: 0, ready: false, permanent: false };
    t.after(() => sync.stop());
    const queue = () => service.lerFila('alice'), stored = () => db.ler('estado:alice');
    async function add(id) {
        const before = (await stored()).dados, next = clone(before); next.meses[month].receitas.push(row(id));
        await service.aplicarEdicao('alice', before, next, () => [operation(id)]);
        sync.localChanged();
    }
    return { sync, client, service, db, document, connectivity, statuses, frames, commits, records, queue, stored, add,
        snapshots: () => snapshots, activeLocks: () => activeLocks, logouts: () => logouts };
}

test('a hanging server read times out, preserves durable work and ignores its late result', async t => {
    const h = await harness(t, ['first']), gate = deferred(), original = h.client.generationSnapshot;
    const stale = await original('alice'), before = await h.stored(), queued = await h.queue();
    h.client.generationSnapshot = () => gate.promise;
    t.after(() => gate.resolve(stale));
    const running = h.sync.run(h.sync.session); await settle();
    assert.equal(h.sync.session.running, true);
    await advance(t, 25);
    assert.equal(h.sync.session.running, false, 'the deadline must release the cycle');
    await running;
    assert.deepEqual(await h.stored(), before); assert.deepEqual((await h.queue()).outbox, queued.outbox);
    assert.equal(h.sync.session.permanent, false); assert.equal((await h.queue()).lastConfirmed, null);
    gate.resolve({ ...stale, records: [{ ...entry('unexpected'), revision: 'stale', updatedAt: stamp }] });
    await settle();
    assert.deepEqual(await h.stored(), before); assert.ok(!h.statuses.some(([message]) => message === 'Sincronizado'));
    h.client.generationSnapshot = original; clearTimeout(h.sync.session.timer);
    await h.sync.run(h.sync.session);
    assert.equal((await h.queue()).outbox.length, 0); assert.equal(h.commits.length, 1);
    assert.ok(h.statuses.some(([message]) => message === 'Sincronizado'));
});

test('a timed-out batch retains a late individual ACK without overlapping writes or sending later edits', async t => {
    const h = await harness(t, ['first', 'second']), gate = deferred(), original = h.client.commit;
    h.client.commit = async (...args) => { const ack = await original(...args); if (h.commits.length === 1) await gate.promise; return ack; };
    t.after(gate.resolve);
    const first = h.sync.run(h.sync.session); await settle();
    assert.equal(h.commits.length, 1);
    await advance(t, 25);
    assert.equal(h.sync.session.running, false, 'a write without ACK must stop blocking the UI cycle'); await first;
    assert.equal((await h.queue()).outbox.length, 2); assert.ok((await h.queue()).attempted[operation('first').id]);
    await h.add('newer');
    clearTimeout(h.sync.session.timer);
    const retry = h.sync.run(h.sync.session); await settle(); await advance(t, 25);
    assert.equal(h.commits.length, 1, 'retry must wait for the original SDK write');
    gate.resolve(); await settle(); await retry;
    assert.deepEqual((await h.queue()).outbox.map(op => op.value.id), ['second', 'newer']);
    assert.equal((await h.queue()).lastConfirmed, null); assert.ok(!h.statuses.some(([message]) => message === 'Sincronizado'));
    clearTimeout(h.sync.session.timer); await h.sync.run(h.sync.session);
    assert.deepEqual(h.commits.map(op => op.value.id), ['first', 'second', 'newer']);
    assert.equal((await h.queue()).outbox.length, 0);
    assert.ok(h.statuses.some(([message]) => message === 'Sincronizado'));
});

test('a settings deadline retains the raw coordination lock and preserves a newer settings edit', async t => {
    const h = await harness(t), gate = deferred(), original = h.client.saveSettings;
    const before = (await h.stored()).dados, next = clone(before); next.categorias.push('Synthetic local');
    await h.service.aplicarEdicao('alice', before, next, () => [], q => { q.automaticSettingsDirty = true; q.automaticSettingsValue = financeSettings(next); });
    h.client.saveSettings = async (...args) => { const ack = await original(...args); await gate.promise; return ack; };
    t.after(gate.resolve);
    const running = h.sync.run(h.sync.session); await settle();
    assert.equal(h.activeLocks(), 1);
    await advance(t, 25);
    assert.equal(h.sync.session.running, false); await running;
    let entered = false;
    const peer = h.service.coordenarSettings('alice', () => { entered = true; });
    await settle(); assert.equal(entered, false, 'the underlying write still owns the lock');
    const current = (await h.stored()).dados, newer = clone(current); newer.categorias.push('Synthetic newer');
    await h.service.aplicarEdicao('alice', current, newer, () => [], q => {
        q.automaticSettingsDirty = true; q.automaticSettingsValue = financeSettings(newer);
    });
    gate.resolve(); await peer; await settle();
    assert.equal((await h.queue()).automaticSettingsDirty, true);
    assert.ok((await h.queue()).automaticSettingsValue.categories.includes('Synthetic newer'));
    assert.equal((await h.queue()).lastConfirmed, null);
});

test('retry uses capped equal jitter and local requests cannot bypass its deadline', async t => {
    const h = await harness(t, [], { maxDelayMs: 256 }); let runs = 0;
    h.sync.run = async () => { runs++; };
    for (const [attempt, random, expected] of [[0, 0, 50], [0, 0.5, 75], [1, 0.5, 150], [9, 0.5, 192]]) {
        h.sync.session.attempt = attempt; h.sync.random = () => random;
        await h.sync.report(failure('unavailable'));
        assert.equal(h.sync.session.retryAt - Date.now(), expected);
        const before = runs; h.sync.localChanged();
        await advance(t, Math.floor(expected) - 1); assert.equal(runs, before);
        await advance(t, 2); assert.equal(runs, before + 1);
    }
    assert.equal(h.sync.session.permanent, false);
});

test('visible foreground events resume transient synchronization and preserve permanent gates', async t => {
    const h = await harness(t); await h.sync.start(); let runs = 0;
    h.sync.run = async () => { runs++; };
    await h.sync.report(failure('unavailable')); clearTimeout(h.sync.session.timer); h.sync.session.retryAt = 0;
    h.document.hidden = true; h.document.visibilityState = 'hidden';
    h.document.dispatchEvent(new Event('visibilitychange')); await advance(t, 250); assert.equal(runs, 0);
    h.document.hidden = false; h.document.visibilityState = 'visible';
    for (const [target, name] of [[h.document, 'visibilitychange'], [h.connectivity, 'focus'], [h.connectivity, 'pageshow']]) {
        target.dispatchEvent(new Event(name)); await advance(t, 250);
    }
    assert.equal(runs, 3);
    for (const code of ['unauthenticated', 'sync/invalid-data', 'sync/storage-blocked']) {
        await h.sync.report(failure(code));
        h.connectivity.dispatchEvent(new Event('focus')); h.connectivity.dispatchEvent(new Event('pageshow'));
        h.document.dispatchEvent(new Event('visibilitychange')); await advance(t, 250);
        assert.equal(h.sync.session.permanent, true); assert.equal(runs, 3);
    }
    h.sync.stop(); h.sync.session = { uid: 'alice', user: {}, generation: 'legacy', stops: [], permanent: false };
    h.connectivity.dispatchEvent(new Event('focus')); h.document.dispatchEvent(new Event('visibilitychange'));
    await advance(t, 250); assert.equal(runs, 3, 'stop removes foreground listeners');
});

for (const code of ['unauthenticated', 'auth/user-token-expired']) test(`expired authentication (${code}) preserves the UID and work until a new valid session`, async t => {
    const h = await harness(t, ['first']), original = h.client.generationSnapshot, session = h.sync.session;
    const before = await h.stored(), queue = await h.queue(); let failedReads = 0;
    h.client.generationSnapshot = async () => { failedReads++; throw failure(code); };
    await h.sync.run(session);
    assert.equal(h.sync.session, session); assert.equal(session.uid, 'alice'); assert.equal(session.permanent, true);
    assert.deepEqual(await h.stored(), before); assert.deepEqual((await h.queue()).outbox, queue.outbox);
    assert.equal(h.logouts(), 0); assert.equal(h.commits.length, 0); assert.ok(h.statuses.some(([, failed]) => failed));
    h.sync.localChanged(); await advance(t, 250); await h.sync.run(session);
    assert.equal(failedReads, 1);
    h.client.generationSnapshot = original; await h.sync.useAccount({ uid: 'alice' });
    clearTimeout(h.sync.session.timer); await h.sync.run(h.sync.session);
    assert.equal(h.sync.session.uid, 'alice'); assert.equal((await h.queue()).outbox.length, 0);
    assert.equal(h.commits.length, 1);
});

test('late reads cannot cross a UID transition and local-only sessions never start remote work', async t => {
    const h = await harness(t, ['first']), gate = deferred(), original = h.client.generationSnapshot;
    const old = h.sync.session, snapshot = await original('alice'); h.client.generationSnapshot = () => gate.promise;
    t.after(() => gate.resolve(snapshot));
    const running = h.sync.run(old); await settle();
    h.sync.closeSession();
    h.sync.session = { uid: 'bob', user: { uid: 'bob' }, generation: 'legacy', stops: [], localOnly: true };
    const before = await h.stored(); h.statuses.length = 0; h.frames.length = 0;
    await advance(t, 25); gate.resolve(snapshot); await running; await settle();
    await h.sync.run(old); await h.sync.run(h.sync.session); h.sync.localChanged(); await advance(t, 250);
    assert.equal(h.sync.session.uid, 'bob'); assert.equal(h.commits.length, 0);
    assert.deepEqual(await h.stored(), before); assert.deepEqual(h.frames, []);
    assert.ok(!h.statuses.some(([message]) => message === 'Sincronizado'));
    assert.equal((await h.queue()).outbox.length, 1);
});

test('synchronized status waits for durable history and conflict resolution ACKs, then replay publishes nothing', async t => {
    const h = await harness(t), historyGate = deferred(), resolutionGate = deferred();
    const historyEntered = deferred(), resolutionEntered = deferred(), published = [], resolved = [];
    t.after(() => { historyGate.resolve(); resolutionGate.resolve(); });
    await h.service.alterarFila('alice', q => ({ ...q,
        automaticHistory: [{ id: 'auto-history-synthetic', uploaded: false }],
        automaticResolutions: [{ id: 'synthetic-conflict', choice: 'remote', confirmed: false }] }));
    h.client.saveAutomaticHistory = async (_uid, item) => {
        historyEntered.resolve(); await historyGate.promise; published.push(item.id); return { acknowledged: true };
    };
    h.client.resolveConflict = async (_uid, id) => {
        resolutionEntered.resolve(); await resolutionGate.promise; resolved.push(id); return true;
    };
    const running = h.sync.run(h.sync.session); await historyEntered.promise;
    assert.equal((await h.queue()).automaticHistory[0].uploaded, false);
    assert.equal((await h.queue()).lastConfirmed, null);
    assert.ok(!h.statuses.some(([s]) => s === 'Sincronizado'));
    historyGate.resolve(); await resolutionEntered.promise;
    assert.equal((await h.queue()).automaticHistory[0].uploaded, true);
    assert.equal((await h.queue()).automaticResolutions[0].confirmed, false);
    assert.equal((await h.queue()).lastConfirmed, null);
    assert.ok(!h.statuses.some(([s]) => s === 'Sincronizado'));
    resolutionGate.resolve(); await running;
    assert.equal((await h.queue()).automaticResolutions[0].confirmed, true);
    assert.ok(h.statuses.some(([s]) => s === 'Sincronizado'));
    await h.sync.run(h.sync.session);
    assert.deepEqual(published, ['auto-history-synthetic']);
    assert.deepEqual(resolved, ['synthetic-conflict']);
});

test('history added by a peer during resolution prevents confirmation until its own publication ACK', async t => {
    const h = await harness(t), published = [];
    await h.service.alterarFila('alice', q => ({ ...q,
        automaticResolutions: [{ id: 'synthetic-conflict', choice: 'remote', confirmed: false }] }));
    h.client.resolveConflict = async () => {
        await h.service.alterarFila('alice', q => ({ ...q,
            automaticHistory: [{ id: 'auto-history-peer', uploaded: false }] }));
        return true;
    };
    h.client.saveAutomaticHistory = async (_uid, item) => { published.push(item.id); return { acknowledged: true }; };
    await h.sync.run(h.sync.session);
    assert.equal(h.sync.session.again, true);
    assert.equal((await h.queue()).lastConfirmed, null);
    assert.ok(!h.statuses.some(([s]) => s === 'Sincronizado'));
    assert.deepEqual(published, []);
    clearTimeout(h.sync.session.timer); await h.sync.run(h.sync.session);
    assert.deepEqual(published, ['auto-history-peer']);
    assert.equal((await h.queue()).automaticHistory[0].uploaded, true);
    assert.ok(h.statuses.some(([s]) => s === 'Sincronizado'));
});
