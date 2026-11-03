import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createVaultCrypto } from '../finance-vault-crypto.js';

test('custodied recovery rewrap: fresh key/context/salt/IV, authenticated round-trip and strict secret format', async () => {
    const reservations = new Set();
    const crypto = createVaultCrypto({ crypto: webcrypto, reserveIV: async ({ keyFingerprint, iv }) => { const id = `${keyFingerprint}:${iv}`; if (reservations.has(id)) return false; reservations.add(id); return true; } });
    const owner = { projectId: 'demo-write-custody', uid: 'synthetic-custody' }, base = { owner, vaultId: 'synthetic-vault', keyId: 'synthetic-key-A' }, next = { ...base, keyId: 'synthetic-key-B' };
    const a = await crypto.generateDataKey(base), b = await crypto.generateDataKey(next); let opened;
    try {
        const first = await crypto.protectWithRecovery(a), second = await crypto.protectWithKnownRecovery(b, first.recoverySecret);
        assert.notEqual(first.envelope.kdf.salt, second.kdf.salt); assert.notEqual(first.envelope.iv, second.iv); assert.equal(second.keyId, next.keyId);
        opened = await crypto.recoverDataKey(second, first.recoverySecret, { ...next, wrapRevision: 1 });
        const context = { ...next, documentId: 'estado:synthetic-custody', schemaVersion: 1, revision: 1, generation: 'legacy' }, bytes = new Uint8Array([1, 3, 5]);
        const envelope = await crypto.encryptDocument(b, bytes, context); assert.deepEqual(await crypto.decryptDocument(opened, envelope, context), bytes);
        await assert.rejects(crypto.recoverDataKey(first.envelope, first.recoverySecret, { ...next, wrapRevision: 1 }), { code: 'context-mismatch' });
        await assert.rejects(crypto.protectWithKnownRecovery(b, 'synthetic-invalid'), { code: 'invalid-secret' });
        assert.equal(reservations.size, 3);
    } finally { crypto.destroyKey(a); crypto.destroyKey(b); if (opened) crypto.destroyKey(opened); }
});
