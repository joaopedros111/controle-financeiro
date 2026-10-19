const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const json = (value) => JSON.stringify(canonical(value));
export const jsonCanonico = json;

export function createSyncSessionGuard() {
    let current = 0;
    return {
        begin() { current += 1; return current; },
        current() { return current; },
        isCurrent(session) { return session === current; },
        invalidate() { current += 1; }
    };
}

const safeMoney = (value) => typeof value === "number" && Number.isFinite(value)
    && value >= 0 && value <= 2 ** 44 && Math.round(value * 100) <= (2 ** 44) * 100;
const validTimestamp = (value) => !!value && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)
    && value.seconds >= 0 && value.nanoseconds >= 0 && value.nanoseconds < 1_000_000_000;
const validBudgetMap = (value) => value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length <= 1000
    && Object.entries(value).every(([category, amount]) => category.trim().length > 0
        && category.length <= 40 && safeMoney(amount));

export function validateRemoteSettings(settings) {
    if (settings === null) return true;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)
        || Object.keys(settings).some((key) => !["version", "categories", "theme", "budgets", "revision", "updatedAt"].includes(key))
        || ![2, 3].includes(settings.version)
        || !Array.isArray(settings.categories) || settings.categories.length > 1000
        || settings.categories.some((category) => typeof category !== "string" || !category.trim() || category.length > 40)
        || new Set(settings.categories).size !== settings.categories.length
        || !["claro", "escuro", "rosa", "floresta", "pangolim"].includes(settings.theme)
        || typeof settings.revision !== "string" || !settings.revision || settings.revision.length > 128
        || !validTimestamp(settings.updatedAt)) return false;
    const budgets = settings.budgets;
    // The persisted finance-core model normalizes month-specific overrides to an empty map.
    if (!budgets || typeof budgets !== "object" || Array.isArray(budgets)
        || Object.keys(budgets).some((key) => !["padrao", "meses"].includes(key))
        || !validBudgetMap(budgets.padrao) || Object.keys(budgets.padrao).some((category) => !settings.categories.includes(category)) || !budgets.meses || typeof budgets.meses !== "object"
        || Array.isArray(budgets.meses) || Object.keys(budgets.meses).length !== 0) return false;
    return true;
}

export function mergeRemoteSettings(state, settings) {
    if (!validateRemoteSettings(settings)) return { valid: false, state };
    if (settings === null) return { valid: true, state };
    return { valid: true, state: { ...state, categorias: settings.categories, tema: settings.theme, orcamentos: settings.budgets } };
}

// Active record: {month,type,id,record,deleted:false,revision,updatedAt}.
// Tombstone: {month,type,id,deleted:true,revision,updatedAt}; record is forbidden.
export function validRemoteTombstone(item) {
    const allowed = ["month", "type", "id", "deleted", "revision", "updatedAt", "_docId", "hasPendingWrites"];
    return !!item && Object.keys(item).every((key) => allowed.includes(key)) && item.deleted === true && typeof item.month === "string"
        && /^\d{4}-(0[1-9]|1[0-2])$/.test(item.month)
        && typeof item.id === "string" && item.id.length > 0 && item.id.length <= 128
        && ["receitas", "despesas"].includes(item.type)
        && typeof item.revision === "string" && item.revision.length > 0 && item.revision.length <= 128
        && validTimestamp(item.updatedAt) && !Object.hasOwn(item, "record")
        && (item._docId === undefined || typeof item._docId === "string")
        && (item.hasPendingWrites === undefined || typeof item.hasPendingWrites === "boolean");
}

export function reconcileRemoteConflicts(localConflicts, remoteConflicts) {
    const merged = [...(Array.isArray(localConflicts) ? localConflicts : [])];
    const resolved = new Set((remoteConflicts || []).filter((item) => item?.resolved === true).map((item) => item.operationId));
    const unresolved = merged.filter((item) => !resolved.has(item?.operationId || item?.operation?.id));
    const unresolvedKeys = new Set(unresolved.map((item) => item?.operationId || item?.operation?.id).filter(Boolean));
    for (const item of remoteConflicts || []) {
        if (!item || item.resolved === true || typeof item.operationId !== "string" || !item.operationId
            || typeof item.entityKey !== "string" || !item.entityKey
            || !item.local || typeof item.local !== "object" || Array.isArray(item.local)
            || item.remote !== null && (!item.remote || typeof item.remote !== "object" || Array.isArray(item.remote))) continue;
        if (unresolvedKeys.has(item.operationId)) {
            const index = unresolved.findIndex((entry) => (entry?.operationId || entry?.operation?.id) === item.operationId);
            const existing = unresolved[index];
            unresolved[index] = { ...existing, kind: existing.kind || "concurrent-change", operationId: item.operationId,
                entityKey: item.entityKey, operation: existing.operation || { id: item.operationId, entityKey: item.entityKey, value: item.local },
                local: existing.local || item.local, remote: item.remote, createdAt: item.createdAt, source: "firestore" };
            continue;
        }
        unresolved.push({ kind: "concurrent-change", operationId: item.operationId, entityKey: item.entityKey,
            operation: { id: item.operationId, entityKey: item.entityKey, value: item.local },
            local: item.local, remote: item.remote, createdAt: item.createdAt, source: "firestore" });
        unresolvedKeys.add(item.operationId);
    }
    return unresolved;
}

export function validateRemoteConflicts(items) {
    if (!Array.isArray(items)) return null;
    const validTimestampShape = (value) => validTimestamp(value);
    for (const item of items) {
        if (!item || typeof item.operationId !== "string" || !item.operationId || item.operationId.length > 128
            || typeof item.entityKey !== "string" || !item.entityKey || item.entityKey.length > 512
            || !item.local || typeof item.local !== "object" || Array.isArray(item.local)
            || item.remote !== null && (!item.remote || typeof item.remote !== "object" || Array.isArray(item.remote))
            || !validTimestampShape(item.createdAt)
            || (item._docId !== undefined && item._docId !== item.operationId)) return null;
        if (typeof item.local.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.local.month)
            || !["receitas", "despesas"].includes(item.local.type) || typeof item.local.id !== "string"
            || typeof item.local.deleted !== "boolean" || (!item.local.deleted && (!item.local.record || typeof item.local.record !== "object"))) return null;
        if (item.remote && (typeof item.remote.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.remote.month)
            || !["receitas", "despesas"].includes(item.remote.type) || typeof item.remote.id !== "string"
            || typeof item.remote.deleted !== "boolean" || typeof item.remote.revision !== "string"
            || !validTimestampShape(item.remote.updatedAt) || (!item.remote.deleted && (!item.remote.record || typeof item.remote.record !== "object")))) return null;
        if (item.resolved === true) {
            if (!["local", "remote", "both"].includes(item.resolution) || !validTimestampShape(item.resolvedAt)) return null;
        } else if (Object.hasOwn(item, "resolved") || Object.hasOwn(item, "resolution") || Object.hasOwn(item, "resolvedAt")) return null;
    }
    return items;
}

export const chaveLocalConta = (uid) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid || "")) throw new TypeError("UID inválido");
    return `controleFinanceiro:v3:uid:${uid}`;
};
export const caminhoConta = (uid, collection, id) => {
    if (!/^(records|settings|operations|conflicts|meta)$/.test(collection)) throw new TypeError("Coleção inválida");
    return `users/${encodeURIComponent(uid)}/${collection}/${encodeURIComponent(id)}`;
};

export function registrosFinanceiros(state) {
    const result = [];
    for (const [month, data] of Object.entries(state?.meses || {})) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) continue;
        for (const type of ["receitas", "despesas"]) {
            for (const record of data?.[type] || []) if (record?.id) result.push({ month, type, id: record.id, record });
        }
    }
    return result;
}

export function signature(record) {
    const r = record.record;
    const amount = Math.round(Number(r.valor) * 100);
    const relevant = record.type === "receitas"
        ? [record.month, record.type, r.nome?.trim().toLocaleLowerCase(), amount, r.serie || null]
        : [record.month, record.type, r.nome?.trim().toLocaleLowerCase(), amount, r.categoria || "Outros", Boolean(r.pago), Boolean(r.fixa), r.parcela || null, r.serie || null];
    return JSON.stringify(relevant);
}

export function combinarRegistros(local, remoto, { deduplicarExatos = false } = {}) {
    const merged = new Map(remoto.map((entry) => [`${entry.month}/${entry.type}/${entry.id}`, structuredClone(entry)]));
    const conflitos = [];
    const possiveisDuplicatas = [];
    const remoteSignatures = new Map(remoto.map((entry) => [signature(entry), entry]));
    for (const item of local) {
        const key = `${item.month}/${item.type}/${item.id}`;
        const sameId = merged.get(key);
        if (sameId) {
            if (json(sameId.record) !== json(item.record)) {
                const preserved = { ...structuredClone(item), id: `${item.id}-local-${operationId(key, null, item.record)}` };
                merged.set(`${item.month}/${item.type}/${preserved.id}`, preserved);
                conflitos.push({ kind: "same-id", local: item, remote: sameId, preserved });
            }
            continue;
        }
        const candidate = remoteSignatures.get(signature(item));
        if (candidate) {
            possiveisDuplicatas.push({ local: item, remote: candidate });
            if (deduplicarExatos) continue;
        }
        merged.set(key, structuredClone(item));
    }
    return { records: [...merged.values()], conflitos, possiveisDuplicatas };
}

export function operationId(entityKey, baseRevision, value) {
    const text = `${entityKey}|${baseRevision || "new"}|${json(value)}`;
    const hashes = [2166136261, 2246822519, 3266489917, 668265263];
    const primes = [16777619, 3266489917, 668265263, 2246822519];
    for (let i = 0; i < text.length; i += 1) for (let lane = 0; lane < hashes.length; lane += 1) {
        hashes[lane] = Math.imul(hashes[lane] ^ (text.charCodeAt(i) + lane * 31), primes[lane]);
    }
    return hashes.map((hash) => (hash >>> 0).toString(16).padStart(8, "0")).join("") + text.length.toString(16).padStart(8, "0");
}

export function makeOperation(entityKey, value, baseRevision = null) {
    return { id: operationId(entityKey, baseRevision, value), entityKey, value: structuredClone(value), baseRevision, state: "pending" };
}

export function revisionMatches(current, expected) {
    return (current?.revision || null) === (expected || null);
}

export function applyRemoteRecord(state, item) {
    const next = structuredClone(state);
    next.meses ||= {};
    next.meses[item.month] ||= { receitas: [], despesas: [] };
    const records = next.meses[item.month][item.type];
    const index = records.findIndex(({ id }) => id === item.id);
    if (item.deleted) { if (index >= 0) records.splice(index, 1); }
    else if (index >= 0) records[index] = structuredClone(item.record);
    else records.push(structuredClone(item.record));
    return next;
}

export function createSyncQueue(storage, uid) {
    const key = `controleFinanceiro:sync:${uid}`;
    const read = () => storage.get(key) || { enabled: true, outbox: [], conflicts: [], lastConfirmed: null, initialized: false };
    const write = (value) => storage.set(key, value);
    return {
        state: read,
        enqueue(operation) {
            const current = read();
            if (!current.outbox.some((entry) => entry.id === operation.id)) current.outbox.push(operation);
            write(current);
            return current;
        },
        acknowledge(id, confirmedAt = new Date().toISOString()) {
            const current = read(); current.outbox = current.outbox.filter((entry) => entry.id !== id);
            current.lastConfirmed = confirmedAt; write(current); return current;
        },
        addConflict(conflict) { const current = read(); current.conflicts.push(conflict); write(current); return current; }
    };
}

export function coalesceOutbox(existing, candidates) {
    const result = structuredClone(existing || []);
    for (const candidate of candidates) {
        const index = result.findIndex((operation) => operation.entityKey === candidate.entityKey);
        if (index >= 0) result[index] = { ...structuredClone(candidate), baseRevision: result[index].baseRevision };
        else result.push(structuredClone(candidate));
    }
    return result;
}

export async function flushSyncQueue(uid, storage, commit, now = () => new Date().toISOString()) {
    const queue = createSyncQueue(storage, uid);
    for (const operation of queue.state().outbox) {
        const result = await commit(uid, operation);
        if (result?.conflict) queue.addConflict({ kind: "concurrent-change", operation, remote: result.remote || null });
        queue.acknowledge(operation.id, now());
    }
    return queue.state();
}

export function migrationBackup(state, storage, uid) {
    const key = `controleFinanceiro:sync-backup:${uid}`;
    if (storage.get?.(key)) return key;
    if (!storage.set(key, structuredClone(state))) throw new Error("Não foi possível guardar o backup anterior à migração.");
    return key;
}
