import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createCipheriv, pbkdf2Sync, hkdfSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createVaultCrypto } from '../finance-vault-crypto.js';
import { cryptoCases, syntheticContext, syntheticDocumentContext, syntheticPassword, rejects } from './fixtures/vault-crypto-scenarios.mjs';

for (const scenario of cryptoCases(webcrypto)) test(`vault crypto: ${scenario.name}`, scenario.run);

const aad = e => Buffer.from(JSON.stringify([e.format, e.version, e.algorithm, e.keyId, e.owner.projectId, e.owner.uid, e.vaultId, e.documentId, e.schemaVersion, e.revision, e.generation]));
const keyAAD = e => Buffer.from(JSON.stringify([e.format, e.version, e.slot, e.algorithm, e.keyId, e.owner.projectId, e.owner.uid, e.vaultId, e.wrapRevision, e.kdf.name, e.kdf.hash, e.kdf.iterations ?? null, e.kdf.salt, e.kdf.info ?? null]));
function encryptReference(key, envelope, bytes, associated) {
    const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'), { authTagLength: 16 });
    cipher.setAAD(associated);
    return Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]).toString('base64url');
}

test('vault crypto: actual module ciphertext/AAD/key wrappers match independent Node crypto', async () => {
    // Test-only deterministic RNG. Production defaults exclusively to native Crypto.
    const deterministic = { subtle: webcrypto.subtle, getRandomValues: bytes => bytes.fill(bytes.length === 32 ? 9 : 10) };
    const api = createVaultCrypto({ crypto: deterministic }), raw = Buffer.alloc(32, 9);
    const key = await api.generateDataKey(syntheticContext()), payload = Buffer.from('synthetic-exact-bytes');
    const doc = await api.encryptDocument(key, payload, syntheticDocumentContext());
    assert.equal(doc.ciphertext, encryptReference(raw, doc, payload, aad(doc)));
    // Separate instances avoid deliberately repeated test IVs in the reservation set.
    const wrapper = createVaultCrypto({ crypto: deterministic });
    const wrappingKey = await wrapper.generateDataKey(syntheticContext());
    const password = await wrapper.protectWithPassword(wrappingKey, syntheticPassword);
    const kek = pbkdf2Sync(syntheticPassword, Buffer.from(password.kdf.salt, 'base64url'), 600000, 32, 'sha256');
    assert.equal(password.wrappedKey, encryptReference(kek, password, raw, keyAAD(password)));
    const recoveryApi = createVaultCrypto({ crypto: deterministic });
    const recoveryKey = await recoveryApi.generateDataKey(syntheticContext());
    const recovery = await recoveryApi.protectWithRecovery(recoveryKey);
    const recoveryKek = Buffer.from(hkdfSync('sha256', Buffer.alloc(32, 9), Buffer.from(recovery.envelope.kdf.salt, 'base64url'), 'cf-vault-recovery/v1', 32));
    assert.equal(recovery.envelope.wrappedKey, encryptReference(recoveryKek, recovery.envelope, raw, keyAAD(recovery.envelope)));
});

test('vault crypto: repeated RNG IVs fail closed instead of reusing a nonce', async () => {
    const api = createVaultCrypto({ crypto: { subtle: webcrypto.subtle, getRandomValues: bytes => bytes.fill(1) } });
    const key = await api.generateDataKey(syntheticContext());
    await api.encryptDocument(key, new Uint8Array(), syntheticDocumentContext());
    await rejects(() => api.encryptDocument(key, new Uint8Array(), syntheticDocumentContext()), 'nonce-unavailable');
});

test('vault crypto: destroying a handle while encryption is pending suppresses delivery', async () => {
    let release;
    const pendingGate = new Promise(resolve => { release = resolve; });
    const crypto = { getRandomValues: bytes => webcrypto.getRandomValues(bytes), subtle: {
        importKey: (...args) => webcrypto.subtle.importKey(...args),
        encrypt: async (...args) => { await pendingGate; return webcrypto.subtle.encrypt(...args); }
    } };
    const api = createVaultCrypto({ crypto }), key = await api.generateDataKey(syntheticContext());
    const result = api.encryptDocument(key, new Uint8Array(), syntheticDocumentContext());
    api.destroyKey(key); release();
    await rejects(() => result, 'invalid-key');
});

test('vault crypto: invalid parameters are rejected before costly derivation', async () => {
    let calls = 0;
    const api = createVaultCrypto({ crypto: { getRandomValues: bytes => webcrypto.getRandomValues(bytes),
        subtle: { deriveKey() { calls++; throw new Error('must never execute'); } } } });
    const { keyFixture } = await import('./fixtures/vault-contract.mjs');
    const envelope = keyFixture(); envelope.kdf.iterations = 999999999;
    await rejects(() => api.unlockWithPassword(envelope, syntheticPassword, { ...syntheticContext(), wrapRevision: 1 }), 'invalid-envelope');
    assert.equal(calls, 0);
});

test('vault crypto: underlying provider errors never escape through cause/messages', async () => {
    const secret = 'synthetic-provider-sensitive-message';
    const api = createVaultCrypto({ crypto: { subtle: webcrypto.subtle, getRandomValues() { throw new Error(secret); } } });
    const error = await rejects(() => api.generateDataKey(syntheticContext()), 'crypto-failed');
    assert.ok(!error.stack.includes(secret));
    assert.throws(() => createVaultCrypto({ crypto: null }), { code: 'crypto-unavailable' });
});

test('vault crypto: no storage, Firebase, application imports or logging', async () => {
    const source = await readFile(new URL('../finance-vault-crypto.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /^\s*import\s|\bconsole\.|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bfetch\s*\(/m);
    for (const name of ['app.js', 'sw.js', 'firebase-sync-entry.js']) {
        assert.doesNotMatch(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'), /finance-vault-crypto/);
    }
});

test('vault crypto: full synthetic preservation graph survives real encryption without mutation', async () => {
    const { preservationFixture } = await import('./fixtures/vault-contract.mjs');
    const source = preservationFixture(), snapshot = structuredClone(source);
    const api = createVaultCrypto({ crypto: webcrypto }), key = await api.generateDataKey(syntheticContext());
    const bytes = new TextEncoder().encode(JSON.stringify(source));
    const envelope = await api.encryptDocument(key, bytes, syntheticDocumentContext());
    const restored = JSON.parse(new TextDecoder().decode(await api.decryptDocument(key, envelope, syntheticDocumentContext())));
    assert.deepEqual(restored, source); assert.deepEqual(source, snapshot);
    assert.ok(!JSON.stringify(envelope).includes('synthetic-pending'));
    assert.ok(!JSON.stringify(envelope).includes('1234.56'));
    api.destroyKey(key);
});

test('vault crypto: destruction during decrypt prevents returning cleartext', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const crypto = { getRandomValues: bytes => webcrypto.getRandomValues(bytes), subtle: {
        importKey: (...args) => webcrypto.subtle.importKey(...args),
        encrypt: (...args) => webcrypto.subtle.encrypt(...args),
        decrypt: async (...args) => { await gate; return webcrypto.subtle.decrypt(...args); }
    } };
    const api = createVaultCrypto({ crypto }), key = await api.generateDataKey(syntheticContext());
    const envelope = await api.encryptDocument(key, new Uint8Array([1, 2, 3]), syntheticDocumentContext());
    const result = api.decryptDocument(key, envelope, syntheticDocumentContext());
    api.destroyKey(key); release(); await rejects(() => result, 'invalid-key');
});

test('vault crypto: accessors and unexpected metadata never execute during validation', async () => {
    let calls = 0;
    const context = syntheticContext();
    Object.defineProperty(context, 'keyId', { enumerable: true, get() { calls++; return 'forbidden'; } });
    const api = createVaultCrypto({ crypto: webcrypto });
    await rejects(() => api.generateDataKey(context), 'invalid-envelope');
    assert.equal(calls, 0);
});

test('vault crypto: durable callback keeps the v1 wrappers compatible with memory-only readers', async () => {
    const reservations = new Set();
    const durable = createVaultCrypto({ crypto: webcrypto, reserveIV: async r => {
        const id = `${r.keyFingerprint}:${r.iv}`;
        if (reservations.has(id)) return false; reservations.add(id); return true;
    } });
    const key = await durable.generateDataKey(syntheticContext());
    const envelope = await durable.protectWithPassword(key, syntheticPassword);
    const recovery = await durable.protectWithRecovery(key);
    const payload = new Uint8Array([0, 255, 17]);
    const document = await durable.encryptDocument(key, payload, syntheticDocumentContext());
    const previousReader = createVaultCrypto({ crypto: webcrypto }), expected = { ...syntheticContext(), wrapRevision: 1 };
    const opened = await previousReader.unlockWithPassword(envelope, syntheticPassword, expected);
    const recovered = await previousReader.recoverDataKey(recovery.envelope, recovery.recoverySecret, expected);
    assert.deepEqual(await previousReader.decryptDocument(opened, document, syntheticDocumentContext()), payload);
    assert.deepEqual(await previousReader.decryptDocument(recovered, document, syntheticDocumentContext()), payload);
    assert.equal(reservations.size, 3);
    previousReader.destroyKey(opened); previousReader.destroyKey(recovered); durable.destroyKey(key);
});

test('vault crypto: durable reserve failures fail closed with constant safe messages', async () => {
    for (const outcome of [false, undefined, 'provider-error']) {
        let encrypts = 0;
        const provider = { getRandomValues: bytes => webcrypto.getRandomValues(bytes), subtle: new Proxy(webcrypto.subtle, {
            get(target, name) { if (name === 'encrypt') return (...args) => { encrypts++; return target.encrypt(...args); }; const fn = target[name]; return typeof fn === 'function' ? fn.bind(target) : fn; }
        }) };
        const api = createVaultCrypto({ crypto: provider, reserveIV: async () => {
            if (outcome === 'provider-error') throw new Error('synthetic-secret-in-provider'); return outcome;
        } });
        const key = await api.generateDataKey(syntheticContext());
        const error = await rejects(() => api.encryptDocument(key, new Uint8Array(), syntheticDocumentContext()), outcome === false ? 'nonce-unavailable' : 'reservation-failed');
        assert.equal(encrypts, 0); assert.ok(!error.stack.includes('synthetic-secret-in-provider')); api.destroyKey(key);
    }
});
