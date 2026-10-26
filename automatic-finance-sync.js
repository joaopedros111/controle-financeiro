import { chaveLocalConta, registrosFinanceiros, recordEntityKey, makeOperation, validateRemoteSettings, validRemoteTombstone,
    validateRemoteConflicts, snapshotConfirmed, inspectRemoteKeys, settingsEquivalent, recordsEquivalent, validConflictRecord,
    functionalSettings, readSyncMetadata } from './sync-core.js';
import { normalizarEstado, validarBackup, validarTotaisMonetarios } from './finance-core.js';
import { financeSettings, reconcileAutomatic, prepareAutomaticBackup, transientSyncError } from './automatic-sync-policy.js';

const error = (code, message) => Object.assign(new Error(message), { code });
const pending = queue => queue.outbox.length || queue.automaticSettingsDirty || queue.conflicts.length
    || queue.automaticHistory?.some(item => !item.uploaded) || queue.automaticResolutions?.some(item => !item.confirmed);
function validateRecords(items) {
    if (!Array.isArray(items) || inspectRemoteKeys(items).duplicates.length || inspectRemoteKeys(items).mismatches.length) throw error('sync/invalid-data', 'Dados remotos incompatíveis. As cópias locais foram preservadas.');
    const state = { meses: {} };
    for (const item of items) {
        if (item.deleted) { if (!validRemoteTombstone(item)) throw error('sync/invalid-data', 'Exclusão remota inválida.'); continue; }
        state.meses[item.month] ||= { receitas: [], despesas: [] };
        if (!['receitas', 'despesas'].includes(item.type) || !item.revision || !item.updatedAt || !validConflictRecord(item, { remote: true })) throw error('sync/invalid-data', 'Registro remoto inválido.');
        state.meses[item.month][item.type].push(item.record);
    }
    if (!validarBackup(state)) throw error('sync/invalid-data', 'Dados financeiros remotos inválidos.');
    return items;
}

export class AutomaticFinanceSync {
    constructor({ client, db, service, readLegacy, onAccount, onState, onStatus, onTransition = () => {}, waitLocal = async () => {}, storageBlocked = () => false,
        connectivity = globalThis, delayMs = 200, maxDelayMs = 30000 }) {
        Object.assign(this, { client, db, service, readLegacy, onAccount, onState, onStatus, onTransition, waitLocal, storageBlocked, connectivity, delayMs, maxDelayMs });
        this.session = null; this.online = connectivity.navigator?.onLine !== false;
    }
    async start() {
        this.unAuth = this.client.onUser(user => { const transition = this.useAccount(user), session = this.session; void transition.catch(cause => this.report(cause, session)); });
        this.offline = () => { this.online = false; this.status('Offline'); };
        this.reconnect = () => { this.online = true; if (this.session) { this.session.permanent = false; this.session.retryAt = 0; } this.request(0); };
        this.connectivity.addEventListener?.('online', this.reconnect);
        this.connectivity.addEventListener?.('offline', this.offline);
        await this.client.ready();
    }
    stop() {
        this.closeSession(); this.unAuth?.();
        this.connectivity.removeEventListener?.('online', this.reconnect); this.connectivity.removeEventListener?.('offline', this.offline);
    }
    closeSession() { const s = this.session; this.session = null; if (s) { clearTimeout(s.timer); s.stops.forEach(stop => stop()); } }
    current(s) { return this.session === s; }
    status(message, failed = false, confirmedAt = null) { this.onStatus(message, failed, confirmedAt); }
    async useAccount(user) {
        this.closeSession();
        this.onTransition(user);
        if (!user) { await this.waitLocal(); if (!this.session) await this.onAccount(null); return; }
        const s = { uid: user.uid, user, stops: [], attempt: 0, ready: false, permanent: false };
        this.session = s; this.status('Sincronizando');
        await this.waitLocal(); if (!this.current(s)) return;
        const saved = this.readLegacy(chaveLocalConta(s.uid));
        if (!['valido', 'ausente'].includes(saved.estado)) throw error('sync/invalid-local', 'Dados locais precisam de recuperação.');
        const legacyQueue = readSyncMetadata(globalThis.localStorage, s.uid);
        const existing = await this.db.ler(`estado:${s.uid}`);
        const initialized = await this.service.inicializar(s.uid, normalizarEstado(saved.estado === 'valido' ? saved.valor : null),
            { outbox: [], conflicts: [], lastConfirmed: null, settingsPristine: saved.estado === 'ausente', ...legacyQueue });
        if (!this.current(s)) return;
        await this.onAccount(user); if (!this.current(s)) return;
        await this.service.alterarFila(s.uid, q => { if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
            q.automaticHasLocalSettings ??= saved.estado === 'valido' || !!existing;
            return q; });
        this.onState(initialized.estado.dados);
        this.request(0);
    }
    request(delay = this.delayMs) {
        const s = this.session;
        if (!s || s.permanent) return;
        clearTimeout(s.timer);
        if (!this.online) { this.status('Offline'); return; }
        s.timer = setTimeout(() => { void this.run(s); }, Math.max(delay, (s.retryAt || 0) - Date.now()));
        s.timer.unref?.();
    }
    localChanged() {
        if (this.session) this.session.localVersion = (this.session.localVersion || 0) + 1;
        this.request(0);
    }
    report(cause, s = this.session) {
        if (!s || !this.current(s)) return;
        this.status(transientSyncError(cause) ? 'Sincronizando' : (cause.message || 'Falha na sincronização.'), !transientSyncError(cause));
        if (transientSyncError(cause)) {
            const delay = Math.min(this.maxDelayMs, this.delayMs * 2 ** Math.min(s.attempt++, 8));
            s.retryAt = Date.now() + delay; this.request(delay);
        }
        else s.permanent = true;
    }
    async run(s) {
        if (!this.current(s) || !this.online || s.permanent) return;
        if (s.running) { s.again = true; return; }
        s.running = true; s.again = false;
        try {
            if (this.storageBlocked()) throw error('sync/storage-blocked', 'A persistência falhou. Os dados locais foram preservados.');
            await this.waitLocal(); if (!this.current(s)) return;
            this.status('Sincronizando');
            await this.cycle(s);
            if (this.current(s)) { s.attempt = 0; s.retryAt = 0; }
        } catch (cause) { this.report(cause, s); }
        finally { s.running = false; if (this.current(s) && s.again && !s.permanent) this.request(); }
    }
    async snapshot(s) {
        const [records, settings, conflicts] = await Promise.all([this.client.list(s.uid), this.client.getSettings(s.uid), this.client.listConflicts(s.uid)]);
        if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
        validateRecords(records);
        if (!validateRemoteSettings(settings) || !validateRemoteConflicts(conflicts)) throw error('sync/invalid-data', 'Configurações remotas inválidas.');
        return { records, settings, conflicts };
    }
    async reconcile(s, snapshot) {
        const changed = await this.db.alterarDocumentos([`estado:${s.uid}`, `fila:${s.uid}`], docs => {
            if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
            const stored = docs.get(`estado:${s.uid}`), before = docs.get(`fila:${s.uid}`);
            const plan = reconcileAutomatic(stored.dados, before, snapshot.records, snapshot.settings, snapshot.conflicts);
            if (!validarBackup(plan.state) || !validarTotaisMonetarios(plan.state)) throw error('sync/invalid-data', 'Combinação financeira inválida.');
            // Resume explicit old backup/first-account work. Ordinary snapshots do not stage records.
            if (before.restoredPending || !before.initialized) {
                const remote = new Map(snapshot.records.map(item => [recordEntityKey(item), item]));
                for (const item of registrosFinanceiros(plan.state)) {
                    const key = recordEntityKey(item), current = remote.get(key);
                    if (!current && !plan.queue.outbox.some(op => op.entityKey === key)) plan.queue.outbox.push(makeOperation(key, { ...item, deleted: false }, null));
                }
                plan.queue.restoredPending = false; plan.queue.initialized = true; plan.queue.firstLinkReviewed = true;
            }
            stored.dados = plan.state; stored.revisao++;
            docs.set(`estado:${s.uid}`, stored); docs.set(`fila:${s.uid}`, plan.queue); return docs;
        });
        if (this.current(s)) this.onState(changed.get(`estado:${s.uid}`).dados);
        return changed.get(`fila:${s.uid}`);
    }
    async cycle(s) {
        const localVersion = s.localVersion || 0;
        let snapshot = await this.snapshot(s);
        await this.reconcile(s, snapshot); if (!this.current(s)) return;
        await this.service.enviarFila(s.uid, (uid, op) => this.current(s) ? this.client.commit(uid, op) : Promise.reject(error('persistence/cancelled', 'Sessão alterada.')),
            () => this.current(s), () => this.current(s), snapshot.records);
        if (!this.current(s)) return;
        snapshot = await this.snapshot(s);
        let queue = await this.reconcile(s, snapshot); if (!this.current(s)) return;
        const stored = await this.db.ler(`estado:${s.uid}`); if (!this.current(s)) return;
        const settings = financeSettings(stored.dados);
        if (!snapshot.settings || queue.automaticSettingsDirty || !queue.settingsBaseline && !settingsEquivalent(settings, snapshot.settings)) {
            const result = await this.service.coordenarSettings(s.uid,
                () => this.client.saveSettings(s.uid, settings, snapshot.settings?.revision || null, () => this.current(s)), true);
            if (!this.current(s)) return;
            if (result.conflict) { s.again = true; return; }
            if (!result.acknowledged) throw error('sync/invalid-ack', 'Configurações sem confirmação remota.');
            await this.service.alterarFila(s.uid, q => { if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
                // A new local settings edit must survive this old ACK.
                if (settingsEquivalent(q.automaticSettingsValue || settings, settings)) q.automaticSettingsDirty = false;
                q.settingsBaseline = functionalSettings(settings); q.settingsRevision = result.revision; return q; });
            snapshot = await this.snapshot(s); queue = await this.reconcile(s, snapshot);
        }
        for (const item of queue.automaticHistory || []) if (!item.uploaded) {
            if (!this.current(s)) return;
            await this.client.saveAutomaticHistory(s.uid, item);
            await this.service.alterarFila(s.uid, q => { if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
                const target = q.automaticHistory?.find(row => row.id === item.id); if (target) target.uploaded = true; return q; });
        }
        queue = await this.service.lerFila(s.uid);
        if (queue.outbox.length) { s.again = true; return; }
        for (const resolution of queue.automaticResolutions || []) if (!resolution.confirmed) {
            if (!this.current(s)) return;
            if (!await this.client.resolveConflict(s.uid, resolution.id, resolution.choice)) throw error('sync/invalid-ack', 'Histórico sem confirmação remota.');
            await this.service.alterarFila(s.uid, q => { if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
                const item = q.automaticResolutions?.find(row => row.id === resolution.id); if (item) item.confirmed = true; return q; });
        }
        if (!this.current(s)) return;
        const final = await this.db.ler(`estado:${s.uid}`);
        if (pending(await this.service.lerFila(s.uid))) { s.again = true; return; }
        if (!snapshot.settings || !settingsEquivalent(financeSettings(final.dados), snapshot.settings)) { s.again = true; return; }
        const local = new Map(registrosFinanceiros(final.dados).map(item => [recordEntityKey(item), item]));
        const remoteKeys = new Set(snapshot.records.map(recordEntityKey));
        if ([...local.keys()].some(key => !remoteKeys.has(key))) throw error('sync/untracked-data', 'Há dados locais sem confirmação remota. A cópia local foi preservada.');
        for (const remote of snapshot.records) if (remote.deleted ? local.has(recordEntityKey(remote)) : !recordsEquivalent(local.get(recordEntityKey(remote))?.record, remote.record)) { s.again = true; return; }
        const confirmation = await this.service.confirmarSincronizacao(s.uid, final.dados, new Date().toISOString(), () => this.current(s));
        if (!this.current(s)) return;
        if (!confirmation.confirmed) { s.again = true; return; }
        let stillConfirmed = false;
        await this.service.alterarFila(s.uid, q => { if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
            if (pending(q)) return q;
            stillConfirmed = true;
            for (const job of q.backupJobs || []) if (job.status === 'pending') job.status = 'confirmed'; return q; });
        if (!this.current(s)) return;
        if (!stillConfirmed || (s.localVersion || 0) !== localVersion) { s.again = true; return; }
        if (!this.online) { this.status('Offline'); return; }
        if (!s.ready) this.listen(s);
        this.status('Sincronizado', false, confirmation.fila.lastConfirmed);
    }
    listen(s) {
        s.ready = true;
        const received = (_data, meta) => { if (this.current(s) && snapshotConfirmed(meta)) this.request(); };
        const failure = cause => { if (!this.current(s)) return; s.stops.splice(0).forEach(stop => stop()); s.ready = false; this.report(cause, s); };
        s.stops.push(this.client.listen(s.uid, received, failure), this.client.listenSettings(s.uid, received, failure), this.client.listenConflicts(s.uid, received, failure));
    }
    async importBackup(raw) {
        const s = this.session;
        if (!s) throw error('sync/sign-in-required', 'Entre com Google antes de importar para a conta.');
        await this.waitLocal(); if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
        const result = await this.db.alterarDocumentos([`estado:${s.uid}`, `fila:${s.uid}`], docs => {
            if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
            const stored = docs.get(`estado:${s.uid}`), queue = docs.get(`fila:${s.uid}`), before = stored.dados;
            const next = prepareAutomaticBackup(raw, before, queue);
            const old = new Map(registrosFinanceiros(before).map(item => [recordEntityKey(item), item]));
            for (const item of registrosFinanceiros(next)) if (!old.has(recordEntityKey(item))) {
                const key = recordEntityKey(item);
                queue.outbox.push(makeOperation(key, { ...item, deleted: false }, queue.remoteRevisions?.[key] || null));
            }
            if (!validarBackup(next) || !validarTotaisMonetarios(next)) throw error('sync/invalid-backup', 'Backup excede os limites financeiros.');
            queue.restoredPending = false; stored.dados = next; stored.revisao++;
            docs.set(`estado:${s.uid}`, stored); docs.set(`fila:${s.uid}`, queue); return docs;
        });
        if (this.current(s)) { this.onState(result.get(`estado:${s.uid}`).dados); this.localChanged(); }
        return result.get(`estado:${s.uid}`).dados;
    }
}
