// Standalone synthetic browser fixture. Never imported by the published app.
import { initializeApp, deleteApp } from 'firebase/app';
import * as authSDK from 'firebase/auth';
import * as firestoreSDK from 'firebase/firestore';
import { criarFirebaseSync } from '../../firebase-sync-entry.js';
import { AutomaticFinanceSync } from '../../automatic-finance-sync.js';
import { ServicoFinanceiroAtomico } from '../../financial-atomic-service.js';
import { PersistenciaFinanceira } from '../../indexeddb-persistence.js';
import { normalizarEstado, validarBackup } from '../../finance-core.js';
import { financeSettings } from '../../automatic-sync-policy.js';
import { makeOperation, recordEntityKey } from '../../sync-core.js';
import { composeFirebaseSyncLifecycle } from '../../experimental/firebase-sync-lifecycle-poc.js';

const config = globalThis.authPocConfiguration;
const projectId = 'demo-controle-financeiro';
if (location.hostname !== '127.0.0.1' || config?.projectId !== projectId
    || !/^[a-f0-9-]{36}$/.test(config.run) || typeof config.composed !== 'boolean') {
    throw new Error('Explicit isolated IndexedDB composition required');
}
const owners = ['A', 'B'].map(name => `synthetic-idb-${name}-${config.run}`);
const databaseName = `synthetic:firebase-sync-lifecycle-idb:v1:${config.run}`;
const idb = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Synthetic PoC IndexedDB blocked'));
});
const local = new PersistenciaFinanceira(idb);
const service = new ServicoFinanceiroAtomico(local, validarBackup,
    queue => Array.isArray(queue.outbox) && Array.isArray(queue.conflicts), navigator.locks);
const month = '2026-11';
const initial = normalizarEstado({ versao: 3, categorias: ['Casa'], meses: { [month]: { receitas: [], despesas: [] } } });
for (const uid of owners) {
    // The real service rejects incomplete pairs and never replaces existing documents.
    await service.inicializar(uid, initial, { generation: 'legacy', initialized: true,
        automaticPolicyInitialized: true, outbox: [], conflicts: [], remoteRevisions: {},
        attempted: {}, recoveryKeys: [], settingsBaseline: financeSettings(initial), automaticSettingsDirty: false });
}
await local.alterar('harness:acks', current => current === null ? [] : current);

let app, auth, remoteDb, registrations = 0, cancellations = 0, closed = false;
const client = criarFirebaseSync({ projectId, apiKey: 'demo-only-auth-poc', appId: 'synthetic-idb-financial-poc' }, {
    createApp: value => app = initializeApp(value, `synthetic-idb-${config.run}`),
    createAuth(value) {
        auth = authSDK.initializeAuth(value, { persistence: authSDK.browserLocalPersistence });
        authSDK.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        return auth;
    },
    createFirestore(value) {
        remoteDb = firestoreSDK.initializeFirestore(value, { localCache: firestoreSDK.memoryLocalCache() });
        firestoreSDK.connectFirestoreEmulator(remoteDb, '127.0.0.1', 8080);
        return remoteDb;
    },
    checkAuthPersistence() {}, getRedirectResult: async () => null
});
if (auth.emulatorConfig?.host !== '127.0.0.1' || auth.emulatorConfig.port !== 9099
    || remoteDb._settings.host !== '127.0.0.1:8080' || remoteDb._settings.ssl !== false) {
    throw new Error('Exclusive Emulator endpoints required');
}
const source = { ...client,
    onUser(callback) {
        registrations++;
        const unsubscribe = client.onUser(callback);
        return () => { cancellations++; unsubscribe(); };
    },
    async commit(...args) {
        const ack = await client.commit(...args);
        if (ack?.acknowledged !== true) throw new Error('Real commit ACK required');
        await local.alterar('harness:acks', current => [...current, { id: args[1].id, ack: structuredClone(ack) }]);
        return ack;
    }
};
const composition = config.composed ? composeFirebaseSyncLifecycle({ client: source, auth, sdk: authSDK, allowedUids: owners }) : null;
const active = composition?.client || source;
const failures = [], transitions = [];
const sync = new AutomaticFinanceSync({ client: active, db: local, service,
    readLegacy: () => ({ estado: 'ausente' }), readLegacyMetadata: () => ({}),
    connectivity: { navigator: { onLine: false } },
    onTransition: user => transitions.push(user?.uid || null),
    onAccount() {}, onState() {},
    onStatus(message, failed) { if (failed) failures.push(message); }
});
await sync.start();
if (composition) await composition.session.ready;
async function waitFor(predicate) {
    for (let attempt = 0; attempt < 500; attempt++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Synthetic session hydration timeout');
}
async function login(index) {
    if (closed) throw new Error('PoC closed');
    if (auth.currentUser?.uid !== owners[index]) {
        await authSDK.signInWithCustomToken(auth, JSON.stringify({ uid: owners[index] }));
    }
    await waitFor(() => sync.session?.uid === owners[index] && sync.session?.generation === 'legacy');
    if (composition) await waitFor(() => composition.session.lifecycle.state().owner?.uid === owners[index]);
}
async function close() {
    if (closed) return;
    closed = true;
    sync.stop();
    await composition?.session.dispose();
    await firestoreSDK.terminate(remoteDb);
    await deleteApp(app);
    local.fechar(); // Never signOut or delete a database on reload/restart.
}
globalThis.financialPoc = Object.freeze({
    ready: true, loginA: () => login(0), loginB: () => login(1),
    async queueIncome(id, value) {
        if (closed || sync.session?.uid !== owners[0]) throw new Error('Synthetic account A required');
        if (!/^synthetic-[\w-]+$/.test(id)) throw new Error('Synthetic record ID required');
        const base = (await local.ler(`estado:${owners[0]}`)).dados, next = structuredClone(base);
        next.meses[month].receitas.push({ id, nome: 'SYNTHETIC FINANCIAL COMPARISON', valor: value, recebido: false });
        return service.aplicarEdicao(owners[0], base, next, (changes, queue) => changes.map(record =>
            makeOperation(recordEntityKey(record), record, queue.remoteRevisions[recordEntityKey(record)] || null)));
    },
    async cycle() {
        if (closed || !sync.session) throw new Error('Synthetic session required');
        return sync.cycle(sync.session);
    },
    async inspect() {
        const documents = await Promise.all(owners.map(async uid => ({
            state: await local.ler(`estado:${uid}`), queue: await service.lerFila(uid)
        })));
        const stats = composition?.session.stats || { adapterOpens: 0 };
        return { documents, state: documents[0].state, queue: documents[0].queue,
            acks: await local.ler('harness:acks'), registrations, cancellations, failures,
            composed: config.composed, databaseName, sdkUid: auth.currentUser?.uid || null,
            authPhase: composition?.session.lifecycle.state() || null, stats,
            safe: !composition || composition.session.states.every(state => state.data === null
                && !['unlocking', 'ready', 'operating'].includes(state.phase)),
            compositionErrors: composition?.errors.map(error => error.message) || [], transitions };
    },
    async logout() { await active.logout(); await waitFor(() => sync.session === null); },
    async remoteRecords() {
        if (auth.currentUser?.uid !== owners[0]) throw new Error('Synthetic account A required');
        return client.list(owners[0]);
    },
    close
});
addEventListener('pagehide', () => { void close(); });
