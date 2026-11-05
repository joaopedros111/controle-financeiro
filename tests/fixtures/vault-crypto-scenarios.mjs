// The same real-Web-Crypto cases run in Node and fresh local browser contexts.
import { createVaultCrypto } from '../../finance-vault-crypto.js';

export const syntheticContext = () => ({ owner: { projectId: 'demo-cf-vault', uid: 'synthetic-A' }, vaultId: 'vault-synthetic-a', keyId: 'dek-synthetic-a-1' });
export const syntheticDocumentContext = () => ({ ...syntheticContext(), documentId: 'estado:synthetic-A', schemaVersion: 1, revision: 7, generation: 'generation-a' });
export const syntheticPassword = 'synthetic-only passphrase A';
const nextPassword = 'synthetic-only passphrase B';
const utf8 = new TextEncoder();
const plain = () => utf8.encode(JSON.stringify({ synthetic: true, amount: 1234.56, pending: ['synthetic-op'], conflicts: ['synthetic-conflict'] }));
const equal = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Synthetic assertion failed'); };
const ok = value => { if (!value) throw new Error('Synthetic assertion failed'); };
const bytesEqual = (a, b) => equal(Array.from(a), Array.from(b));
export const fromHex = value => Uint8Array.from(value.match(/../g) || [], byte => parseInt(byte, 16));
export const hex = value => Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
export function flip(value, last = false) {
    const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    bytes[last ? bytes.length - 1 : 0] ^= 1;
    return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export async function rejects(operation, code) {
    let error;
    try { await operation(); } catch (failure) { error = failure; }
    ok(error); equal(error.code, code);
    ok(!error.cause); equal(error.name, 'VaultCryptoError');
    return error;
}

export function cryptoCases(crypto) {
    const api = createVaultCrypto({ crypto });
    let setup;
    const sample = () => setup ||= (async () => {
        const key = await api.generateDataKey(syntheticContext());
        const password = await api.protectWithPassword(key, syntheticPassword);
        const recovery = await api.protectWithRecovery(key);
        const document = await api.encryptDocument(key, plain(), syntheticDocumentContext());
        return { key, password, recovery, document };
    })();
    const expected = () => ({ ...syntheticContext(), wrapRevision: 1 });
    const cases = [];
    const add = (name, run) => cases.push({ name, run });

    add('real AES-256-GCM document and password round-trip', async () => {
        const s = await sample(), before = JSON.stringify(s.password);
        const key = await api.unlockWithPassword(s.password, syntheticPassword, expected());
        bytesEqual(await api.decryptDocument(key, s.document, syntheticDocumentContext()), plain());
        equal(JSON.stringify(s.password), before);
        ok(Object.isFrozen(key)); equal(Object.keys(key), []); api.destroyKey(key);
    });
    add('wrong password is ambiguous and never leaks input', async () => {
        const s = await sample(), wrong = 'synthetic-wrong-password-secret';
        const error = await rejects(() => api.unlockWithPassword(s.password, wrong, expected()), 'unlock-failed');
        ok(!String(error.stack).includes(wrong)); ok(!JSON.stringify(error).includes(syntheticPassword));
    });
    for (const [name, mutate] of [
        ['ciphertext', v => { v.ciphertext = flip(v.ciphertext); }],
        ['tag', v => { v.ciphertext = flip(v.ciphertext, true); }],
        ['IV', v => { v.iv = flip(v.iv); }]
    ]) add(`actual ${name} tampering fails GCM authentication`, async () => {
        const s = await sample(), bad = structuredClone(s.document); mutate(bad);
        await rejects(() => api.decryptDocument(s.key, bad, syntheticDocumentContext()), 'integrity-failed');
        bytesEqual(await api.decryptDocument(s.key, s.document, syntheticDocumentContext()), plain());
    });
    for (const field of ['documentId', 'revision', 'generation']) add(`AAD ${field} mutation with matching claimed context still fails authentication`, async () => {
        const s = await sample(), bad = structuredClone(s.document), context = syntheticDocumentContext();
        bad[field] = context[field] = field === 'revision' ? 8 : `${context[field]}-other`;
        await rejects(() => api.decryptDocument(s.key, bad, context), 'integrity-failed');
    });
    for (const field of ['uid', 'projectId', 'vaultId', 'keyId', 'documentId', 'revision', 'generation']) add(`expected ${field} mismatch rejects substitution`, async () => {
        const s = await sample(), context = syntheticDocumentContext();
        if (['uid', 'projectId'].includes(field)) context.owner[field] += '-other';
        else context[field] = field === 'revision' ? 8 : `${context[field]}-other`;
        await rejects(() => api.decryptDocument(s.key, s.document, context), 'context-mismatch');
    });
    add('forged account plus matching metadata cannot cross key handles', async () => {
        const s = await sample(), other = syntheticContext(); other.owner.uid = 'synthetic-B';
        const keyB = await api.generateDataKey(other);
        const bad = structuredClone(s.document); bad.owner.uid = 'synthetic-B';
        const context = syntheticDocumentContext(); context.owner.uid = 'synthetic-B';
        await rejects(() => api.decryptDocument(keyB, bad, context), 'integrity-failed');
        api.destroyKey(keyB);
    });
    add('successive/concurrent encryptions use different 96-bit IVs', async () => {
        const s = await sample();
        const values = await Promise.all(Array.from({ length: 32 }, () => api.encryptDocument(s.key, plain(), syntheticDocumentContext())));
        equal(new Set(values.map(v => v.iv)).size, 32);
        for (const value of values) equal(atob(value.iv.replaceAll('-', '+').replaceAll('_', '/')).length, 12);
    });
    add('independent recovery opens the same DEK and permits new password protection', async () => {
        const s = await sample();
        const key = await api.recoverDataKey(s.recovery.envelope, s.recovery.recoverySecret, expected());
        bytesEqual(await api.decryptDocument(key, s.document, syntheticDocumentContext()), plain());
        const replacement = await api.protectWithPassword(key, nextPassword, 2);
        const reopened = await api.unlockWithPassword(replacement, nextPassword, { ...expected(), wrapRevision: 2 });
        bytesEqual(await api.decryptDocument(reopened, s.document, syntheticDocumentContext()), plain());
        api.destroyKey(key); api.destroyKey(reopened);
    });
    add('failed recovery does not mutate envelopes or documents and exposes no secret', async () => {
        const s = await sample(), before = JSON.stringify(s.recovery), beforeDoc = JSON.stringify(s.document);
        const wrong = flip(s.recovery.recoverySecret);
        const error = await rejects(() => api.recoverDataKey(s.recovery.envelope, wrong, expected()), 'recovery-failed');
        equal(JSON.stringify(s.recovery), before); equal(JSON.stringify(s.document), beforeDoc);
        ok(!String(error.stack).includes(wrong));
        const bad = structuredClone(s.recovery.envelope); bad.wrappedKey = flip(bad.wrappedKey);
        await rejects(() => api.recoverDataKey(bad, s.recovery.recoverySecret, expected()), 'recovery-failed');
    });
    add('rewrap preserves DEK/documents and old password fails on replacement only', async () => {
        const s = await sample(), beforeDoc = JSON.stringify(s.document), beforeKey = JSON.stringify(s.password);
        const replacement = await api.changePassword(s.password, syntheticPassword, nextPassword, expected());
        equal(replacement.wrapRevision, 2); ok(replacement.iv !== s.password.iv); ok(replacement.kdf.salt !== s.password.kdf.salt);
        await rejects(() => api.unlockWithPassword(replacement, syntheticPassword, { ...expected(), wrapRevision: 2 }), 'unlock-failed');
        const key = await api.unlockWithPassword(replacement, nextPassword, { ...expected(), wrapRevision: 2 });
        bytesEqual(await api.decryptDocument(key, s.document, syntheticDocumentContext()), plain());
        equal(JSON.stringify(s.document), beforeDoc); equal(JSON.stringify(s.password), beforeKey);
        const old = await api.unlockWithPassword(s.password, syntheticPassword, expected());
        bytesEqual(await api.decryptDocument(old, s.document, syntheticDocumentContext()), plain());
        api.destroyKey(key); api.destroyKey(old);
    });
    add('rewrap with wrong old password fails without changing the original', async () => {
        const s = await sample(), before = JSON.stringify(s.password);
        await rejects(() => api.changePassword(s.password, nextPassword, nextPassword, expected()), 'unlock-failed');
        equal(JSON.stringify(s.password), before);
    });
    for (const [name, mutate] of [
        ['version', v => { v.version = 2; }], ['algorithm', v => { v.algorithm = 'AES-CBC'; }],
        ['tag length', v => { v.tagLength = 32; }], ['short IV', v => { v.iv = 'AA'; }],
        ['noncanonical base64', v => { v.iv += '='; }], ['ciphertext type', v => { v.ciphertext = []; }],
        ['unsafe revision', v => { v.revision = Number.MAX_SAFE_INTEGER + 1; }],
        ['negative revision', v => { v.revision = -1; }], ['Unicode', v => { v.documentId = '\ud800'; }],
        ['schema version', v => { v.schemaVersion = 2; }], ['owner extras', v => { v.owner.secret = 'forbidden'; }]
    ]) add(`strict malformed envelope: ${name}`, async () => {
        const s = await sample(), bad = structuredClone(s.document); mutate(bad);
        await rejects(() => api.decryptDocument(s.key, bad, syntheticDocumentContext()), 'invalid-envelope');
    });
    for (const [name, mutate] of [
        ['weak iterations', v => { v.kdf.iterations = 1; }], ['excessive iterations', v => { v.kdf.iterations = 2000001; }],
        ['fraction iterations', v => { v.kdf.iterations = 600000.5; }], ['hash', v => { v.kdf.hash = 'SHA-1'; }],
        ['salt', v => { v.kdf.salt = 'AA'; }], ['slot', v => { v.slot = 'recovery'; }],
        ['key size', v => { v.wrappedKey = 'AA'; }], ['KDF extras', v => { v.kdf.secret = 'forbidden'; }]
    ]) add(`reject key parameters before KDF: ${name}`, async () => {
        const s = await sample(), bad = structuredClone(s.password); mutate(bad);
        await rejects(() => api.unlockWithPassword(bad, syntheticPassword, expected()), 'invalid-envelope');
    });
    add('tampered password envelope and KDF salt fail actual authentication', async () => {
        const s = await sample();
        for (const field of ['wrappedKey', 'iv']) {
            const bad = structuredClone(s.password); bad[field] = flip(bad[field]);
            await rejects(() => api.unlockWithPassword(bad, syntheticPassword, expected()), 'unlock-failed');
        }
        const bad = structuredClone(s.password); bad.kdf.salt = flip(bad.kdf.salt);
        await rejects(() => api.unlockWithPassword(bad, syntheticPassword, expected()), 'unlock-failed');
    });
    add('key AAD binds owner/context and wrap revision even with matching claims', async () => {
        const s = await sample();
        for (const field of ['uid', 'projectId', 'keyId', 'vaultId', 'wrapRevision']) {
            const bad = structuredClone(s.password), context = expected();
            if (['uid', 'projectId'].includes(field)) bad.owner[field] = context.owner[field] += '-other';
            else bad[field] = context[field] = field === 'wrapRevision' ? 2 : `${context[field]}-other`;
            await rejects(() => api.unlockWithPassword(bad, syntheticPassword, context), 'unlock-failed');
        }
    });
    add('password Unicode/spaces are not silently normalized or trimmed', async () => {
        const s = await sample(), password = '  frase sinte\u0301tica longa 🔐  ';
        const env = await api.protectWithPassword(s.key, password);
        const key = await api.unlockWithPassword(env, password, expected());
        api.destroyKey(key);
        await rejects(() => api.unlockWithPassword(env, password.trim(), expected()), 'unlock-failed');
        await rejects(() => api.unlockWithPassword(env, password.normalize('NFC'), expected()), 'unlock-failed');
        for (const invalid of ['short', '\ud800'.repeat(20), 'a'.repeat(4097), '🔐'.repeat(1100)]) {
            await rejects(() => api.protectWithPassword(s.key, invalid), 'invalid-secret');
        }
    });
    add('destroyed handles and arbitrary objects cannot decrypt', async () => {
        const s = await sample(), key = await api.generateDataKey(syntheticContext());
        api.destroyKey(key);
        await rejects(() => api.decryptDocument(key, s.document, syntheticDocumentContext()), 'invalid-key');
        await rejects(() => api.decryptDocument({}, s.document, syntheticDocumentContext()), 'invalid-key');
    });
    add('input snapshots resist mutation while Web Crypto is pending', async () => {
        const s = await sample(), envelope = structuredClone(s.password), context = expected();
        const pending = api.unlockWithPassword(envelope, syntheticPassword, context);
        envelope.owner.uid = 'synthetic-B'; envelope.wrappedKey = 'AA'; context.owner.uid = 'synthetic-B';
        const key = await pending;
        bytesEqual(await api.decryptDocument(key, s.document, syntheticDocumentContext()), plain()); api.destroyKey(key);
        const input = plain(), docContext = syntheticDocumentContext();
        const encrypt = api.encryptDocument(s.key, input, docContext);
        input.fill(0); docContext.owner.uid = 'synthetic-B';
        bytesEqual(await api.decryptDocument(s.key, await encrypt, syntheticDocumentContext()), plain());
    });
    add('opaque bytes preserve exact payload and empty document', async () => {
        const s = await sample();
        for (const bytes of [new Uint8Array(), Uint8Array.from([0, 255, 128, 13, 10])]) {
            const env = await api.encryptDocument(s.key, bytes, syntheticDocumentContext());
            bytesEqual(await api.decryptDocument(s.key, env, syntheticDocumentContext()), bytes);
        }
    });
    add('NIST GCM AES-256 known answer validates the Web Crypto provider', async () => {
        // McGrew/Viega GCM specification, test case 14. No AAD in this primitive vector.
        const key = await crypto.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt', 'decrypt']);
        const params = { name: 'AES-GCM', iv: new Uint8Array(12), tagLength: 128 };
        const encrypted = await crypto.subtle.encrypt(params, key, new Uint8Array(16));
        equal(hex(encrypted), 'cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919');
        bytesEqual(new Uint8Array(await crypto.subtle.decrypt(params, key, encrypted)), new Uint8Array(16));
    });
    add('RFC 5869 A.1 HKDF-SHA-256 known answer validates recovery primitive', async () => {
        const key = await crypto.subtle.importKey('raw', new Uint8Array(22).fill(11), 'HKDF', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256',
            salt: fromHex('000102030405060708090a0b0c'), info: fromHex('f0f1f2f3f4f5f6f7f8f9') }, key, 336);
        equal(hex(bits), '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
    });
    add('RFC 7914 section 11 PBKDF2-HMAC-SHA-256 known answer validates password primitive', async () => {
        const key = await crypto.subtle.importKey('raw', utf8.encode('passwd'), 'PBKDF2', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: utf8.encode('salt'), iterations: 1 }, key, 512);
        equal(hex(bits), '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783');
    });
    return cases;
}
