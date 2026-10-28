// Regression tests for successful restores and account/session isolation.
// All data and persistence below are synthetic and in memory; no Firebase,
// browser profile, real backup, or financial record is accessed or modified.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { normalizarEstado, validarBackup, validarTotaisMonetarios } from '../finance-core.js';
import { criarRecuperacaoFinanceira } from '../storage.js';
import { AutomaticFinanceSync } from '../automatic-finance-sync.js';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('function importarBackup(');
const importBackupUI = source.slice(start, source.indexOf('\n}', start) + 2);
assert.ok(start >= 0 && importBackupUI.endsWith('}'));

const fixture = (id, amount) => normalizarEstado({ versao: 3, tema: 'claro', categorias: ['Outros'],
    orcamentos: { padrao: {}, meses: {} },
    meses: { '2026-10': { receitas: [{ id, nome: `Synthetic ${id}`, valor: amount }], despesas: [] } } });
const firstId = state => state.meses['2026-10'].receitas[0].id;
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

function setup({ pauseAfterWrite = false, pauseAt = pauseAfterWrite ? 'after-write' : null,
    local = false, controllerAbsent = false, confirmAction = () => true } = {}) {
    const backupA = fixture('backup-a', 101), privateA = fixture('private-a', 102), privateB = fixture('private-b', 202);
    const queue = () => ({ outbox: [], conflicts: [], recoveryKeys: [], recoveryNotices: [], generation: 'legacy' });
    const docs = new Map([
        ['estado:alice', { revisao: 0, dados: privateA }], ['fila:alice', queue()],
        ['estado:bob', { revisao: 0, dados: privateB }], ['fila:bob', queue()]
    ]);
    docs.set('estado:@local', { revisao: 0, dados: structuredClone(privateA) });
    docs.set('fila:@local', queue());
    const written = deferred(), paused = deferred(), release = deferred();
    const networkCalls = [], frames = [], notices = [], reads = [], renewals = [], events = [];
    let queueReads = 0, confirmations = 0, transactions = 0;
    const checkpoint = async stage => {
        if (pauseAt === stage) { paused.resolve(); await release.promise; }
    };
    const db = {
        async ler(key) {
            reads.push(key);
            const result = structuredClone(docs.get(key));
            await checkpoint(key.startsWith('fila:') ? `queue-${++queueReads}` : 'state');
            return result;
        },
        async alterarDocumentos(keys, transform) {
            transactions++;
            await checkpoint('before-write');
            const snapshot = new Map(keys.map(key => [key, structuredClone(docs.get(key))]));
            const changed = transform(snapshot);
            for (const [key, value] of changed) docs.set(key, structuredClone(value));
            written.resolve();
            await checkpoint('after-write');
            return changed;
        }
    };
    let context, reader;
    const controller = new AutomaticFinanceSync({ db,
        service: { lerFila: uid => db.ler(`fila:${uid}`) },
        client: { publishRestore: (...args) => { networkCalls.push(args); } },
        readLegacy: () => ({ estado: 'ausente' }), onAccount() {}, onStatus() {},
        onState: next => { context.estado = normalizarEstado(next); },
        waitLocal: () => checkpoint('wait-local'),
        connectivity: { navigator: { onLine: false } }
    });
    controller.request = () => {}; // No timers or synchronization/network work in these tests.
    if (pauseAt === 'marker') {
        controller.online = true;
        controller.client.generationMarker = async () => { await checkpoint('marker'); return null; };
    }
    const actualImport = controller.importBackup.bind(controller);
    controller.importBackup = (raw, confirm, onSessionRenewed) => actualImport(raw, confirm, event => {
        renewals.push(event);
        onSessionRenewed?.(event);
    });
    const switchAccount = (uid, state) => {
        controller.closeSession();
        if (uid) controller.session = { uid, user: { uid }, stops: [], ready: false, permanent: false };
        if (context) {
            context.estado = structuredClone(state);
            context.idbBase = structuredClone(state);
            context.chaveEstadoAtual = uid ? `controleFinanceiro:v3:uid:${uid}` : 'controleFinanceiro:v3';
        }
    };
    switchAccount(local ? null : 'alice', privateA);
    const originalSession = controller.session;
    context = vm.createContext({ structuredClone, crypto: globalThis.crypto,
        automaticController: controllerAbsent ? undefined : controller, estado: structuredClone(privateA),
        chaveEstadoAtual: local ? 'controleFinanceiro:v3' : 'controleFinanceiro:v3:uid:alice',
        CHAVE_ESTADO: 'controleFinanceiro:v3', IDB_HOMOLOGACAO: false,
        idbBase: structuredClone(privateA), ultimaRemocao: null, normalizarEstado,
        validarBackup, validarTotaisMonetarios,
        idbBanco: db, idbServico: {}, idbBloqueado: false, idbGeneration: 'legacy', idbPendente: Promise.resolve(),
        capturarSessaoPersistencia: () => {
            const currentController = context.automaticController, currentSession = currentController?.session ?? null;
            return () => context.automaticController === currentController && (currentController?.session ?? null) === currentSession;
        },
        recuperacaoFinanceira: criarRecuperacaoFinanceira({ desproteger() {} }),
        window: { dispatchEvent: event => events.push(event.type) }, CustomEvent: class { constructor(type) { this.type = type; } },
        estadoParaSalvar: () => context.estado,
        renderTudo: () => frames.push({ uid: controller.session?.uid, firstId: firstId(context.estado) }),
        registrarOperacaoDados() {}, avisar: message => notices.push(message),
        textoTraduzido: value => value, confirm: () => { confirmations++; return confirmAction(); },
        FileReader: class { constructor() { reader = this; } readAsText() {} }
    });
    const persistStart = source.indexOf('async function persistirEstadoFinanceiro(');
    vm.runInContext(source.slice(persistStart, source.indexOf('\n}', persistStart) + 2), context);
    vm.runInContext(importBackupUI, context);
    context.importarBackup({ name: 'synthetic-alice-backup.json' });
    reader.result = JSON.stringify(backupA);
    return { controller, context, docs, frames, notices, networkCalls, written, paused, release, reads, renewals, events,
        originalSession, backupA, privateA, privateB,
        confirmations: () => confirmations, transactions: () => transactions,
        switchToBob: () => switchAccount('bob', privateB),
        loginAliceAgain: () => switchAccount('alice', privateA),
        logout: () => switchAccount(null, privateA), load: () => reader.onload() };
}

test('SECURITY AUDIT: backup selected by A must not be restored into B after FileReader account switch', async () => {
    const h = setup();
    h.switchToBob(); // The file was selected while Alice was active; read finishes after Bob signs in.
    await h.load();
    assert.deepEqual(h.networkCalls, [], 'The diagnostic must remain entirely offline');
    assert.deepEqual(h.notices, ['A conta mudou durante a leitura do backup. Importe novamente.']);
    assert.equal(h.controller.session.uid, 'bob');
    assert.equal(firstId(h.docs.get('estado:bob').dados), 'private-b',
        'ISOLATION FAILURE: the backup selected in account A overwrote the in-memory account B state');
});

test('SECURITY AUDIT: completed A restore must not render A data in B after an asynchronous account switch', async () => {
    const h = setup({ pauseAfterWrite: true });
    const restoring = h.load();
    await h.written.promise; // A transaction passed its session guard and wrote only Alice's namespace.
    h.switchToBob(); // Auth changes before the transaction completion promise reaches the UI callback.
    h.release.resolve();
    await restoring;
    assert.deepEqual(h.networkCalls, [], 'The diagnostic must remain entirely offline');
    assert.deepEqual(h.notices, ['Sessão alterada durante a restauração.']);
    assert.equal(h.controller.session.uid, 'bob');
    assert.equal(firstId(h.docs.get('estado:bob').dados), 'private-b', 'Bob persistence was not written by Alice');
    assert.equal(h.frames.some(frame => frame.uid === 'bob' && frame.firstId === 'backup-a'), false,
        'CONFIDENTIALITY FAILURE: the old account restore republished A financial data while B was active');
});

test('authenticated restore renews its own session, persists and renders the restored backup', async () => {
    const h = setup();
    await h.load();
    assert.equal(firstId(h.docs.get('estado:alice').dados), 'backup-a');
    assert.equal(firstId(h.context.estado), 'backup-a');
    assert.equal(firstId(h.context.idbBase), 'backup-a');
    assert.deepEqual(h.frames, [{ uid: 'alice', firstId: 'backup-a' }]);
    assert.equal(firstId(h.docs.get('estado:bob').dados), 'private-b');
    assert.equal(h.renewals.length, 1);
    assert.equal(h.renewals[0].controller, h.controller);
    assert.equal(h.renewals[0].previousSession, h.originalSession);
    assert.equal(h.renewals[0].session, h.controller.session);
    assert.notEqual(h.controller.session, h.originalSession);
    assert.deepEqual(h.networkCalls, []);
});

test('importBackup keeps its data/null return contract without the optional callback', async () => {
    const h = setup();
    const cancelled = await h.controller.importBackup(h.backupA, () => false);
    assert.equal(cancelled, null);
    assert.equal(h.controller.session, h.originalSession);
    assert.equal(h.renewals.length, 0);
    assert.equal(h.transactions(), 0);
    const restored = await h.controller.importBackup(h.backupA, () => true);
    assert.equal(firstId(restored), 'backup-a');
    assert.equal(Object.hasOwn(restored, 'session'), false);
    assert.equal(firstId(h.docs.get('estado:alice').dados), 'backup-a');
});

for (const stage of ['queue-1', 'queue-2', 'state', 'wait-local', 'marker', 'before-write']) {
    for (const transition of ['logout', 'same-account-login', 'A-B-A']) {
        test(`restore rejects ${transition} while awaiting ${stage}`, async () => {
            const h = setup({ pauseAt: stage });
            const restoring = h.load();
            await h.paused.promise;
            if (transition === 'logout') h.logout();
            else {
                if (transition === 'A-B-A') h.switchToBob();
                h.loginAliceAgain();
            }
            h.release.resolve();
            await restoring;
            assert.equal(firstId(h.docs.get('estado:alice').dados), 'private-a');
            assert.equal(firstId(h.docs.get('estado:bob').dados), 'private-b');
            assert.equal(h.frames.length, 0);
            assert.equal(h.transactions(), stage === 'before-write' ? 1 : 0);
            if (['queue-1', 'queue-2', 'state'].includes(stage)) assert.equal(h.confirmations(), 0);
            const readCount = { 'queue-1': 1, 'queue-2': 2, state: 3 }[stage];
            if (readCount) assert.equal(h.reads.length, readCount, 'No more reads after session invalidation');
        });
    }
}

for (const transition of ['logout', 'same-account-login', 'A-B-A']) {
    test(`committed restore does not deliver data after ${transition}`, async () => {
        const h = setup({ pauseAfterWrite: true });
        const restoring = h.load();
        await h.written.promise;
        if (transition === 'logout') h.logout();
        else {
            if (transition === 'A-B-A') h.switchToBob();
            h.loginAliceAgain();
        }
        h.release.resolve();
        await restoring;
        assert.equal(firstId(h.docs.get('estado:alice').dados), 'backup-a', 'Only the already committed original namespace changed');
        assert.equal(firstId(h.docs.get('estado:bob').dados), 'private-b');
        assert.equal(firstId(h.context.estado), 'private-a');
        assert.equal(h.frames.length, 0);
    });
}

test('session changes during confirmation cancel before any renewal or write', async () => {
    const h = setup({ confirmAction: () => { h.logout(); h.loginAliceAgain(); return true; } });
    await h.load();
    assert.equal(h.transactions(), 0);
    assert.equal(h.renewals.length, 0);
    assert.equal(firstId(h.docs.get('estado:alice').dados), 'private-a');
    assert.equal(h.frames.length, 0);
});

test('a different controller cannot reuse the original session object while reading the file', async () => {
    const h = setup();
    h.context.automaticController = { session: h.originalSession };
    await h.load();
    assert.equal(h.reads.length, 0);
    assert.equal(h.frames.length, 0);
});

test('controller replacement during an async read does not confirm or write', async () => {
    const h = setup({ pauseAt: 'state' });
    const restoring = h.load();
    await h.paused.promise;
    h.context.automaticController = { session: h.originalSession };
    h.release.resolve();
    await restoring;
    assert.equal(h.confirmations(), 0);
    assert.equal(h.transactions(), 0);
    assert.equal(h.frames.length, 0);
});

test('a renewed-session handoff cannot authorize a replacement controller', async () => {
    const h = setup();
    const actualImport = h.controller.importBackup;
    h.controller.importBackup = (raw, confirm, notify) => actualImport(raw, confirm, event => {
        h.context.automaticController = { session: event.session };
        notify(event);
    });
    await h.load();
    assert.equal(h.transactions(), 0);
    assert.equal(firstId(h.docs.get('estado:alice').dados), 'private-a');
    assert.equal(h.frames.length, 0);
});

test('UI delivery accepts only the explicitly renewed object, not another login with the same UID', async () => {
    const h = setup();
    const actualImport = h.controller.importBackup;
    h.controller.importBackup = async (...args) => {
        const restored = await actualImport(...args);
        h.switchToBob();
        h.loginAliceAgain();
        return restored;
    };
    await h.load();
    assert.equal(firstId(h.docs.get('estado:alice').dados), 'backup-a');
    assert.equal(firstId(h.context.estado), 'private-a');
    assert.equal(h.frames.length, 0);
});

for (const controllerAbsent of [false, true]) {
    test(`local restore persists and renders with ${controllerAbsent ? 'no controller' : 'no authenticated session'}`, async () => {
        const h = setup({ local: true, controllerAbsent });
        await h.load();
        assert.equal(firstId(h.docs.get('estado:@local').dados), 'backup-a');
        assert.equal(firstId(h.docs.get('estado:alice').dados), 'private-a');
        assert.equal(firstId(h.docs.get('estado:bob').dados), 'private-b');
        assert.equal(firstId(h.context.estado), 'backup-a');
        assert.equal(h.frames.length, 1);
        assert.deepEqual(h.events, ['finance-backup-restored']);
        assert.equal(h.renewals.length, 0);
    });
}

test('local restore does not follow a persistence key changed before the queued write', async () => {
    const h = setup({ local: true, confirmAction: () => {
        queueMicrotask(() => { h.context.chaveEstadoAtual = 'controleFinanceiro:v3:uid:bob'; });
        return true;
    } });
    await h.load();
    assert.equal(h.transactions(), 0);
    assert.equal(firstId(h.docs.get('estado:@local').dados), 'private-a');
    assert.equal(firstId(h.docs.get('estado:bob').dados), 'private-b');
    assert.equal(h.frames.length, 0);
    assert.deepEqual(h.events, []);
});

test('a local persistence key changed during commit cannot replace the new account baseline or UI', async () => {
    const h = setup({ local: true, pauseAfterWrite: true });
    const restoring = h.load();
    await h.written.promise;
    h.context.chaveEstadoAtual = 'controleFinanceiro:v3:uid:bob';
    h.context.estado = structuredClone(h.privateB);
    h.context.idbBase = structuredClone(h.privateB);
    h.release.resolve();
    await restoring;
    assert.equal(firstId(h.docs.get('estado:@local').dados), 'backup-a');
    assert.equal(firstId(h.docs.get('estado:bob').dados), 'private-b');
    assert.equal(firstId(h.context.estado), 'private-b');
    assert.equal(firstId(h.context.idbBase), 'private-b');
    assert.equal(h.frames.length, 0);
    assert.deepEqual(h.events, []);
});

test('local file selection cannot survive login/logout even when key and null session return to their old values', async () => {
    const h = setup({ local: true });
    h.loginAliceAgain();
    h.logout();
    await h.load();
    assert.equal(h.controller.session, null);
    assert.equal(h.context.chaveEstadoAtual, 'controleFinanceiro:v3');
    assert.equal(h.transactions(), 0);
    assert.equal(firstId(h.docs.get('estado:@local').dados), 'private-a');
    assert.equal(h.frames.length, 0);
});

test('local commit cannot deliver to a later anonymous context after login/logout', async () => {
    const h = setup({ local: true, pauseAfterWrite: true });
    const restoring = h.load();
    await h.written.promise;
    h.loginAliceAgain();
    h.logout();
    const newBaseline = h.context.idbBase;
    h.release.resolve();
    await restoring;
    assert.equal(firstId(h.docs.get('estado:@local').dados), 'backup-a');
    assert.equal(h.context.idbBase, newBaseline);
    assert.equal(firstId(h.context.estado), 'private-a');
    assert.equal(h.frames.length, 0);
    assert.deepEqual(h.events, []);
});
