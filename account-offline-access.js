// Local application authorization; does not encrypt the existing financial database.
import { validarBackup, validarTotaisMonetarios } from './finance-core.js';
const CONTROL = 'account-access:v1', PREFIX = 'account-offline:v1:';
const enc = new TextEncoder(), iterations = 600000;
const fail = code => { throw Object.assign(new Error({ 'offline/pin': 'PIN incorreto ou autorização local adulterada.', 'offline/locked': 'Acesso local bloqueado. Desbloqueie novamente.', 'offline/unavailable': 'Autorização local indisponível. Entre novamente com Google.', 'offline/invalid-data': 'Dados locais incompletos ou inválidos. Originais preservados.', 'offline/pin-format': 'Use um PIN de 8 a 64 dígitos.', 'offline/rate-limit': 'Aguarde antes de tentar outro PIN.' }[code] || 'Sessão local alterada. Operação cancelada.'), { code }); };
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const bytes = (s, size) => { if (typeof s !== 'string' || s.length !== size * 2 || !/^[a-f0-9]+$/.test(s)) fail('offline/unavailable'); return Uint8Array.from(s.match(/../g), h => parseInt(h, 16)); };
const validUid = uid => typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
const pairValid = (s, q) => s && Number.isSafeInteger(s.revisao) && s.revisao >= 0 && validarBackup(s.dados) && validarTotaisMonetarios(s.dados)
    && q && Array.isArray(q.outbox) && Array.isArray(q.conflicts) && (!q.generation || typeof q.generation === 'string');
const aad = g => enc.encode(JSON.stringify(['cf-local-access', 1, g.uid, g.id, g.generation, g.iterations, g.salt]));
async function pinKey(pin, salt) {
    if (typeof pin !== 'string' || !/^[0-9]{8,64}$/.test(pin)) fail('offline/pin-format');
    const material = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations, salt }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export class OfflineAccountAccess {
    constructor(policy) { this.policy = policy; this.db = policy.db; }
    async enroll(uid, pin, current = () => true) {
        const access = this.policy.access, ticket = this.policy.intent;
        const active = () => current() && this.policy.intent === ticket && this.policy.access === access && access?.uid === uid && access.kind !== 'local' && !this.policy.closing;
        if (!validUid(uid) || !active() || !await this.policy.isCurrent()) fail('offline/locked');
        const queue = await this.db.ler('fila:' + uid), state = await this.db.ler('estado:' + uid);
        if (!active()) fail('offline/locked');
        if (!pairValid(state, queue)) fail('offline/invalid-data');
        const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
        const g = { version: 1, uid, id: crypto.randomUUID(), generation: queue.generation || 'legacy', iterations, salt: hex(salt), iv: hex(iv), enabled: true, failures: 0, retryAt: 0 };
        const key = await pinKey(pin, salt);
        const proof = enc.encode(JSON.stringify({ uid, id: g.id, nonce: hex(crypto.getRandomValues(new Uint8Array(32))) }));
        g.ciphertext = hex(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(g), tagLength: 128 }, key, proof)));
        await this.db.alterarComLeituras([PREFIX + uid], [CONTROL, 'estado:' + uid, 'fila:' + uid], (docs, reads) => {
            const c = reads.get(CONTROL), q = reads.get('fila:' + uid);
            if (!active() || c?.uid !== uid || c.epoch !== access.epoch || c.closing || c.revoked?.includes(uid) || !pairValid(reads.get('estado:' + uid), q) || (q.generation || 'legacy') !== g.generation) fail('offline/locked');
            docs.set(PREFIX + uid, g); return docs;
        });
        if (!active()) fail('offline/locked');
        this.enrollment = { uid, id: g.id, access };
        return { uid, id: g.id };
    }
    async available() {
        const c = await this.db.ler(CONTROL);
        // No enumeration of account identities on the logged-out screen.
        if (!validUid(c?.localCandidate)) return null;
        const g = await this.db.ler(PREFIX + c.localCandidate);
        return g?.enabled === true && g.uid === c.localCandidate ? { uid: g.uid } : null;
    }
    async unlock(uid, pin) {
        if (!validUid(uid) || this.policy.closing) fail('offline/locked');
        const ticket = ++this.policy.intent, before = await this.db.ler(CONTROL), g = await this.db.ler(PREFIX + uid);
        const active = () => this.policy.intent === ticket && !this.policy.closing;
        if (!active() || !g || g.version !== 1 || g.uid !== uid || !g.enabled || before?.closing || before?.localCandidate !== uid || !Number.isSafeInteger(before?.epoch)) fail('offline/unavailable');
        if (typeof g.id !== 'string' || g.id.length > 128 || typeof g.generation !== 'string' || g.generation.length > 256 || typeof g.ciphertext !== 'string' || g.ciphertext.length < 32 || g.ciphertext.length > 2048) fail('offline/unavailable');
        if (Object.keys(g).some(k => !['version', 'uid', 'id', 'generation', 'iterations', 'salt', 'iv', 'enabled', 'failures', 'retryAt', 'ciphertext'].includes(k))) fail('offline/unavailable');
        if (g.iterations !== iterations || !Number.isSafeInteger(g.failures) || g.failures < 0 || g.failures > 30 || !Number.isFinite(g.retryAt) || g.retryAt < 0) fail('offline/unavailable');
        if (g.retryAt > Date.now()) fail('offline/rate-limit');
        let decoded;
        try {
            const key = await pinKey(pin, bytes(g.salt, 16));
            const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(g.iv, 12), additionalData: aad(g), tagLength: 128 }, key, bytes(g.ciphertext,  (g.ciphertext?.length || 0) / 2));
            decoded = JSON.parse(new TextDecoder().decode(raw));
            if (decoded.uid !== uid || decoded.id !== g.id || !/^[a-f0-9]{64}$/.test(decoded.nonce)) fail('offline/pin');
        } catch (error) {
            if (!active()) fail('offline/locked');
            await this.db.alterar(PREFIX + uid, latest => {
                if (active() && latest?.id === g.id) { latest.failures = Math.min(30, latest.failures + 1); latest.retryAt = Date.now() + Math.min(300000, 1000 * 2 ** Math.min(8, latest.failures)); } return latest;
            });
            if (error.code === 'offline/pin-format') throw error;
            fail('offline/pin');
        }
        if (!active()) fail('offline/locked');
        let result;
        const docs = await this.db.alterarComLeituras([CONTROL, PREFIX + uid], ['estado:' + uid, 'fila:' + uid], (docs, reads) => {
            const c = docs.get(CONTROL), latest = docs.get(PREFIX + uid), state = reads.get('estado:' + uid), queue = reads.get('fila:' + uid);
            if (!active() || c?.epoch !== before.epoch || c.closing || c.localCandidate !== uid || JSON.stringify(latest) !== JSON.stringify(g)) fail('offline/locked');
            if (!pairValid(state, queue)) fail('offline/invalid-data');
            if ((queue.generation || 'legacy') !== g.generation) fail('offline/unavailable');
            if (!Number.isSafeInteger(c.epoch + 1)) fail('offline/unavailable');
            if (c.uid && !c.revoked.includes(c.uid)) c.revoked.push(c.uid);
            c.uid = uid; c.mode = 'local'; c.localGrant = g.id; c.localGeneration = g.generation; c.requiresLogin = true; c.epoch++;
            latest.failures = 0; latest.retryAt = 0;
            docs.set(CONTROL, c); docs.set(PREFIX + uid, latest);
            result = { state, queue }; return docs;
        });
        if (!active()) fail('offline/locked');
        const control = docs.get(CONTROL), access = { uid, epoch: control.epoch, kind: 'local', grantId: g.id, generation: g.generation };
        this.policy.access = access; this.db.acessoConta = access; this.policy.announce();
        return { ...result, access };
    }
    async nominate(uid, expectedEpoch) {
        await this.db.alterarComLeituras([CONTROL], [PREFIX + uid], (docs, reads) => {
            const c = docs.get(CONTROL), g = reads.get(PREFIX + uid);
            if (c?.epoch !== expectedEpoch || c.uid !== null || c.closing || !g?.enabled || g.uid !== uid) fail('offline/locked');
            c.localCandidate = uid; docs.set(CONTROL, c); return docs;
        });
    }
    async disable(uid, expectedEpoch) {
        await this.db.alterarComLeituras([CONTROL, PREFIX + uid], [], docs => {
            const c = docs.get(CONTROL);
            if (c?.epoch !== expectedEpoch || c.uid !== null || c.closing) fail('offline/locked');
            if (c.localCandidate === uid) delete c.localCandidate;
            const g = docs.get(PREFIX + uid); if (g) { g.enabled = false; docs.set(PREFIX + uid, g); }
            docs.set(CONTROL, c); return docs;
        });
    }
}
