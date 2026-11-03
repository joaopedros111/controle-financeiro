// Node-only experimental SDK adapter. Refuses to initialize without local emulators.
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, connectAuthEmulator, signInWithCustomToken, signOut } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache, connectFirestoreEmulator, doc, runTransaction, serverTimestamp, terminate } from 'firebase/firestore';
import { recordEntityKey, validConflictRecord } from '../sync-core.js';

export async function createVaultEmulatorTransport(uid) {
    const projectId = 'demo-vault-integration';
    if (globalThis.process?.env.LOCAL_VAULT_EMULATORS !== '1' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080'
        || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || !/^synthetic-[A-Za-z0-9_-]+$/.test(uid || '')) throw new Error('Explicit synthetic loopback emulators required');
    const app = initializeApp({ projectId, apiKey: 'demo-only', appId: 'synthetic-vault-integration' }, `synthetic-vault-${globalThis.crypto.randomUUID()}`);
    const auth = initializeAuth(app, { persistence: inMemoryPersistence });
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const db = initializeFirestore(app, { localCache: memoryLocalCache() }); connectFirestoreEmulator(db, '127.0.0.1', 8080);
    // The Auth Emulator explicitly accepts this synthetic JSON token. Production does not.
    const login = async () => signInWithCustomToken(auth, JSON.stringify({ uid }));
    await login();
    return { auth, db, login, logout: () => signOut(auth),
        async commit(owner, op) {
            const captured = auth.currentUser;
            const current = () => { if (!captured || auth.currentUser !== captured || captured.uid !== owner.uid || owner.projectId !== projectId) throw Object.assign(new Error('Synthetic auth session changed'), { code: 'session-changed' }); };
            current();
            if (!op || typeof op.id !== 'string' || op.id.length > 128 || !validConflictRecord(op.value) || recordEntityKey(op.value) !== op.entityKey) throw new Error('Invalid synthetic operation');
            const receipt = doc(db, 'users', owner.uid, 'operations', op.id), target = doc(db, 'users', owner.uid, 'records', op.entityKey);
            const result = await runTransaction(db, async tx => {
                current(); const [prior, snapshot] = await Promise.all([tx.get(receipt), tx.get(target)]); current();
                const remote = snapshot.exists() ? snapshot.data() : null;
                if (prior.exists()) {
                    if (!['applied', 'conflict'].includes(prior.data().status)) throw new Error('Invalid synthetic ACK');
                    return { acknowledged: true, duplicate: true, conflict: prior.data().status === 'conflict', revision: remote?.revision || op.id, remote };
                }
                if ((remote?.revision || null) !== (op.baseRevision || null)) {
                    tx.set(doc(db, 'users', owner.uid, 'conflicts', op.id), { operationId: op.id, entityKey: op.entityKey, local: op.value, remote, createdAt: serverTimestamp() });
                    tx.set(receipt, { status: 'conflict', createdAt: serverTimestamp() });
                    return { acknowledged: true, conflict: true, remote };
                }
                tx.set(target, { ...op.value, revision: op.id, updatedAt: serverTimestamp() });
                tx.set(receipt, { status: 'applied', createdAt: serverTimestamp() });
                return { acknowledged: true, revision: op.id };
            }); current(); return result;
        },
        async close() { await signOut(auth); await terminate(db); await deleteApp(app); }
    };
}
