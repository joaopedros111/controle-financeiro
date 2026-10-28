// Synthetic in-memory regressions: real app save, atomic service and sync controller.
// No browser profile, production Firebase or financial data is accessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { AutomaticFinanceSync } from '../automatic-finance-sync.js';
import { ServicoFinanceiroAtomico } from '../financial-atomic-service.js';
import { normalizarEstado, validarBackup, validarTotaisMonetarios } from '../finance-core.js';
import { financeSettings, captureRejectedLocalEdit } from '../automatic-sync-policy.js';
import { recordEntityKey, operationId, validSyncIdentity } from '../sync-core.js';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const save = source.slice(source.indexOf('function salvar()'), source.indexOf('// O modo experimental'));
const captureStart = source.indexOf('let capturarSessaoPersistencia =');
const capture = source.slice(captureStart, source.indexOf('\n};', captureStart) + 3);
const clone = structuredClone;
const fixture = (id = 'alice', amount = 10) => normalizarEstado({ meses: {
    '2026-10': { receitas: [{ id, nome: `Synthetic ${id}`, valor: amount }], despesas: [] }
} });
const queue = () => ({ outbox: [], conflicts: [], generation: 'legacy', remoteRevisions: {} });
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
const session = uid => ({ uid, stops: [], ready: true, permanent: false });
const transitions = ['A-B', 'A-B-A', 'logout', 'same-UID-login', 'controller-replacement'];
function switchSession(sync, kind) {
    sync.closeSession();
    if (kind !== 'logout') sync.session = session(kind === 'A-B' || kind === 'A-B-A' ? 'bob' : 'alice');
    if (kind === 'A-B-A') { sync.closeSession(); sync.session = session('alice'); }
}

async function saveHarness({ mode = 'storage-error', pauseAt = 'save', local = false } = {}) {
    const docs = new Map(), paused = deferred(), release = deferred();
    const frames = [], notices = [], events = [], statuses = [], reports = [], changes = [];
    const checkpoint = async stage => { if (stage === pauseAt) { paused.resolve(); await release.promise; } };
    const db = {
        async ler(key) { const value = clone(docs.get(key)); await checkpoint('state-read'); return value; },
        async alterarDocumentos(keys, transform) {
            const changed = transform(new Map(keys.map(key => [key, clone(docs.get(key) ?? null)])));
            for (const [key, value] of changed) docs.set(key, clone(value));
            return changed;
        },
        async alterar(key, transform) {
            const result = await this.alterarDocumentos([key], docs => { docs.set(key, transform(docs.get(key))); return docs; });
            return result.get(key);
        }
    };
    const service = new ServicoFinanceiroAtomico(db, validarBackup,
        q => Array.isArray(q?.outbox) && Array.isArray(q?.conflicts));
    const uid = local ? '@local' : 'alice';
    const initialQueue = { ...queue(), ...(mode === 'generation' ? { generation: 'new' } : {}),
        ...(mode === 'restore' ? { restoreJob: { generation: 'new' } } : {}),
        ...(mode === 'compatibility' ? { compatibilityBlocked: { code: 'sync/upgrade-required' } } : {}) };
    await service.inicializar(uid, fixture(uid, mode === 'conflict' ? 15 : 10), initialQueue);
    await service.inicializar('bob', fixture('bob', 50), queue());
    const apply = service.aplicarEdicao.bind(service);
    service.aplicarEdicao = async (...args) => {
        if (mode === 'success') { const result = await apply(...args); await checkpoint('save'); return result; }
        await checkpoint('save');
        if (mode === 'storage-error') throw new Error('Synthetic old storage error');
        return apply(...args);
    };
    for (const method of ['preservarEdicaoRejeitada', 'alterarFila']) {
        const original = service[method].bind(service);
        service[method] = async (...args) => { const result = await original(...args); await checkpoint('recovery'); return result; };
    }
    let c;
    const sync = new AutomaticFinanceSync({ client: {}, db, service,
        readLegacy: () => ({ estado: 'ausente' }), onAccount() {},
        onState: next => { c.estado = clone(next); frames.push(next); },
        onStatus: (...args) => statuses.push(args), connectivity: { navigator: { onLine: false } } });
    sync.session = local ? null : session('alice');
    sync.request = () => changes.push(sync.session);
    const report = sync.report.bind(sync);
    sync.report = (...args) => { reports.push(args); return report(...args); };
    c = vm.createContext({ estado: fixture(uid, 20), idbBase: fixture(uid), idbGeneration: 'legacy',
        idbPendente: Promise.resolve(), idbBloqueado: false, idbServico: service, idbBanco: db,
        automaticController: sync, chaveEstadoAtual: local ? 'local-key' : 'local-key:uid:alice',
        CHAVE_ESTADO: 'local-key', IDB_HOMOLOGACAO: false, recuperacaoFinanceira: { protegido: false },
        structuredClone, JSON, normalizarEstado, validarTotaisMonetarios, financeSettings,
        captureRejectedLocalEdit, recordEntityKey, operationId, validSyncIdentity,
        renderTudo: () => frames.push(c.estado), renderAvisosFinanceiros: () => frames.push('recovery'),
        atualizarDiagnostico: () => frames.push('diagnostics'), avisar: text => notices.push(text),
        console: { warn() {} }, window: { dispatchEvent: e => events.push(e) },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } }
    });
    c.estadoParaSalvar = () => c.estado;
    vm.runInContext(capture + '\n' + save, c);
    function transition(kind) {
        if (kind === 'controller-replacement') {
            // Even sharing the original session object must not authorize a new controller.
            c.automaticController = { session: sync.session, sessionContext: sync.sessionContext,
                report: (...args) => reports.push(args), localChanged: () => changes.push('replacement') };
        } else switchSession(sync, kind);
        c.chaveEstadoAtual = sync.session ? `local-key:uid:${sync.session.uid}` : 'local-key';
        c.estado = fixture(sync.session?.uid || '@local', 20); c.idbBase = clone(c.estado);
        c.idbBloqueado = false;
    }
    return { c, sync, db, docs, service, paused, release, transition, frames, notices, events, statuses, reports, changes, uid };
}

for (const kind of transitions) {
    for (const mode of ['storage-error', 'success', 'generation', 'restore', 'compatibility', 'conflict']) {
        test(`save ${mode}: ${kind} cannot deliver old errors, state or events to the current UI`, async () => {
            const h = await saveHarness({ mode });
            const bobBefore = clone([h.docs.get('estado:bob'), h.docs.get('fila:bob')]);
            h.c.salvar(); await h.paused.promise; h.transition(kind);
            const visible = h.c.estado, base = h.c.idbBase;
            h.release.resolve(); await h.c.idbPendente;
            assert.equal(h.c.estado, visible); assert.equal(h.c.idbBase, base);
            assert.equal(h.c.idbBloqueado, false);
            assert.deepEqual([h.frames, h.notices, h.events, h.statuses, h.reports, h.changes], [[], [], [], [], [], []]);
            assert.deepEqual([h.docs.get('estado:bob'), h.docs.get('fila:bob')], bobBefore);
            assert.equal(h.c.automaticController.session?.permanent || false, false);
            const q = h.docs.get('fila:alice');
            if (mode === 'success') {
                assert.equal(h.docs.get('estado:alice').dados.meses['2026-10'].receitas[0].valor, 20);
                assert.equal(q.outbox.length, 1, 'the original owner keeps the durable offline operation');
            } else if (mode === 'conflict') assert.ok(q.automaticHistory.length);
            else if (mode !== 'storage-error') assert.ok(q.recoveryKeys.length, 'old intent remains recoverable under A');
        });
    }
    for (const pauseAt of ['recovery', 'state-read']) {
        for (const mode of ['generation', 'conflict']) {
            test(`save ${mode}: ${kind} during ${pauseAt} keeps recovery durable without changing the UI`, async () => {
                const h = await saveHarness({ mode, pauseAt });
                h.c.salvar(); await h.paused.promise; h.transition(kind);
                const visible = h.c.estado;
                h.release.resolve(); await h.c.idbPendente;
                assert.equal(h.c.estado, visible);
                assert.deepEqual([h.frames, h.notices, h.events, h.reports, h.changes], [[], [], [], [], []]);
                const q = h.docs.get('fila:alice');
                assert.ok(mode === 'conflict' ? q.automaticHistory.length : q.recoveryKeys.length);
            });
        }
    }
}

test('current-session save errors still block/report; successful saves still persist and render', async () => {
    for (const mode of ['storage-error', 'success', 'generation', 'conflict']) {
        const h = await saveHarness({ mode }), original = h.sync.session;
        h.c.salvar(); await h.paused.promise; h.release.resolve(); await h.c.idbPendente;
        if (mode === 'storage-error') {
            assert.equal(h.c.idbBloqueado, true); assert.equal(original.permanent, true);
            assert.equal(h.reports[0][1], original); assert.equal(h.notices.length, 1);
        } else {
            assert.equal(h.c.idbBloqueado, false); assert.ok(h.frames.length);
            assert.equal(h.sync.session, original);
        }
    }
});

test('an already queued save survives the next account UI being blocked', async () => {
    const h = await saveHarness({ mode: 'success' }), gate = deferred();
    h.c.idbPendente = gate.promise; h.c.salvar(); h.transition('A-B'); h.c.idbBloqueado = true;
    gate.resolve(); await h.paused.promise; h.release.resolve(); await h.c.idbPendente;
    assert.equal(h.docs.get('estado:alice').dados.meses['2026-10'].receitas[0].valor, 20);
    assert.equal(h.docs.get('fila:alice').outbox.length, 1);
    assert.equal(h.c.idbBloqueado, true, 'the old save cannot change the new account gate');
    assert.deepEqual(h.reports, []);
});

test('anonymous save cannot deliver across login/logout even when controller and null session return', async () => {
    for (const mode of ['storage-error', 'success']) {
        const h = await saveHarness({ mode, local: true });
        h.c.salvar(); await h.paused.promise;
        h.transition('A-B'); h.transition('logout');
        const visible = h.c.estado;
        h.release.resolve(); await h.c.idbPendente;
        assert.equal(h.c.estado, visible); assert.equal(h.c.idbBloqueado, false);
        assert.deepEqual([h.frames, h.notices, h.events, h.reports], [[], [], [], []]);
        if (mode === 'success') assert.equal(h.docs.get('estado:@local').dados.meses['2026-10'].receitas[0].valor, 20);
    }
});

test('real useAccount waits for A saving without permanently blocking synchronization of B', async t => {
    const oldStorage = globalThis.localStorage;
    globalThis.localStorage = { getItem: () => null };
    t.after(() => { if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage; });
    const h = await saveHarness();
    h.sync.waitLocal = async () => { let p; do { p = h.c.idbPendente; await p; } while (p !== h.c.idbPendente); };
    h.sync.onTransition = user => { h.c.chaveEstadoAtual = `local-key:uid:${user.uid}`; h.c.idbBloqueado = true; };
    h.sync.onAccount = () => { h.c.idbBloqueado = false; };
    h.c.salvar(); await h.paused.promise;
    const switched = h.sync.useAccount({ uid: 'bob' });
    h.release.resolve(); await switched;
    assert.equal(h.sync.session.uid, 'bob'); assert.equal(h.sync.session.permanent, false);
    assert.equal(h.c.idbBloqueado, false); assert.equal(h.changes.length, 1);
    assert.equal(h.reports.length, 0); assert.deepEqual(h.notices, []);
    assert.equal(h.c.estado.meses['2026-10'].receitas[0].id, 'bob');
});

function cycleHarness(pauseAt, notices = []) {
    const paused = deferred(), release = deferred(), calls = [], statuses = [], frames = [];
    const state = fixture(), settings = financeSettings(state);
    const q = { ...queue(), settingsBaseline: settings, recoveryNotices: notices };
    let queueReads = 0, stateReads = 0, snapshots = 0;
    const step = async name => { calls.push(name); if (name === pauseAt) { paused.resolve(); await release.promise; } };
    const service = {
        async lerFila() { await step(`queue-${++queueReads}`); return clone(q); },
        async enviarFila() { await step('send'); },
        async confirmarSincronizacao(_uid, _state, _time, current) {
            await step('confirm'); assert.equal(current(), true); return { confirmed: true, fila: { ...q, lastConfirmed: 'synthetic-confirmed' } };
        },
        async alterarFila(_uid, transform) { await step('metadata'); return transform(clone(q)); }
    };
    const sync = new AutomaticFinanceSync({ client: {}, service,
        db: { async ler() { await step(`state-${++stateReads}`); return { dados: state, revisao: 1 }; } },
        onStatus: (...args) => statuses.push(args), onState: (...args) => frames.push(args),
        connectivity: { navigator: { onLine: true } } });
    sync.session = session('alice');
    sync.snapshot = async () => { await step(`snapshot-${++snapshots}`); return { records: [{ month: '2026-10', type: 'receitas', id: 'alice', record: state.meses['2026-10'].receitas[0] }], settings, generation: 'legacy' }; };
    sync.reconcile = async () => { await step('reconcile'); return clone(q); };
    return { sync, paused, release, calls, statuses, frames };
}

for (const kind of transitions.filter(kind => kind !== 'controller-replacement')) {
    for (const pauseAt of ['queue-1', 'snapshot-1', 'snapshot-2', 'state-1', 'queue-2', 'state-2', 'queue-3', 'queue-4']) {
        test(`sync ${kind} during ${pauseAt} cannot confirm or continue old asynchronous work`, async () => {
            const h = cycleHarness(pauseAt), old = h.sync.session;
            const running = h.sync.cycle(old); await h.paused.promise;
            switchSession(h.sync, kind);
            const calls = [...h.calls]; h.release.resolve(); await running;
            assert.deepEqual(h.statuses, []); assert.deepEqual(h.frames, []);
            assert.deepEqual(h.calls, calls, 'no additional persistence or server calls after the stale await');
            assert.equal(h.sync.session?.permanent || false, false);
        });
    }
}

test('current synchronization still publishes confirmation and recovery statuses with its timestamp', async () => {
    for (const notices of [[], [{ id: 'synthetic-recovery', acknowledged: false }]]) {
        const h = cycleHarness(null, notices);
        await h.sync.cycle(h.sync.session);
        assert.equal(h.statuses.length, 1);
        assert.equal(h.statuses[0][0], notices.length ? 'Dados ativos sincronizados; há alterações somente no histórico de recuperação.' : 'Sincronizado');
        assert.equal(h.statuses[0][2], 'synthetic-confirmed');
    }
});

test('obsolete anonymous account transition cannot hydrate a newer logout context', async () => {
    const paused = deferred(), release = deferred(), accounts = [];
    let waits = 0;
    const sync = new AutomaticFinanceSync({ waitLocal: async () => { if (++waits === 1) { paused.resolve(); await release.promise; } },
        onTransition() {}, onAccount: value => accounts.push(value), connectivity: {} });
    const old = sync.useAccount(null); await paused.promise;
    sync.closeSession(); sync.session = session('alice');
    await sync.useAccount(null);
    release.resolve(); await old;
    assert.deepEqual(accounts, [null]);
});

test('anonymous UI hydration fences login/logout while IndexedDB is being read', async () => {
    const start = source.lastIndexOf('onAccount: async user => {');
    const end = source.indexOf('\n                },', start) + '\n                }'.length;
    const handler = source.slice(start + 'onAccount: '.length, end);
    for (const changeSession of [false, true]) {
        const h = await saveHarness({ local: true, pauseAt: 'state-read' });
        h.c.showStatus = text => h.statuses.push(text);
        h.c.concluirCarregamentoConta = () => h.frames.push('ready');
        const hydrate = vm.runInContext(`(${handler})`, h.c);
        const loading = hydrate(null); await h.paused.promise;
        if (changeSession) { h.transition('A-B'); h.transition('logout'); }
        const visible = h.c.estado, base = h.c.idbBase;
        h.release.resolve(); await loading;
        if (changeSession) {
            assert.equal(h.c.estado, visible); assert.equal(h.c.idbBase, base);
            assert.deepEqual(h.frames, []); assert.deepEqual(h.statuses, []);
        } else {
            assert.equal(h.c.estado.meses['2026-10'].receitas[0].valor, 10);
            assert.deepEqual(h.statuses, ['Somente neste dispositivo.']);
            assert.ok(h.frames.includes('ready'));
        }
    }
});

for (const kind of transitions.filter(kind => kind !== 'controller-replacement')) {
    test(`account hydration ${kind}: stale state read cannot initialize or render an old session`, async t => {
        const oldStorage = globalThis.localStorage;
        globalThis.localStorage = { getItem: () => null };
        t.after(() => { if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage; });
        const h = await saveHarness({ pauseAt: 'state-read' });
        let initialized = 0;
        const initialize = h.service.inicializar.bind(h.service);
        h.service.inicializar = (...args) => { initialized++; return initialize(...args); };
        const pending = h.sync.useAccount({ uid: 'alice' }); await h.paused.promise;
        h.transition(kind); const visible = h.c.estado;
        h.statuses.length = 0; h.release.resolve(); await pending;
        assert.equal(initialized, 0); assert.equal(h.c.estado, visible);
        assert.deepEqual([h.frames, h.statuses, h.changes], [[], [], []]);
    });

    test(`snapshot ${kind}: a stale generation read cannot fall back to other server reads`, async () => {
        const h = cycleHarness(null), paused = deferred(), release = deferred(), calls = [];
        h.sync.snapshot = AutomaticFinanceSync.prototype.snapshot;
        h.sync.client = { generationSnapshot: async () => { paused.resolve(); await release.promise; return null; },
            list: () => calls.push('records'), getSettings: () => calls.push('settings'), listConflicts: () => calls.push('conflicts') };
        const pending = h.sync.snapshot(h.sync.session);
        const rejected = assert.rejects(pending, { code: 'persistence/cancelled' });
        await paused.promise; switchSession(h.sync, kind); release.resolve(); await rejected;
        assert.deepEqual(calls, []); assert.deepEqual(h.statuses, []);
    });
}
