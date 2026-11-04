// Pure synthetic event source, shared by the Node tests and browser fixture.
export function createSyntheticLifecycleAuth(lifecycle, subscribe, onAccepted = () => {}) {
    let sequence = 0, registration = null, consumer = null, onError = null, accepted = null;
    let current = { sequence, user: null, failed: false }, user = null, delivering = false;
    let pending = Promise.resolve(true);
    const track = work => { pending = Promise.resolve(work); pending.catch(() => {}); return pending; };
    function deliver(event, subscription) {
        if (!event || subscription !== registration || !registration || event !== current || event.sequence !== sequence) return Promise.resolve(false);
        if (accepted === event) return pending;
        accepted = event; user = event.user; onAccepted(user);
        let work;
        delivering = true;
        try {
            work = event.failed ? lifecycle.identify({ kind: 'failed' })
                : user ? lifecycle.identify({ kind: 'confirmed', owner: { projectId: 'demo-injection', uid: user.uid } })
                    : lifecycle.close('logout');
        } finally { delivering = false; }
        const result = track(Promise.resolve(work).then(() => true, error => {
            if (error.code === 'lifecycle/stale-session' && event.sequence !== sequence) return false;
            throw error;
        }));
        // Failure is not an anonymous-session event; never turn it into logout.
        if (event.failed) onError?.(Object.assign(new Error('Synthetic authentication failed'), { code: 'auth/synthetic-unavailable' }));
        else consumer(user);
        return result;
    }
    function prepare(uid, failed = false) {
        if (uid !== null && !/^synthetic-injection-[AB]$/.test(uid)) throw new Error('Synthetic identity required');
        current = { sequence: ++sequence, user: uid ? { uid, email: `${uid}@local.test` } : null, failed };
        return current;
    }
    return Object.freeze({
        onUser(callback, failure = () => {}) {
            if (registration) throw new Error('Synthetic Auth observer already registered');
            const subscription = {}; registration = subscription; consumer = callback; onError = failure;
            const initial = current;
            const stop = subscribe(() => { void deliver(initial, subscription); });
            return () => {
                if (registration !== subscription) return;
                stop(); registration = null; consumer = null; onError = null;
                current = { sequence: ++sequence, user: null, failed: false }; accepted = null;
                user = null; onAccepted(null);
                delivering = true;
                try { track(lifecycle.close('logout')); } finally { delivering = false; }
            };
        },
        ready: async () => user,
        switchAccount(uid) { return deliver(prepare(uid), registration); },
        failAuth() { return deliver(prepare(null, true), registration); },
        delayedCallback(uid) {
            const event = prepare(uid), subscription = registration;
            return () => deliver(event, subscription);
        },
        duplicateCallback() {
            const event = current, subscription = registration;
            return () => deliver(event, subscription);
        },
        onLifecycleState(state) {
            // Direct close/suspend/resume also invalidate queued Auth callbacks.
            if (!delivering && state.phase === 'closing') { sequence++; current = accepted = null; }
        },
        settled: () => pending
    });
}

// Synthetic test document imports this before app.js; production index.html does not.
import { configurarDependenciasAplicacao, criarArmazenamento } from '../../storage.js';
import { abrirPersistenciaFinanceira } from '../../indexeddb-persistence.js';
import { ServicoFinanceiroAtomico } from '../../financial-atomic-service.js';
import { AutomaticFinanceSync } from '../../automatic-finance-sync.js';
import { realContractClient } from './vault-real-client.mjs';
import { createVaultLifecycle } from '../../experimental/finance-vault-lifecycle.js';
const mode = new URL(location.href).searchParams.get('mode'), events = [];
const trace = [], counts = { clients: 0, observers: 0 };
window.injectionEvidence = { events, trace, counts, db: null, controller: null };
// Coordenação experimental, sem acesso ao cofre ou aos dados financeiros.
if (new URL(location.href).searchParams.get('lifecycle_probe') === '1') {
    window.injectionEvidence.lifecycleAdapterOpenAttempts = 0;
    const lifecycle = createVaultLifecycle({
        revocationScope: 'owner-vault-all-tabs',
        openAdapter: async () => {
            window.injectionEvidence.lifecycleAdapterOpenAttempts++;
            throw new Error('Experimental vault opening is disabled');
        },
        onState: state => {
            window.injectionEvidence.lifecycleAuth?.onLifecycleState(state);
            window.injectionEvidence.lifecycleStates.push({
                phase: state.phase,
                ownership: state.ownership,
                owner: state.owner
            });
        }
    });

    window.injectionEvidence.lifecycleStates = [];
    window.injectionEvidence.lifecycle = lifecycle;
    lifecycle.start();
}
const values = new Map(), local = { getItem: key => { if (key === 'controleFinanceiro:v3') trace.push('financial-read'); return values.get(key) ?? null; }, setItem: (key, v) => values.set(key, v), removeItem: key => values.delete(key) };
if (new URL(location.href).searchParams.has('bootstrap_seed')) {
    const now = new Date(), month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    values.set('controleFinanceiro:v3', JSON.stringify({ versao: 3, tema: 'claro', categorias: ['Casa'], meses: {
        [month]: { receitas: [{ id: 'synthetic-before-auth', nome: 'SYNTHETIC BEFORE AUTH', valor: 12.34, recebido: true }], despesas: [] }
    } }));
}
const clients = new Map(), accounts = ['synthetic-injection-A', 'synthetic-injection-B'];
let observer, user = null;
const switchAccount = async uid => {
    if (window.injectionEvidence.lifecycleAuth) return window.injectionEvidence.lifecycleAuth.switchAccount(uid);
    user = uid ? { uid, email: `${uid}@local.test` } : null; observer?.(user);
};
const client = { protocolVersion: 2, ready: async () => user, onUser(callback) { counts.observers++; trace.push('auth-observer'); observer = callback; queueMicrotask(() => callback(user)); return () => { observer = null; }; },
    login: () => switchAccount(accounts[0]), logout: () => switchAccount(null) };
if (window.injectionEvidence.lifecycle) {
    const auth = createSyntheticLifecycleAuth(window.injectionEvidence.lifecycle, client.onUser.bind(client), value => { user = value; });
    window.injectionEvidence.lifecycleAuth = auth;
    client.onUser = auth.onUser;
    client.ready = auth.ready;
}
for (const name of ['list', 'getSettings', 'saveSettings', 'listConflicts', 'commit', 'saveAutomaticHistory', 'listAutomaticHistory', 'resolveConflict', 'generationMarker', 'generationSnapshot', 'publishRestore', 'listen', 'listenSettings', 'listenConflicts', 'listenGeneration']) {
    client[name] = (uid, ...args) => {
        if (user?.uid !== uid) throw new Error('Synthetic account mismatch');
        if (!clients.has(uid)) clients.set(uid, realContractClient({ projectId: 'demo-injection', uid }).client);
        return clients.get(uid)[name](uid, ...args);
    };
}
window.injectionEvidence.switchAccount = switchAccount;
configurarDependenciasAplicacao({
    storage: criarArmazenamento(local),
    async openPersistence() {
        events.push('open'); trace.push('open'); if (mode === 'fail') throw new Error('Synthetic persistence initialization failure');
        const db = await abrirPersistenciaFinanceira({ open(name, version) {
            if (name !== 'controleFinanceiro:integridade:v1') throw new Error('Unexpected default DB');
            return indexedDB.open('controleFinanceiro:integridade:v1:synthetic-injection', version);
        } }); window.injectionEvidence.db = db; return db;
    },
    createAtomicService(...args) { events.push('service'); trace.push('service'); return new ServicoFinanceiroAtomico(...args); },
    createAutomaticSync(options) { events.push('sync'); trace.push('sync'); return window.injectionEvidence.controller = new AutomaticFinanceSync(options); },
    readLegacyMetadata(uid) { events.push(`metadata:${uid}`); return {}; },
    async loadFirebase() {
        events.push('firebase'); trace.push('firebase');
        if (mode === 'firebase-fail') throw new Error('Synthetic Firebase loading failure');
        if (new URL(location.href).searchParams.has('bootstrap_seed')) {
            window.injectionEvidence.beforeAuth = { state: await window.injectionEvidence.db.ler('estado:@local'), text: document.getElementById('lista-receitas').textContent };
            await new Promise(resolve => { window.injectionEvidence.releaseFirebase = resolve; });
        }
        return { criarFirebaseSync: () => { counts.clients++; return client; } };
    }
});
await import('../../app.js');
if (window.injectionEvidence.lifecycleAuth) {
    // Reuse the application's subscription when present; local-only probe needs
    // one synthetic subscription, never a second Auth observer.
    if (counts.observers === 0) client.onUser(() => {});
    await new Promise(resolve => queueMicrotask(resolve));
    await window.injectionEvidence.lifecycleAuth.settled();
}
window.injectionEvidence.ready = true;
