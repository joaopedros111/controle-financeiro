// Restores only the last explicitly selected Google owner. Never grants remote authority.
import { validarBackup, validarTotaisMonetarios } from './finance-core.js';
const CONTROL = 'account-access:v1';
const validUid = uid => typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
const fail = code => { throw Object.assign(new Error(code === 'offline/invalid-data'
    ? 'Dados locais incompletos ou inválidos. Originais preservados.'
    : 'Conta local alterada. Dados preservados; entre novamente com Google.'), { code }); };
export class OfflineAccountAccess {
    constructor(policy) { this.policy = policy; this.db = policy.db; }
    async available() {
        const c = await this.db.ler(CONTROL);
        if (!c || c.closing) return null;
        // An active owner always takes precedence over an older retained owner.
        const uid = c.uid || c.localCandidate;
        return validUid(uid) ? { uid, resumeGoogle: c.googleResume === true || c.mode !== 'local' && c.uid === uid && !c.requiresLogin } : null;
    }
    async resume() {
        if (this.policy.closing) fail('offline/changed');
        const ticket = ++this.policy.intent, before = await this.db.ler(CONTROL);
        const uid = before?.uid || before?.localCandidate;
        if (!validUid(uid) || before.closing) return null;
        const active = () => this.policy.intent === ticket && !this.policy.closing;
        let result;
        const docs = await this.db.alterarComLeituras([CONTROL], ['estado:' + uid, 'fila:' + uid], (docs, reads) => {
            const c = docs.get(CONTROL), state = reads.get('estado:' + uid), queue = reads.get('fila:' + uid);
            if (!active() || c?.epoch !== before.epoch || c.closing || (c.uid || c.localCandidate) !== uid) fail('offline/changed');
            if (!state && !queue) return docs; // Login may have stopped before creating its first local pair.
            if (!state || !Number.isSafeInteger(state.revisao) || state.revisao < 0 || !validarBackup(state.dados) || !validarTotaisMonetarios(state.dados)
                || !queue || !Array.isArray(queue.outbox) || !Array.isArray(queue.conflicts)
                || queue.generation !== undefined && typeof queue.generation !== 'string') fail('offline/invalid-data');
            if (!Number.isSafeInteger(c.epoch + 1)) fail('offline/changed');
            // Reopening the same owner in another tab must not revoke an active Google session.
            if (!c.uid || c.mode === 'local' && c.localGeneration !== (queue.generation || 'legacy')) {
                c.uid = uid; c.localCandidate = uid; c.mode = 'local'; c.googleResume = false;
                c.localGeneration = queue.generation || 'legacy'; c.epoch++;
            }
            delete c.localGrant;
            docs.set(CONTROL, c); result = { state, queue }; return docs;
        });
        if (!active()) fail('offline/changed');
        if (!result) return null;
        const c = docs.get(CONTROL), access = { uid, epoch: c.epoch, kind: 'local', generation: result.queue.generation || 'legacy' };
        this.policy.access = access; this.db.acessoConta = access; this.policy.announce();
        return { ...result, access };
    }
}
