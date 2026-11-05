// Isolated Web Crypto primitives. No application, storage, UI or Firebase imports.
const DOC = ['format', 'version', 'algorithm', 'keyId', 'owner', 'vaultId', 'documentId', 'schemaVersion', 'revision', 'generation', 'iv', 'ciphertext'];
const KEY = ['format', 'version', 'slot', 'algorithm', 'keyId', 'owner', 'vaultId', 'wrapRevision', 'kdf', 'iv', 'wrappedKey'];
const BASE = ['owner', 'vaultId', 'keyId'];
const CONTEXT = [...BASE, 'documentId', 'schemaVersion', 'revision', 'generation'];
const encoder = new TextEncoder();
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_RESERVATIONS = 1_000_000;
const messages = Object.freeze({
    'invalid-envelope': 'Envelope ou parâmetros inválidos.',
    'context-mismatch': 'Contexto do cofre não corresponde ao esperado.',
    'invalid-secret': 'Segredo fora do formato permitido.',
    'unlock-failed': 'Senha incorreta ou envelope de chave danificado.',
    'recovery-failed': 'Segredo de recuperação incorreto ou envelope danificado.',
    'integrity-failed': 'Falha de integridade do documento.',
    'invalid-key': 'Chave indisponível ou encerrada.',
    'nonce-unavailable': 'Não foi possível reservar um IV novo.',
    'reservation-failed': 'Reserva durável de IV não concluída.',
    'quota-exceeded': 'Espaço insuficiente para a reserva durável.',
    'rotation-required': 'Limite de operações atingido; rotação necessária.',
    'crypto-unavailable': 'Web Crypto indisponível em contexto seguro.',
    'crypto-failed': 'Operação criptográfica não concluída.'
});

export class VaultCryptoError extends Error {
    constructor(code) { super(messages[code] || messages['crypto-failed']); this.name = 'VaultCryptoError'; this.code = Object.hasOwn(messages, code) ? code : 'crypto-failed'; }
}
const fail = code => { throw new VaultCryptoError(code); };
function record(value, fields) {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid-envelope');
    const keys = Reflect.ownKeys(value);
    if (keys.length !== fields.length || keys.some(k => !fields.includes(k))) fail('invalid-envelope');
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid-envelope');
    }
}
function text(value, limit = 128) {
    if (typeof value !== 'string' || !value.length || value.length > limit || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail('invalid-envelope');
}
function revision(value) { if (!Number.isSafeInteger(value) || value < 0) fail('invalid-envelope'); }
function base(value) {
    record(value.owner, ['projectId', 'uid']);
    text(value.owner.projectId); text(value.owner.uid); text(value.vaultId); text(value.keyId);
}
function docContext(value) {
    record(value, CONTEXT); base(value); text(value.documentId, 512); text(value.generation);
    if (value.schemaVersion !== 1) fail('invalid-envelope'); revision(value.revision);
}
function keyContext(value) { record(value, [...BASE, 'wrapRevision']); base(value); revision(value.wrapRevision); }
function compare(value, expected, fields) {
    for (const field of ['projectId', 'uid']) if (value.owner[field] !== expected.owner[field]) fail('context-mismatch');
    for (const field of fields) if (value[field] !== expected[field]) fail('context-mismatch');
}
function encode(bytes) {
    let binary = '';
    // Avoid exceeding argument limits for large documents.
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function decode(value, min, max = min) {
    if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) fail('invalid-envelope');
    let bytes;
    try { bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
    catch { fail('invalid-envelope'); }
    if (bytes.length < min || bytes.length > max || encode(bytes) !== value) fail('invalid-envelope');
    return bytes;
}
function header(value, format) {
    if (value.format !== format || value.version !== 1 || value.algorithm !== 'AES-256-GCM') fail('invalid-envelope');
    base(value); decode(value.iv, 12);
}
function validateDocument(value) {
    record(value, DOC); header(value, 'cf-vault-document');
    text(value.documentId, 512); text(value.generation); revision(value.revision);
    if (value.schemaVersion !== 1) fail('invalid-envelope');
    decode(value.ciphertext, 16, MAX_BYTES + 16);
}
function validateKey(value, slot) {
    record(value, KEY); header(value, 'cf-vault-key'); revision(value.wrapRevision);
    if (value.slot !== slot) fail('invalid-envelope');
    const kdf = value.kdf;
    if (slot === 'password') {
        record(kdf, ['name', 'hash', 'iterations', 'salt']);
        if (kdf.name !== 'PBKDF2' || !Number.isInteger(kdf.iterations) || kdf.iterations < 600000 || kdf.iterations > 2000000) fail('invalid-envelope');
    } else {
        record(kdf, ['name', 'hash', 'salt', 'info']);
        if (kdf.name !== 'HKDF' || kdf.info !== 'cf-vault-recovery/v1') fail('invalid-envelope');
    }
    if (kdf.hash !== 'SHA-256') fail('invalid-envelope');
    decode(kdf.salt, 16); decode(value.wrappedKey, 48);
}
// Structural/context validation only. Authentication still requires unwrapping.
export function checkKeyEnvelopeFormat(envelope, expected, slot) {
    validateKey(envelope, slot); keyContext(expected);
    compare(envelope, expected, ['keyId', 'vaultId', 'wrapRevision']); return true;
}
const documentAAD = v => encoder.encode(JSON.stringify([v.format, v.version, v.algorithm, v.keyId, v.owner.projectId, v.owner.uid, v.vaultId, v.documentId, v.schemaVersion, v.revision, v.generation]));
const keyAAD = v => encoder.encode(JSON.stringify([v.format, v.version, v.slot, v.algorithm, v.keyId, v.owner.projectId, v.owner.uid, v.vaultId, v.wrapRevision, v.kdf.name, v.kdf.hash, v.kdf.iterations ?? null, v.kdf.salt, v.kdf.info ?? null]));
const algorithm = (v, aad) => ({ name: 'AES-GCM', iv: decode(v.iv, 12), additionalData: aad(v), tagLength: 128 });
function passwordBytes(password) {
    if (typeof password !== 'string' || password.length > 4096) fail('invalid-secret');
    try { text(password, 4096); } catch { fail('invalid-secret'); }
    const bytes = encoder.encode(password);
    if ([...password].length < 15 || bytes.length > 4096) fail('invalid-secret');
    return bytes;
}

/** A factory owns opaque in-memory handles. Optional reserveIV must acknowledge
 * a DURABLE, globally serialized reservation before returning true. false means
 * collision; anything else fails closed. Without it, reservations are memory-only.
 * Inject a standards-compatible Crypto only in tests. Never inject weak RNG in use.
 */
export function createVaultCrypto({ crypto = globalThis.crypto, reserveIV } = {}) {
    if (!crypto?.subtle || typeof crypto.getRandomValues !== 'function' || globalThis.isSecureContext === false) fail('crypto-unavailable');
    if (reserveIV !== undefined && typeof reserveIV !== 'function') fail('invalid-envelope');
    const subtle = crypto.subtle, handles = new WeakMap(), nonces = new Map();
    const safe = operation => async (...args) => {
        try { return await operation(...args); }
        catch (error) { if (error instanceof VaultCryptoError) throw error; fail('crypto-failed'); }
    };
    const random = size => crypto.getRandomValues(new Uint8Array(size));
    function entry(handle) {
        const found = handle && handles.get(handle);
        if (!found) fail('invalid-key'); return found;
    }
    function live(handle, expected) { if (entry(handle) !== expected) fail('invalid-key'); }
    async function nonce(context, fingerprint) {
        if (reserveIV) {
            if (!fingerprint) fail('reservation-failed');
            for (let attempt = 0; attempt < 8; attempt++) {
                const iv = encode(random(12));
                let reserved;
                try { reserved = await reserveIV({ keyFingerprint: fingerprint, iv }); }
                catch (error) {
                    if (error?.code === 'quota-exceeded' || error?.name === 'QuotaExceededError') fail('quota-exceeded');
                    if (error?.code === 'rotation-required') fail('rotation-required');
                    fail('reservation-failed');
                }
                if (reserved === true) return iv;
                if (reserved !== false) fail('reservation-failed');
            }
            fail('nonce-unavailable');
        }
        const id = JSON.stringify([context.owner.projectId, context.owner.uid, context.vaultId, context.keyId]);
        let used = nonces.get(id);
        if (!used) { used = new Set(); nonces.set(id, used); }
        if (used.size >= MAX_RESERVATIONS) fail('rotation-required');
        for (let attempt = 0; attempt < 8; attempt++) {
            const iv = encode(random(12));
            if (!used.has(iv)) { used.add(iv); return iv; }
        }
        fail('nonce-unavailable');
    }
    async function importHandle(raw, context) {
        // Raw material is retained only as a private, exportable CryptoKey so it
        // can be rewrapped. Callers receive no CryptoKey or raw-key export API.
        const key = await subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
        const handle = Object.freeze(Object.create(null));
        const fingerprint = reserveIV ? encode(new Uint8Array(await subtle.digest('SHA-256', raw))) : null;
        handles.set(handle, { key, fingerprint, context: structuredClone(context) }); return handle;
    }
    async function derive(secret, kdf, slot) {
        let bytes;
        if (slot === 'password') bytes = passwordBytes(secret);
        else {
            try { bytes = decode(secret, 32); } catch { fail('invalid-secret'); }
        }
        try {
            const material = await subtle.importKey('raw', bytes, slot === 'password' ? 'PBKDF2' : 'HKDF', false, [reserveIV ? 'deriveBits' : 'deriveKey']);
            const params = { name: kdf.name, hash: kdf.hash, salt: decode(kdf.salt, 16),
                ...(slot === 'password' ? { iterations: kdf.iterations } : { info: encoder.encode(kdf.info) }) };
            if (!reserveIV) return { key: await subtle.deriveKey(params, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) };
            const raw = new Uint8Array(await subtle.deriveBits(params, material, 256));
            try {
                return { key: await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']),
                    fingerprint: encode(new Uint8Array(await subtle.digest('SHA-256', raw))) };
            } finally { raw.fill(0); }
        } finally { bytes.fill(0); }
    }
    async function wrap(handle, secret, slot, wrapRevision) {
        const e = entry(handle); revision(wrapRevision);
        const kdf = slot === 'password'
            ? { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: encode(random(16)) }
            : { name: 'HKDF', hash: 'SHA-256', salt: encode(random(16)), info: 'cf-vault-recovery/v1' };
        const value = { format: 'cf-vault-key', version: 1, slot, algorithm: 'AES-256-GCM',
            ...structuredClone(e.context), wrapRevision, kdf };
        const kek = await derive(secret, kdf, slot); live(handle, e);
        value.iv = await nonce(e.context, kek.fingerprint); live(handle, e);
        let raw;
        try {
            raw = new Uint8Array(await subtle.exportKey('raw', e.key)); live(handle, e);
            value.wrappedKey = encode(new Uint8Array(await subtle.encrypt(algorithm(value, keyAAD), kek.key, raw)));
            live(handle, e); return value;
        } finally { raw?.fill(0); }
    }
    async function unlock(envelope, secret, expected, slot) {
        validateKey(envelope, slot); keyContext(expected);
        compare(envelope, expected, ['keyId', 'vaultId', 'wrapRevision']);
        // Snapshot before the first await prevents caller mutation/TOCTOU.
        const value = structuredClone(envelope), context = structuredClone(expected);
        delete context.wrapRevision;
        const kek = await derive(secret, value.kdf, slot);
        let raw;
        try {
            try { raw = new Uint8Array(await subtle.decrypt(algorithm(value, keyAAD), kek.key, decode(value.wrappedKey, 48))); }
            catch { fail(slot === 'password' ? 'unlock-failed' : 'recovery-failed'); }
            return await importHandle(raw, context);
        } finally { raw?.fill(0); }
    }
    return Object.freeze({
        generateDataKey: safe(async context => {
            record(context, BASE); base(context);
            const copy = structuredClone(context), raw = random(32);
            try { return await importHandle(raw, copy); } finally { raw.fill(0); }
        }),
        protectWithPassword: safe((handle, password, wrapRevision = 1) => wrap(handle, password, 'password', wrapRevision)),
        // Explicit custody continuity: wrap a NEW DEK with an independently held
        // recovery secret. derive() still validates canonical 32-byte input, and
        // wrap() generates a fresh salt/IV and authenticates the new key context.
        protectWithKnownRecovery: safe((handle, secret, wrapRevision = 1) => wrap(handle, secret, 'recovery', wrapRevision)),
        protectWithRecovery: safe(async (handle, wrapRevision = 1) => {
            entry(handle);
            const bytes = random(32);
            let recoverySecret;
            try { recoverySecret = encode(bytes); } finally { bytes.fill(0); }
            const envelope = await wrap(handle, recoverySecret, 'recovery', wrapRevision);
            return { envelope, recoverySecret };
        }),
        unlockWithPassword: safe((envelope, password, expected) => unlock(envelope, password, expected, 'password')),
        recoverDataKey: safe((envelope, recoverySecret, expected) => unlock(envelope, recoverySecret, expected, 'recovery')),
        changePassword: safe(async (previousEnvelope, oldPassword, newPassword, expected) => {
            // Authenticate the exact source envelope, not just its keyId. A handle
            // generated independently with the same label could contain another DEK.
            keyContext(expected); revision(expected.wrapRevision + 1);
            const nextRevision = expected.wrapRevision + 1;
            const handle = await unlock(previousEnvelope, oldPassword, expected, 'password');
            try { return await wrap(handle, newPassword, 'password', nextRevision); }
            finally { handles.delete(handle); }
        }),
        encryptDocument: safe(async (handle, plaintext, context) => {
            const e = entry(handle); docContext(context); compare(e.context, context, ['keyId', 'vaultId']);
            if (!(plaintext instanceof Uint8Array) || plaintext.length > MAX_BYTES) fail('invalid-envelope');
            const value = { format: 'cf-vault-document', version: 1, algorithm: 'AES-256-GCM',
                ...structuredClone(context) };
            // Uint8Array#slice is overridden by Node Buffer to return a view.
            // Always copy explicitly, including Buffer inputs in Node tests.
            const copy = new Uint8Array(plaintext);
            try {
                value.iv = await nonce(e.context, e.fingerprint); live(handle, e);
                value.ciphertext = encode(new Uint8Array(await subtle.encrypt(algorithm(value, documentAAD), e.key, copy)));
                live(handle, e); return value;
            } finally { copy.fill(0); }
        }),
        decryptDocument: safe(async (handle, envelope, expected) => {
            const e = entry(handle); validateDocument(envelope); docContext(expected);
            compare(envelope, expected, ['keyId', 'vaultId', 'documentId', 'schemaVersion', 'revision', 'generation']);
            compare(e.context, expected, ['keyId', 'vaultId']);
            const value = structuredClone(envelope);
            let bytes;
            try {
                try { bytes = new Uint8Array(await subtle.decrypt(algorithm(value, documentAAD), e.key, decode(value.ciphertext, 16, MAX_BYTES + 16))); }
                catch { fail('integrity-failed'); }
                live(handle, e); return bytes;
            } catch (error) { bytes?.fill(0); throw error; }
        }),
        destroyKey(handle) { handles.delete(handle); }
    });
}
