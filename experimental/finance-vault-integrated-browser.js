import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, connectAuthEmulator, signInWithCustomToken } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache, connectFirestoreEmulator, terminate, doc, getDocFromServer } from 'firebase/firestore';
import { criarFirebaseSync } from '../firebase-sync-entry.js';
import { openVaultStore } from '../finance-vault-store.js';
import { createIntegratedSession, validateIntegratedConfiguration } from './finance-vault-integrated-session.js';

const config = globalThis.integratedConfiguration;
validateIntegratedConfiguration(config);
if (location.hostname !== '127.0.0.1') throw new Error('Synthetic loopback UI required');
let app, auth, firestore, fault = null, gate = null;
const runtime = {
    createApp() { return app = initializeApp({ projectId: config.projectId, apiKey: 'demo-only', appId: 'synthetic-integrated-ui' }, `synthetic-integrated-${crypto.randomUUID()}`); },
    createAuth(value) { auth = initializeAuth(value, { persistence: inMemoryPersistence }); connectAuthEmulator(auth, config.authEmulator, { disableWarnings: true }); return auth; },
    createFirestore(value) { firestore = initializeFirestore(value, { localCache: memoryLocalCache() }); connectFirestoreEmulator(firestore, '127.0.0.1', 8080); return firestore; },
    checkAuthPersistence() {}, getRedirectResult: async () => null
};
const client = criarFirebaseSync({ projectId: config.projectId }, runtime), originalCommit = client.commit;
client.commit = async (...args) => {
    const result = await originalCommit(...args);
    if (gate) { const captured = gate; gate = null; captured.applied = true; await new Promise(resolve => { captured.release = resolve; }); }
    return result;
};
const $ = id => document.getElementById(id);
const open = databaseName => openVaultStore({ databaseName, testHooks: {
    beforePut() { if (fault === 'quota') { fault = null; throw Object.assign(new Error('Synthetic quota'), { name: 'QuotaExceededError' }); } },
    afterRead() { if (fault === 'read') { fault = null; throw new Error('Synthetic read failure'); } }
} });
const session = createIntegratedSession({ config, client, auth: {
    async login(uid) { return (await signInWithCustomToken(auth, JSON.stringify({ uid }))).user; }, logout: () => client.logout()
}, makeStore: open, onView(view) {
    $('phase').textContent = view.phase; $('owner').textContent = view.uid || ''; $('pending').textContent = view.pending === null ? '?' : String(view.pending);
    $('conflicts').textContent = String(view.conflicts); $('error').textContent = view.error ? `${view.error}:${view.lastError || ''}` : '';
    $('finance').replaceChildren();
    if (view.data) for (const [month, values] of Object.entries(view.data.meses)) for (const type of ['receitas', 'despesas']) for (const row of values[type]) {
        const li = document.createElement('li'); li.textContent = `${row.nome} | ${row.valor}`; li.dataset.record = row.id; li.dataset.type = type; li.dataset.month = month; $('finance').append(li);
    }
    const unlocked = ['syncing', 'synced', 'offline', 'pending', 'recovery-history'].includes(view.phase);
    for (const id of ['add-income', 'add-expense', 'edit-record', 'delete-record', 'sync', 'restore-fixture']) $(id).disabled = !unlocked;
    $('create').disabled = view.phase !== 'missing'; $('confirm-custody').disabled = view.phase !== 'custody';
    $('unlock').disabled = !['locked', 'error', 'recovery-required'].includes(view.phase); $('recover').disabled = $('unlock').disabled;
    if (!unlocked) { $('record-name').value = ''; $('record-value').value = ''; }
    if (view.phase !== 'custody') $('new-secret').textContent = '';
    if (['signed-out', 'locked', 'checking', 'closed', 'authenticating', 'signing-out', 'error', 'recovery-required'].includes(view.phase)) { $('password').value = ''; $('recovery-secret').value = ''; }
} });
async function action(fn) { const epoch = session.view.epoch; $('action-error').textContent = ''; try { return await fn(); } catch (e) { if (session.view.epoch === epoch) $('action-error').textContent = e.code || 'operation-failed'; } finally { if (session.view.epoch === epoch) { $('password').value = ''; $('recovery-secret').value = ''; } } }
for (const uid of config.accounts) { const option = document.createElement('option'); option.value = uid; option.textContent = uid; $('account').append(option); }
$('login').onclick = () => action(() => session.login($('account').value));
$('logout').onclick = () => action(() => session.logout()); $('lock').onclick = () => action(() => session.lock());
$('create').onclick = () => action(async () => { const epoch = session.view.epoch, result = await session.create($('password').value); if (session.view.epoch === epoch && session.view.phase === 'custody') $('new-secret').textContent = result.recoverySecret; });
$('confirm-custody').onclick = () => action(() => session.confirmCustody($('recovery-secret').value, $('custody').checked));
$('unlock').onclick = () => action(() => session.unlock($('password').value)); $('recover').onclick = () => action(() => session.recover($('recovery-secret').value));
function add(type) {
    const nome = $('record-name').value, valor = Number($('record-value').value);
    return action(() => session.edit(state => { state.meses['2026-11'][type].push({ id: `synthetic-${crypto.randomUUID()}`, nome, valor, ...(type === 'receitas' ? { recebido: false } : { categoria: 'Casa', pago: false, fixa: false, serie: null, parcela: null }) }); }));
}
$('add-income').onclick = () => add('receitas'); $('add-expense').onclick = () => add('despesas');
$('edit-record').onclick = () => { const value = Number($('record-value').value); return action(() => session.edit(s => { s.meses['2026-11'].receitas[0].valor = value; })); };
$('delete-record').onclick = () => action(() => session.edit(s => { s.meses['2026-11'].despesas = []; }));
$('sync').onclick = () => action(() => session.synchronize());
$('restore-fixture').onclick = () => action(async () => { const snapshot = await session.snapshot(), state = structuredClone(snapshot.documents[`estado:${session.view.uid}`].dados); state.meses['2026-11'].receitas[0].valor = 87.65; await session.restoreFixture(state); });
let held;
globalThis.integratedQA = Object.freeze({
    view: () => session.view, snapshot: () => session.snapshot(), checkpoint: () => session.checkpoint(), edit: mutate => session.edit(mutate),
    holdAck() { if (gate || held) throw new Error('Synthetic gate already active'); held = {}; gate = held; },
    ackApplied: () => held?.applied === true, releaseAck() { held?.release?.(); held = null; },
    fault(value) { if (!['quota', 'read', null].includes(value)) throw new Error('Synthetic fault only'); fault = value; },
    async foreignRead(uid, entity) { try { await getDocFromServer(doc(firestore, 'users', uid, 'records', entity)); return 'allowed'; } catch (e) { return e.code; } },
    async inspect() {
        const names = (await indexedDB.databases()).map(d => d.name), banks = [];
        for (const name of names) {
            if (!name.startsWith(config.databaseName) && name !== 'firebase-heartbeat-database') throw new Error(`Unexpected database in isolated profile: ${name}`);
            const db = await new Promise((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
            try { banks.push(await new Promise((resolve, reject) => { const tx = db.transaction([...db.objectStoreNames], 'readonly'), raw = { databaseName: name };
                for (const store of [...db.objectStoreNames]) { const request = tx.objectStore(store).getAll(); request.onsuccess = () => { raw[store] = request.result; }; }
                tx.oncomplete = () => resolve(raw); tx.onabort = () => reject(tx.error);
            })); } finally { db.close(); }
        }
        const noKeys = value => { if (value instanceof CryptoKey) throw new Error('Plain CryptoKey persisted'); if (value && typeof value === 'object') Object.values(value).forEach(noKeys); };
        noKeys(banks);
        return { names, banks, local: localStorage.length, session: sessionStorage.length, caches: (await caches.keys()).length };
    },
    async close() { await session.shutdown(); await terminate(firestore); await deleteApp(app); }
});
await session.start();
window.addEventListener('pagehide', () => { void session.shutdown().catch(() => {}); }, { once: true });
