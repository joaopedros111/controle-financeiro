// Official dependency injection; no source transformation or SDK transaction mocks.
export async function loadRealEmulatorFactory() {
    if (process.env.LOCAL_VAULT_EMULATORS !== '1' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Explicit loopback emulators required');
    const [appSDK, authSDK, firestoreSDK, factory] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore'), import('../../firebase-sync-entry.js')]);
    const resources = {};
    const runtime = {
        createApp(config) { if (config.projectId !== 'demo-vault-integration') throw new Error('Synthetic project required'); return resources.app = appSDK.initializeApp(config, 'synthetic-real-' + crypto.randomUUID()); },
        createAuth(app) { const auth = authSDK.initializeAuth(app, { persistence: authSDK.inMemoryPersistence }); authSDK.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); return resources.auth = auth; },
        createFirestore(app) { const db = firestoreSDK.initializeFirestore(app, { localCache: firestoreSDK.memoryLocalCache() }); firestoreSDK.connectFirestoreEmulator(db, '127.0.0.1', 8080); return resources.db = db; },
        checkAuthPersistence() {}, // No browser storage in this Node-only runtime.
        getRedirectResult: async () => null // Emulator token login, not Google OAuth.
    };
    return {
        criarFirebaseSync: config => factory.criarFirebaseSync(config, runtime), resources,
        async login(uid) { if (!/^synthetic-[A-Za-z0-9_-]+$/.test(uid)) throw new Error('Synthetic UID required'); await authSDK.signInWithCustomToken(resources.auth, JSON.stringify({ uid })); },
        async close() { await authSDK.signOut(resources.auth); await firestoreSDK.terminate(resources.db); await appSDK.deleteApp(resources.app); }
    };
}
