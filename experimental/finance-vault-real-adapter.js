// Isolated synthetic composition; never imported by the application bootstrap.
import { createVaultController } from '../finance-vault-controller.js';
import { ServicoFinanceiroAtomico } from '../financial-atomic-service.js';
import { AutomaticFinanceSync } from '../automatic-finance-sync.js';
import { validarBackup } from '../finance-core.js';

const fail = code => { throw Object.assign(new Error('Synthetic adapter access rejected.'), { code }); };
export function createRealVaultAdapter({ store, owner, crypto = globalThis.crypto, locks = globalThis.navigator?.locks }) {
    if (!owner?.projectId?.startsWith('demo-') || !/^synthetic-[A-Za-z0-9_-]+$/.test(owner.uid || '')) fail('synthetic-only');
    owner = Object.freeze({ ...owner });
    let commitFence = null, localWrites = Promise.resolve();
    const guardedStore = { ...store, compareAndSwap(scope, expected, next, isCurrent, coordination) {
        const fence = commitFence;
        return store.compareAndSwap(scope, expected, next, () => isCurrent()
            && (!fence || current === fence.lease && fence.lease.sync?.session === fence.syncSession), coordination);
    } };
    const vault = createVaultController({ store: guardedStore, owner, crypto, vaultId: 'synthetic-real-adapter', channelFactory: () => null });
    const uid = owner.uid, stateKey = `estado:${uid}`, queueKey = `fila:${uid}`;
    let current = null;
    const revoke = () => { if (current) { current.sync?.stop(); current = null; } };
    const owned = key => key === stateKey || key === queueKey || [`restore-recovery:${uid}:`, `snapshot:${uid}:`, `conflicts:${uid}:`].some(p => key.startsWith(p));
    function validate(documents, generation) {
        const s = documents[stateKey], q = documents[queueKey];
        if (!s || !Number.isSafeInteger(s.revisao) || s.revisao < 0 || !validarBackup(s.dados)
            || !q || !Array.isArray(q.outbox) || !Array.isArray(q.conflicts) || q.generation !== generation) fail('invalid-state');
    }
    async function authorize(unlock) {
        revoke(); const lease = {}; current = lease;
        const check = () => { if (current !== lease) fail('persistence/cancelled'); };
        try {
            await unlock(); check(); const first = await vault.read(); check(); validate(first.documents, first.generation);
            async function mutate(keys, callback, syncSession) {
                const transactionCurrent = () => { check(); if (lease.sync?.session !== syncSession) fail('persistence/cancelled'); };
                transactionCurrent(); if (!Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length || keys.some(k => typeof k !== 'string' || !owned(k))) fail('invalid-input');
                for (let attempt = 0; attempt < 3; attempt++) {
                    const before = await vault.read(); transactionCurrent(); validate(before.documents, before.generation);
                    const docs = new Map(keys.map(k => [k, structuredClone(before.documents[k] ?? null)]));
                    const changed = callback(docs);
                    if (!(changed instanceof Map) || changed.size !== keys.length || keys.some(k => !changed.has(k))) fail('invalid-input');
                    const updates = Object.fromEntries([...changed].map(([k, v]) => { if (!keys.includes(k) || v == null) fail('invalid-input'); return [k, structuredClone(v)]; }));
                    const generation = updates[queueKey]?.generation ?? before.generation;
                    validate({ ...before.documents, ...updates }, generation); transactionCurrent();
                    try {
                        const token = await vault.prepare({ expectedRevision: before.catalog.revision, generation, updates }); transactionCurrent();
                        commitFence = { lease, syncSession };
                        try { await vault.commit(token); } finally { commitFence = null; }
                        transactionCurrent(); return new Map(Object.entries(updates).map(([k, v]) => [k, structuredClone(v)]));
                    } catch (e) { transactionCurrent(); if (e.code !== 'stale-revision' || attempt === 2) throw e; }
                }
            }
            const db = Object.freeze({
                async ler(key) {
                    check(); const syncSession = lease.sync?.session;
                    if (typeof key !== 'string' || !owned(key)) fail('owner-mismatch');
                    const read = async () => { check(); const s = await vault.read(); check(); if (lease.sync?.session !== syncSession) fail('persistence/cancelled'); validate(s.documents, s.generation); return structuredClone(s.documents[key] ?? null); };
                    // A live automatic cycle must not read halfway through this
                    // adapter's own Web Crypto/commit. Coordinate cooperative tabs too.
                    const run = () => locks ? locks.request(`synthetic-real-vault:${owner.projectId}:${uid}`, read) : read();
                    const pending = localWrites.then(run); localWrites = pending.catch(() => {}); return pending;
                },
                alterarDocumentos(keys, fn) {
                    const ids = Array.isArray(keys) ? [...keys] : keys, syncSession = lease.sync?.session; check();
                    const run = () => locks ? locks.request(`synthetic-real-vault:${owner.projectId}:${uid}`, () => mutate(ids, fn, syncSession)) : mutate(ids, fn, syncSession);
                    const pending = localWrites.then(run); localWrites = pending.catch(() => {}); return pending;
                },
                async alterar(key, fn) { return (await db.alterarDocumentos([key], docs => { docs.set(key, fn(docs.get(key))); return docs; })).get(key); }
            });
            // useAccount validates a legacy candidate without generation even when
            // initialized documents already exist. Persisted vault data remains strict.
            const service = new ServicoFinanceiroAtomico(db, validarBackup, q => !!q && Array.isArray(q.outbox) && Array.isArray(q.conflicts) && (q.generation === undefined || typeof q.generation === 'string'), locks);
            return Object.freeze({ db, service, isCurrent: () => current === lease,
                attachSync(options) {
                    check(); if (lease.sync) fail('already-exists');
                    const client = new Proxy(options.client, { get(target, name) {
                        const method = Reflect.get(target, name);
                        if (typeof method !== 'function') return method;
                        return asyncOrListener(name, method, target);
                    } });
                    function asyncOrListener(name, method, target) {
                        // Listener unsubscribe functions must remain synchronous.
                        if (name === 'onUser') return callback => { check(); return method.call(target, user => { if (current === lease) callback(user?.uid === uid ? user : null); }); };
                        if (String(name).startsWith('listen')) return (...args) => { check(); return method.apply(target, args); };
                        return async (...args) => {
                            check(); if (name !== 'ready' && args[0] !== uid) fail('owner-mismatch');
                            const syncSession = lease.sync?.session, result = await method.apply(target, args); check();
                            if (name !== 'ready' && lease.sync?.session !== syncSession) fail('persistence/cancelled');
                            if (['commit', 'saveSettings', 'saveAutomaticHistory'].includes(name)
                                && !(name === 'saveSettings' && result?.conflict === true)
                                && result?.acknowledged !== true) fail('sync/invalid-ack');
                            return result;
                        };
                    }
                    // readLegacy cannot consult real storage. Cofre state/fila must already exist.
                    lease.sync = new AutomaticFinanceSync({ ...options, client, db, service, readLegacy: () => ({ estado: 'ausente' }), storageBlocked: () => current !== lease });
                    return lease.sync;
                }
            });
        } catch (e) { if (current === lease) current = null; throw e; }
    }
    return Object.freeze({
        status: () => vault.status(),
        async create(args) { let created; const session = await authorize(async () => { created = await vault.create(args); }); return { ...created, session }; },
        unlock: password => authorize(() => vault.unlockWithPassword(password)),
        unlockWithRecovery: secret => authorize(() => vault.unlockWithRecovery(secret)),
        async lock() { revoke(); await vault.lock(); },
        async read() { if (!current) fail('locked'); return vault.read(); },
        exportRecoveryPackage: () => vault.exportRecoveryPackage(),
        async restore(bytes, args) { let restored; const session = await authorize(async () => { restored = await vault.importRecoveryPackage(bytes, args); }); return { ...restored, session }; },
        close() { revoke(); vault.close(); }
    });
}
