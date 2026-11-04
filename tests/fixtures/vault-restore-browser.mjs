import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, connectAuthEmulator, signInWithCustomToken } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache, connectFirestoreEmulator, terminate } from 'firebase/firestore';
import { criarFirebaseSync } from '../../firebase-sync-entry.js';
import { openVaultStore } from '../../finance-vault-store.js';
import { validateIntegratedConfiguration } from '../../experimental/finance-vault-integrated-session.js';
import { createRestoreProbe } from './vault-restore-probe.mjs';
const config = globalThis.restoreConfiguration; validateIntegratedConfiguration(config);
if (location.hostname !== '127.0.0.1') throw new Error('Synthetic loopback only');
let app, auth, db, captured;
const client = criarFirebaseSync({ projectId: config.projectId }, {
    createApp() { return app = initializeApp({ projectId: config.projectId, apiKey: 'demo-only', appId: 'synthetic-restore-probe' }, `synthetic-${crypto.randomUUID()}`); },
    createAuth(a) { auth = initializeAuth(a, { persistence: inMemoryPersistence }); connectAuthEmulator(auth, config.authEmulator, { disableWarnings: true }); return auth; },
    createFirestore(a) { db = initializeFirestore(a, { localCache: memoryLocalCache() }); connectFirestoreEmulator(db, '127.0.0.1', 8080); return db; },
    checkAuthPersistence() {}, getRedirectResult: async () => null
});
const connectivity = { navigator: { onLine: false }, addEventListener() {}, removeEventListener() {} };
const probe = await createRestoreProbe({ config, client, connectivity, locks: navigator.locks,
    auth: { login: async uid => (await signInWithCustomToken(auth, JSON.stringify({ uid }))).user, logout: () => client.logout() },
    makeStore: name => openVaultStore({ databaseName: name })
});
globalThis.restoreQA = {
    prepare: () => probe.prepare(),
    async reproduce(point) { captured = await (point === 'committed-before-delivery' ? probe.reproduceAtCommit() : probe.reproduce()); return { rejected: captured.rejected, delivery: captured.delivery, events: captured.events }; },
    async publish() { connectivity.navigator.onLine = true; return probe.reopenAndPublish(captured); },
    async close() { await probe.close(); await terminate(db); await deleteApp(app); }
};
