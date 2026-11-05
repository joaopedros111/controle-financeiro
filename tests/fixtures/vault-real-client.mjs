// SDK I/O model only. Generation/restore business rules run in the REAL module.
import { withFinanceGenerations } from '../../finance-generation-transport.js';
import { syntheticWriteRemote } from './vault-write-remote.mjs';
export function realContractClient(owner) {
    const remote = syntheticWriteRemote(), data = new Map(); let chain = Promise.resolve(), failed = false;
    const stamp = { seconds: 100, nanoseconds: 0 }, snap = key => ({ exists: () => data.has(key), data: () => structuredClone(data.get(key)), metadata: { fromCache: false, hasPendingWrites: false } });
    const children = key => [...data].filter(([p]) => p.startsWith(key + '/') && !p.slice(key.length + 1).includes('/'));
    const sdk = {
        doc: (...p) => p.filter(x => typeof x === 'string').join('/'), collection: (...p) => p.filter(x => typeof x === 'string').join('/'),
        getDocFromServer: async k => snap(k), getDocsFromServer: async k => { const docs = children(k).map(([p]) => ({ id: p.split('/').at(-1), data: () => structuredClone(data.get(p)) })); return { docs, size: docs.length, metadata: { fromCache: false, hasPendingWrites: false } }; },
        onSnapshot: () => () => {}, serverTimestamp: () => stamp, Timestamp: { now: () => stamp },
        runTransaction(_db, callback) {
            const pending = chain.then(async () => {
                const writes = []; const result = await callback({ get: async k => snap(k), set: (k, v) => writes.push([k, structuredClone(v)]), update: (k, v) => writes.push([k, { ...data.get(k), ...structuredClone(v) }]) });
                if (failed && writes.length) { failed = false; throw Object.assign(new Error('Synthetic interruption'), { code: 'unavailable' }); }
                writes.forEach(([k, v]) => data.set(k, v)); return result;
            }); chain = pending.catch(() => {}); return pending;
        }
    };
    const guard = uid => { if (uid !== owner.uid) throw new Error('Synthetic owner mismatch'); };
    const history = new Map();
    const legacy = {
        async list(uid) { guard(uid); return remote.inspect(owner).records.map(([key, value]) => ({ ...value, _docId: key, updatedAt: stamp })); },
        async getSettings(uid) { guard(uid); const s = remote.inspect(owner).settings; return s ? { ...s, updatedAt: stamp } : null; },
        async listConflicts(uid) { guard(uid); return []; },
        async commit(uid, op) { guard(uid); return remote.commit(owner, op); },
        async saveSettings(uid, value, baseRevision, canWrite) { guard(uid); if (!canWrite()) throw new Error('Session changed'); const { operationId } = await import('../../sync-core.js'); return remote.commitSettings(owner, { id: operationId('settings', baseRevision, value), value, baseRevision }); },
        async saveAutomaticHistory(uid, item) { guard(uid); history.set(item.id, structuredClone(item)); return { acknowledged: true }; },
        async listAutomaticHistory(uid) { guard(uid); return [...history.values()]; },
        async resolveConflict(uid) { guard(uid); return true; },
        listen: () => () => {}, listenSettings: () => () => {}, listenConflicts: () => () => {}
    };
    return { client: withFinanceGenerations(legacy, {}, guard, sdk), remote, failRestore() { failed = true; } };
}
