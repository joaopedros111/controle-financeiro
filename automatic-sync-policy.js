import { normalizarEstado, validarBackup } from './finance-core.js';
import { registrosFinanceiros, recordEntityKey, operationId, recordsEquivalent, settingsEquivalent, functionalSettings, makeOperation, validSyncIdentity, validConflictRecord, validateRemoteSettings } from './sync-core.js';

export const financeSettings = state => ({ version: state.versao || 3, categories: [...(state.categorias || [])].sort(),
    theme: state.tema || 'claro', budgets: state.orcamentos || { padrao: {}, meses: {} } });
const copy = value => structuredClone(value);
const envelope = value => ({ month: value.month, type: value.type, id: value.id, deleted: false, record: copy(value.record) });
export function prepareGenerationRestore(raw, currentTheme = 'claro') {
    if (!validarBackup(raw)) throw Object.assign(new Error('Arquivo inválido.'), { code: 'sync/invalid-backup' });
    const restored = normalizarEstado(raw);
    restored.tema ||= currentTheme || 'claro';
    const settings = { ...financeSettings(restored), revision: 'validation', updatedAt: { seconds: 0, nanoseconds: 0 } };
    if (!validateRemoteSettings(settings) || registrosFinanceiros(restored).some(item => !validSyncIdentity(item.id) || !validConflictRecord(envelope(item)))) {
        throw Object.assign(new Error('O backup contém dados incompatíveis com a sincronização. Nenhum dado foi alterado.'), { code: 'sync/invalid-backup' });
    }
    return restored;
}
export function archiveAutomatic(queue, entry) {
    const id = `auto-history-${operationId(entry.entityKey, entry.remote?.revision || null, entry)}`;
    queue.automaticHistory ||= [];
    if (!queue.automaticHistory.some(item => item.id === id)) queue.automaticHistory.push({ id, ...copy(entry), uploaded: false });
    return id;
}
function replaceRecord(state, value) {
    state.meses[value.month] ||= { receitas: [], despesas: [] };
    const list = state.meses[value.month][value.type];
    const index = list.findIndex(item => item.id === value.id);
    if (value.deleted) { if (index >= 0) list.splice(index, 1); }
    else if (index >= 0) list[index] = copy(value.record); else list.push(copy(value.record));
}

// Server reads and revision CAS establish order. Device clocks never elect a winner.
// Called inside ONE IndexedDB transaction for state, queue and recovery history.
export function reconcileAutomatic(state, queue, records, settings, remoteConflicts = []) {
    const next = copy(state), q = copy(queue);
    // Capture a pre-existing legacy settings edit once, before applying any
    // snapshot. Later snapshots may derive display categories, never intent.
    if (!q.automaticPolicyInitialized && q.settingsBaseline && !settingsEquivalent(financeSettings(state), q.settingsBaseline)) {
        q.automaticSettingsDirty = true; q.automaticSettingsValue = financeSettings(state);
    }
    q.automaticPolicyInitialized = true;
    q.automaticResolutions ||= [];
    const local = new Map(registrosFinanceiros(next).map(item => [recordEntityKey(item), item]));
    for (const remote of records) {
        const key = recordEntityKey(remote), pending = q.outbox.filter(op => op.entityKey === key);
        const original = local.get(key);
        if (q.restoredPending && original && (remote.deleted || !recordsEquivalent(original.record, remote.record))) {
            archiveAutomatic(q, { entityKey: key, policy: 'legacy-backup-preserved', local: { record: original }, remote });
        }
        const deletion = pending.find(op => op.value.deleted)
            || q.conflicts.find(item => item.operation?.entityKey === key && item.operation.value?.deleted)?.operation
            || remoteConflicts.filter(item => !item.resolved).map(item => ({ entityKey: item.entityKey, value: item.local, id: item.operationId }))
                .find(item => item.entityKey === key && item.value?.deleted);
        if (remote.deleted) {
            if (pending.length) archiveAutomatic(q, { entityKey: key, policy: 'delete-wins',
                local: { record: original || null, operations: pending }, remote });
            q.outbox = q.outbox.filter(op => op.entityKey !== key);
            replaceRecord(next, remote);
        } else if (deletion) {
            replaceRecord(next, { ...remote, deleted: true });
            if (!pending.length || pending[0].baseRevision !== remote.revision || !pending[0].value.deleted) {
                archiveAutomatic(q, { entityKey: key, policy: 'delete-wins', local: { operations: pending, deletion }, remote });
                q.outbox = q.outbox.filter(op => op.entityKey !== key);
                q.outbox.push(makeOperation(key, { month: remote.month, type: remote.type, id: remote.id, deleted: true }, remote.revision));
            }
        } else if (pending.length && (pending[0].baseRevision === remote.revision || pending.some(op => op.id === remote.revision))) {
            // Preserve optimistic local state; replay/ACK original IDs, including a lost ACK.
        } else {
            if (pending.length || original && !q.remoteRevisions?.[key] && !recordsEquivalent(original.record, remote.record)) {
                archiveAutomatic(q, { entityKey: key, policy: 'server-confirmed-wins', local: { record: original || null, operations: pending }, remote });
            }
            q.outbox = q.outbox.filter(op => op.entityKey !== key);
            replaceRecord(next, remote);
        }
    }
    for (const conflict of [...q.conflicts, ...remoteConflicts.filter(item => !item.resolved)]) {
        const key = conflict.entityKey || conflict.operation?.entityKey || (conflict.month && conflict.type && conflict.id ? recordEntityKey(conflict) : 'settings');
        archiveAutomatic(q, { entityKey: key, policy: conflict.operation?.value?.deleted ? 'delete-wins' : 'server-confirmed-wins',
            local: conflict, remote: key === 'settings' ? settings : records.find(item => recordEntityKey(item) === key) || conflict.remote || null });
        const id = conflict.operationId || (conflict.source === 'firestore' ? conflict.operation?.id : null);
        if (id && !q.automaticResolutions.some(item => item.id === id)) q.automaticResolutions.push({ id,
            choice: conflict.operation?.value?.deleted || conflict.local?.deleted ? 'local' : 'remote', confirmed: false });
    }
    for (const decision of q.conflictDecisions || []) if (decision.status !== 'confirmed') {
        archiveAutomatic(q, { entityKey: 'previous-decision', policy: 'server-confirmed-wins',
            local: { conflict: decision.conflict, choice: decision.choice, operations: decision.supersededOperations || [] }, remote: settings });
        decision.status = 'confirmed'; decision.automatic = true;
    }
    q.conflicts = [];
    if (settings) {
        const baseline = q.settingsBaseline;
        const localChanged = q.automaticSettingsDirty;
        const remoteChanged = !baseline || !settingsEquivalent(settings, baseline);
        if (!localChanged || remoteChanged) {
            if ((localChanged || !baseline && q.automaticHasLocalSettings) && !settingsEquivalent(financeSettings(next), settings)) archiveAutomatic(q, {
                entityKey: 'settings', policy: 'server-confirmed-wins', local: financeSettings(next), remote: settings
            });
            next.categorias = copy(settings.categories); next.orcamentos = copy(settings.budgets);
            q.settingsBaseline = functionalSettings(settings); q.settingsRevision = settings.revision;
            q.automaticSettingsDirty = false;
            q.automaticSettingsValue = null;
        }
    }
    q.remoteRevisions = Object.fromEntries(records.map(item => [recordEntityKey(item), item.revision]));
    q.enabled = true;
    // Failed/attempted operations are not dropped here unless their full intent was archived.
    if (q.attempted) for (const id of Object.keys(q.attempted)) if (!q.outbox.some(op => op.id === id)) delete q.attempted[id];
    return { state: normalizarEstado(next), queue: q };
}

export function prepareAutomaticBackup(raw, current, queue) {
    if (!validarBackup(raw)) throw Object.assign(new Error('Arquivo inválido.'), { code: 'sync/invalid-backup' });
    if (Object.keys(raw.orcamentos?.meses || {}).length) throw Object.assign(new Error('O backup contém limites mensais não suportados. Nenhum dado foi importado.'), { code: 'sync/unsupported-backup' });
    const source = { versao: raw.versao || 2, categorias: raw.categorias || [], orcamentos: raw.orcamentos || {}, meses: {} };
    for (const [month, values] of Object.entries(raw.meses)) source.meses[month] = Object.fromEntries(['receitas','despesas'].map(type => [type,
        (values[type] || []).map(item => Object.fromEntries(['id','nome','valor','serie','categoria','pago','fixa','parcela','recebido'].filter(key => Object.hasOwn(item, key)).map(key => [key, item[key]])))]));
    const fingerprint = operationId('backup', null, source); let index = 0;
    const imported = normalizarEstado(raw, () => `backup-${fingerprint}-${++index}`);
    if (registrosFinanceiros(imported).some(item => !validSyncIdentity(item.id) || !validConflictRecord(envelope(item)))) throw Object.assign(new Error('Arquivo inválido.'), { code: 'sync/invalid-backup' });
    const next = copy(current), existing = new Map(registrosFinanceiros(next).map(item => [recordEntityKey(item), item]));
    for (const item of registrosFinanceiros(imported)) {
        const prior = existing.get(recordEntityKey(item));
        if (prior) {
            if (!recordsEquivalent(prior.record, item.record)) archiveAutomatic(queue, { entityKey: recordEntityKey(item),
                policy: 'existing-record-wins-on-reimport', local: envelope(item), remote: prior });
        } else replaceRecord(next, envelope(item));
    }
    next.categorias = [...new Set([...current.categorias, ...imported.categorias])];
    next.orcamentos.padrao = { ...imported.orcamentos.padrao, ...current.orcamentos.padrao };
    queue.automaticSettingsDirty ||= !settingsEquivalent(financeSettings(current), financeSettings(next));
    if (queue.automaticSettingsDirty) queue.automaticSettingsValue = financeSettings(next);
    queue.backupJobs ||= [];
    if (!queue.backupJobs.some(job => job.id === fingerprint)) queue.backupJobs.push({ id: fingerprint, status: 'pending',
        records: registrosFinanceiros(imported).map(recordEntityKey), count: registrosFinanceiros(imported).length });
    return normalizarEstado(next);
}

export function transientSyncError(error) {
    const code = String(error?.code || '').replace(/^firestore\//, '');
    return ['sync/generation-changed', 'sync/restore-in-progress', 'unavailable', 'aborted', 'deadline-exceeded', 'resource-exhausted', 'internal', 'auth/network-request-failed',
        'network-request-failed', 'persistence/cancelled', 'sync/retry'].includes(code);
}

export function captureRejectedLocalEdit(queue, base, proposal) {
    const before = new Map(registrosFinanceiros(base).map(item => [recordEntityKey(item), item]));
    const after = new Map(registrosFinanceiros(proposal).map(item => [recordEntityKey(item), item]));
    for (const key of new Set([...before.keys(), ...after.keys()])) {
        if (recordsEquivalent(before.get(key), after.get(key))) continue;
        archiveAutomatic(queue, { entityKey: key, policy: 'local-serialization-rejected', local: { base: before.get(key) || null, proposal: after.get(key) || null }, remote: null });
        if (before.has(key) && !after.has(key)) {
            const item = before.get(key), prior = queue.outbox.filter(op => op.entityKey === key).at(-1);
            const deletion = makeOperation(key, { month: item.month, type: item.type, id: item.id, deleted: true }, prior?.id || queue.remoteRevisions?.[key] || null);
            if (!queue.outbox.some(op => op.id === deletion.id)) queue.outbox.push(deletion);
        }
    }
    if (!settingsEquivalent(financeSettings(base), financeSettings(proposal))) archiveAutomatic(queue, { entityKey: 'settings', policy: 'local-serialization-rejected',
        local: financeSettings(proposal), remote: null });
    return queue;
}
