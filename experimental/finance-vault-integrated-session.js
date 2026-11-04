import { createRealVaultAdapter } from './finance-vault-real-adapter.js';
import { createVaultController } from '../finance-vault-controller.js';
import { createFinancialCodec } from '../finance-vault-codec.js';
import { normalizarEstado, validarBackup } from '../finance-core.js';
import { financeSettings } from '../automatic-sync-policy.js';
import { makeOperation, recordEntityKey, registrosFinanceiros } from '../sync-core.js';

const fail = code => { throw Object.assign(new Error('Experimental integrated operation rejected.'), { code }); };
const codec = createFinancialCodec();
const same = (a, b) => { const x = codec.encode(a), y = codec.encode(b); try { return x.length === y.length && x.every((v, i) => v === y[i]); } finally { x.fill(0); y.fill(0); } };
export function validateIntegratedConfiguration(config) {
    if (config?.experimentalVault !== true || config.projectId !== 'demo-vault-integration'
        || config.authEmulator !== 'http://127.0.0.1:9099' || config.firestoreEmulator !== 'http://127.0.0.1:8080'
        || !/^controleFinanceiro:cofre-isolado:v1:synthetic-integrated-[A-Za-z0-9_-]+$/.test(config.databaseName || '')
        || !Array.isArray(config.accounts) || !config.accounts.length || config.accounts.some(uid => !/^synthetic-integrated-[A-Za-z0-9_-]+$/.test(uid))) fail('synthetic-only');
}
export function createIntegratedSession({ config, client, auth, makeStore, onView, connectivity = globalThis, crypto = globalThis.crypto, locks = globalThis.navigator?.locks }) {
    validateIntegratedConfiguration(config); config = Object.freeze({ ...config, accounts: Object.freeze([...config.accounts]) });
    let token = {}, resource = null, cleanup = Promise.resolve(), unAuth, closed = false;
    let authWork = Promise.resolve(), authIntent = 0, intendedUser;
    let view = { phase: 'signed-out', uid: null, data: null, pending: null, conflicts: 0, epoch: 0 }, secretInCustody = null;
    const emit = (phase, values = {}) => { view = { ...view, phase, ...values }; onView(structuredClone(view)); };
    const check = captured => { if (closed || token !== captured) fail('session-cancelled'); };
    const authorityId = uid => `snapshot:${uid}:integrated-custody-v1`;
    function clear(phase, uid = null) { secretInCustody = null; emit(phase, { uid, data: null, pending: null, conflicts: 0, error: null, lastError: null, generation: null, recoveryCount: 0, restorePending: false }); }
    function retire(phase, uid = null) {
        token = {}; view.epoch++; const old = resource; resource = null; clear(phase, uid);
        // lock revokes the adapter synchronously, before its durable await.
        const locking = old ? old.adapter.lock() : Promise.resolve();
        const disposed = locking.finally(() => old?.adapter.close());
        const previous = cleanup; cleanup = Promise.allSettled([previous, disposed]).then(results => { const failure = results.find(r => r.status === 'rejected'); if (failure) throw failure.reason; });
        cleanup.catch(() => {}); return token;
    }
    async function transition(user) {
        if (intendedUser !== undefined && (user?.uid || null) !== intendedUser) { retire(intendedUser ? 'authenticating' : 'signing-out', intendedUser); return; }
        const captured = retire(user ? 'checking' : 'signed-out', user?.uid || null);
        try {
            await cleanup; check(captured); if (!user) return;
            if (!config.accounts.includes(user.uid)) fail('owner-mismatch');
            const owner = { projectId: config.projectId, uid: user.uid }, store = await makeStore(config.databaseName);
            if (closed || token !== captured) { store.close(); fail('session-cancelled'); }
            const adapter = createRealVaultAdapter({ store, owner, crypto, locks }); resource = { owner, adapter, lease: null, sync: null, armed: false, captured };
            const status = await adapter.status(); check(captured);
            if (!['missing', 'locked'].includes(status.state)) fail('recovery-required'); clear(status.state, user.uid);
        } catch (e) { if (token === captured && !closed) clear('error', user?.uid || null), emit('error', { error: e.code || 'initialization-failed' }); }
    }
    const active = () => { const r = resource; if (!r?.armed || !r.lease?.isCurrent()) fail('locked'); check(r.captured); return r; };
    async function resetAfterError(r, phase, error) {
        const captured = retire('checking', r.owner.uid);
        try {
            await cleanup; check(captured); await transition({ uid: r.owner.uid });
            if (resource?.owner.uid === r.owner.uid && view.phase === 'locked') emit(phase, { data: null, error: error.code || 'operation-failed' });
        } catch (failure) { if (token === captured && !closed) { clear('error', r.owner.uid); emit('error', { error: failure.code || 'recovery-required' }); } throw failure; }
    }
    function readFailure(r, error) { if (token === r.captured && r.armed && !['stale-revision', 'persistence/cancelled'].includes(error.code)) void resetAfterError(r, 'error', error).catch(() => {}); }
    async function proof(r, recoverySecret) {
        const before = await r.adapter.read(); check(r.captured); const bytes = await r.adapter.exportRecoveryPackage(); check(r.captured);
        const store = await makeStore(`${config.databaseName}-proof-${crypto.randomUUID()}`);
        if (closed || token !== r.captured) { store.close(); fail('session-cancelled'); }
        const c = createVaultController({ store, owner: r.owner, vaultId: 'synthetic-real-adapter', crypto, channelFactory: () => null });
        try {
            if ((await c.status()).state !== 'missing') fail('destination-exists'); check(r.captured);
            const restored = await c.importRecoveryPackage(bytes, { recoverySecret, newPassword: crypto.randomUUID() }); check(r.captured);
            const after = await c.read(); check(r.captured);
            if (!same(before.documents, after.documents) || before.generation !== after.generation || before.catalog.keyId === after.catalog.keyId) fail('equivalence-failed');
            await c.lock(); await c.unlockWithRecovery(restored.recoverySecret); check(r.captured);
            if (!same(before.documents, (await c.read()).documents)) fail('equivalence-failed');
            if ((await r.adapter.read()).catalog.revision !== before.catalog.revision) fail('stale-revision'); check(r.captured);
        } finally { c.close(); }
    }
    async function activate(r) {
        check(r.captured); const snapshot = await r.adapter.read(); check(r.captured);
        const authority = snapshot.documents[authorityId(r.owner.uid)];
        if (!authority || authority.mode !== 'verified' || authority.uid !== r.owner.uid || authority.keyId !== snapshot.catalog.keyId) fail('recovery-required');
        r.armed = true;
        r.sync = r.lease.attachSync({ client, readLegacyMetadata: () => ({}), connectivity, requiredProtocol: 2,
            onAccount() {}, onTransition() {},
            onState(data, meta) {
                if (token !== r.captured || !r.armed) return;
                r.statusTicket = (r.statusTicket || 0) + 1;
                emit(connectivity.navigator?.onLine === false ? 'offline' : 'syncing', { data, generation: meta.generation });
                void refresh(r).catch(e => readFailure(r, e));
            },
            onStatus(message, failed) {
                if (token !== r.captured || !r.armed) return;
                const ticket = r.statusTicket = (r.statusTicket || 0) + 1;
                const phase = failed ? 'error' : message === 'Sincronizado' ? 'synced' : message.startsWith('Dados ativos sincronizados;') ? 'recovery-history' : message === 'Offline' ? 'offline' : 'syncing';
                if (['synced', 'recovery-history'].includes(phase)) {
                    void r.lease.service.lerFila(r.owner.uid).then(q => {
                        if (token !== r.captured || !r.armed || ticket !== r.statusTicket) return;
                        const pending = q.outbox.length || q.restoreJob || q.compatibilityBlocked || q.restoredPending || q.automaticSettingsDirty || q.conflicts.length || q.automaticHistory?.some(h => !h.uploaded) || q.automaticResolutions?.some(h => !h.confirmed) || q.conflictDecisions?.some(h => h.status !== 'confirmed');
                        emit(pending ? (connectivity.navigator?.onLine === false ? 'offline' : 'pending') : phase, { pending: q.outbox.length, error: null });
                    }).catch(e => readFailure(r, e));
                } else emit(phase, { error: failed ? 'sync-failed' : null });
                void refresh(r).catch(e => readFailure(r, e));
            }
        });
        const report = r.sync.report.bind(r.sync);
        r.sync.report = (cause, s) => { if (token === r.captured) emit(view.phase, { lastError: cause.code || cause.name || 'unknown' }); return report(cause, s); };
        await r.sync.start(); check(r.captured);
    }
    async function refresh(r) {
        const state = await r.lease.db.ler(`estado:${r.owner.uid}`), q = await r.lease.service.lerFila(r.owner.uid); check(r.captured);
        emit(view.phase, { data: state.dados, pending: q.outbox.length, conflicts: q.conflicts.length + (q.automaticHistory || []).length, recoveryCount: q.recoveryKeys?.length || 0, restorePending: !!q.restoreJob });
    }
    async function unlock(secret, recovery) {
        const r = resource; if (!r || !['locked', 'error', 'recovery-required'].includes(view.phase)) fail('locked'); check(r.captured);
        clear('unlocking', r.owner.uid);
        try {
            r.lease = await (recovery ? r.adapter.unlockWithRecovery(secret) : r.adapter.unlock(secret)); check(r.captured);
            if (recovery) await proof(r, secret);
            const authority = (await r.adapter.read()).documents[authorityId(r.owner.uid)]; check(r.captured);
            if (authority?.mode === 'prepared') {
                clear(recovery ? 'custody' : 'recovery-required', r.owner.uid);
                if (recovery) secretInCustody = secret;
                return false;
            }
            await activate(r); return true;
        } catch (e) { if (token === r.captured) await resetAfterError(r, 'locked', e); throw e; }
    }
    return Object.freeze({
        get view() { return structuredClone(view); },
        async start() { if (closed) fail('session-cancelled'); unAuth = client.onUser(user => { if (!closed) void transition(user); }); await client.ready(); },
        async login(uid) {
            if (closed) fail('session-cancelled'); if (!config.accounts.includes(uid)) fail('synthetic-only');
            const intent = ++authIntent; intendedUser = uid; retire('authenticating', uid);
            const pending = authWork.then(async () => {
                if (closed || intent !== authIntent) fail('session-cancelled'); await cleanup; if (closed || intent !== authIntent) fail('session-cancelled');
                const user = await auth.login(uid); if (user?.uid !== uid) fail('owner-mismatch');
                // Auth may not emit onAuthStateChanged for a new credential with
                // the same UID. The successful SDK result still needs a new lease.
                if (!closed && intent === authIntent && view.phase === 'authenticating') await transition(user);
            });
            authWork = pending.catch(() => {}); return pending;
        },
        async logout() {
            const intent = ++authIntent; intendedUser = null; retire('signing-out');
            const pending = authWork.then(async () => { if (closed || intent !== authIntent) fail('session-cancelled'); try { await cleanup; } finally { await auth.logout(); } });
            authWork = pending.catch(() => {}); return pending;
        },
        async lock() { const uid = resource?.owner.uid; if (!uid) return; retire('checking', uid); await cleanup; await transition({ uid }); },
        async create(password) {
            const r = resource; if (!r || view.phase !== 'missing' || (await r.adapter.status()).state !== 'missing') fail('destination-exists'); check(r.captured);
            clear('creating', r.owner.uid);
            try {
                const dados = normalizarEstado({ versao: 3, categorias: ['Casa'], meses: { '2026-11': { receitas: [], despesas: [] } } });
                const created = await r.adapter.create({ password, generation: 'legacy', documents: {
                    [`estado:${r.owner.uid}`]: { revisao: 0, dados },
                    [`fila:${r.owner.uid}`]: { generation: 'legacy', initialized: true, automaticPolicyInitialized: true, outbox: [], conflicts: [], attempted: {}, remoteRevisions: {}, recoveryKeys: [], settingsBaseline: financeSettings(dados), automaticSettingsDirty: false },
                    [authorityId(r.owner.uid)]: { mode: 'prepared', uid: r.owner.uid }
                } }); check(r.captured); r.lease = created.session;
                await proof(r, created.recoverySecret); check(r.captured); secretInCustody = created.recoverySecret; clear('custody', r.owner.uid); secretInCustody = created.recoverySecret;
                return { recoverySecret: created.recoverySecret };
            } catch (e) { if (token === r.captured) { clear('error', r.owner.uid); emit('error', { error: e.code || 'creation-failed' }); } throw e; }
        },
        async confirmCustody(secret, externalCustodyConfirmed) {
            const r = resource; if (!r?.lease || view.phase !== 'custody' || !secretInCustody || secret !== secretInCustody || externalCustodyConfirmed !== true) fail('recovery-required');
            const snapshot = await r.adapter.read(); check(r.captured);
            await r.lease.db.alterar(authorityId(r.owner.uid), previous => ({ ...previous, mode: 'verified', keyId: snapshot.catalog.keyId })); check(r.captured);
            secretInCustody = null; await activate(r);
        },
        unlock: password => unlock(password, false), recover: secret => unlock(secret, true),
        async edit(mutate) {
            const r = active(), uid = r.owner.uid; emit(connectivity.navigator?.onLine === false ? 'offline' : 'pending');
            try {
            const stored = await r.lease.db.ler(`estado:${uid}`); check(r.captured);
            const desired = structuredClone(stored.dados); mutate(desired);
            if (!validarBackup(desired) || registrosFinanceiros(desired).some(row => !row.id.startsWith('synthetic-') || !row.record.nome.startsWith('SYNTHETIC '))) fail('synthetic-only');
            const q = await r.lease.service.lerFila(uid); check(r.captured);
                await r.lease.service.aplicarEdicao(uid, stored.dados, desired, (changes, queue) => changes.map(value => {
                    const key = recordEntityKey(value), prior = queue.outbox.filter(o => o.entityKey === key).at(-1);
                    return makeOperation(key, value, prior && queue.attempted?.[prior.id] ? prior.id : queue.remoteRevisions?.[key] || null);
                }), () => {}, () => token === r.captured && r.armed && r.lease.isCurrent(), q.generation);
                check(r.captured); await refresh(r); emit(connectivity.navigator?.onLine === false ? 'offline' : 'pending'); r.sync.localChanged();
            } catch (e) { if (token === r.captured) await resetAfterError(r, 'error', e); throw e; }
        },
        async synchronize() { const r = active(); r.sync.session.permanent = false; await r.sync.run(r.sync.session); check(r.captured); await refresh(r); },
        async restoreFixture(state) { const r = active(); if (!validarBackup(state) || registrosFinanceiros(state).some(row => !row.id.startsWith('synthetic-') || !row.record.nome.startsWith('SYNTHETIC '))) fail('synthetic-only'); emit(connectivity.navigator?.onLine === false ? 'offline' : 'pending'); await r.sync.importBackup(state, () => true); check(r.captured); await refresh(r); },
        async snapshot() { const r = active(), result = await r.adapter.read(); check(r.captured); return result; },
        async checkpoint() { const r = active(), result = await r.adapter.exportRecoveryPackage(); check(r.captured); return result; },
        async shutdown() { if (closed) return; closed = true; authIntent++; unAuth?.(); retire('closed'); await cleanup; }
    });
}
