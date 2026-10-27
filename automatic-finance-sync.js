import { chaveLocalConta, registrosFinanceiros, recordEntityKey, makeOperation, validateRemoteSettings, validRemoteTombstone,
    validateRemoteConflicts, snapshotConfirmed, inspectRemoteKeys, settingsEquivalent, recordsEquivalent, validConflictRecord,
    functionalSettings, readSyncMetadata, operationId } from './sync-core.js';
import { normalizarEstado, validarBackup, validarTotaisMonetarios } from './finance-core.js';
import { financeSettings, reconcileAutomatic, prepareGenerationRestore, transientSyncError } from './automatic-sync-policy.js';

const error = (code, message) => Object.assign(new Error(message), { code });
const upgradeMessage = 'Atualização obrigatória: esta versão não é compatível com a geração da conta. Os dados locais foram preservados.';
const recoveryStatus = 'Dados ativos sincronizados; há alterações somente no histórico de recuperação.';
const pending = queue => queue.outbox.length || queue.automaticSettingsDirty || queue.conflicts.length
    || queue.compatibilityBlocked || queue.restoreJob || queue.automaticHistory?.some(item => !item.uploaded) || queue.automaticResolutions?.some(item => !item.confirmed);
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
        connectivity = globalThis, delayMs = 200, maxDelayMs = 30000, requiredProtocol = 1 }) {
        Object.assign(this, { client, db, service, readLegacy, onAccount, onState, onStatus, onTransition, waitLocal, storageBlocked, connectivity, delayMs, maxDelayMs, requiredProtocol });
        this.session = null; this.online = connectivity.navigator?.onLine !== false;
    }
    async start() {
        let settleInitial;
        const initial = new Promise(resolve => { settleInitial = resolve; });
        let awaitingInitial = true;
        this.unAuth = this.client.onUser(user => {
            const transition = this.useAccount(user), session = this.session;
            void transition.catch(cause => this.report(cause, session)).finally(() => {
                if (awaitingInitial) { awaitingInitial = false; settleInitial(); }
            });
        });
        this.offline = () => { this.online = false; this.status('Offline'); };
        this.reconnect = () => { this.online = true; if (this.session) { this.session.permanent = false; this.session.retryAt = 0; } this.request(0); };
        this.connectivity.addEventListener?.('online', this.reconnect);
        this.connectivity.addEventListener?.('offline', this.offline);
        await this.client.ready();
        // Não libera a interface entre a restauração do Auth e a hidratação
        // do estado IndexedDB pertencente ao UID restaurado.
        await initial;
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
        s.generation = initialized.fila.generation || 'legacy';
        this.emitState(s, initialized.estado, initialized.fila);
        if (this.requiredProtocol > 1 && (!this.client.generationSnapshot || !this.client.generationMarker || this.client.protocolVersion < this.requiredProtocol || !this.client.protocolVersion)) {
            await this.report(error('sync/upgrade-required', upgradeMessage), s); return;
        }
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
        if (cause.code === 'sync/upgrade-required' || (cause.code === 'permission-denied' && !this.client.generationSnapshot)) {
            s.permanent = true;
            this.status(upgradeMessage, true);
            return this.service.alterarFila(s.uid, queue => {
                if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
                queue.compatibilityBlocked = { code: 'sync/upgrade-required' }; return queue;
            }).then(async queue => {
                const stored = await this.db.ler(`estado:${s.uid}`);
                if (this.current(s)) { this.emitState(s, stored, queue); this.status(upgradeMessage, true); }
            }).catch(failure => { if (this.current(s)) this.status(failure.message || upgradeMessage, true); });
        }
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
        } catch (cause) { await this.report(cause, s); }
        finally { s.running = false; if (this.current(s) && s.again && !s.permanent) this.request(); }
    }
    async snapshot(s) {
        if (!this.client.generationSnapshot && this.client.generationMarker && await this.client.generationMarker(s.uid)) throw error('sync/upgrade-required', upgradeMessage);
        const data = this.client.generationSnapshot ? await this.client.generationSnapshot(s.uid) : null;
        if (data?.protocol > (this.client.protocolVersion || 2)) throw error('sync/upgrade-required', upgradeMessage);
        const [records, settings, conflicts] = data ? [data.records, data.settings, data.conflicts]
            : await Promise.all([this.client.list(s.uid), this.client.getSettings(s.uid), this.client.listConflicts(s.uid)]);
        if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
        validateRecords(records);
        if (!validateRemoteSettings(settings) || !validateRemoteConflicts(conflicts)) throw error('sync/invalid-data', 'Configurações remotas inválidas.');
        return { records, settings, conflicts, generation: data?.generation || 'legacy' };
    }
    async reconcile(s, snapshot) {
        const known = await this.service.lerFila(s.uid);
        if (this.client.generationMarker) {
            const marker = await this.client.generationMarker(s.uid);
            if ((marker?.activeGeneration || 'legacy') !== snapshot.generation) throw error('aborted', 'Snapshot de geração anterior descartado.');
        }
        const recoveryKey = known.compatibilityBlocked
            ? `restore-recovery:${s.uid}:compat-${operationId(s.uid, snapshot.generation, known)}`
            : `restore-recovery:${s.uid}:before-${snapshot.generation}`;
        const adopting = !known.restoreJob && (known.compatibilityBlocked || (known.generation || 'legacy') !== snapshot.generation);
        const keys = [`estado:${s.uid}`, `fila:${s.uid}`, ...(adopting ? [recoveryKey] : [])];
        const changed = await this.db.alterarDocumentos(keys, docs => {
            if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
            const stored = docs.get(`estado:${s.uid}`); let before = docs.get(`fila:${s.uid}`);
            if (before.restoreJob) throw error('sync/restore-in-progress', 'Restauração em preparação.');
            if ((before.generation || 'legacy') !== (known.generation || 'legacy')) throw error('aborted', 'Geração local mudou durante a leitura.');
            if (before.compatibilityBlocked || (before.generation || 'legacy') !== snapshot.generation) {
                if (!adopting) throw error('aborted', 'Geração local mudou durante a leitura.');
                if (!docs.get(recoveryKey)) docs.set(recoveryKey, { state: structuredClone(stored.dados), queue: structuredClone(before), reason: 'generation-replaced' });
                const notices = [...(before.recoveryNotices || [])];
                if ((before.outbox.length || before.automaticSettingsDirty || before.conflicts.length || before.restoredPending)
                    && !notices.some(item => item.id === recoveryKey)) notices.push({ id: recoveryKey, code: 'archived-offline', acknowledged: false });
                before = { outbox: [], conflicts: [], remoteRevisions: {}, initialized: true, automaticPolicyInitialized: true,
                    generation: snapshot.generation, recoveryNotices: notices, recoveryKeys: [...new Set([...(before.recoveryKeys || []), recoveryKey])] };
                stored.dados = normalizarEstado({ meses: {}, tema: stored.dados.tema });
                s.stops.splice(0).forEach(stop => stop()); s.ready = false;
            }
            const plan = reconcileAutomatic(stored.dados, before, snapshot.records, snapshot.settings, snapshot.conflicts);
            for (const op of plan.queue.outbox) if (plan.queue.generation && !op.generation) op.generation = plan.queue.generation;
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
        if (this.current(s)) {
            s.generation = snapshot.generation;
            this.emitState(s, changed.get(`estado:${s.uid}`), changed.get(`fila:${s.uid}`));
        }
        return changed.get(`fila:${s.uid}`);
    }
    async cycle(s) {
        const initialQueue = await this.service.lerFila(s.uid);
        if (initialQueue.compatibilityBlocked) {
            // Only a successful, supported server read can release the durable gate.
            const compatible = await this.snapshot(s);
            if (!this.current(s)) return;
            if (!initialQueue.restoreJob) await this.reconcile(s, compatible);
            else await this.service.alterarFila(s.uid, queue => { if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.'); delete queue.compatibilityBlocked; return queue; });
        }
        if (initialQueue.restoreJob) await this.resumeRestore(s, initialQueue.restoreJob);
        if (!this.current(s)) return;
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
                () => this.client.saveSettings(s.uid, settings, snapshot.settings?.revision || null, () => this.current(s), snapshot.generation), true);
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
            await this.client.saveAutomaticHistory(s.uid, item, snapshot.generation);
            await this.service.alterarFila(s.uid, q => { if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
                const target = q.automaticHistory?.find(row => row.id === item.id); if (target) target.uploaded = true; return q; });
        }
        queue = await this.service.lerFila(s.uid);
        if (queue.outbox.length) { s.again = true; return; }
        for (const resolution of queue.automaticResolutions || []) if (!resolution.confirmed) {
            if (!this.current(s)) return;
            if (!await this.client.resolveConflict(s.uid, resolution.id, resolution.choice, snapshot.generation)) throw error('sync/invalid-ack', 'Histórico sem confirmação remota.');
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
        const notices = (await this.service.lerFila(s.uid)).recoveryNotices || [];
        this.status(notices.some(item => !item.acknowledged) ? recoveryStatus : 'Sincronizado', false, confirmation.fila.lastConfirmed);
    }
    listen(s) {
        s.ready = true;
        const received = (_data, meta) => { if (this.current(s) && snapshotConfirmed(meta)) this.request(); };
        const failure = cause => {
            if (!this.current(s)) return;
            s.stops.splice(0).forEach(stop => stop()); s.ready = false;
            if (cause.code === 'permission-denied' && this.client.generationSnapshot) this.request(0); else this.report(cause, s);
        };
        s.stops.push(this.client.listen(s.uid, received, failure, s.generation), this.client.listenSettings(s.uid, received, failure, s.generation), this.client.listenConflicts(s.uid, received, failure, s.generation));
        if (this.client.listenGeneration) s.stops.push(this.client.listenGeneration(s.uid, received, failure));
    }
    emitState(s, stored, queue) {
        if (!this.current(s) || (s.visibleRevision ?? -1) > stored.revisao) return;
        s.visibleRevision = stored.revisao;
        this.onState(stored.dados, { generation: queue?.generation || 'legacy',
            recoveryNotices: (queue?.recoveryNotices || []).filter(item => !item.acknowledged), compatibilityBlocked: Boolean(queue?.compatibilityBlocked) });
    }
    async resumeRestore(s, job) {
        if (!this.client.publishRestore) throw error('sync/upgrade-required', 'Atualize o cliente antes de restaurar.');
        await this.client.publishRestore(s.uid, job, () => this.current(s));
        if (!this.current(s)) return;
        const result = await this.db.alterarDocumentos([`estado:${s.uid}`, `fila:${s.uid}`], docs => {
            if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
            const queue = docs.get(`fila:${s.uid}`);
            if (!queue.restoreJob && queue.generation === job.generation) return docs;
            if (queue.restoreJob?.generation !== job.generation) throw error('sync/restore-conflict', 'Restauração local alterada.');
            queue.restoreJob = null; queue.generation = job.generation; queue.initialized = true;
            queue.settingsBaseline = functionalSettings(financeSettings(job.state));
            queue.automaticSettingsDirty = false; queue.automaticSettingsValue = null;
            docs.set(`fila:${s.uid}`, queue); return docs;
        });
        this.emitState(s, result.get(`estado:${s.uid}`), result.get(`fila:${s.uid}`));
    }
    async importBackup(raw, confirm = () => false) {
        let s = this.session;
        if (!s) throw error('sync/sign-in-required', 'Entre com Google antes de importar para a conta.');
        if ((await this.service.lerFila(s.uid)).compatibilityBlocked) throw error('sync/upgrade-required', upgradeMessage);
        if (!this.client.publishRestore) throw error('sync/upgrade-required', 'Atualize o cliente antes de restaurar.');
        if ((await this.service.lerFila(s.uid)).compatibilityBlocked) throw error('sync/upgrade-required', upgradeMessage);
        const previous = await this.db.ler(`estado:${s.uid}`);
        const restored = prepareGenerationRestore(raw, previous?.dados?.tema);
        if (!validarTotaisMonetarios(restored)) throw error('sync/invalid-backup', 'Backup excede os limites financeiros.');
        if (!confirm()) return null;
        await this.waitLocal(); if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
        let observedGeneration = null;
        if (this.online && this.client.generationMarker) {
            try { observedGeneration = (await this.client.generationMarker(s.uid))?.activeGeneration || 'legacy'; }
            catch (cause) { if (!transientSyncError(cause)) throw cause; }
        }
        if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
        // Invalidate old in-flight callbacks without changing Auth or the account.
        this.closeSession();
        s = { uid: s.uid, user: s.user, stops: [], attempt: 0, ready: false, permanent: false };
        this.session = s;
        const generation = globalThis.crypto.randomUUID();
        const recoveryKey = `restore-recovery:${s.uid}:${generation}`;
        const result = await this.db.alterarDocumentos([`estado:${s.uid}`, `fila:${s.uid}`, recoveryKey], docs => {
            if (!this.current(s)) throw error('persistence/cancelled', 'Sessão alterada.');
            const stored = docs.get(`estado:${s.uid}`), queue = docs.get(`fila:${s.uid}`), before = stored.dados;
            if (queue.compatibilityBlocked) throw error('sync/upgrade-required', upgradeMessage);
            docs.set(recoveryKey, { state: structuredClone(before), queue: structuredClone(queue), reason: 'explicit-restore' });
            const nextQueue = { generation, initialized: true, automaticPolicyInitialized: true, outbox: [], conflicts: [], remoteRevisions: {},
                recoveryNotices: [...(queue.recoveryNotices || []), ...((queue.outbox.length || queue.automaticSettingsDirty || queue.conflicts.length)
                    ? [{ id: recoveryKey, code: 'archived-offline', acknowledged: false }] : [])],
                recoveryKeys: [...(queue.recoveryKeys || []), recoveryKey],
                restoreJob: { generation, baseGeneration: observedGeneration || queue.restoreJob?.baseGeneration || queue.generation || 'legacy', state: restored } };
            stored.dados = restored; stored.revisao++;
            docs.set(`estado:${s.uid}`, stored); docs.set(`fila:${s.uid}`, nextQueue); return docs;
        }).catch(cause => { if (this.current(s)) this.localChanged(); throw cause; });
        if (this.current(s)) { this.emitState(s, result.get(`estado:${s.uid}`), result.get(`fila:${s.uid}`)); this.localChanged(); }
        return result.get(`estado:${s.uid}`).dados;
    }
}
