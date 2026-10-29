import { checkKeyEnvelopeFormat } from './finance-vault-crypto.js';
export class VaultCatalogError extends Error {
    constructor(code = 'corruption') { super(code === 'context-mismatch' ? 'Proprietário ou cofre incompatível.' : 'Catálogo incompatível ou sem integridade confirmada.'); this.name = 'VaultCatalogError'; this.code = code; }
}
const fail = () => { throw new VaultCatalogError(); };
function exact(value, keys) {
    if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length
        || Reflect.ownKeys(value).some(k => !keys.includes(k) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), 'value'))) fail();
}
export function validateCatalog(c, { context, generation = c?.generation, snapshotRevision = c?.snapshotRevision } = {}) {
    try {
        exact(c, ['format', 'version', 'owner', 'vaultId', 'keyId', 'generation', 'revision', 'snapshotRevision', 'codec', 'password', 'recovery', 'originPackageId', ...(c.version === 2 ? ['recoveryPrevious', 'recoveryPending'] : [])]);
        exact(c.owner, ['projectId', 'uid']);
        if (c.format !== 'cf-vault-catalog' || ![1, 2].includes(c.version) || c.codec !== 'cf-financial-codec-v1') fail();
        for (const v of [c.owner.projectId, c.owner.uid, c.vaultId, c.keyId, c.generation]) if (typeof v !== 'string' || !v.length || v.length > 128 || !v.isWellFormed()) fail();
        if (![c.revision, c.snapshotRevision].every(v => Number.isSafeInteger(v) && v > 0) || c.snapshotRevision !== snapshotRevision || c.generation !== generation) fail();
        if (c.originPackageId !== null && !/^[a-f0-9]{64}$/.test(c.originPackageId)) fail();
        const owned = context || { owner: c.owner, vaultId: c.vaultId, keyId: c.keyId };
        if (c.owner.projectId !== owned.owner.projectId || c.owner.uid !== owned.owner.uid || c.vaultId !== owned.vaultId || c.keyId !== owned.keyId) throw new VaultCatalogError('context-mismatch');
        checkKeyEnvelopeFormat(c.password, { ...owned, wrapRevision: c.password?.wrapRevision }, 'password');
        checkKeyEnvelopeFormat(c.recovery, { ...owned, wrapRevision: c.recovery?.wrapRevision }, 'recovery');
        if (c.version === 2) {
            if (!Array.isArray(c.recoveryPrevious) || c.recoveryPrevious.length > 8) fail();
            if (c.recoveryPending !== null) {
                exact(c.recoveryPending, ['id', 'envelope']);
                if (typeof c.recoveryPending.id !== 'string' || !/^[a-f0-9-]{36}$/.test(c.recoveryPending.id)) fail();
            }
            const slots = [c.recovery, ...c.recoveryPrevious, ...(c.recoveryPending ? [c.recoveryPending.envelope] : [])];
            if (new Set(slots.map(e => e.wrappedKey)).size !== slots.length) fail();
            for (const envelope of slots) checkKeyEnvelopeFormat(envelope, { ...owned, wrapRevision: envelope?.wrapRevision }, 'recovery');
        }
        return c;
    } catch (error) { if (error instanceof VaultCatalogError) throw error; fail(); }
}
export async function unlockRecoverySlots(backend, catalog, secret) {
    for (const envelope of [catalog.recovery, ...(catalog.recoveryPrevious || [])]) {
        try { await backend.unlockWithRecovery(envelope, secret, envelope.wrapRevision); return; }
        catch (error) { if (error.code !== 'recovery-failed') throw error; }
    }
    // Preserve the cryptographic error contract, without exposing credentials.
    await backend.unlockWithRecovery(catalog.recovery, secret, catalog.recovery.wrapRevision);
}
export function validateLocator(locator, expected) {
    try {
        exact(locator, ['version', 'context', 'catalog']); exact(locator.context, ['owner', 'vaultId', 'keyId']);
        if (locator.version !== 1) fail();
        validateCatalog(locator.catalog, { context: locator.context });
        if (locator.context.owner.projectId !== expected.owner.projectId || locator.context.owner.uid !== expected.owner.uid || locator.context.vaultId !== expected.vaultId) throw new VaultCatalogError('context-mismatch');
        return locator;
    } catch (error) { if (error instanceof VaultCatalogError) throw error; fail(); }
}
