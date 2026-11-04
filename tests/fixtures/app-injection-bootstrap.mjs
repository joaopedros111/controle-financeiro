// Synthetic test document imports this before app.js; production index.html does not.
import { configurarDependenciasAplicacao, criarArmazenamento } from '../../storage.js';
import { abrirPersistenciaFinanceira } from '../../indexeddb-persistence.js';
import { ServicoFinanceiroAtomico } from '../../financial-atomic-service.js';
import { AutomaticFinanceSync } from '../../automatic-finance-sync.js';
import { realContractClient } from './vault-real-client.mjs';
const mode = new URL(location.href).searchParams.get('mode'), events = [];
const trace = [], counts = { clients: 0, observers: 0 };
window.injectionEvidence = { events, trace, counts, db: null, controller: null };
const values = new Map(), local = { getItem: key => { if (key === 'controleFinanceiro:v3') trace.push('financial-read'); return values.get(key) ?? null; }, setItem: (key, v) => values.set(key, v), removeItem: key => values.delete(key) };
if (new URL(location.href).searchParams.has('bootstrap_seed')) {
    const now = new Date(), month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    values.set('controleFinanceiro:v3', JSON.stringify({ versao: 3, tema: 'claro', categorias: ['Casa'], meses: {
        [month]: { receitas: [{ id: 'synthetic-before-auth', nome: 'SYNTHETIC BEFORE AUTH', valor: 12.34, recebido: true }], despesas: [] }
    } }));
}
const clients = new Map(), accounts = ['synthetic-injection-A', 'synthetic-injection-B'];
let observer, user = null;
const switchAccount = async uid => { user = uid ? { uid, email: `${uid}@local.test` } : null; observer?.(user); };
const client = { protocolVersion: 2, ready: async () => user, onUser(callback) { counts.observers++; trace.push('auth-observer'); observer = callback; queueMicrotask(() => callback(user)); return () => { observer = null; }; },
    login: () => switchAccount(accounts[0]), logout: () => switchAccount(null) };
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
window.injectionEvidence.ready = true;
