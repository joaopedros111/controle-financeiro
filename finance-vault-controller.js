import { createVaultBackend } from './finance-vault-backend.js';
import { createFinancialCodec } from './finance-vault-codec.js';
import { validateCatalog, validateLocator, unlockRecoverySlots } from './finance-vault-catalog.js';
import { exportRecoveryPackage, validateRecoveryPackage } from './finance-vault-recovery.js';
import { copyDocumentMap } from './finance-vault-limits.js';

export class VaultControllerError extends Error {
    constructor(code) {
        const messages = { locked: 'Cofre bloqueado.', missing: 'Cofre inexistente.', cancelled: 'Sessão do cofre invalidada.',
            'already-exists': 'Destino existente; nenhum dado foi substituído.', 'stale-revision': 'Revisão do catálogo alterada.',
            'recovery-required': 'Recuperação explícita necessária.', 'invalid-input': 'Contexto ou operação inválida.', 'crypto-failed': 'Operação criptográfica não concluída.' };
        super(messages[code] || 'Integridade do cofre não confirmada.'); this.name = 'VaultControllerError'; this.code = Object.hasOwn(messages, code) ? code : 'corruption';
    }
}
const fail = code => { throw new VaultControllerError(code); };
export function createVaultController({ store, owner, vaultId, codec = createFinancialCodec(), crypto = globalThis.crypto,
    channelFactory = name => typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null }) {
    if (!owner || Object.keys(owner).sort().join() !== 'projectId,uid' || [owner.projectId, owner.uid, vaultId].some(v => typeof v !== 'string' || !v.length || v.length > 128 || !v.isWellFormed())) fail('invalid-input');
    const expected = { owner: { projectId: owner.projectId, uid: owner.uid }, vaultId };
    const logicalScope = JSON.stringify([owner.projectId, owner.uid, vaultId]);
    let channel; try { channel = channelFactory('cf-vault-lock-v1'); } catch { channel = null; }
    const prepared = new WeakMap();
    const custody = new WeakMap();
    let localEpoch = {}, active = null, closed = false;
    function invalidate() { localEpoch = {}; active?.backend.lock(); active = null; }
    function invalidateCurrent(s) { if (active === s && localEpoch === s.local) invalidate(); }
    function local(captured) { if (closed || captured !== localEpoch) fail('cancelled'); }
    function session() { if (!active || closed) fail('locked'); return active; }
    async function entry() {
        const value = await store.loadCatalog(logicalScope);
        if (value.locator) validateLocator(value.locator, expected);
        return value;
    }
    async function guard(s) {
        local(s.local);
        let now;
        try { now = await entry(); }
        catch (error) { invalidateCurrent(s); throw error; }
        local(s.local);
        if (active !== s || !now.locator || now.control.epoch !== s.control.epoch || now.control.keyScope !== s.control.keyScope || now.control.generation !== s.control.generation) {
            invalidateCurrent(s); fail('cancelled');
        }
        return now;
    }
    const makeBackend = context => createVaultBackend({ store, context, codec, validateCatalog, crypto });
    const announce = epoch => { try { channel?.postMessage({ version: 1, type: 'invalidate', logicalScope, epoch }); } catch { /* Durable fencing remains authoritative. */ } };
    const listener = event => { const m = event.data; if (m?.version === 1 && m.type === 'invalidate' && m.logicalScope === logicalScope
        && Number.isSafeInteger(m.epoch) && active && m.epoch > active.control.epoch) invalidate(); };
    channel?.addEventListener('message', listener);

    async function verifiedRead(s) {
        try { return await s.backend.read(); }
        catch (error) { invalidateCurrent(s); throw error; }
    }
    async function unlock(secret, recovery = false, requiredControl) {
        invalidate(); const captured = localEpoch, state = await entry(); local(captured);
        if (requiredControl !== undefined && JSON.stringify(requiredControl) !== JSON.stringify(state.control)) fail('cancelled');
        if (!state.locator) fail('missing');
        const { context, catalog } = state.locator, candidate = makeBackend(context);
        try {
            if (recovery) await unlockRecoverySlots(candidate, catalog, secret);
            else await candidate.unlockWithPassword(catalog.password, secret, catalog.password.wrapRevision);
            local(captured); const after = await entry(); local(captured);
            if (JSON.stringify(after.control) !== JSON.stringify(state.control)) fail('cancelled');
            active = { backend: candidate, context, control: after.control, local: captured };
        } catch (error) { candidate.lock(); throw error; }
    }
    async function create({ password, generation, documents, originPackageId = null }, requiredControl) {
        // Copy/validate before await, with the lossless codec rather than structuredClone.
        const copy = copyDocumentMap(documents, codec.encode, codec.decode);
        invalidate(); const captured = localEpoch, baseline = await entry(); local(captured);
        if (requiredControl !== undefined && JSON.stringify(requiredControl) !== JSON.stringify(baseline.control)) fail('cancelled');
        if (baseline.locator) fail('already-exists');
        let keyId; try { keyId = crypto.randomUUID(); } catch { fail('crypto-failed'); }
        const context = { ...expected, keyId }, backend = makeBackend(context);
        try {
            await backend.createKey(); local(captured);
            const passwordEnvelope = await backend.protectWithPassword(password); local(captured);
            const recovery = await backend.protectWithRecovery(); local(captured);
            const catalog = { format: 'cf-vault-catalog', version: 2, recoveryPrevious: [], recoveryPending: null, ...context, generation,
                revision: (baseline.control?.revision || 0) + 1, snapshotRevision: 1, codec: codec.id,
                password: passwordEnvelope, recovery: recovery.envelope, originPackageId };
            validateCatalog(catalog, { context, generation, snapshotRevision: 1 });
            const locator = { version: 1, context, catalog };
            await backend.initialize({ generation, documents: copy, catalog,
                coordination: { logicalScope, expected: baseline.control, locator } });
            local(captured); const now = await entry(); local(captured);
            // A lock after commit must not be mistaken for an unlock authorization.
            const expectedEpoch = (baseline.control?.epoch || 0) + 1;
            if (now.control.epoch !== expectedEpoch || now.locator?.context.keyId !== context.keyId) fail('cancelled');
            active = { backend, context, control: now.control, local: captured };
            return { revision: catalog.revision, recoverySecret: recovery.recoverySecret };
        } catch (error) { backend.lock(); throw error; }
    }
    async function prepare({ expectedRevision, generation, updates }, patch = {}, requiredSession) {
        const s = session(), changes = copyDocumentMap(updates, codec.encode, codec.decode);
        if (requiredSession && s !== requiredSession) fail('cancelled');
        const before = await guard(s);
        if (before.control.revision !== expectedRevision) fail('stale-revision');
        const snapshot = await verifiedRead(s); await guard(s);
        if (snapshot.catalog.revision !== expectedRevision) fail('stale-revision');
        const catalog = { recoveryPrevious: [], recoveryPending: null, ...snapshot.catalog, version: 2, ...patch, revision: expectedRevision + 1, snapshotRevision: snapshot.revision + 1, generation };
        validateCatalog(catalog, { context: s.context, generation, snapshotRevision: snapshot.revision + 1 });
        const backendToken = await s.backend.prepare({ expectedRevision: snapshot.revision, generation, updates: changes, catalog });
        const after = await guard(s);
        if (JSON.stringify(after.control) !== JSON.stringify(before.control)) fail('stale-revision');
        const token = Object.freeze(Object.create(null));
        prepared.set(token, { s, backendToken, before: before.control, beforeCatalog: snapshot.catalog, locator: { version: 1, context: s.context, catalog } });
        return token;
    }
    async function commit(token) {
        const item = token && prepared.get(token); if (!item) fail('invalid-input'); prepared.delete(token);
        const { s, locator } = item, before = await guard(s);
        if (JSON.stringify(before.control) !== JSON.stringify(item.before)) fail('stale-revision');
        await s.backend.commit(item.backendToken, { logicalScope, expected: item.before, locator }); local(s.local);
        const now = await entry(); local(s.local);
        const changedGeneration = locator.catalog.generation !== item.before.generation;
        const changedCredentials = item.beforeCatalog.password.wrappedKey !== locator.catalog.password.wrappedKey || item.beforeCatalog.recovery.wrappedKey !== locator.catalog.recovery.wrappedKey;
        if (now.control.epoch !== item.before.epoch + (changedGeneration || changedCredentials ? 1 : 0) || now.control.keyScope !== item.before.keyScope || now.control.generation !== locator.catalog.generation) {
            invalidate(); fail('cancelled');
        }
        if (changedGeneration || changedCredentials) {
            localEpoch = {}; active = { ...s, control: now.control, local: localEpoch }; announce(now.control.epoch);
        } else s.control = now.control;
        return locator.catalog.revision;
    }
    return Object.freeze({
        async status() {
            const captured = localEpoch;
            try {
                const state = await entry(); local(captured);
                if (!state.locator) return { state: 'missing', authenticated: false };
                if (active) { const s = active; await guard(s); await verifiedRead(s); await guard(s); return { state: 'unlocked', authenticated: true }; }
                return { state: 'locked', authenticated: false };
            } catch (error) {
                local(captured);
                if (['corruption', 'context-mismatch'].includes(error.code)) { invalidate(); return { state: 'corrupted', authenticated: false }; }
                if (error.code === 'recovery-required') { invalidate(); return { state: 'recovery-required', authenticated: false }; }
                throw error;
            }
        },
        create: args => create(args),
        unlockWithPassword: password => unlock(password),
        unlockWithRecovery: secret => unlock(secret, true),
        async read() {
            const s = session(), before = await guard(s), snapshot = await verifiedRead(s), after = await guard(s);
            if (snapshot.catalog.revision !== before.control.revision || after.control.revision !== before.control.revision) fail('stale-revision');
            return snapshot;
        },
        prepare: args => prepare(args), commit,
        async renewRecovery() {
            const s = session(), now = await guard(s);
            if (now.locator.catalog.recoveryPending || (now.locator.catalog.recoveryPrevious?.length || 0) >= 8) fail('invalid-input');
            const recovery = await s.backend.protectWithRecovery(now.locator.catalog.recovery.wrapRevision + 1); await guard(s);
            const operationId = crypto.randomUUID();
            const token = await prepare({ expectedRevision: now.control.revision, generation: now.control.generation, updates: {} }, { recoveryPending: { id: operationId, envelope: recovery.envelope } }, s);
            await commit(token); return { operationId, recoverySecret: recovery.recoverySecret, state: 'prepared' };
        },
        async confirmRecoveryCustody(operationId, { recoverySecret, externalCustodyConfirmed } = {}) {
            if (externalCustodyConfirmed !== true) fail('invalid-input');
            const s = session(), now = await guard(s), pending = now.locator.catalog.recoveryPending;
            if (!pending || pending.id !== operationId) fail('invalid-input');
            const candidate = makeBackend(s.context);
            try { await candidate.unlockWithRecovery(pending.envelope, recoverySecret, pending.envelope.wrapRevision); await guard(s); }
            finally { candidate.lock(); }
            const after = await guard(s);
            if (after.control.revision !== now.control.revision) fail('stale-revision');
            const token = Object.freeze(Object.create(null)); custody.set(token, { s, operationId, revision: now.control.revision }); return token;
        },
        async activateRecovery(token) {
            const item = token && custody.get(token); if (!item) fail('invalid-input'); custody.delete(token);
            const now = await guard(item.s), cat = now.locator.catalog;
            if (now.control.revision !== item.revision || cat.recoveryPending?.id !== item.operationId) fail('stale-revision');
            const preparedToken = await prepare({ expectedRevision: item.revision, generation: cat.generation, updates: {} }, {
                recovery: cat.recoveryPending.envelope, recoveryPrevious: [cat.recovery, ...(cat.recoveryPrevious || [])], recoveryPending: null
            }, item.s);
            return commit(preparedToken);
        },
        async cancelRecoveryPreparation(operationId) {
            const s = session(), now = await guard(s);
            if (now.locator.catalog.recoveryPending?.id !== operationId) fail('invalid-input');
            return commit(await prepare({ expectedRevision: now.control.revision, generation: now.control.generation, updates: {} }, { recoveryPending: null }, s));
        },
        async changePassword(oldPassword, newPassword) {
            const s = session(), now = await guard(s), envelope = now.locator.catalog.password;
            const password = await s.backend.rewrapPassword(envelope, oldPassword, newPassword, envelope.wrapRevision); await guard(s);
            const token = await prepare({ expectedRevision: now.control.revision, generation: now.control.generation, updates: {} }, { password }, s);
            return commit(token);
        },
        async exportRecoveryPackage() {
            const s = session(), before = await guard(s), pack = await exportRecoveryPackage(s.backend, crypto), after = await guard(s);
            if (before.control.revision !== after.control.revision) fail('stale-revision'); return pack;
        },
        async importRecoveryPackage(bytes, { recoverySecret, newPassword, sourceVaultId = expected.vaultId }) {
            if (typeof sourceVaultId !== 'string' || !sourceVaultId.length || sourceVaultId.length > 128 || !sourceVaultId.isWellFormed()) fail('invalid-input');
            invalidate(); const captured = localEpoch;
            const baseline = await entry(); local(captured);
            const recovered = await validateRecoveryPackage(bytes, { expected: { ...expected, vaultId: sourceVaultId }, recoverySecret, codec, crypto }); local(captured);
            const state = await entry(); local(captured);
            if (JSON.stringify(state.control) !== JSON.stringify(baseline.control)) fail('cancelled');
            if (state.locator) {
                if (state.locator.catalog.originPackageId !== recovered.packageId) fail('already-exists');
                await unlock(newPassword, false, baseline.control);
                const s = session(); await guard(s); const snapshot = await verifiedRead(s); await guard(s);
                if (snapshot.catalog.originPackageId !== recovered.packageId) fail('already-exists');
                return { alreadyRestored: true, revision: snapshot.catalog.revision, recoverySecret: null, needsRecoveryRenewal: true };
            }
            return { ...await create({ password: newPassword, generation: recovered.generation, documents: recovered.documents, originPackageId: recovered.packageId }, baseline.control), alreadyRestored: false };
        },
        async lock() {
            invalidate(); const control = await store.bumpEpoch(logicalScope); if (closed) fail('cancelled'); announce(control.epoch);
        },
        close() { invalidate(); closed = true; channel?.removeEventListener('message', listener); channel?.close(); store.close(); }
    });
}
