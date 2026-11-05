// Synthetic integration only. No imports from the app, Firebase or legacy storage.
import { createVaultController } from '../finance-vault-controller.js';
import { createFinancialCodec } from '../finance-vault-codec.js';
import { ServicoFinanceiroAtomico } from '../financial-atomic-service.js';
import { validarBackup } from '../finance-core.js';

const fail = (code = 'persistence/cancelled') => { throw Object.assign(new Error('Experimental vault operation rejected.'), { code }); };
export function createExperimentalAccount({ store, owner, vaultId = 'synthetic-integration', crypto = globalThis.crypto, channelFactory, codec = createFinancialCodec(), locks = globalThis.navigator?.locks, snapshotPolicy }) {
    if (!owner?.projectId?.startsWith('demo-') || !/^synthetic-[A-Za-z0-9_-]+$/.test(owner.uid || '') || !vaultId.startsWith('synthetic-')) fail('synthetic-only');
    owner = Object.freeze({ projectId: owner.projectId, uid: owner.uid });
    if (snapshotPolicy && !['validate', 'prepareUpdates'].every(k => typeof snapshotPolicy[k] === 'function')) fail('invalid-input');
    const vault = createVaultController({ store, owner, vaultId, crypto, codec, ...(channelFactory === undefined ? {} : { channelFactory }) });
    const uid = owner.uid, copy = value => { const bytes = codec.encode(value); try { return codec.decode(bytes); } finally { bytes.fill(0); } };
    let pending = {}, active = null;
    const revoke = () => { if (active) active.live = false; active = null; pending = {}; return pending; };
    const owned = id => typeof id === 'string' && (id === `estado:${uid}` || id === `fila:${uid}`
        || [`restore-recovery:${uid}:`, `snapshot:${uid}:`, `conflicts:${uid}:`].some(prefix => id.startsWith(prefix) && id.length > prefix.length));
    const validateQueue = q => !!q && Array.isArray(q.outbox) && Array.isArray(q.conflicts) && typeof q.generation === 'string';
    function bind() {
        const lease = { live: true }; active = lease;
        const check = () => { if (active !== lease || !lease.live) fail(); };
        async function mutateDocuments(keys, mutate) {
                check();
                if (!Array.isArray(keys) || !keys.length || keys.length > 1000 || new Set(keys).size !== keys.length || keys.some(id => !owned(id)) || typeof mutate !== 'function') fail('invalid-input');
                // Bounded CAS retry: callback must be synchronous and side-effect free.
                // Reapply the original financial intent, never a stale whole-state replacement.
                for (let attempt = 0; attempt < 3; attempt++) {
                    check(); const snapshot = await vault.read(); check(); snapshotPolicy?.validate(snapshot);
                    const records = new Map(keys.map(id => [id, Object.hasOwn(snapshot.documents, id) ? copy(snapshot.documents[id]) : null]));
                    const changed = mutate(records) ?? records;
                    if (!(changed instanceof Map) || changed.size !== keys.length || keys.some(id => !changed.has(id)) || [...changed].some(([id, value]) => !keys.includes(id) || value === null || value === undefined)) fail('invalid-input');
                    check();
                    let updates = Object.fromEntries([...changed].map(([id, value]) => [id, copy(value)]));
                    if (snapshotPolicy) {
                        updates = snapshotPolicy.prepareUpdates(snapshot, updates);
                        if (!updates || typeof updates.then === 'function' || Object.keys(updates).some(id => !owned(id))) fail('invalid-input');
                    }
                    try {
                        const token = await vault.prepare({ expectedRevision: snapshot.catalog.revision, generation: snapshot.generation, updates }); check();
                        await vault.commit(token); check(); return new Map(Object.entries(updates).map(([id, value]) => [id, copy(value)]));
                    } catch (error) { check(); if (error.code !== 'stale-revision' || attempt === 2) throw error; }
                }
        }
        const db = Object.freeze({
            async ler(id) {
                check(); if (!owned(id)) fail('context-mismatch');
                const snapshot = await vault.read(); check(); snapshotPolicy?.validate(snapshot);
                return Object.hasOwn(snapshot.documents, id) ? copy(snapshot.documents[id]) : null;
            },
            alterarDocumentos(keys, mutate) {
                check();
                if (!Array.isArray(keys)) fail('invalid-input'); const ids = [...keys];
                // Serialize cooperating browser tabs before reading the CAS baseline.
                // Durable revision/epoch checks still fence non-cooperating writers.
                return locks ? locks.request(`cf-vault-experimental:${owner.projectId}:${uid}:${vaultId}`, () => mutateDocuments(ids, mutate)) : mutateDocuments(ids, mutate);
            },
            async alterar(id, mutate) { return (await db.alterarDocumentos([id], docs => { docs.set(id, mutate(docs.get(id))); return docs; })).get(id); }
        });
        const service = new ServicoFinanceiroAtomico(db, validarBackup, validateQueue, null);
        return Object.freeze({ db, service,
            isCurrent: () => active === lease && lease.live,
            async synchronize(transport) {
                check();
                const result = await service.enviarFila(uid, async (requestedUid, operation) => {
                    check(); if (requestedUid !== uid) fail('context-mismatch');
                    const ack = await transport.commit(owner, operation); check(); return ack;
                }, () => active === lease && lease.live);
                check(); return result;
            }
        });
    }
    async function authorize(operation) {
        const captured = revoke(); await operation();
        if (pending !== captured) fail(); return bind();
    }
    return Object.freeze({
        // Diagnostic facade cannot bypass the account authorization lifecycle.
        vault: Object.freeze({ read: () => vault.read(), status: () => vault.status(), exportRecoveryPackage: () => vault.exportRecoveryPackage(),
            prepare: args => vault.prepare(args), commit: token => vault.commit(token) }),
        async create(args) { let result; const session = await authorize(async () => { result = await vault.create(args); }); return { ...result, session }; },
        unlockWithPassword: password => authorize(() => vault.unlockWithPassword(password)),
        unlockWithRecovery: secret => authorize(() => vault.unlockWithRecovery(secret)),
        changePassword: (oldPassword, newPassword) => authorize(() => vault.changePassword(oldPassword, newPassword)),
        async restore(bytes, args) { let result; const session = await authorize(async () => { result = await vault.importRecoveryPackage(bytes, args); }); return { ...result, session }; },
        async lock() { revoke(); await vault.lock(); },
        close() { revoke(); vault.close(); }
    });
}
