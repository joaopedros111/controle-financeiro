import { createVaultCrypto } from './finance-vault-crypto.js';
import { copyDocumentMap, MAX_SNAPSHOT_BYTES } from './finance-vault-limits.js';

const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const messages = {
    locked: 'Cofre bloqueado.', missing: 'Cofre inexistente.', corruption: 'Integridade do cofre não confirmada.',
    'invalid-input': 'Dados ou contexto do cofre inválidos.', 'stale-revision': 'Revisão do cofre desatualizada.',
    'already-exists': 'Cofre já existente.', 'invalid-operation': 'Operação preparada indisponível.',
    cancelled: 'Contexto de desbloqueio alterado.'
};
export class VaultBackendError extends Error {
    constructor(code) { super(messages[code] || messages.corruption); this.name = 'VaultBackendError'; this.code = Object.hasOwn(messages, code) ? code : 'corruption'; }
}
const fail = code => { throw new VaultBackendError(code); };
function text(value, max = 128) {
    if (typeof value !== 'string' || !value.length || value.length > max || !value.isWellFormed()) fail('invalid-input');
}
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function jsonBytes(value) {
    const active = new Set();
    const visit = v => {
        if (v === null || typeof v === 'boolean') return;
        if (typeof v === 'string') { if (!v.isWellFormed()) fail('invalid-input'); return; }
        if (typeof v === 'number') { if (!Number.isFinite(v) || Object.is(v, -0)) fail('invalid-input'); return; }
        if ((!plain(v) && !Array.isArray(v)) || active.has(v)) fail('invalid-input');
        active.add(v);
        const fields = Reflect.ownKeys(v).filter(k => !(Array.isArray(v) && k === 'length'));
        if (Array.isArray(v) && (fields.length !== v.length || fields.some((k, i) => k !== String(i)))) fail('invalid-input');
        for (const k of fields) {
            const d = Object.getOwnPropertyDescriptor(v, k);
            if (typeof k !== 'string' || !d.enumerable || !Object.hasOwn(d, 'value')) fail('invalid-input');
            visit(d.value);
        }
        active.delete(v);
    };
    visit(value);
    return encoder.encode(JSON.stringify(value));
}
function parse(bytes) { try { return JSON.parse(decoder.decode(bytes)); } catch { fail('corruption'); } }

/** Store is a dedicated adapter; test suites may inject a transactional memory
 * model. Opening/constructing does not initialize financial data or unlock keys.
 */
export function createVaultBackend({ store, context, crypto: provider = globalThis.crypto, codec, validateCatalog }) {
    jsonBytes(context);
    if (!plain(context) || !plain(context.owner) || Object.keys(context).sort().join() !== 'keyId,owner,vaultId'
        || Object.keys(context.owner).sort().join() !== 'projectId,uid') fail('invalid-input');
    for (const v of [context.keyId, context.vaultId, context.owner.projectId, context.owner.uid]) text(v);
    const owned = structuredClone(context), scope = JSON.stringify([owned.owner.projectId, owned.owner.uid, owned.vaultId, owned.keyId]);
    const crypto = createVaultCrypto({ crypto: provider, reserveIV: reservation => store.reserveIV(reservation) });
    const encode = codec ? value => codec.encode(value) : jsonBytes;
    const decode = codec ? bytes => codec.decode(bytes) : parse;
    const clone = value => copyDocumentMap(value, encode, decode);
    let key = null, epoch = {};
    const prepared = new WeakMap();
    const current = captured => { if (captured !== epoch) fail('cancelled'); };
    const unlocked = () => { if (!key) fail('locked'); return { key, epoch }; };
    const allowed = id => typeof id === 'string' && (id === `estado:${owned.owner.uid}` || id === `fila:${owned.owner.uid}`
        || [`restore-recovery:${owned.owner.uid}:`, `conflicts:${owned.owner.uid}:`, `snapshot:${owned.owner.uid}:`].some(prefix => id.startsWith(prefix) && id.length > prefix.length));
    const documentContext = (documentId, revision, generation) => ({ ...structuredClone(owned), documentId, schemaVersion: 1, revision, generation });
    function graph(documents, generation) {
        if (!plain(documents) || Object.keys(documents).length > 1000) fail('invalid-input');
        const uid = owned.owner.uid;
        if (!plain(documents[`estado:${uid}`]) || !plain(documents[`fila:${uid}`])
            || !Array.isArray(documents[`fila:${uid}`].outbox) || !Array.isArray(documents[`fila:${uid}`].conflicts)) fail('invalid-input');
        const queue = documents[`fila:${uid}`];
        if (queue.generation !== generation || (queue.restoreJob && queue.restoreJob.generation !== generation)) fail('invalid-input');
        const references = [];
        const refs = value => {
            if (!value || !Object.hasOwn(value, 'recoveryKeys')) return;
            const child = value.recoveryKeys;
            if (!Array.isArray(child) || child.some(id => !allowed(id) || !Object.hasOwn(documents, id))) fail('invalid-input');
            references.push(...child);
        };
        for (const id of Object.keys(documents)) {
            text(id, 512); if (!allowed(id)) fail('invalid-input');
            if (id === `estado:${uid}`) continue;
            refs(documents[id]);
            if (id !== `fila:${uid}`) refs(documents[id].queue);
        }
        return [...new Set(references)].sort();
    }
    async function readSnapshot(handle, captured) {
        const raw = await store.load(scope); current(captured);
        if (raw === null) fail('missing');
        try {
            const enhanced = raw?.version === 2;
            if (!plain(raw) || Object.keys(raw).sort().join() !== (enhanced ? 'catalog,documents,generation,manifest,revision,version' : 'documents,generation,manifest,revision,version')
                || ![1, 2].includes(raw.version) || (enhanced && (!codec || !validateCatalog)) || !Number.isSafeInteger(raw.revision) || raw.revision < 1 || !Array.isArray(raw.documents)
                || raw.documents.length < 2 || raw.documents.length > 1000) fail('corruption');
            text(raw.generation);
            const manifestBytes = await crypto.decryptDocument(handle, raw.manifest, documentContext('@manifest', raw.revision, raw.generation));
            let manifest;
            try { manifest = parse(manifestBytes); } finally { manifestBytes.fill(0); }
            current(captured);
            if (!plain(manifest) || Object.keys(manifest).sort().join() !== (enhanced ? 'catalog,codec,generation,ids,references,revision,version' : 'generation,ids,references,revision,version')
                || manifest.version !== 1 || manifest.revision !== raw.revision || manifest.generation !== raw.generation
                || !Array.isArray(manifest.ids) || manifest.ids.length !== raw.documents.length
                || new Set(manifest.ids).size !== manifest.ids.length) fail('corruption');
            if (enhanced) {
                validateCatalog(raw.catalog, { context: owned, generation: raw.generation, snapshotRevision: raw.revision });
                if (manifest.codec !== codec.id || JSON.stringify(manifest.catalog) !== JSON.stringify(raw.catalog)) fail('corruption');
            } else if (codec) fail('corruption');
            const documents = Object.create(null);
            for (let i = 0; i < manifest.ids.length; i++) {
                const id = manifest.ids[i]; if (!allowed(id)) fail('corruption');
                const bytes = await crypto.decryptDocument(handle, raw.documents[i], documentContext(id, raw.revision, raw.generation));
                try { documents[id] = decode(bytes); } finally { bytes.fill(0); }
                current(captured);
            }
            if (JSON.stringify(graph(documents, raw.generation)) !== JSON.stringify(manifest.references)) fail('corruption');
            return { raw, revision: raw.revision, generation: raw.generation, documents };
        } catch (error) {
            current(captured);
            if (error?.code === 'invalid-key') fail('locked');
            fail('corruption');
        }
    }
    async function prepareWrite({ expectedRevision, generation, updates, catalog }, initializing = false) {
        const captured = unlocked(); text(generation);
        // Validate/copy all user objects before asynchronous work or JSON traversal.
        const changes = clone(updates), nextGeneration = generation;
        const nextCatalog = catalog === undefined ? undefined : structuredClone(catalog);
        let before = null, documents;
        if (initializing) {
            before = await store.load(scope); current(captured.epoch);
            if (before !== null) fail('already-exists');
            documents = changes;
        } else {
            const previous = await readSnapshot(captured.key, captured.epoch);
            if (previous.revision !== expectedRevision) fail('stale-revision');
            before = previous.raw;
            // No deletion API: omitted recoveries/history are always retained.
            documents = Object.assign(previous.documents, changes);
        }
        const revision = initializing ? 1 : expectedRevision + 1;
        clone(documents); // Enforce the same aggregate profile after merging updates.
        if (!Number.isSafeInteger(revision) || revision < 1) fail('invalid-input');
        const references = graph(documents, nextGeneration), ids = Object.keys(documents).sort(), envelopes = [];
        const selectedCatalog = nextCatalog ?? before?.catalog;
        if (codec) {
            if (!selectedCatalog || !validateCatalog) fail('invalid-input');
            validateCatalog(selectedCatalog, { context: owned, generation: nextGeneration, snapshotRevision: revision });
        } else if (selectedCatalog) fail('invalid-input');
        for (const id of ids) {
            const bytes = encode(documents[id]);
            try { envelopes.push(await crypto.encryptDocument(captured.key, bytes, documentContext(id, revision, nextGeneration))); }
            finally { bytes.fill(0); }
            current(captured.epoch);
        }
        const bytes = jsonBytes({ version: 1, revision, generation: nextGeneration, ids, references,
            ...(codec ? { codec: codec.id, catalog: selectedCatalog } : {}) });
        let manifest;
        try { manifest = await crypto.encryptDocument(captured.key, bytes, documentContext('@manifest', revision, nextGeneration)); }
        finally { bytes.fill(0); }
        current(captured.epoch);
        const next = { version: codec ? 2 : 1, revision, generation: nextGeneration, manifest, documents: envelopes,
            ...(codec ? { catalog: selectedCatalog } : {}) };
        if (jsonBytes(next).length > MAX_SNAPSHOT_BYTES) fail('invalid-input');
        const token = Object.freeze(Object.create(null));
        prepared.set(token, { before, next, epoch: captured.epoch });
        return token;
    }
    function lock() { epoch = {}; if (key) crypto.destroyKey(key); key = null; }
    async function openKey(operation) {
        lock(); const captured = epoch;
        const candidate = await operation();
        try {
            current(captured);
            const raw = await store.load(scope); current(captured);
            if (raw !== null) await readSnapshot(candidate, captured);
            current(captured); key = candidate;
        } catch (error) { crypto.destroyKey(candidate); throw error; }
    }
    return Object.freeze({
        lock,
        async close() { lock(); store.close(); },
        async createKey() {
            lock(); const captured = epoch;
            if (await store.load(scope) !== null) fail('already-exists'); current(captured);
            await openKey(() => crypto.generateDataKey(owned));
        },
        protectWithPassword(password, wrapRevision = 1) {
            const captured = unlocked();
            return crypto.protectWithPassword(captured.key, password, wrapRevision).then(result => { current(captured.epoch); return result; });
        },
        protectWithRecovery(wrapRevision = 1) {
            const captured = unlocked();
            return crypto.protectWithRecovery(captured.key, wrapRevision).then(result => { current(captured.epoch); return result; });
        },
        protectWithKnownRecovery(secret, wrapRevision = 1) {
            const captured = unlocked();
            return crypto.protectWithKnownRecovery(captured.key, secret, wrapRevision).then(result => { current(captured.epoch); return result; });
        },
        rewrapPassword(envelope, oldPassword, newPassword, wrapRevision) {
            const captured = unlocked();
            return crypto.changePassword(envelope, oldPassword, newPassword, { ...owned, wrapRevision }).then(result => { current(captured.epoch); return result; });
        },
        unlockWithPassword(envelope, password, wrapRevision = 1) {
            return openKey(() => crypto.unlockWithPassword(envelope, password, { ...owned, wrapRevision }));
        },
        unlockWithRecovery(envelope, secret, wrapRevision = 1) {
            return openKey(() => crypto.recoverDataKey(envelope, secret, { ...owned, wrapRevision }));
        },
        async read() {
            const captured = unlocked();
            const snapshot = await readSnapshot(captured.key, captured.epoch);
            return { revision: snapshot.revision, generation: snapshot.generation, documents: snapshot.documents,
                ...(snapshot.raw.catalog ? { catalog: snapshot.raw.catalog } : {}) };
        },
        async exportSnapshot() { const captured = unlocked(); const snapshot = await readSnapshot(captured.key, captured.epoch); clone(snapshot.documents); return snapshot.raw; },
        async sealArtifact(documentId, bytes) {
            const captured = unlocked(), snapshot = await readSnapshot(captured.key, captured.epoch);
            const envelope = await crypto.encryptDocument(captured.key, bytes, documentContext(documentId, snapshot.revision, snapshot.generation)); current(captured.epoch); return envelope;
        },
        async openArtifact(documentId, envelope) {
            const captured = unlocked(), snapshot = await readSnapshot(captured.key, captured.epoch);
            const bytes = await crypto.decryptDocument(captured.key, envelope, documentContext(documentId, snapshot.revision, snapshot.generation));
            try { current(captured.epoch); return bytes; } catch (error) { bytes.fill(0); throw error; }
        },
        prepare: args => prepareWrite(args),
        async initialize({ generation, documents, catalog, coordination }) {
            const token = await prepareWrite({ generation, updates: documents, catalog }, true);
            const item = prepared.get(token); prepared.delete(token); current(item.epoch);
            const revision = await store.compareAndSwap(scope, item.before, item.next, () => item.epoch === epoch && !!key, coordination); current(item.epoch); return revision;
        },
        async commit(token, coordination) {
            const item = token && prepared.get(token);
            if (!item) fail('invalid-operation');
            prepared.delete(token); unlocked(); current(item.epoch);
            const revision = await store.compareAndSwap(scope, item.before, item.next, () => item.epoch === epoch && !!key, coordination); current(item.epoch); return revision;
        }
    });
}
