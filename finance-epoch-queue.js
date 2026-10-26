import { newStableId } from './finance-epoch.js';
import { scopeKey } from './finance-epoch-cache.js';

export function queueStatus(state, { online = true, error = null, busy = false } = {}) {
    if (error || state.inactive || state.operations.some(item => item.status === 'conflict')) return 'erro';
    if (!online) return 'offline';
    return busy || !state.serverReady || state.operations.some(item => item.status !== 'applied') ? 'sincronizando' : 'sincronizado';
}
export class EpochQueueSync {
    constructor({ now = () => Date.now(), leaseMs = 30000 } = {}) {
        if (typeof now !== 'function' || !Number.isFinite(leaseMs) || leaseMs <= 0) throw new TypeError('Invalid lease configuration');
        this.now = now; this.leaseMs = leaseMs; this.session = null;
        this.online = globalThis.navigator?.onLine !== false; this.error = null;
    }
    activate(cache, transport) {
        this.deactivate();
        if (scopeKey(cache.scope) !== scopeKey(transport.scope)) throw new Error('Transport scope mismatch');
        this.session = { cache, transport, owner: newStableId() }; this.error = null;
    }
    deactivate() { clearTimeout(this.session?.retry); this.session = null; }
    setOnline(online) { this.online = Boolean(online); }
    observeConnectivity(target = globalThis) {
        const offline = () => this.setOnline(false);
        const online = () => { this.setOnline(true); void this.flush().catch(() => {}); };
        target.addEventListener('offline', offline);
        target.addEventListener('online', online);
        return () => { target.removeEventListener('offline', offline); target.removeEventListener('online', online); };
    }
    async status() {
        const session = this.session;
        if (!session) return 'erro';
        try {
            const state = await session.cache.read();
            if (session !== this.session) return 'erro';
            return queueStatus(state, { online: this.online, error: this.error || session.cache.error, busy: Boolean(session.running) });
        } catch { return 'erro'; }
    }
    async flush() {
        const session = this.session;
        if (!session || !this.online) return;
        // One flush per instance; separate tabs coordinate through a durable lease.
        if (session.running) return session.running;
        session.running = this.process(session).finally(() => { session.running = null; });
        return session.running;
    }
    async process(session) {
        const { cache, transport, owner } = session;
        const current = () => session === this.session && this.online;
        try {
            if (cache.error) throw cache.error;
            const leased = await cache.acquireLease(owner, this.now(), this.leaseMs);
            if (!current()) return;
            if (leased.lease?.owner !== owner) { this.retryAfterLease(session, leased.lease); return; }
            clearTimeout(session.retry);
            const snapshot = await transport.readSnapshot();
            if (!current()) return;
            await cache.applyRemoteSnapshot(snapshot, current);
            if (!current()) return;
            this.error = null;
            for (;;) {
                const state = await cache.acquireLease(owner, this.now(), this.leaseMs);
                if (!current()) return;
                if (state.lease?.owner !== owner) { this.retryAfterLease(session, state.lease); return; }
                const blocked = new Set(state.operations.filter(item => item.status === 'conflict')
                    .map(item => `${item.command.collection}/${item.command.entityId}`));
                const next = state.operations.find(item => item.status === 'pending'
                    && !blocked.has(`${item.command.collection}/${item.command.entityId}`));
                if (!next) return;
                const result = await transport.commit(structuredClone(next.command));
                if (!current()) return;
                await cache.acknowledge(next.command, result, owner, this.now(), current);
            }
        } catch (error) {
            if (session === this.session) {
                this.error = error;
                if (['unavailable', 'auth/network-request-failed', 'network-request-failed'].includes(error.code)) {
                    this.online = false; this.error = null;
                }
            }
            throw error;
        } finally { await cache.releaseLease(owner).catch(() => {}); }
    }
    retryAfterLease(session, lease) {
        clearTimeout(session.retry);
        session.retry = setTimeout(() => {
            if (session !== this.session || !this.online) return;
            void this.flush().catch(() => {});
        }, Math.max(1, (lease?.expiresAt || this.now()) - this.now() + 1));
        session.retry.unref?.();
    }
}
