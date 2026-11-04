// Explicit synthetic composition. Never imported by the published application.
import { createVaultLifecycle } from './finance-vault-lifecycle.js';
import { createRealVaultAdapter } from './finance-vault-real-adapter.js';
import { createVaultController } from '../finance-vault-controller.js';
import { createFinancialCodec } from '../finance-vault-codec.js';
import { normalizarEstado } from '../finance-core.js';
import { financeSettings } from '../automatic-sync-policy.js';
import { validateIntegratedConfiguration } from './finance-vault-integrated-session.js';
const fail = code => { throw Object.assign(new Error('Synthetic composition rejected.'), { code }); };
const codec = createFinancialCodec();
const equal = (a, b) => { const x = codec.encode(a), y = codec.encode(b); return x.length === y.length && x.every((v, i) => v === y[i]); };
export function createVaultComposition({ config, client, auth, makeStore, onView = () => {}, crypto = globalThis.crypto, locks = globalThis.navigator?.locks, connectivity = globalThis }) {
    validateIntegratedConfiguration(config);
    let epoch = {}, authIntent = 0, expectedUser, identityDone = Promise.resolve(), identityRequest = -1, authWork = Promise.resolve(), authClosing = false;
    let current = null, enrollment = null, openingRecovery = false, unAuth, closed = false, refreshTicket = 0;
    const localPending = new Set();
    let view = { phase: 'initializing', uid: null, data: null, pending: null, sync: 'stopped', error: null, epoch: 0 };
    const owner = uid => ({ projectId: config.projectId, uid });
    const bindingKey = uid => `snapshot:${uid}:lifecycle-owner`;
    const emit = (phase, patch = {}) => { view = { ...view, phase, ...patch }; onView(structuredClone(view)); };
    const erase = phase => emit(phase, { data: null, pending: null, sync: 'stopped', error: null });
    function retire(phase) { epoch = {}; view.epoch++; refreshTicket++; if (current) current.remote = false; erase(phase); return epoch; }
    const check = token => { if (closed || token !== epoch) fail('composition/stale-session'); };
    const ready = () => ['ready', 'operating'].includes(lifecycle.state().phase);
    function remoteCurrent(r) { return !closed && current === r && r.token === epoch && r.remote && ready(); }
    const keyLock = o => `synthetic-real-vault:${o.projectId}:${o.uid}`;
    const lifecycle = createVaultLifecycle({ revocationScope: 'owner-vault-all-tabs', onState(state) {
        if (!['ready', 'operating'].includes(state.phase)) erase(authClosing && state.phase === 'signed-out' ? 'closing' : state.phase === 'error' ? 'error' : state.phase);
    }, async openAdapter(selected) {
        const token = epoch, recovery = openingRecovery;
        const real = createRealVaultAdapter({ store: await makeStore(config.databaseName), owner: selected, crypto, locks });
        const r = { real, token, owner: selected, lease: null, sync: null, remote: false, revoked: false, disposed: false };
        const dispose = () => { if (!r.disposed) { r.disposed = true; real.close(); } if (current === r) current = null; };
        return {
            async unlock(secret) {
              const perform = async () => {
                check(token); r.lease = await (recovery ? real.unlockWithRecovery(secret) : real.unlock(secret)); check(token);
                const snapshot = await real.read(), binding = snapshot.documents[bindingKey(selected.uid)]; check(token);
                if (binding?.mode !== 'verified' || binding.keyId !== snapshot.catalog.keyId) fail('composition/recovery-required');
                if (recovery) await prove(real, selected, secret, token);
                current = r; return r.lease;
              };
              // KDF/initial authenticated read must not race another tab's normal
              // snapshot revision. Durable epoch revocation still bypasses this lock.
              return locks ? locks.request(keyLock(selected), perform) : perform();
            },
            async read() {
                const read = () => real.read();
                try { return await (locks ? locks.request(keyLock(selected), read) : read()); }
                catch (e) { if (e.code === 'cancelled') r.revoked = true; throw e; }
            },
            async lock() { r.remote = false; if (r.revoked) dispose(); else await real.lock(); },
            close: dispose
        };
    } });
    async function disposeEnrollment() {
        const old = enrollment; enrollment = null;
        if (old) { try { await old.real.lock(); } finally { old.real.close(); } }
    }
    async function discover(uid, token) {
        const a = createRealVaultAdapter({ store: await makeStore(config.databaseName), owner: owner(uid), crypto, locks });
        try { const status = await a.status(); check(token);
            if (!['locked', 'missing'].includes(status.state)) { emit('recovery-required', { error: status.state }); return; }
            emit(status.state, { uid, error: null });
        } finally { a.close(); }
    }
    function applyIdentity(user, request = authIntent) {
        if (closed || request !== authIntent) return Promise.resolve();
        if (expectedUser !== undefined && (user?.uid || null) !== expectedUser) {
            // An obsolete SDK result can still change SDK currentUser. Fence the
            // financial context, rather than keeping a different owner open.
            retire(authClosing ? 'closing' : 'authenticating');
            const pending = lifecycle.close('lock'); identityDone = pending; pending.catch(() => {}); return pending;
        }
        const token = retire(user ? 'authenticating' : 'closing');
        view.uid = user?.uid || null;
        const pending = (async () => {
            if (user && !config.accounts.includes(user.uid)) fail('composition/owner');
            await disposeEnrollment(); check(token);
            await lifecycle.identify(user ? { kind: 'confirmed', owner: owner(user.uid) } : { kind: 'none' }); check(token);
            identityRequest = request;
            if (user) await discover(user.uid, token); else emit(authClosing ? 'closing' : 'signed-out', { uid: null });
        })();
        identityDone = pending; pending.catch(e => { if (epoch === token && !closed) emit('error', { data: null, error: e.code || 'auth-failed' }); }); return pending;
    }
    async function prove(real, selected, secret, token) {
        const before = await real.read(), bytes = await real.exportRecoveryPackage(); check(token);
        const proof = createVaultController({ store: await makeStore(`${config.databaseName}-proof-${crypto.randomUUID()}`), owner: selected, vaultId: 'synthetic-real-adapter', crypto, channelFactory: () => null });
        try {
            const result = await proof.importRecoveryPackage(bytes, { recoverySecret: secret, newPassword: crypto.randomUUID() }); check(token);
            const reconstructed = await proof.read();
            if (!equal(before.documents, reconstructed.documents) || before.generation !== reconstructed.generation || before.catalog.keyId === reconstructed.catalog.keyId) fail('composition/equivalence');
            await proof.lock(); await proof.unlockWithRecovery(result.recoverySecret); check(token);
            if (!equal(before.documents, (await proof.read()).documents) || (await real.read()).catalog.revision !== before.catalog.revision) fail('composition/equivalence');
        } finally { proof.close(); }
    }
    async function refresh() {
        if (!ready()) return;
        if (current?.failed) { erase('error'); emit('error', { error: 'sync-failed' }); return; }
        const token = epoch, ticket = ++refreshTicket;
        try {
            const snapshot = await lifecycle.read(); check(token); if (ticket !== refreshTicket) return;
            const uid = lifecycle.state().owner.uid, q = snapshot.documents[`fila:${uid}`];
            const pending = !!(lifecycle.state().inFlight || q.outbox.length || q.restoreJob || q.conflicts.length || q.compatibilityBlocked || q.automaticSettingsDirty || q.restoredPending
                || q.automaticHistory?.some(h => !h.uploaded) || q.automaticResolutions?.some(h => !h.confirmed) || q.conflictDecisions?.some(h => h.status !== 'confirmed'));
            const remote = current?.remote;
            emit(pending ? 'pending' : 'unlocked', { uid, data: snapshot.documents[`estado:${uid}`].dados, pending: q.outbox.length,
                sync: !remote || connectivity.navigator?.onLine === false ? 'offline' : pending ? 'pending' : current?.confirmed ? 'synced' : 'syncing', error: null });
        } catch (e) {
            if (token !== epoch || !ready() && lifecycle.state().phase !== 'error') return;
            erase(e.code === 'cancelled' ? 'recovery-required' : 'error'); emit(view.phase, { error: e.code || 'storage-failed' });
        }
    }
    async function activate(token) {
        check(token); const r = current; if (!r || r.token !== token) fail('composition/stale-session');
        if (lifecycle.state().ownership === 'confirmed') {
            const guarded = new Proxy(client, { get(target, name) {
                const method = Reflect.get(target, name); if (typeof method !== 'function') return method;
                if (name === 'onUser') return callback => method.call(target, user => { if (remoteCurrent(r) && user?.uid === r.owner.uid) callback(user); });
                if (String(name).startsWith('listen')) return (...args) => { if (!remoteCurrent(r)) fail('composition/stale-session');
                    return method.apply(target, args.map(a => typeof a === 'function' ? (...values) => { if (remoteCurrent(r)) a(...values); } : a)); };
                return async (...args) => { if (!remoteCurrent(r)) fail('composition/stale-session');
                    const result = await method.apply(target, args); if (!remoteCurrent(r)) fail('composition/stale-session'); return result; };
            } });
            r.remote = true;
            r.sync = r.lease.attachSync({ client: guarded, readLegacyMetadata: () => ({}), connectivity, requiredProtocol: 2,
                waitLocal: async () => { while (localPending.size) await Promise.allSettled([...localPending]); },
                onTransition() {}, onAccount() {}, onState() { if (remoteCurrent(r)) { r.confirmed = false; void refresh(); } },
                onStatus(message, failed) { if (!remoteCurrent(r)) return; r.lastStatus = message; r.failed = failed; r.confirmed = !failed && (message === 'Sincronizado' || message.startsWith('Dados ativos sincronizados;'));
                    if (failed) { refreshTicket++; erase('error'); emit('error', { error: 'sync-failed' }); } else void refresh(); }
            });
            await r.sync.start(); check(token);
        }
        await refresh();
    }
    async function unlock(secret, recovery) {
        const token = epoch, state = lifecycle.state();
        if (!state.owner) fail('composition/owner');
        if (state.ownership === 'confirmed' && identityRequest !== authIntent) fail('composition/auth-pending');
        if (state.phase === 'error' || state.phase === 'missing') await lifecycle.identify({ kind: state.ownership, owner: state.owner });
        openingRecovery = recovery;
        try { await lifecycle.unlock(secret); check(token); await activate(token); }
        catch (e) { if (token === epoch) { erase(e.code === 'composition/recovery-required' ? 'recovery-required' : 'locked'); emit(view.phase, { error: e.code || 'unlock-failed' }); } throw e; }
        finally { openingRecovery = false; }
    }
    return Object.freeze({
        view: () => structuredClone(view), lifecycleState: () => lifecycle.state(),
        diagnostics: () => ({ phase: view.phase, lifecycle: lifecycle.state(), confirmed: current?.confirmed, status: current?.lastStatus,
            syncRunning: current?.sync?.session?.running, syncAgain: current?.sync?.session?.again, syncPermanent: current?.sync?.session?.permanent, syncAttempt: current?.sync?.session?.attempt, localPending: localPending.size }),
        async start() {
            lifecycle.start(); let settled; const initial = new Promise(r => { settled = r; });
            unAuth = client.onUser(user => { void applyIdentity(user).finally(settled).catch(() => {}); });
            await client.ready(); await initial;
        },
        async login(uid) {
            if (!config.accounts.includes(uid)) fail('composition/owner');
            const request = ++authIntent; expectedUser = uid; authClosing = false; retire('closing');
            const closing = lifecycle.close('lock'); closing.catch(() => {});
            const pending = authWork.then(async () => {
              await closing; await disposeEnrollment(); if (request !== authIntent) fail('composition/stale-session');
              emit('authenticating', { uid });
              try { const user = await auth.login(uid); if (request !== authIntent) fail('composition/stale-session'); if (user?.uid !== uid) fail('composition/owner');
                await identityDone; if (identityRequest !== request) await applyIdentity(user, request);
              } catch (e) { if (request === authIntent) { retire('error'); await lifecycle.identify({ kind: 'failed' }); emit('error', { error: e.code || 'auth-failed' }); } throw e; }
            }); authWork = pending.catch(() => {}); return pending;
        },
        async logout() { const request = ++authIntent; expectedUser = null; authClosing = true; retire('closing'); const closing = lifecycle.close('logout'); closing.catch(() => {});
            const pending = authWork.then(async () => { await closing; await disposeEnrollment();
                if (request !== authIntent) fail('composition/stale-session'); await auth.logout(); await identityDone;
                if (request === authIntent) { authClosing = false; emit('signed-out', { uid: null }); }
            }); authWork = pending.catch(() => {}); return pending; },
        async lock() { retire('closing'); await lifecycle.close('lock'); await disposeEnrollment(); emit('locked'); },
        async offline(uid) { if (!config.accounts.includes(uid)) fail('composition/owner'); authIntent++; expectedUser = undefined; const token = retire('closing');
            await disposeEnrollment(); await lifecycle.identify({ kind: 'unconfirmed', owner: owner(uid) }); check(token); emit('locked', { uid }); },
        async create(password) {
            const state = lifecycle.state(), token = epoch; if (state.ownership !== 'confirmed' || view.phase !== 'missing') fail('composition/create-forbidden');
            const selected = state.owner, real = createRealVaultAdapter({ store: await makeStore(config.databaseName), owner: selected, crypto, locks }); check(token);
            enrollment = { real, token, owner: selected, secret: null, lease: null }; emit('creating');
            try {
                if ((await real.status()).state !== 'missing') fail('composition/existing-destination');
                const data = normalizarEstado({ versao: 3, categorias: ['Casa'], meses: { '2026-11': { receitas: [], despesas: [] } } });
                const created = await real.create({ password, generation: 'legacy', documents: {
                    [`estado:${selected.uid}`]: { revisao: 0, dados: data },
                    [`fila:${selected.uid}`]: { generation: 'legacy', initialized: true, automaticPolicyInitialized: true, outbox: [], conflicts: [], attempted: {}, remoteRevisions: {}, recoveryKeys: [], settingsBaseline: financeSettings(data), automaticSettingsDirty: false },
                    [bindingKey(selected.uid)]: { format: 'synthetic-authenticated-owner-v1', owner: selected, mode: 'prepared' }
                } }); check(token);
                enrollment.lease = created.session; enrollment.secret = created.recoverySecret; await prove(real, selected, created.recoverySecret, token); check(token);
                emit('custody'); return created.recoverySecret;
            } catch (e) { if (token === epoch) { erase('recovery-required'); emit('recovery-required', { error: e.code || 'creation-failed' }); } throw e; }
        },
        async confirm(secret, external, password) {
            const e = enrollment; if (!e || e.token !== epoch || secret !== e.secret || external !== true || view.phase !== 'custody') fail('composition/custody');
            const snapshot = await e.real.read(); check(e.token);
            await e.lease.db.alterar(bindingKey(e.owner.uid), b => ({ ...b, mode: 'verified', keyId: snapshot.catalog.keyId })); check(e.token);
            await disposeEnrollment(); await unlock(password, false);
        },
        unlock: secret => unlock(secret, false), recover: secret => unlock(secret, true),
        async edit(transform) { if (current) current.confirmed = false; const token = epoch;
            if (!ready()) fail('composition/not-ready'); emit('pending', { sync: 'pending' });
            const pending = lifecycle.edit(transform); localPending.add(pending);
            let result; try { result = await pending; } finally { localPending.delete(pending); }
            if (token === epoch && ready()) { if (current) current.confirmed = false; current?.sync?.localChanged(); await refresh(); } return result; },
        snapshot: () => lifecycle.read(), refresh,
        async synchronize() { const token = epoch, r = current; if (!r?.sync || !remoteCurrent(r)) fail('composition/offline-owner'); await r.sync.run(r.sync.session); check(token); await refresh(); },
        async suspend() { retire('closing'); await lifecycle.suspend(); await disposeEnrollment(); erase('suspended'); },
        async resume() { retire('closing'); await lifecycle.resume(); emit(lifecycle.state().owner ? 'locked' : 'signed-out', { uid: lifecycle.state().owner?.uid || null }); },
        async shutdown() { if (closed) return; unAuth?.(); retire('closing'); await lifecycle.close('logout'); await disposeEnrollment(); closed = true; erase('closed'); }
    });
}
