// Synthetic fixture, bundled only by the local Emulator runner.
import { initializeApp } from 'firebase/app';
import { initializeAuth, browserLocalPersistence, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache, connectFirestoreEmulator } from 'firebase/firestore';
import { openEpochCache } from '../../finance-epoch-cache.js';
import { makeCommand } from '../../finance-epoch.js';
import { EpochQueueSync } from '../../finance-epoch-queue.js';
import { createEpochEmulatorTransport } from '../../finance-epoch-transport-emulator.js';
import { EpochRealtimeSync } from '../../finance-epoch-realtime.js';
import { signOut } from 'firebase/auth';
export { openEpochCache, makeCommand, EpochQueueSync, EpochRealtimeSync, signOut };
export async function setup(email, uid, epoch = 'e1', projectId = 'demo-controle-financeiro', { appName = crypto.randomUUID(), restoreOnly = false } = {}) {
    if (!['localhost', '127.0.0.1'].includes(location.hostname) || !projectId.startsWith('demo-')) throw new Error('Local fixture only');
    const app = initializeApp({ projectId, apiKey: 'demo-only', appId: 'demo-only' }, appName);
    const auth = initializeAuth(app, { persistence: browserLocalPersistence });
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    await auth.authStateReady();
    if (!restoreOnly) await signInWithEmailAndPassword(auth, email, 'synthetic-password-only');
    if (auth.currentUser.uid !== uid) throw new Error('Synthetic UID mismatch');
    const db = initializeFirestore(app, { localCache: memoryLocalCache() });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    const scope = { projectId, uid, epoch };
    const cache = await openEpochCache(scope);
    const transport = createEpochEmulatorTransport(db, scope, { auth });
    const worker = new EpochQueueSync();
    worker.activate(cache, transport);
    window.qa = { app, auth, db, scope, cache, transport, worker };
}
export function command(extra = {}) {
    return makeCommand({ ...window.qa.scope, entityId: 'record1', payload: {
        month: '2026-10', type: 'despesas', nome: 'Synthetic', amountCents: 100
    }, ...extra });
}
