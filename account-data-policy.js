import { validarBackup, validarTotaisMonetarios } from './finance-core.js';
import { financialStatesEquivalent, chaveLocalConta, readSyncMetadata } from './sync-core.js';

export const ANONYMOUS_KEYS = Object.freeze(['estado:@local', 'fila:@local']);
export const LEGACY_STORAGE_KEYS = Object.freeze([
    'controleFinanceiro:v3', 'controleFinanceiro:v2', 'controle-financeiro-dados',
    ...Array.from({ length: 12 }, (_, i) => 'controleFinanceiro-' + (i + 1)),
    'controleFinanceiro:sync:@local', 'controleFinanceiro:sync:local', 'controleFinanceiro:sync',
    'controleFinanceiro:sync-backup:@local', 'controleFinanceiro:sync-backup:local'
]);
export const ACCOUNT_ACCESS_KEY = 'account-access:v1';
export const ACCOUNT_NOTICE_KEY = 'controleFinanceiro:account-access:v1';
export const accountPolicyError = (code, message) => Object.assign(new Error(message), { code });
export function pendingFinancialData(queue) {
    return !queue || !Array.isArray(queue.outbox) || !Array.isArray(queue.conflicts)
        || queue.outbox.length || queue.conflicts.length || queue.automaticSettingsDirty
        || queue.restoredPending || queue.restoreJob || queue.compatibilityBlocked || queue.migrationPending
        || Object.keys(queue.attempted || {}).length || queue.recoveryKeys?.length || queue.conflictHistory?.length
        || queue.recoveryNotices?.some(x => !x.acknowledged)
        || queue.automaticHistory?.some(x => !x.uploaded)
        || queue.automaticResolutions?.some(x => !x.confirmed)
        || queue.conflictDecisions?.some(x => x.status !== 'confirmed')
        || queue.backupJobs?.some(x => x.status !== 'confirmed');
}
export function confirmedForRemoval(state, queue) {
    return !!state && validarBackup(state.dados) && validarTotaisMonetarios(state.dados) && Number.isSafeInteger(state.revisao) && state.revisao >= 0
        && !pendingFinancialData(queue) && Number.isFinite(Date.parse(queue.lastConfirmed))
        && queue.confirmedRevision === state.revisao
        && queue.confirmedGeneration === (queue.generation || 'legacy');
}
const uidValid = uid => typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
export function validAccountControl(value) {
    return value && value.version === 1 && Number.isSafeInteger(value.epoch) && value.epoch >= 0
        && (value.uid === null || uidValid(value.uid)) && Array.isArray(value.revoked)
        && value.revoked.every(uidValid) && typeof value.closing === 'boolean';
}
export function assertAccountAccess(control, access, keys) {
    if (!keys.some(key => /^(estado:|fila:|restore-recovery:)/.test(key))) return;
    if (!validAccountControl(control) || !access || control.uid !== access.uid || control.epoch !== access.epoch
        || control.revoked.includes(access.uid)
        || control.closing && control.closingToken !== access.closingToken
        || keys.some(key => /^(estado:|fila:|restore-recovery:)/.test(key) && key.split(':')[1] !== access.uid))
        throw accountPolicyError('account/access-revoked', 'Acesso financeiro encerrado. Entre novamente com Google.');
}

// Coordinates the existing account synchronizer, never the experimental vault.
export class AccountDataPolicy {
    constructor(db, { storage = globalThis.localStorage, onHide = () => {}, onNotice = () => {} } = {}) {
        this.db = db; this.storage = storage; this.onHide = onHide; this.onNotice = onNotice;
        this.intent = 0; this.access = null; this.closing = null;
        db.requerConta = true;
    }
    async initialize() {
        await this.db.alterar(ACCOUNT_ACCESS_KEY, current => {
            if (current === null) return { version: 1, epoch: 0, uid: null, revoked: [], closing: false, requiresLogin: false };
            if (!validAccountControl(current)) throw accountPolicyError('account/invalid-control', 'Controle de sessão inválido. Dados preservados.');
            if (current.closing) {
                if (current.uid && !current.revoked.includes(current.uid)) current.revoked.push(current.uid);
                current.uid = null; current.closing = false; current.requiresLogin = true; delete current.closingToken; current.epoch++;
            }
            return current;
        });
    }
    hide() { this.access = null; this.db.acessoConta = null; this.onHide(); }
    announce() {
        // A notification only. IndexedDB remains authoritative at every write.
        try { this.storage?.setItem(ACCOUNT_NOTICE_KEY, JSON.stringify({ nonce: crypto.randomUUID() })); } catch { /* Durable DB fencing still applies. */ }
    }
    async identify(user, isCurrent = () => true, explicit = false) {
        const uid = user?.uid;
        if (!uidValid(uid)) throw accountPolicyError('account/auth-required', 'Entre com Google para acessar seus dados.');
        const control = await this.db.alterar(ACCOUNT_ACCESS_KEY, c => {
            if (!validAccountControl(c) || !isCurrent() || c.closing
                || !explicit && (c.requiresLogin && c.uid === null || c.revoked.includes(uid) || c.uid && c.uid !== uid))
                throw accountPolicyError('account/access-revoked', 'Sessão encerrada neste dispositivo. Entre novamente com Google.');
            if (c.uid && c.uid !== uid && !c.revoked.includes(c.uid)) c.revoked.push(c.uid);
            if (c.uid !== uid || explicit && c.revoked.includes(uid)) c.epoch++;
            c.uid = uid; c.requiresLogin = false; c.revoked = c.revoked.filter(x => x !== uid); return c;
        });
        if (!isCurrent()) return null;
        this.access = { uid, epoch: control.epoch }; this.db.acessoConta = this.access;
        return this.access;
    }
    async isCurrent() {
        const access = this.access, c = await this.db.ler(ACCOUNT_ACCESS_KEY);
        return !!access && validAccountControl(c) && c.uid === access.uid && c.epoch === access.epoch
            && !c.revoked.includes(access.uid) && (!c.closing || c.closingToken === access.closingToken);
    }
    async revoke(uid, expectedToken = null) {
        this.intent++; this.hide();
        const c = await this.db.alterar(ACCOUNT_ACCESS_KEY, c => {
            if (!validAccountControl(c)) throw accountPolicyError('account/invalid-control', 'Dados preservados: controle inválido.');
            // An old logout must never revoke a newly selected account.
            if (expectedToken && c.closingToken !== expectedToken) return c;
            if (uid && c.uid && c.uid !== uid) return c;
            const former = uid || c.uid;
            if (former && !c.revoked.includes(former)) c.revoked.push(former);
            c.uid = null; c.closing = false; c.requiresLogin = true; delete c.closingToken; c.epoch++; return c;
        });
        this.announce(); return c;
    }
    async inspectLegacyPresence(isCurrent) {
        if (typeof isCurrent !== 'function' || !isCurrent() || !await this.isCurrent())
            throw accountPolicyError('account/access-revoked', 'Autenticação necessária para examinar fontes locais.');
        const keys = [], unavailable = [];
        try {
            const docs = await this.db.lerDocumentos(ANONYMOUS_KEYS);
            for (const key of ANONYMOUS_KEYS) if (docs.get(key) !== null) keys.push(key);
        } catch { unavailable.push('IndexedDB anônimo'); }
        for (const key of LEGACY_STORAGE_KEYS) {
            if (!isCurrent()) throw accountPolicyError('account/access-revoked', 'Sessão alterada durante a descoberta.');
            try { if (!this.storage) throw new Error('Storage indisponível'); if (this.storage.getItem(key) !== null) keys.push(key); }
            catch { unavailable.push(key); }
        }
        if (!isCurrent() || !await this.isCurrent()) throw accountPolicyError('account/access-revoked', 'Sessão alterada durante a descoberta.');
        return { required: keys.length > 0 || unavailable.length > 0, keys, unavailable };
    }
    loginIntent() { return ++this.intent; }
    async acceptLogin(user, ticket, isCurrent) {
        if (this.closing || ticket !== this.intent || !isCurrent()) throw accountPolicyError('account/stale-login', 'Login anterior ao encerramento foi ignorado.');
        const access = await this.identify(user, () => ticket === this.intent && isCurrent(), true);
        this.announce(); return access;
    }
    logout({ uid, flush, signOut, drainLocal = async () => {}, timeoutMs = 15000 }) {
        if (this.closing) return this.closing;
        this.intent++; const captured = this.access; this.onHide();
        this.closing = (async () => {
            let token, confirmed = false, cause = null, control;
            try {
                if (!captured || captured.uid !== uid) throw accountPolicyError('account/no-session', 'Sessão financeira indisponível.');
                await drainLocal();
                token = crypto.randomUUID();
                control = await this.db.alterar(ACCOUNT_ACCESS_KEY, c => {
                    assertAccountAccess(c, captured, [`estado:${uid}`]);
                    c.closing = true; c.closingToken = token; return c;
                });
                this.access = { ...captured, closingToken: token }; this.db.acessoConta = this.access;
                this.announce();
                let timer;
                try { await Promise.race([flush(), new Promise((_, reject) => { timer = setTimeout(() => reject(accountPolicyError('account/sync-timeout', 'Sincronização não confirmada.')), timeoutMs); })]); }
                finally { clearTimeout(timer); }
                const state = await this.db.ler(`estado:${uid}`), queue = await this.db.ler(`fila:${uid}`);
                confirmed = confirmedForRemoval(state, queue);
                if (!confirmed) throw accountPolicyError('account/recovery-required', 'Há dados ou histórico sem confirmação remota.');
            } catch (error) { cause = error; }
            // Revocation is durable BEFORE calling Firebase. signOut failure cannot restore the UI.
            try { control = await this.revoke(uid, token); }
            catch (error) { this.hide(); cause ||= error; confirmed = false; }
            let signedOut = false;
            try { await signOut(); signedOut = true; } catch (error) { cause ||= error; }
            let removed = [];
            if (confirmed && signedOut && control?.uid === null) {
                try { const cleaned = await this.db.removerContasConfirmadas(control.epoch);
                    removed = cleaned.map(item => item.uid);
                    for (const item of cleaned) {
                        // A legacy copy is removable only if it equals the confirmed state
                        // and its metadata has no pending/recovery evidence. Never clear storage.
                        const key = chaveLocalConta(item.uid), raw = this.storage?.getItem(key);
                        if (raw === null || raw === undefined) continue;
                        const legacy = JSON.parse(raw), meta = readSyncMetadata(this.storage, item.uid);
                        if (financialStatesEquivalent(legacy, item.state) && !pendingFinancialData({ outbox: [], conflicts: [], ...meta })
                            && this.storage.getItem(key) === raw) this.storage.removeItem(key);
                    } }
                catch (error) { cause ||= error; }
            }
            const result = { signedOut, confirmed, removed, preserved: !removed.includes(uid), error: cause?.code || null };
            this.onNotice(result); return result;
        })().finally(() => { this.closing = null; });
        return this.closing;
    }
}
