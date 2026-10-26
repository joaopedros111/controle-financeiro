import { doc, collection, getDocFromServer, getDocsFromServer, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { assertEmulator, commitEpochOperation } from './finance-epoch-emulator.js';
import { epochPath, ENTITY_COLLECTIONS } from './finance-epoch.js';
import { validateScope } from './finance-epoch-cache.js';

export function createEpochEmulatorTransport(db, inputScope, { auth } = {}) {
    assertEmulator(db);
    const scope = Object.freeze(validateScope(inputScope));
    const sdk = db._delegate || db;
    if (sdk.app.options.projectId !== scope.projectId) throw new Error('Project mismatch');
    if (auth && auth.app.options.projectId !== scope.projectId) throw new Error('Auth project mismatch');
    const assertIdentity = () => {
        if (auth && auth.currentUser?.uid !== scope.uid) throw Object.assign(new Error('Authenticated UID changed'), { code: 'epoch/auth-changed' });
    };
    const validControl = data => data?.protocol === 1 && data.activeEpoch === scope.epoch && data.status === 'active';
    const normalized = (kind, snapshot) => snapshot.docs.map(entry => {
        const value = entry.data();
        return { collection: kind, entityId: entry.id, value: {
            payload: value.payload, deleted: value.deleted, revision: value.revision, operationId: value.operationId
        } };
    });
    const controlRef = doc(db, `users/${scope.uid}/control/finance`);
    const checkControl = async () => {
        assertIdentity();
        const snapshot = await getDocFromServer(controlRef), data = snapshot.data();
        assertIdentity();
        if (!snapshot.exists() || !validControl(data)) {
            throw Object.assign(new Error('Inactive generation'), { code: 'epoch/inactive' });
        }
    };
    return {
        scope, assertIdentity, verifyScope: checkControl,
        async readSnapshot() {
            await checkControl();
            const groups = await Promise.all(ENTITY_COLLECTIONS.map(async kind => {
                const snapshot = await getDocsFromServer(collection(db, `${epochPath(scope.uid, scope.epoch)}/${kind}`));
                if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) throw new Error('Server snapshot required');
                return normalized(kind, snapshot);
            }));
            await checkControl();
            return { scope, confirmed: true, complete: true, entities: groups.flat() };
        },
        async commit(command) {
            assertIdentity();
            if (command.uid !== scope.uid || command.epoch !== scope.epoch) throw new Error('Command scope mismatch');
            return commitEpochOperation(db, command);
        },
        listen(receive, failure) {
            if (!auth) throw new Error('Realtime transport requires bound Firebase Auth');
            assertIdentity();
            let closed = false, controlConfirmed = false, watching = false;
            const stops = [], groups = new Map(), confirmed = new Set();
            const stop = () => { closed = true; for (const unsubscribe of stops.splice(0)) unsubscribe(); };
            const fail = error => { if (!closed) { stop(); failure(error); } };
            const check = () => { if (closed) return false; try { assertIdentity(); return true; } catch (error) { fail(error); return false; } };
            const publish = () => {
                if (!check() || !controlConfirmed || confirmed.size !== ENTITY_COLLECTIONS.length) return;
                receive({ type: 'snapshot', snapshot: { scope, confirmed: true, complete: true, entities: [...groups.values()].flat() } });
            };
            const unconfirmed = metadata => receive({ type: 'waiting', reason: metadata.hasPendingWrites ? 'pending' : 'cache' });
            const listenerError = async error => {
                if (!check()) return;
                if (error.code === 'permission-denied') {
                    try { await checkControl(); } catch (cause) { if (!closed) fail(cause); return; }
                }
                fail(error);
            };
            stops.push(onAuthStateChanged(auth, () => { check(); }));
            stops.push(onSnapshot(controlRef, { includeMetadataChanges: true }, snapshot => {
                if (!check()) return;
                if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
                    controlConfirmed = false; confirmed.clear(); unconfirmed(snapshot.metadata); return;
                }
                if (!snapshot.exists() || !validControl(snapshot.data())) {
                    fail(Object.assign(new Error('Inactive generation'), { code: 'epoch/inactive' })); return;
                }
                controlConfirmed = true;
                if (!watching) {
                    watching = true;
                    for (const kind of ENTITY_COLLECTIONS) stops.push(onSnapshot(
                        collection(db, `${epochPath(scope.uid, scope.epoch)}/${kind}`), { includeMetadataChanges: true }, entries => {
                            if (!check()) return;
                            if (entries.metadata.fromCache || entries.metadata.hasPendingWrites) {
                                confirmed.delete(kind); unconfirmed(entries.metadata); return;
                            }
                            groups.set(kind, normalized(kind, entries)); confirmed.add(kind); publish();
                        }, listenerError));
                }
                publish();
            }, listenerError));
            return stop;
        }
    };
}
