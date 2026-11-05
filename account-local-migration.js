import { normalizarEstado, validarBackup, validarTotaisMonetarios } from './finance-core.js';
import { registrosFinanceiros, combinarRegistros, inspectRemoteKeys, validConflictRecord } from './sync-core.js';

export function analisarMigracaoLocal(estadoLocal, registrosRemotos = [], filaLocal = null) {
    if (filaLocal === null || filaLocal === undefined) {
        throw new Error('Fila local obrigatória. Migração bloqueada.');
    }
    {
        if (
            !filaLocal ||
            typeof filaLocal !== 'object' ||
            Array.isArray(filaLocal) ||
            !Array.isArray(filaLocal.outbox) ||
            !Array.isArray(filaLocal.conflicts)
        ) {
            throw new Error('Fila local inválida. Migração bloqueada.');
        }

        if (
            filaLocal.outbox.length ||
            filaLocal.conflicts.length ||
            filaLocal.restoredPending ||
            filaLocal.migrationPending ||
            filaLocal.restoreJob ||
            filaLocal.compatibilityBlocked ||
            filaLocal.automaticSettingsDirty ||
            filaLocal.recoveryKeys?.length ||
            filaLocal.recoveryNotices?.length ||
            filaLocal.automaticHistory?.length ||
            filaLocal.automaticResolutions?.length
        ) {
            throw new Error('Existem operações ou dados de recuperação pendentes. Migração bloqueada.');
        }
    }
    if (!validarBackup(estadoLocal) || !validarTotaisMonetarios(estadoLocal)) {
        throw new Error('Dados locais inválidos. Migração bloqueada.');
    }

    if (!Array.isArray(registrosRemotos)) {
        throw new Error('Registros remotos inválidos.');
    }

    // Não importar exclusões sem uma resolução explícita.
    if (registrosRemotos.some(item => item?.deleted === true)) {
        throw new Error('Existem exclusões remotas. Migração bloqueada.');
    }

    // Validar o conteúdo antes de gerar as chaves.
    for (const item of registrosRemotos) {
        if (!validConflictRecord(item, { remote: true })) {
            throw new Error('Registro remoto inválido. Migração bloqueada.');
        }
    }

    const chaves = inspectRemoteKeys(registrosRemotos);

    if (chaves.duplicates.length || chaves.mismatches.length) {
        throw new Error(
            'Registros remotos com chaves duplicadas ou inconsistentes. Migração bloqueada.'
        );
    }

    const local = registrosFinanceiros(estadoLocal);
    const combinado = combinarRegistros(local, registrosRemotos);

    const meses = {};
    for (const item of combinado.records) {
        meses[item.month] ||= { receitas: [], despesas: [] };
        meses[item.month][item.type].push(item.record);
    }

    const estadoCombinado = normalizarEstado({
        ...estadoLocal,
        meses
    });

    if (!validarBackup(estadoCombinado) ||
        !validarTotaisMonetarios(estadoCombinado)) {
        throw new Error('Resultado da migração inválido.');
    }

    return {
        estado: estadoCombinado,
        quantidadeLocal: local.length,
        quantidadeRemota: registrosRemotos.length,
        duplicidades: combinado.possiveisDuplicatas,
        conflitos: combinado.conflitos
    };
}

// Discovery and review ONLY. Raw originals remain in their original durable stores.
// A preview is not a backup, consent to import, or a migration completion receipt.
import { migrarDadosLegados, normalizarValorMonetario } from './finance-core.js';
import { ANONYMOUS_KEYS, LEGACY_STORAGE_KEYS } from './account-data-policy.js';
import { recordEntityKey, snapshotConfirmed, validateRemoteSettings, validateRemoteConflicts, jsonCanonico, operationId, settingsEquivalent } from './sync-core.js';

const failure = (code, message) => Object.assign(new Error(message), { code });
const ordinary = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const emptyQueue = () => ({ outbox: [], conflicts: [] });
const rowCount = state => Object.values(state?.meses || {}).reduce((n, month) => n + (month.receitas?.length || 0) + (month.despesas?.length || 0), 0);
const blockedQueue = q => !ordinary(q) || !Array.isArray(q.outbox) || !Array.isArray(q.conflicts)
    || q.outbox.length || q.conflicts.length || q.restoredPending || q.migrationPending || q.restoreJob || q.compatibilityBlocked
    || q.automaticSettingsDirty || Object.keys(q.attempted || {}).length || q.recoveryKeys?.length || q.recoveryNotices?.length
    || q.automaticHistory?.length || q.automaticResolutions?.length || q.conflictHistory?.length || q.conflictDecisions?.length || q.backupJobs?.length;
function preview(raw, source) {
    if (!validarBackup(raw, { permitirTextoNumerico: true })) throw new Error('Dados financeiros inválidos');
    let index = 0;
    const value = normalizarEstado(structuredClone(raw), () => 'legacy-preview-' + operationId(source, null, ++index));
    if (!validarBackup(value) || !validarTotaisMonetarios(value) || rowCount(value) !== rowCount(raw)) throw new Error('Conversão incompleta');
    return { value, conversions: jsonCanonico(raw) !== jsonCanonico(value), assignedIds: index };
}
function unknownFields(raw) {
    const allowed = ['versao','tema','categorias','meses','orcamentos'];
    if (Object.keys(raw).some(k => !allowed.includes(k))) return true;
    for (const month of Object.values(raw.meses || {})) {
        if (Object.keys(month).some(k => !['receitas','despesas'].includes(k))) return true;
        for (const type of ['receitas','despesas']) for (const row of month[type] || []) {
            if (Object.keys(row).some(k => !['id','nome','valor','serie', ...(type === 'receitas' ? ['recebido'] : ['categoria','pago','fixa','parcela'])].includes(k))) return true;
        }
    }
    return false;
}
async function ensureSession(uid, isCurrent) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid || '') || typeof isCurrent !== 'function' || await isCurrent() !== true)
        throw failure('migration/session-changed', 'Sessão Google ausente ou alterada. Nenhuma fonte foi modificada.');
}
export async function descobrirFontesAnonimas({ db, storage, uid, isCurrent, anoLegado = new Date().getFullYear() }) {
    await ensureSession(uid, isCurrent);
    const sources = [], blockers = [], candidates = [], monthly = {};
    const addBlock = (code, source) => blockers.push({ code, source });
    let pair;
    try { pair = await db.lerDocumentos(ANONYMOUS_KEYS); if (!(pair instanceof Map) || ANONYMOUS_KEYS.some(k => !pair.has(k))) throw new Error('Leitura incompleta'); }
    catch { pair = new Map(); ANONYMOUS_KEYS.forEach(key => { sources.push({ key, backend: 'IndexedDB', status: 'inacessivel' }); addBlock('source-unavailable', key); }); }
    await ensureSession(uid, isCurrent);
    for (const key of ANONYMOUS_KEYS) if (pair.has(key)) {
        const value = pair.get(key), source = { key, backend: 'IndexedDB', status: value === null ? 'ausente' : 'presente', original: structuredClone(value) };
        sources.push(source);
        if (value === null) continue;
        if (key === 'estado:@local') {
            try {
                if (!ordinary(value) || !Number.isSafeInteger(value.revisao) || value.revisao < 0 || !validarBackup(value.dados)) throw new Error('Estado inválido');
                const normalized = preview(value.dados, key);
                source.status = 'valido'; source.revision = value.revisao; source.quantity = rowCount(value.dados);
                source.conversions = normalized.conversions; source.assignedIds = normalized.assignedIds;
                if (unknownFields(value.dados)) addBlock('unsupported-fields', key);
                candidates.push({ key, priority: 0, state: normalized.value });
            } catch { source.status = 'invalido'; addBlock('invalid-source', key); }
        } else {
            source.status = ordinary(value) && Array.isArray(value.outbox) && Array.isArray(value.conflicts)
                && value.outbox.every(op => ordinary(op) && typeof op.id === 'string' && op.id.length > 0 && op.id.length <= 128
                    && validConflictRecord(op.value) && op.entityKey === recordEntityKey(op.value)
                    && (op.baseRevision === null || typeof op.baseRevision === 'string' && op.baseRevision.length > 0)) ? 'valido' : 'invalido';
            if (source.status === 'invalido') addBlock('invalid-queue', key);
            else {
                source.pending = value.outbox.length; source.conflicts = value.conflicts.length;
                source.tombstones = value.outbox.filter(op => op?.value?.deleted === true).length;
                if (blockedQueue(value)) addBlock('pending-queue-or-recovery', key);
            }
        }
    }
    if (pair.has(ANONYMOUS_KEYS[0]) && ((pair.get(ANONYMOUS_KEYS[0]) === null) !== (pair.get(ANONYMOUS_KEYS[1]) === null))) addBlock('partial-state-queue', 'IndexedDB');
    for (const key of LEGACY_STORAGE_KEYS) {
        await ensureSession(uid, isCurrent);
        const source = { key, backend: 'localStorage', status: 'ausente' }; sources.push(source);
        let raw;
        try { if (!storage || typeof storage.getItem !== 'function') throw new Error('Storage indisponível'); raw = storage.getItem(key); }
        catch { source.status = 'inacessivel'; addBlock('source-unavailable', key); continue; }
        if (raw === null) continue;
        source.raw = raw;
        try {
            const parsed = JSON.parse(raw); source.original = structuredClone(parsed);
            if (key.startsWith('controleFinanceiro:sync')) {
                if (!ordinary(parsed)) throw new Error('Metadados inválidos');
                source.status = 'metadados';
                // Absence is not a verified empty queue. Any metadata requires reconciliation.
                addBlock('legacy-metadata-unverified', key); continue;
            }
            const match = /^controleFinanceiro-(\d+)$/.exec(key);
            if (match) {
                const m = Number(match[1]);
                if (!ordinary(parsed) || Object.keys(parsed).some(k => !['renda','despesas','categorias'].includes(k))
                    || parsed.categorias !== undefined && (!Array.isArray(parsed.categorias) || parsed.categorias.some(c => typeof c !== 'string' || !c.trim() || c.length > 40))
                    || parsed.despesas !== undefined && !Array.isArray(parsed.despesas)
                    || parsed.renda !== undefined && normalizarValorMonetario(parsed.renda) === null) throw new Error('Mês legado inválido');
                const oneMonth = { meses: { [String(anoLegado) + '-' + String(m).padStart(2,'0')]: {
                    receitas: parsed.renda !== undefined && Number(parsed.renda) > 0 ? [{ nome: 'Renda mensal', valor: parsed.renda }] : [], despesas: parsed.despesas || [] } } };
                if (!validarBackup(oneMonth, { permitirTextoNumerico: true })) throw new Error('Despesas mensais inválidas');
                monthly[m] = structuredClone(parsed);
                source.status = 'valido'; source.inferredYear = anoLegado; source.quantity = rowCount(oneMonth); continue;
            }
            const normalized = preview(parsed, key);
            source.status = 'valido'; source.quantity = rowCount(parsed); source.conversions = normalized.conversions; source.assignedIds = normalized.assignedIds;
            if (unknownFields(parsed)) addBlock('unsupported-fields', key);
            candidates.push({ key, priority: LEGACY_STORAGE_KEYS.indexOf(key) + 1, state: normalized.value });
        } catch { source.status = 'invalido'; addBlock('invalid-source', key); }
    }
    if (Object.keys(monthly).length) {
        try {
            if (!Number.isInteger(anoLegado) || anoLegado < 2000 || anoLegado > 2100) throw new Error('Ano inválido');
            const raw = migrarDadosLegados(monthly, anoLegado), normalized = preview(raw, 'meses-legados');
            if (unknownFields(raw)) addBlock('unsupported-fields', 'meses-legados');
            // The pure legacy converter must not silently filter an invalid expense.
            for (const [m, original] of Object.entries(monthly)) {
                const converted = normalized.value.meses[`${anoLegado}-${String(m).padStart(2,'0')}`];
                if (converted.despesas.length !== (original.despesas?.length || 0)) throw new Error('Despesas legadas incompletas');
            }
            candidates.push({ key: 'meses-legados', priority: 100, state: normalized.value });
            addBlock('legacy-year-requires-review', 'meses-legados');
        } catch { addBlock('invalid-monthly-source', 'meses-legados'); }
    }
    candidates.sort((a, b) => a.priority - b.priority);
    const selected = candidates[0] || null;
    const divergent = selected ? candidates.filter(c => jsonCanonico(c.state) !== jsonCanonico(selected.state)).map(c => c.key) : [];
    if (divergent.length) addBlock('divergent-sources', divergent.join(', '));
    const found = sources.filter(s => s.status !== 'ausente');
    const verifiedQueue = sources.find(s => s.key === 'fila:@local' && s.status === 'valido')?.original || null;
    if (found.length && !verifiedQueue) addBlock('queue-unverified', 'origem anônima');
    await ensureSession(uid, isCurrent);
    let fingerprint = null;
    try {
        const bytes = new TextEncoder().encode(jsonCanonico(sources.map(s => ({ key: s.key, status: s.status, raw: s.raw, original: s.original }))));
        fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2,'0')).join('');
    } catch { addBlock('source-fingerprint-unavailable', 'fontes locais'); }
    await ensureSession(uid, isCurrent);
    return { uid, sources, candidates, selected: selected?.key || null, divergent, blockers, fingerprint,
        required: found.length > 0, quantity: selected ? rowCount(selected.state) : 0,
        queue: verifiedQueue, anonymousRevision: pair.get('estado:@local')?.revisao ?? null };
}
export function analisarFontesDescobertas(discovery, snapshot) {
    const blockers = [...discovery.blockers], analyses = [];
    if (!snapshot || snapshot.uid !== discovery.uid || !snapshotConfirmed(snapshot.metadata)) throw failure('migration/unconfirmed-snapshot', 'Snapshot remoto sem confirmação do servidor.');
    if (![1, 2].includes(snapshot.protocol) || typeof snapshot.generation !== 'string' || !snapshot.generation) throw failure('migration/protocol', 'Protocolo remoto incompatível.');
    if (!Array.isArray(snapshot.records) || !validateRemoteSettings(snapshot.settings) || !validateRemoteConflicts(snapshot.conflicts)) throw failure('migration/invalid-remote', 'Snapshot remoto inválido.');
    if (snapshot.conflicts.length) blockers.push({ code: 'remote-conflicts', source: 'Firebase' });
    if (snapshot.records.some(row => row?.deleted)) blockers.push({ code: 'remote-tombstones', source: 'Firebase' });
    if (snapshot.records.some(row => row?.hasPendingWrites === true)) throw failure('migration/unconfirmed-snapshot', 'Gravações remotas ainda pendentes.');
    const inspected = inspectRemoteKeys(snapshot.records);
    if (inspected.duplicates.length || inspected.mismatches.length || snapshot.records.some(row => !validConflictRecord(row, { remote: true }))) throw failure('migration/invalid-remote', 'Chaves ou registros remotos inválidos.');
    for (const source of discovery.candidates) {
        // Preview combinations only with verified local queue; never synthesize a proof.
        const local = registrosFinanceiros(source.state);
        const combined = combinarRegistros(local, snapshot.records.filter(row => !row.deleted));
        analyses.push({ source: source.key, quantity: local.length, conflicts: combined.conflitos.length,
            duplicates: combined.possiveisDuplicatas.length, identical: local.filter(item => snapshot.records.some(remote => recordEntityKey(remote) === recordEntityKey(item) && jsonCanonico(remote.record) === jsonCanonico(item.record))).length,
            settingsDiffer: snapshot.settings !== null && !settingsEquivalent({ version: 3, categories: source.state.categorias, theme: source.state.tema || 'claro', budgets: source.state.orcamentos }, snapshot.settings) });
    }
    for (const item of analyses) {
        if (item.conflicts) blockers.push({ code: 'record-conflicts-require-review', source: item.source });
        if (item.duplicates) blockers.push({ code: 'possible-duplicates-require-review', source: item.source });
        if (item.settingsDiffer) blockers.push({ code: 'settings-require-review', source: item.source });
    }
    for (const source of discovery.sources) if (source.assignedIds) blockers.push({ code: 'legacy-ids-require-durable-ledger', source: source.key });
    // No import path exists until atomic source revalidation and durable recovery have a tested contract.
    blockers.push({ code: 'atomic-import-not-implemented', source: 'migração' });
    return { uid: discovery.uid, generation: snapshot.generation, quantityLocal: discovery.quantity,
        quantityRemote: snapshot.records.filter(row => !row.deleted).length, sources: discovery.sources.map(({ original, raw, ...meta }) => meta),
        analyses, blockers, importAllowed: false, sourcesPreserved: true, fingerprint: discovery.fingerprint };
}
export async function revisarFontesAnonimas({ db, storage, uid, isCurrent, snapshotReader, online, anoLegado }) {
    await ensureSession(uid, isCurrent);
    if (online !== true) throw failure('migration/offline', 'Conecte-se antes de revisar a cópia remota. As fontes permanecem preservadas.');
    const discovery = await descobrirFontesAnonimas({ db, storage, uid, isCurrent, anoLegado });
    await ensureSession(uid, isCurrent);
    if (typeof snapshotReader !== 'function') throw failure('migration/unconfirmed-snapshot', 'Leitor remoto confirmado indisponível.');
    const accountKeys = ['estado:' + uid, 'fila:' + uid];
    const accountBefore = await db.lerDocumentos(accountKeys);
    if (!(accountBefore instanceof Map) || !accountBefore.get(accountKeys[0]) || !accountBefore.get(accountKeys[1]))
        throw failure('migration/account-unavailable', 'Conta Google ainda não inicializada. Nenhuma fonte foi alterada.');
    const remote = await snapshotReader(uid);
    await ensureSession(uid, isCurrent);
    const after = await descobrirFontesAnonimas({ db, storage, uid, isCurrent, anoLegado });
    const accountAfter = await db.lerDocumentos(accountKeys);
    if (jsonCanonico([...accountBefore]) !== jsonCanonico([...accountAfter])) throw failure('migration/account-changed', 'A revisão ou fila da conta Google mudou. Revise novamente.');
    await ensureSession(uid, isCurrent);
    if (!discovery.fingerprint || discovery.fingerprint !== after.fingerprint) throw failure('migration/source-changed', 'Outra aba alterou uma fonte durante a revisão. Revise novamente.');
    return analisarFontesDescobertas(discovery, remote);
}
export function importarFontesAnonimas() {
    throw failure('migration/import-blocked', 'Importação bloqueada: faltam contrato atômico de origem, mapeamento de filas/exclusões e recuperação durável homologada. Nenhuma fonte foi modificada.');
}
import { makeOperation, recordsEquivalent } from './sync-core.js';
import { financeSettings } from './automatic-sync-policy.js';
import { pendingFinancialData } from './account-data-policy.js';

// An immutable reviewed plan is private until explicit consent produces a durable journal.
const reviewedImports = new WeakMap();
const same = (a, b) => jsonCanonico(a) === jsonCanonico(b);
const pairKeys = uid => [`estado:${uid}`, `fila:${uid}`];
const requireCurrent = isCurrent => {
    if (typeof isCurrent !== 'function' || isCurrent() !== true) throw failure('migration/session-changed', 'Sessão encerrada.');
};
const requireTransaction = db => {
    if (!db?.requerConta || !db.acessoConta || typeof db.alterarComLeituras !== 'function')
        throw failure('migration/atomic-unavailable', 'Importação exige persistência nativa protegida por conta.');
};
function validateJournal(journal, uid, key) {
    if (!journal || journal.version !== 1 || journal.kind !== 'anonymous-google-import' || journal.uid !== uid
        || key !== 'restore-recovery:' + uid + ':migration-' + journal.id || !/^[a-f0-9]{64}$/.test(journal.id)
        || !['prepared', 'applied', 'confirmed'].includes(journal.state) || !journal.consent?.explicit || !journal.consent?.ownershipAcknowledged
        || !validarBackup(journal.source) || !validarTotaisMonetarios(journal.source)
        || !Array.isArray(journal.sourcePair) || !Array.isArray(journal.before) || journal.remote?.uid !== uid || journal.remote?.generation !== journal.generation
        || !same(journal.operations, registrosFinanceiros(journal.source).map(row => ({ ...makeOperation(recordEntityKey(row), { ...row, deleted: false }, null), generation: journal.generation }))))
        throw failure('migration/journal-invalid', 'Diário inválido; recuperação manual necessária.');
}
function checkSource(journal, reads) {
    if (!same([...reads], journal.sourcePair)) throw failure('migration/source-changed', 'A origem mudou; revise novamente.');
}
function checkOwned(journal, docs) {
    if (!same(journal.before, pairKeys(journal.uid).map(key => [key, docs.get(key)])))
        throw failure('migration/account-changed', 'A conta mudou; nenhum lançamento foi substituído.');
}

export async function prepararImportacaoAnonima(options) {
    const report = await revisarFontesAnonimas(options);
    requireTransaction(options.db);
    const discovery = await descobrirFontesAnonimas(options);
    const keys = pairKeys(options.uid), before = await options.db.lerDocumentos(keys);
    const snapshot = await options.snapshotReader(options.uid);
    await ensureSession(options.uid, options.isCurrent);
    const sourcePair = await options.db.lerDocumentos(ANONYMOUS_KEYS);
    const finalDiscovery = await descobrirFontesAnonimas(options);
    const finalOwned = await options.db.lerDocumentos(keys);
    if (!same([...before], [...finalOwned]) || discovery.fingerprint !== report.fingerprint || discovery.fingerprint !== finalDiscovery.fingerprint)
        throw failure('migration/review-changed', 'A revisão mudou. Repita a revisão.');
    const analyzed = analisarFontesDescobertas(discovery, snapshot);
    const blockers = analyzed.blockers.filter(item => item.code !== 'atomic-import-not-implemented');
    const source = discovery.candidates.find(item => item.key === 'estado:@local');
    if (!discovery.queue || Object.keys(discovery.queue).some(key => !['outbox', 'conflicts'].includes(key)))
        blockers.push({ code: 'anonymous-queue-metadata-requires-review', source: 'fila:@local' });
    // The first safe contract deliberately excludes cross-storage and pending anonymous intentions.
    if (discovery.sources.some(item => !ANONYMOUS_KEYS.includes(item.key) && item.status !== 'ausente') || !source)
        blockers.push({ code: 'native-pair-required', source: 'origem' });
    if (discovery.sources.some(item => item.assignedIds || item.conversions)) blockers.push({ code: 'conversion-requires-review', source: 'origem' });
    const owned = before.get(keys[0]), queue = before.get(keys[1]);
    if (!owned || !Number.isSafeInteger(owned.revisao) || owned.revisao < 0 || !validarBackup(owned.dados) || !queue
        || pendingFinancialData(queue) || registrosFinanceiros(owned.dados).length || snapshot.records.length)
        blockers.push({ code: 'empty-confirmed-target-required', source: 'conta Google' });
    if (owned && (!settingsEquivalent(financeSettings(owned.dados), snapshot.settings || financeSettings(normalizarEstado(null)))
        || Object.keys(queue?.remoteRevisions || {}).length)) blockers.push({ code: 'local-settings-or-revisions-unconfirmed', source: 'conta Google' });
    if ((queue?.generation || 'legacy') !== snapshot.generation) blockers.push({ code: 'generation-changed', source: 'conta Google' });
    if (source && snapshot.protocol === 1 && Object.keys(source.state.orcamentos?.meses || {}).length)
        blockers.push({ code: 'legacy-monthly-budgets', source: 'origem' });
    const result = { ...analyzed, blockers, importAllowed: blockers.length === 0 };
    if (result.importAllowed) result.preview = { records: registrosFinanceiros(source.state), settings: financeSettings(source.state) };
    if (!result.importAllowed) return result;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jsonCanonico({ uid: options.uid, fingerprint: discovery.fingerprint, generation: snapshot.generation })));
    const id = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
    const journal = { version: 1, kind: 'anonymous-google-import', id, uid: options.uid, generation: snapshot.generation,
        fingerprint: discovery.fingerprint, sourcePair: [...sourcePair], before: [...before], remote: snapshot,
        source: source.state, state: 'prepared', operations: registrosFinanceiros(source.state).map(row => ({ ...makeOperation(recordEntityKey(row), { ...row, deleted: false }, null), generation: snapshot.generation })) };
    const key = `restore-recovery:${options.uid}:migration-${id}`;
    reviewedImports.set(result, { db: options.db, journal, key });
    return result;
}

export async function registrarConsentimentoMigracao({ review, consent, ownershipAcknowledged, isCurrent }) {
    if (consent !== true || ownershipAcknowledged !== true || !review?.importAllowed || !reviewedImports.has(review))
        throw failure('migration/consent-required', 'Revise a origem e confirme explicitamente sua propriedade e a importação.');
    const { db, journal, key } = reviewedImports.get(review); requireTransaction(db);
    await ensureSession(journal.uid, isCurrent);
    await db.alterarComLeituras([key], [...ANONYMOUS_KEYS, ...pairKeys(journal.uid)], (docs, reads) => {
        // isCurrent is synchronous inside a transaction; the durable guard also validates epoch/UID.
        requireCurrent(isCurrent);
        const previous = docs.get(key);
        if (previous) {
            if (previous.kind !== journal.kind || previous.fingerprint !== journal.fingerprint || previous.uid !== journal.uid) throw failure('migration/journal-invalid', 'Diário incompatível.');
            return docs;
        }
        checkSource(journal, new Map(ANONYMOUS_KEYS.map(k => [k, reads.get(k)])));
        checkOwned(journal, reads);
        docs.set(key, { ...structuredClone(journal), consent: { explicit: true, ownershipAcknowledged: true, at: new Date().toISOString() } });
        return docs;
    });
    return key;
}

export async function retomarImportacaoAnonima({ db, uid, journalKey, isCurrent, snapshotReader, online }) {
    requireTransaction(db); await ensureSession(uid, isCurrent);
    if (online !== true || typeof snapshotReader !== 'function') throw failure('migration/offline', 'Revalidação remota necessária.');
    if (typeof journalKey !== 'string' || !journalKey.startsWith(`restore-recovery:${uid}:migration-`)) throw failure('migration/journal-invalid', 'Diário de outra conta.');
    const journal = (await db.lerDocumentos([journalKey])).get(journalKey);
    if (!journal || journal.kind !== 'anonymous-google-import' || journal.uid !== uid || !journal.consent?.explicit || !journal.consent?.ownershipAcknowledged)
        throw failure('migration/journal-invalid', 'Diário ou consentimento ausente.');
    validateJournal(journal, uid, journalKey);
    const remote = await snapshotReader(uid); await ensureSession(uid, isCurrent);
    // Reuse all remote identity, metadata, record and protocol validators.
    analisarFontesDescobertas({ uid, blockers: [], candidates: [], sources: [], quantity: 0 }, remote);
    if (remote.generation !== journal.generation) throw failure('migration/generation-changed', 'Geração remota alterada.');
    const keys = pairKeys(uid);
    const result = await db.alterarComLeituras([...keys, journalKey], ANONYMOUS_KEYS, (docs, reads) => {
        requireCurrent(isCurrent);
        const durable = docs.get(journalKey);
        validateJournal(durable, uid, journalKey);
        const immutable = value => Object.fromEntries(['version','kind','id','uid','generation','fingerprint','sourcePair','before','remote','source','operations','consent'].map(key => [key, value[key]]));
        if (!same(immutable(durable), immutable(journal))) throw failure('migration/journal-changed', 'Outra aba alterou o plano do diário.');
        // Another tab may have committed this exact plan while this tab awaited the server.
        // Accept its durable receipt, never replay its writes or replace newer account state.
        const queue = docs.get(keys[1]);
        if (!queue || (queue.generation || 'legacy') !== journal.generation) throw failure('migration/generation-changed', 'Geração local alterada.');
        if (durable.state === 'applied' || durable.state === 'confirmed') return docs; // No replay, even after later edits.
        if (durable.state !== 'prepared') throw failure('migration/journal-invalid', 'Estado de diário inválido.');
        if (!same(remote, durable.remote)) throw failure('migration/remote-changed', 'Destino remoto mudou; revisão necessária.');
        checkSource(durable, reads); checkOwned(durable, docs);
        const before = docs.get(keys[0]);
        const next = { ...before, revisao: before.revisao + 1, dados: structuredClone(durable.source) };
        if (!Number.isSafeInteger(next.revisao)) throw failure('migration/revision-overflow', 'Revisão inválida.');
        const settings = financeSettings(next.dados);
        const nextQueue = { ...queue, initialized: true, automaticPolicyInitialized: true,
            outbox: [...queue.outbox, ...durable.operations], remoteRevisions: {}, settingsBaseline: remote.settings,
            automaticSettingsDirty: remote.settings === null, automaticSettingsValue: remote.settings === null ? settings : queue.automaticSettingsValue,
            recoveryKeys: [...new Set([...(queue.recoveryKeys || []), journalKey])] };
        docs.set(keys[0], next); docs.set(keys[1], nextQueue);
        docs.set(journalKey, { ...durable, state: 'applied', appliedRevision: next.revisao, appliedAt: new Date().toISOString() });
        return docs;
    });
    return { journalKey, state: result.get(journalKey).state, revision: result.get(keys[0]).revisao };
}

export async function reconciliarImportacaoAnonima({ db, uid, journalKey, isCurrent, snapshotReader }) {
    requireTransaction(db); await ensureSession(uid, isCurrent);
    if (!journalKey?.startsWith(`restore-recovery:${uid}:migration-`)) throw failure('migration/journal-invalid', 'Diário inválido.');
    const remote = await snapshotReader(uid); await ensureSession(uid, isCurrent);
    analisarFontesDescobertas({ uid, blockers: [], candidates: [], sources: [], quantity: 0 }, remote);
    const keys = pairKeys(uid);
    const result = await db.alterarDocumentos([...keys, journalKey], docs => {
        requireCurrent(isCurrent);
        const journal = docs.get(journalKey), state = docs.get(keys[0]), queue = docs.get(keys[1]);
        if (!journal || journal.uid !== uid || !['applied', 'confirmed'].includes(journal.state)) throw failure('migration/journal-invalid', 'Importação não aplicada.');
        validateJournal(journal, uid, journalKey);
        if (!state || !queue || remote.conflicts.length || pendingFinancialData({ ...queue, recoveryKeys: (queue.recoveryKeys || []).filter(key => key !== journalKey) }) || remote.generation !== journal.generation || (queue.generation || 'legacy') !== journal.generation
            || queue.outbox.length || queue.conflicts.length || queue.automaticSettingsDirty || queue.confirmedRevision !== state.revisao
            || queue.confirmedGeneration !== journal.generation || !Number.isFinite(Date.parse(queue.lastConfirmed))
            || journal.operations.some(op => !remote.records.some(row => row.revision === op.id && recordEntityKey(row) === op.entityKey && !row.deleted && recordsEquivalent({ month: row.month, type: row.type, id: row.id, deleted: row.deleted, record: row.record }, op.value)))
            || !settingsEquivalent(financeSettings(journal.source), remote.settings))
            throw failure('migration/ack-required', 'Confirmação exata do servidor ainda não demonstrada.');
        docs.set(journalKey, { ...journal, state: 'confirmed', confirmedAt: new Date().toISOString(), confirmedRevision: state.revisao });
        // Keep the journal itself and original source forever; release only this pending reference.
        docs.set(keys[1], { ...queue, recoveryKeys: (queue.recoveryKeys || []).filter(key => key !== journalKey) });
        return docs;
    });
    return result.get(journalKey);
}
export async function consultarImportacaoPendente({ db, uid, isCurrent }) {
    requireTransaction(db); await ensureSession(uid, isCurrent);
    const queue = (await db.lerDocumentos([`fila:${uid}`])).get(`fila:${uid}`);
    const keys = (queue?.recoveryKeys || []).filter(key => key.startsWith(`restore-recovery:${uid}:migration-`));
    if (!keys.length) return null;
    if (keys.length !== 1) throw failure('migration/manual-recovery-required', 'Múltiplos diários pendentes exigem recuperação manual.');
    const journal = (await db.lerDocumentos(keys)).get(keys[0]); await ensureSession(uid, isCurrent);
    if (!journal || journal.uid !== uid || journal.kind !== 'anonymous-google-import' || journal.state !== 'applied'
        || journal.generation !== (queue.generation || 'legacy') || !journal.consent?.explicit || !journal.consent?.ownershipAcknowledged)
        throw failure('migration/manual-recovery-required', 'Diário pendente precisa de revisão manual.');
    validateJournal(journal, uid, keys[0]);
    return { uid, generation: journal.generation, journalKey: keys[0], resumeAllowed: true, importAllowed: false,
        quantityLocal: journal.operations.length, quantityRemote: 0, analyses: [], sources: [], blockers: [] };
}
