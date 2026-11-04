import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, connectAuthEmulator, signInWithCustomToken } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache, connectFirestoreEmulator, terminate, doc, getDocFromServer } from 'firebase/firestore';
import { criarFirebaseSync } from '../../firebase-sync-entry.js';
import { openVaultStore } from '../../finance-vault-store.js';
import { createVaultComposition } from '../../experimental/finance-vault-composition.js';
import { validateIntegratedConfiguration } from '../../experimental/finance-vault-integrated-session.js';
import { registrosFinanceiros, recordEntityKey, recordsEquivalent } from '../../sync-core.js';
const config = globalThis.compositionConfiguration; validateIntegratedConfiguration(config);
if (location.hostname !== '127.0.0.1') throw new Error('Synthetic loopback required');
let app, auth, db, writeGate = null, ackGate = null, heldAck = null, fault = null, persisted = false, resuming = Promise.resolve();
const trace = []; const note = event => { trace.push(event); if (trace.length > 80) trace.shift(); };
const $ = id => document.getElementById(id);
const client = criarFirebaseSync({ projectId: config.projectId }, {
    createApp() { return app = initializeApp({ projectId: config.projectId, apiKey: 'demo-only', appId: 'synthetic-composition-ui' }, `synthetic-${crypto.randomUUID()}`); },
    createAuth(a) { auth = initializeAuth(a, { persistence: inMemoryPersistence }); connectAuthEmulator(auth, config.authEmulator, { disableWarnings: true }); return auth; },
    createFirestore(a) { db = initializeFirestore(a, { localCache: memoryLocalCache() }); connectFirestoreEmulator(db, '127.0.0.1', 8080); return db; },
    checkAuthPersistence() {}, getRedirectResult: async () => null
});
const original = client.commit;
client.commit = async (...args) => { const result = await original(...args); if (ackGate) { const gate = ackGate; ackGate = null; gate.applied = true; await gate.promise; } return result; };
// CP-05 QA gate retains an actual server snapshot after SDK delivery, never
// substitutes records or ACKs. Only the isolated test runner can arm it.
let snapshotGate, heldSnapshot;
const originalSnapshot = client.generationSnapshot;
client.generationSnapshot = async (...args) => {
    const result = await originalSnapshot(...args);
    if (snapshotGate && --snapshotGate.remaining === 0) {
        const held = snapshotGate; snapshotGate = null; held.entered = true; await held.promise;
    }
    return result;
};
let view;
const c = createVaultComposition({ config, client, auth: { login: async uid => (await signInWithCustomToken(auth, JSON.stringify({ uid }))).user, logout: () => client.logout() },
    makeStore: async name => {
        const store = await openVaultStore({ databaseName: name, testHooks: { beforePut() { if (fault === 'quota') { fault = null; throw Object.assign(new Error('Synthetic quota'), { name: 'QuotaExceededError' }); } } } });
        return { ...store, async compareAndSwap(...args) {
            // Automatic sync also commits queue metadata. A drain test must hold
            // a write only after the lifecycle has accepted a local command.
            const gate = c.lifecycleState().inFlight > 0 ? writeGate : null;
            if (gate) { writeGate = null; gate.entered = true; note({ event: 'write-held', localInFlight: c.lifecycleState().inFlight }); await gate.promise; note({ event: 'write-released' }); }
            const result = await store.compareAndSwap(...args); note({ event: 'write-complete' }); return result;
        } };
    },
    onView(next) {
        view = next; note({ phase: next.phase, sync: next.sync, epoch: next.epoch }); $('phase').textContent = next.phase; $('owner').textContent = next.uid || ''; $('sync-state').textContent = next.sync;
        $('pending').textContent = next.pending === null ? '?' : String(next.pending); $('error').textContent = next.error || '';
        $('finance').replaceChildren(); if (next.data) for (const month of Object.values(next.data.meses)) for (const row of [...month.receitas, ...month.despesas]) {
            const item = document.createElement('li'); item.textContent = `${row.nome} | ${row.valor}`; item.dataset.record = row.id; $('finance').append(item);
        }
        const active = ['unlocked', 'pending'].includes(next.phase);
        for (const id of ['add-income', 'sync']) $(id).disabled = !active;
        $('create').disabled = next.phase !== 'missing'; $('confirm').disabled = next.phase !== 'custody';
        $('unlock').disabled = !['locked', 'error', 'recovery-required'].includes(next.phase); $('recover').disabled = $('unlock').disabled;
        if (!active) { $('record-name').value = ''; $('record-value').value = ''; }
        if (next.phase !== 'custody') $('new-secret').textContent = '';
        if (['signed-out', 'closing', 'locked', 'error', 'recovery-required', 'suspended'].includes(next.phase)) { $('password').value = ''; $('recovery-secret').value = ''; }
    }
});
async function action(fn) { const epoch = c.view().epoch; $('action-error').textContent = ''; try { return await fn(); }
    catch (e) { if (c.view().epoch === epoch) $('action-error').textContent = e.code || 'operation-failed'; }
    finally { if (c.view().epoch === epoch) { $('password').value = ''; $('recovery-secret').value = ''; } }
}
for (const uid of config.accounts) { const o = document.createElement('option'); o.value = uid; o.textContent = uid; $('account').append(o); }
$('login').onclick = () => action(() => c.login($('account').value)); $('logout').onclick = () => action(() => c.logout());
$('offline-open').onclick = () => action(() => c.offline($('account').value)); $('lock').onclick = () => action(() => c.lock());
$('create').onclick = () => action(async () => { const token = c.view().epoch, secret = await c.create($('password').value); if (token === c.view().epoch && c.view().phase === 'custody') $('new-secret').textContent = secret; });
$('confirm').onclick = () => action(() => c.confirm($('recovery-secret').value, $('custody').checked, $('password').value));
$('unlock').onclick = () => action(() => c.unlock($('password').value)); $('recover').onclick = () => action(() => c.recover($('recovery-secret').value));
$('add-income').onclick = () => { const nome = $('record-name').value, valor = Number($('record-value').value), id = `synthetic-${crypto.randomUUID()}`;
    return action(() => c.edit(s => { if (!nome.startsWith('SYNTHETIC ')) throw new Error('Synthetic input required'); s.meses['2026-11'].receitas.push({ id, nome, valor, recebido: false }); })); };
$('sync').onclick = () => action(() => c.synchronize());
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release, entered: false }; };
let heldWrite;
const watch = setInterval(() => { if (['unlocked', 'pending'].includes(view?.phase)) void c.refresh(); }, 250);
globalThis.compositionQA = Object.freeze({
    view: () => c.view(), snapshot: () => c.snapshot(), lifecycle: () => c.lifecycleState(),
    trace: () => trace, diagnostics: () => c.diagnostics(),
    async evidence() {
        const snapshot = await c.snapshot(), uid = c.lifecycleState().owner.uid, state = snapshot.documents[`estado:${uid}`], queue = snapshot.documents[`fila:${uid}`];
        const remote = await client.generationSnapshot(uid), local = registrosFinanceiros(state.dados), live = remote.records.filter(r => !r.deleted);
        return { localRevision: state.revisao, localCount: local.length, remoteCount: live.length, outbox: queue.outbox.length,
            equivalent: local.length === live.length && local.every(l => live.some(r => recordEntityKey(l) === recordEntityKey(r) && recordsEquivalent(l.record, r.record))) };
    },
    holdWrite() { heldWrite = writeGate = gate(); }, writeEntered: () => heldWrite?.entered === true, releaseWrite() { heldWrite?.release(); heldWrite = null; },
    holdAck() { heldAck = ackGate = gate(); }, ackApplied: () => heldAck?.applied === true, releaseAck() { heldAck?.release(); heldAck = null; },
    holdSnapshot() { heldSnapshot = snapshotGate = { ...gate(), remaining: 2 }; },
    snapshotEntered: () => heldSnapshot?.entered === true,
    releaseSnapshot() { heldSnapshot?.release(); heldSnapshot = snapshotGate = null; },
    quota() { fault = 'quota'; }, persisted: () => persisted, resumed: () => resuming,
    async foreignRead(uid) { try { await getDocFromServer(doc(db, 'users', uid, 'records', 'synthetic-denied')); return 'allowed'; } catch (e) { return e.code; } },
    async inspect() {
        const names = (await indexedDB.databases()).map(d => d.name), banks = [];
        for (const name of names) {
            if (!name.startsWith(config.databaseName) && name !== 'firebase-heartbeat-database') throw new Error('Unexpected DB');
            const database = await new Promise((yes, no) => { const r = indexedDB.open(name); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error); });
            try { banks.push(await new Promise((yes, no) => { const tx = database.transaction([...database.objectStoreNames]), result = { name };
                for (const key of database.objectStoreNames) { const r = tx.objectStore(key).getAll(); r.onsuccess = () => { result[key] = r.result; }; }
                tx.oncomplete = () => yes(result); tx.onabort = () => no(tx.error);
            })); } finally { database.close(); }
        }
        function noKeys(v) { if (v instanceof CryptoKey) throw new Error('Persisted CryptoKey'); if (v && typeof v === 'object') Object.values(v).forEach(noKeys); } noKeys(banks);
        return { names, banks, local: localStorage.length, session: sessionStorage.length, caches: (await caches.keys()).length };
    },
    async close() { clearInterval(watch); await c.shutdown(); await terminate(db); await deleteApp(app); }
});
await c.start();
addEventListener('pagehide', () => { resuming = c.suspend(); resuming.catch(() => {}); });
addEventListener('pageshow', e => { if (e.persisted) { persisted = true; resuming = c.resume(); resuming.catch(() => {}); } });
