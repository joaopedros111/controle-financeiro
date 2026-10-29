import { createVaultBackend } from './finance-vault-backend.js';
import { validateCatalog, unlockRecoverySlots } from './finance-vault-catalog.js';
import { MAX_PACKAGE_BYTES, MAX_SNAPSHOT_BYTES, copyDocumentMap } from './finance-vault-limits.js';
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
export class VaultRecoveryError extends Error {
    constructor() { super('Pacote de recuperação incompleto, incompatível ou adulterado.'); this.name = 'VaultRecoveryError'; this.code = 'invalid-package'; }
}
export async function vaultDigest(bytes, crypto = globalThis.crypto) {
    try { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join(''); }
    catch { throw new VaultRecoveryError(); }
}
export async function exportRecoveryPackage(backend, crypto = globalThis.crypto) {
    const snapshot = await backend.exportSnapshot();
    if (encoder.encode(JSON.stringify(snapshot)).length > MAX_SNAPSHOT_BYTES) throw new VaultRecoveryError();
    const digest = await vaultDigest(encoder.encode(JSON.stringify(snapshot)), crypto);
    const seal = await backend.sealArtifact('@recovery-package', encoder.encode(JSON.stringify({ format: 'cf-vault-package-seal', version: 1, digest })));
    if (seal.revision !== snapshot.revision || seal.generation !== snapshot.generation) throw new VaultRecoveryError();
    // Financial payloads remain encrypted. Envelopes contain only wrapped DEKs.
    const bytes = encoder.encode(JSON.stringify({ format: 'cf-vault-recovery', version: 1, snapshot, seal }));
    if (bytes.length > MAX_PACKAGE_BYTES) throw new VaultRecoveryError(); return bytes;
}
export async function validateRecoveryPackage(bytes, { expected, recoverySecret, codec, crypto = globalThis.crypto }) {
    let backend;
    try {
        if (!(bytes instanceof Uint8Array) || bytes.length > MAX_PACKAGE_BYTES) throw new VaultRecoveryError();
        const copy = new Uint8Array(bytes), text = decoder.decode(copy), pack = JSON.parse(text);
        if (JSON.stringify(pack) !== text || Object.keys(pack).sort().join() !== 'format,seal,snapshot,version'
            || pack.format !== 'cf-vault-recovery' || pack.version !== 1 || pack.snapshot?.version !== 2) throw new VaultRecoveryError();
        const cat = validateCatalog(pack.snapshot.catalog);
        if (encoder.encode(JSON.stringify(pack.snapshot)).length > MAX_SNAPSHOT_BYTES) throw new VaultRecoveryError();
        if (cat.owner.uid !== expected.owner.uid || cat.owner.projectId !== expected.owner.projectId || cat.vaultId !== expected.vaultId) throw new VaultRecoveryError();
        const context = { owner: cat.owner, vaultId: cat.vaultId, keyId: cat.keyId };
        // Imported source keys are decrypt-only at this boundary: never continue
        // encrypting an old DEK without its authoritative durable IV ledger.
        const store = { load: async () => structuredClone(pack.snapshot), reserveIV() { throw new VaultRecoveryError(); }, close() {} };
        backend = createVaultBackend({ store, context, codec, validateCatalog, crypto });
        await unlockRecoverySlots(backend, cat, recoverySecret);
        const sealBytes = await backend.openArtifact('@recovery-package', pack.seal);
        try {
            const seal = JSON.parse(decoder.decode(sealBytes));
            if (Object.keys(seal).sort().join() !== 'digest,format,version' || seal.format !== 'cf-vault-package-seal' || seal.version !== 1
                || seal.digest !== await vaultDigest(encoder.encode(JSON.stringify(pack.snapshot)), crypto)) throw new VaultRecoveryError();
        } finally { sealBytes.fill(0); }
        const read = await backend.read();
        copyDocumentMap(read.documents, codec.encode, codec.decode);
        return { ...read, packageId: await vaultDigest(copy, crypto) };
    } catch { throw new VaultRecoveryError(); }
    finally { backend?.lock(); }
}
