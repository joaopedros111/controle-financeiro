import { assertIdentity, validateCommand, sameCommand } from './finance-epoch.js';

export const EPOCH_DATABASE = 'controleFinanceiro:epoch-cache:v1';
const STORE = 'namespaces';
const copy = value => structuredClone(value);
export function validateScope(scope) {
    if (!scope || typeof scope.projectId !== 'string' || !/^[a-z][a-z0-9-]{3,62}$/.test(scope.projectId)) throw new TypeError('Invalid project');
    assertIdentity(scope.uid); assertIdentity(scope.epoch);
    return { projectId: scope.projectId, uid: scope.uid, epoch: scope.epoch };
}
export const scopeKey = scope => JSON.stringify(Object.values(validateScope(scope)));
const entityKey = command => `${command.collection}/${command.entityId}`;
const initial = () => ({ version: 1, nextSequence: 1, operations: [], remote: {}, projection: {},
    serverReady: false, lease: null });
function rebuild(state) {
    state.projection = copy(state.remote);
    const blocked = new Set(state.operations.filter(item => item.status === 'conflict').map(item => entityKey(item.command)));
    for (const item of state.operations) {
        if (item.status === 'applied') continue;
        const c = item.command;
        state.projection[entityKey(c)] = { payload: copy(c.payload), deleted: c.action === 'delete',
            revision: c.baseRevision + 1, operationId: c.operationId, pending: true, conflict: blocked.has(entityKey(c)) };
    }
    return state;
}
export function stageIntent(state, command) {
    if (state.inactive) throw Object.assign(new Error('Generation retired'), { code: 'epoch/inactive' });
    const prior = state.operations.find(item => item.command.operationId === command.operationId);
    if (prior) {
        if (!sameCommand(prior.command, command)) throw Object.assign(new Error('Operation ID reused'), { code: 'epoch/id-reused' });
        return state;
    }
    const current = state.projection[entityKey(command)];
    if ((current?.revision || 0) !== command.baseRevision || current?.deleted) {
        throw Object.assign(new Error('Local revision changed; intention not saved'), { code: 'cache/stale-base' });
    }
    if (command.action === 'delete' && !current) throw new Error('Cannot delete a missing entity');
    state.operations.push({ command: copy(command), sequence: state.nextSequence++, status: 'pending' });
    return rebuild(state);
}

export async function openEpochCache(scope, { indexedDB = globalThis.indexedDB } = {}) {
    const ownedScope = Object.freeze(validateScope(scope));
    if (!indexedDB) throw Object.assign(new Error('IndexedDB unavailable'), { code: 'cache/unavailable' });
    const db = await new Promise((resolve, reject) => {
        let failed = false;
        const request = indexedDB.open(EPOCH_DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onerror = () => { failed = true; reject(request.error); };
        request.onblocked = () => { failed = true; reject(new Error('IndexedDB blocked by another tab')); };
        request.onsuccess = () => failed ? request.result.close() : resolve(request.result);
    });
    const cache = new EpochCache(db, ownedScope);
    db.onversionchange = () => cache.close();
    try { await cache.mutate(state => state); return cache; }
    catch (error) { cache.close(); throw error; }
}

export class EpochCache {
    constructor(db, scope) { this.db = db; this.scope = scope; this.key = scopeKey(scope); this.error = null; }
    close() { this.db.close(); }
    async transaction(mode, transform) {
        try {
            return await new Promise((resolve, reject) => {
                let result, cause;
                const tx = this.db.transaction(STORE, mode);
                const store = tx.objectStore(STORE);
                const read = store.get(this.key);
                read.onsuccess = () => {
                    try {
                        const state = read.result === undefined ? initial() : copy(read.result);
                        if (state.version !== 1 || !Array.isArray(state.operations)) throw new Error('Invalid cache format');
                        result = transform(state);
                        if (!result || typeof result.then === 'function') throw new Error('Synchronous cache transaction required');
                        if (mode === 'readwrite') store.put(result, this.key);
                    } catch (error) { cause = error; tx.abort(); }
                };
                tx.oncomplete = () => resolve(copy(result));
                tx.onerror = () => { cause ||= tx.error; };
                tx.onabort = () => reject(cause || tx.error || new Error('IndexedDB transaction aborted'));
            });
        } catch (error) { if (error.code !== 'cache/cancelled') this.error = error; throw error; }
    }
    read() { return this.transaction('readonly', state => state); }
    mutate(transform) { return this.transaction('readwrite', transform); }
    async recover() { const state = await this.read(); this.error = null; return state; }
    enqueue(input, isCurrent = () => true) {
        const command = copy(validateCommand(input));
        if (command.uid !== this.scope.uid || command.epoch !== this.scope.epoch) throw new Error('Command outside cache scope');
        return this.mutate(state => {
            if (!isCurrent()) throw Object.assign(new Error('Session changed before local commit'), { code: 'cache/cancelled' });
            return stageIntent(state, command);
        });
    }
    // Listener boundary: only confirmed server envelopes; never stages intents.
    applyRemoteSnapshot(snapshot, isCurrent = () => true) {
        if (scopeKey(snapshot.scope) !== this.key || snapshot.confirmed !== true || !Array.isArray(snapshot.entities)) {
            throw new Error('Unconfirmed or mismatched server snapshot');
        }
        const entries = copy(snapshot.entities);
        for (const { collection, entityId, value } of entries) {
            validateCommand({ protocol: 1, uid: this.scope.uid, epoch: this.scope.epoch, operationId: value.operationId,
                collection, entityId, baseRevision: value.revision - 1, action: value.deleted ? 'delete' : 'put', payload: value.payload });
            if (typeof value.deleted !== 'boolean') throw new Error('Invalid remote envelope');
        }
        return this.mutate(state => {
            if (!isCurrent()) return state;
            if (state.inactive) throw Object.assign(new Error('Generation retired'), { code: 'epoch/inactive' });
            for (const { collection, entityId, value } of entries) {
                const key = `${collection}/${entityId}`, previous = state.remote[key];
                if (previous && previous.revision === value.revision && !sameCommand(previous, value)) throw new Error('Divergent server revision');
                if (!previous || value.revision > previous.revision) {
                    if (previous?.deleted && !value.deleted) throw new Error('Remote tombstone cannot be resurrected');
                    state.remote[key] = value;
                }
            }
            if (snapshot.complete === true) state.serverReady = true;
            return rebuild(state);
        });
    }
    retireGeneration(isCurrent = () => true) {
        return this.mutate(state => {
            if (isCurrent()) { state.inactive = true; state.serverReady = false; }
            return state;
        });
    }
    acquireLease(owner, now, ttl) {
        return this.mutate(state => {
            if (!state.lease || state.lease.expiresAt <= now || state.lease.owner === owner) {
                state.lease = { owner, expiresAt: now + ttl };
            }
            return state;
        });
    }
    releaseLease(owner) { return this.mutate(state => { if (state.lease?.owner === owner) state.lease = null; return state; }); }
    acknowledge(command, result, owner, now, isCurrent = () => true) {
        return this.mutate(state => {
            if (!isCurrent()) return state;
            if (state.lease?.owner !== owner || state.lease.expiresAt <= now) return state;
            const item = state.operations.find(entry => entry.command.operationId === command.operationId);
            if (!item || item.status !== 'pending' || !sameCommand(item.command, command)) return state;
            if (result.status === 'applied' && result.revision === command.baseRevision + 1) {
                item.status = 'applied'; item.result = copy(result);
                const key = entityKey(command), previous = state.remote[key];
                if (!previous || previous.revision < result.revision) state.remote[key] = {
                    payload: copy(command.payload), deleted: command.action === 'delete', revision: result.revision, operationId: command.operationId
                };
            } else if (result.status === 'conflict' && sameCommand(result.command, command)) {
                item.status = 'conflict'; item.result = copy(result);
            } else throw new Error('Missing or invalid remote confirmation');
            return rebuild(state);
        });
    }
}
