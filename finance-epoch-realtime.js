import { scopeKey } from './finance-epoch-cache.js';
import { EpochQueueSync, queueStatus } from './finance-epoch-queue.js';

const networkFailure = error => ['unavailable', 'deadline-exceeded', 'auth/network-request-failed', 'network-request-failed'].includes(error?.code);
const transient = error => networkFailure(error) || ['aborted', 'internal', 'resource-exhausted'].includes(error?.code);
const sendable = state => {
    const blocked = new Set(state.operations.filter(item => item.status === 'conflict').map(item => `${item.command.collection}/${item.command.entityId}`));
    return state.operations.some(item => item.status === 'pending' && !blocked.has(`${item.command.collection}/${item.command.entityId}`));
};
export function realtimeStatus(state, session, busy = false, error = null) {
    if (!session || error || (session.error && !session.waitingNetwork) || state.inactive) return 'erro';
    return queueStatus(state, { online: session.online && !session.waitingNetwork, busy: busy || !session.ready || session.applying > 0 });
}

// No UI binding or Firebase initialization. Hosts explicitly start/stop this session.
export class EpochRealtimeSync {
    constructor(cache, transport, { connectivity = globalThis, retryMs = 250, worker = new EpochQueueSync() } = {}) {
        if (scopeKey(cache.scope) !== scopeKey(transport.scope)) throw new Error('Realtime scope mismatch');
        if (!Number.isFinite(retryMs) || retryMs <= 0) throw new TypeError('Invalid listener retry interval');
        this.cache = cache; this.transport = transport; this.worker = worker;
        this.connectivity = connectivity; this.retryMs = retryMs; this.session = null;
    }
    alive(s, run = s?.run) {
        if (!s || this.session !== s || s.run !== run || s.error?.terminal) return false;
        try { this.transport.assertIdentity(); return true; } catch { return false; }
    }
    start() {
        if (this.session) return;
        this.transport.assertIdentity();
        const s = { run: 0, sequence: 0, ready: false, authorized: false, applying: 0,
            online: this.connectivity.navigator?.onLine !== false, error: null, chain: Promise.resolve(), failures: 0 };
        this.session = s; this.worker.activate(this.cache, this.transport); this.worker.setOnline(false);
        const offline = () => {
            if (this.session !== s) return;
            s.online = false; s.ready = false; s.run++; s.unsubscribe?.(); s.unsubscribe = null;
            clearTimeout(s.retry); this.worker.setOnline(false);
        };
        const online = () => {
            if (this.session !== s || s.error?.terminal) return;
            s.online = true; s.waitingNetwork = false; this.restartListeners();
        };
        this.connectivity.addEventListener?.('offline', offline);
        this.connectivity.addEventListener?.('online', online);
        s.disposeConnectivity = () => { this.connectivity.removeEventListener?.('offline', offline); this.connectivity.removeEventListener?.('online', online); };
        if (s.online) this.openListeners(s);
    }
    stop() {
        const s = this.session;
        this.session = null; this.worker.deactivate();
        if (s) { s.run++; s.unsubscribe?.(); clearTimeout(s.retry); s.disposeConnectivity(); }
    }
    restartListeners() {
        const s = this.session;
        if (!s || s.error?.terminal) return;
        s.run++; s.unsubscribe?.(); s.unsubscribe = null; clearTimeout(s.retry);
        s.ready = false; s.authorized = false; this.worker.setOnline(false);
        if (s.online) this.openListeners(s);
    }
    openListeners(s) {
        const run = ++s.run;
        try {
            s.unsubscribe = this.transport.listen(event => {
                if (!this.alive(s, run)) return;
                const sequence = ++s.sequence;
                if (event.type === 'waiting') {
                    s.ready = false; this.worker.setOnline(false);
                    if (event.reason === 'cache' && s.authorized) s.waitingNetwork = true;
                    return;
                }
                if (event.type !== 'snapshot') return;
                s.applying++;
                s.chain = s.chain.then(async () => {
                    const current = () => this.alive(s, run) && s.online && s.sequence === sequence;
                    if (!current()) return;
                    await this.cache.applyRemoteSnapshot(event.snapshot, current);
                    if (!current()) return;
                    s.ready = true; s.authorized = true; s.waitingNetwork = false; s.error = null; s.failures = 0;
                    this.worker.setOnline(true); this.worker.error = null;
                    void this.pump(s);
                }).catch(error => { if (this.alive(s, run)) this.fail(s, error); })
                    .finally(() => { s.applying--; });
            }, error => { if (this.session === s && s.run === run) this.fail(s, error); });
        } catch (error) { this.fail(s, error); }
    }
    fail(s, error) {
        if (this.session !== s || s.error?.terminal) return;
        s.ready = false; s.run++; s.unsubscribe?.(); s.unsubscribe = null; this.worker.setOnline(false);
        if (transient(error) && !this.cache.error) {
            s.error = error; s.waitingNetwork = networkFailure(error);
            clearTimeout(s.retry);
            s.retry = setTimeout(() => {
                if (this.session !== s || !s.online) return;
                s.error = null; this.openListeners(s);
            }, Math.min(5000, this.retryMs * 2 ** s.failures++));
            s.retry.unref?.();
        } else {
            s.error = Object.assign(error, { terminal: true }); s.authorized = false;
            this.worker.deactivate(); clearTimeout(s.retry);
            if (error.code === 'epoch/inactive') void this.cache.retireGeneration(() => this.session === s).catch(() => {});
            else if (error.code === 'permission-denied') void this.transport.verifyScope().catch(cause => {
                if (this.session === s && cause.code === 'epoch/inactive') return this.cache.retireGeneration(() => this.session === s);
            }).catch(() => {});
        }
    }
    async pump(s) {
        if (!this.alive(s) || !s.online || !s.ready || s.error) return;
        if (s.pumping) { s.resumeRequested = true; return; }
        s.pumping = true; s.resumeRequested = false;
        try {
            const state = await this.cache.read();
            if (!this.alive(s) || !s.ready || !sendable(state)) return;
            await this.worker.flush();
        }
        catch (error) {
            if (this.session === s) {
                this.fail(s, error);
            }
        } finally {
            s.pumping = false;
            // A listener restart may have completed while an old request drained.
            if (this.alive(s) && s.online && s.ready) {
                const state = await this.cache.read().catch(() => null);
                if (state && !s.error && !this.worker.session?.running && sendable(state)) {
                    // Queue's lease retry handles another tab; don't spin here.
                    if (s.resumeRequested) { s.resumeRequested = false; void this.pump(s); }
                }
            }
        }
    }
    async enqueue(command) {
        const s = this.session;
        this.transport.assertIdentity();
        if (!this.alive(s)) throw new Error('Inactive realtime session');
        const state = await this.cache.read();
        if (state.inactive || s.error?.terminal) throw Object.assign(new Error('Inactive generation'), { code: 'epoch/inactive' });
        if (!s.authorized && !state.serverReady) throw new Error('Server baseline required before editing');
        const saved = await this.cache.enqueue(command, () => this.alive(s));
        if (this.alive(s)) { s.resumeRequested = true; void this.pump(s); }
        return saved;
    }
    async view() {
        const s = this.session;
        const empty = { scope: null, confirmed: {}, optimistic: {}, pending: [], conflicts: [], ready: false, status: 'erro' };
        if (!this.alive(s)) return empty;
        try {
            const state = await this.cache.read();
            if (!this.alive(s)) return empty;
            const status = realtimeStatus(state, s, Boolean(s.pumping) || Boolean(this.worker.session?.running), this.cache.error || this.worker.error);
            if (state.inactive || (!s.authorized && ((s.online && !s.waitingNetwork) || !state.serverReady))) return { ...empty, status };
            return { scope: this.cache.scope, confirmed: state.remote, optimistic: state.projection,
                pending: state.operations.filter(item => item.status !== 'applied'),
                conflicts: state.operations.filter(item => item.status === 'conflict'), ready: s.ready, status };
        } catch { return empty; }
    }
}
