import { createVaultController } from '../finance-vault-controller.js';
import { createFinancialCodec } from '../finance-vault-codec.js';
import { copyDocumentMap } from '../finance-vault-limits.js';
import { vaultDigest } from '../finance-vault-recovery.js';
import { validarBackup } from '../finance-core.js';
import { requireMigrationCapabilities } from './finance-vault-migration-storage.js';

export class VaultMigrationError extends Error {
    constructor(code) { super('Migração sintética não autorizada ou não verificada.'); this.name = 'VaultMigrationError'; this.code = code; }
}
const fail = code => { throw new VaultMigrationError(code); };
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const plain = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.isWellFormed();
function exact(value, fields) { if (!plain(value) || Reflect.ownKeys(value).length !== fields.length || fields.some(k => !Object.hasOwn(value, k))
    || Reflect.ownKeys(value).some(k => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), 'value'))) fail('source-invalid'); }
function canonicalTree(node) {
    const [tag, value] = node;
    if (tag === 'object' || tag === 'null-object') return [tag, value.map(([k, v]) => [k, canonicalTree(v)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)];
    if (tag === 'array') return [tag, [value[0], value[1].map(([k, v]) => [k, canonicalTree(v)]).sort((a, b) => a[0] - b[0])]];
    if (tag.startsWith('custom:')) return [tag, canonicalTree(value)];
    return node;
}
// Canonical comparison keeps array order, sparse/undefined/type distinctions and
// exact numbers. Financial objects are not normalized, rounded or merged.
export function migrationCanonicalBytes(codec, value) {
    const bytes = codec.encode(value);
    try { const wire = JSON.parse(decoder.decode(bytes)); wire[2] = canonicalTree(wire[2]); return encoder.encode(JSON.stringify(wire)); }
    finally { bytes.fill(0); }
}
export function createSyntheticMigrator({ source, target, owner, crypto = globalThis.crypto, codec = createFinancialCodec(), onPhase = () => {} }) {
    requireMigrationCapabilities(source, target);
    if (!plain(owner) || Object.keys(owner).sort().join() !== 'projectId,uid' || !text(owner.projectId) || !owner.projectId.startsWith('demo-')
        || !text(owner.uid) || !/^synthetic-[A-Za-z0-9_-]+$/.test(owner.uid) || typeof onPhase !== 'function') fail('synthetic-only');
    owner = Object.freeze({ ...owner }); const uid = owner.uid, vaultId = 'synthetic-migration';
    let operation = null, active = null, closed = false;
    function cancel() { active = null; const old = operation; operation = null; old?.controllers.forEach(c => c.close()); }
    function begin() { if (closed) fail('cancelled'); cancel(); const op = { controllers: new Set() }; operation = op; return op; }
    const check = op => { if (closed || operation !== op) fail('cancelled'); };
    function controller(op, destination = target) {
        requireMigrationCapabilities(source, destination); check(op);
        // Each operation owns its keys; closing it must not close another tab's store.
        const c = createVaultController({ store: { ...destination.store, close() {} }, owner, vaultId, crypto, codec, channelFactory: () => null });
        op.controllers.add(c); return c;
    }
    const phase = async (op, name) => { try { await onPhase(name); } catch { fail('interrupted'); } check(op); };
    async function describe(op) {
        let raw; try { raw = await source.read(); } catch { fail('source-unavailable'); } check(op);
        exact(raw, ['format', 'version', 'owner', 'sourceId', 'revision', 'financialVersion', 'generation', 'documents']);
        exact(raw.owner, ['projectId', 'uid']);
        // Detach metadata before the first asynchronous digest. The documents are
        // copied below; neither retained provider objects nor later reads can edit it.
        raw = { ...raw, owner: { ...raw.owner } };
        if (raw.format !== 'cf-synthetic-financial-source' || raw.version !== 1 || raw.financialVersion !== 3 || !text(raw.sourceId) || !raw.sourceId.startsWith('synthetic-')
            || !Number.isSafeInteger(raw.revision) || raw.revision < 1 || !text(raw.generation)) fail('source-invalid');
        if (raw.owner.projectId !== owner.projectId || raw.owner.uid !== uid) fail('owner-mismatch');
        const mapPrototype = Object.getPrototypeOf(raw.documents || {});
        const documents = copyDocumentMap(raw.documents, codec.encode, codec.decode), state = documents[`estado:${uid}`], queue = documents[`fila:${uid}`];
        const ids = Object.keys(documents).sort();
        if (ids.length > 999 || ids.some(id => id.length > 512 || !id.isWellFormed() || !(id === `estado:${uid}` || id === `fila:${uid}`
            || [`snapshot:${uid}:`, `restore-recovery:${uid}:`, `conflicts:${uid}:`].some(prefix => id.startsWith(prefix) && id.length > prefix.length)))
            || !plain(state) || !Number.isSafeInteger(state.revisao) || state.revisao < 0 || state.dados?.versao !== raw.financialVersion || !validarBackup(state.dados)
            || !plain(queue) || queue.generation !== raw.generation || !Array.isArray(queue.outbox) || !Array.isArray(queue.conflicts)
            || queue.outbox.some(op => !plain(op) || !text(op.id) || (op.generation !== undefined && op.generation !== raw.generation))
            || (queue.restoreJob && queue.restoreJob.generation !== raw.generation)) fail('source-invalid');
        const hashes = [], canonical = new Map();
        for (const id of ids) {
            const bytes = migrationCanonicalBytes(codec, documents[id]);
            try { hashes.push({ id, sha256: await vaultDigest(bytes, crypto), bytes: bytes.length }); check(op); canonical.set(id, decoder.decode(bytes)); }
            finally { bytes.fill(0); }
        }
        const binding = { format: raw.format, version: raw.version, codec: codec.id, comparison: 'cf-migration-canonical-v1', owner, storageId: source.id, sourceId: raw.sourceId, revision: raw.revision, financialVersion: raw.financialVersion, generation: raw.generation,
            documentMapKind: mapPrototype === null ? 'null-object' : 'object', documents: hashes };
        const digest = await vaultDigest(encoder.encode(JSON.stringify(binding)), crypto); check(op);
        const recordCounts = Object.values(state.dados.meses).reduce((a, m) => ({ income: a.income + m.receitas.length, expense: a.expense + m.despesas.length }), { income: 0, expense: 0 });
        const counts = { documents: ids.length, ...recordCounts, offlineOperations: queue.outbox.length, conflicts: queue.conflicts.length,
            queuedTombstones: queue.outbox.filter(op => op.value?.deleted === true || op.tombstone === true).length,
            recoveryDocuments: ids.filter(id => id.startsWith(`restore-recovery:${uid}:`)).length };
        const journalId = `snapshot:${uid}:synthetic-migration-manifest-v1`;
        if (Object.hasOwn(documents, journalId)) fail('source-invalid');
        const journal = { format: 'cf-synthetic-migration-copy', version: 1, binding, digest, counts };
        return { documents, mapPrototype, canonical, binding, digest, counts, journalId, journal };
    }
    async function unchanged(op, baseline) { const now = await describe(op); if (now.digest !== baseline.digest) fail('source-changed'); return now; }
    function equivalent(baseline, snapshot) {
        if (snapshot.generation !== baseline.binding.generation || Object.keys(snapshot.documents).length !== baseline.counts.documents + 1
            || JSON.stringify(snapshot.documents[baseline.journalId]) !== JSON.stringify(baseline.journal)) fail('equivalence-failed');
        for (const [id, expected] of baseline.canonical) {
            if (!Object.hasOwn(snapshot.documents, id)) fail('equivalence-failed');
            const bytes = migrationCanonicalBytes(codec, snapshot.documents[id]);
            try { if (decoder.decode(bytes) !== expected) fail('equivalence-failed'); } finally { bytes.fill(0); }
        }
    }
    const evidence = b => Object.freeze({ version: 1, sourceDigest: b.digest, counts: Object.freeze({ ...b.counts }) });
    async function inspectTarget(op, c, baseline, password) {
        const status = await c.status(); check(op);
        if (status.state === 'missing') return null;
        if (!['locked', 'unlocked'].includes(status.state)) fail('destination-invalid');
        await c.unlockWithPassword(password); check(op); const snapshot = await c.read(); check(op);
        if (!Object.hasOwn(snapshot.documents, baseline.journalId) || snapshot.documents[baseline.journalId]?.digest !== baseline.digest) fail('destination-exists');
        equivalent(baseline, snapshot); return snapshot;
    }
    function finish(op) { if (active?.op !== op) { op.controllers.forEach(c => c.close()); if (operation === op) operation = null; } }
    return Object.freeze({
        async prepare({ password }) {
            const op = begin();
            try {
                const b = await describe(op); await phase(op, 'source-read'); const c = controller(op);
                const existing = await inspectTarget(op, c, b, password); await unchanged(op, b);
                if (existing) return { state: 'staged', alreadyCopied: true, recoverySecret: null, evidence: evidence(b) };
                const documents = Object.assign(Object.create(null), b.documents, { [b.journalId]: b.journal });
                copyDocumentMap(documents, codec.encode, codec.decode);
                await phase(op, 'before-create'); await unchanged(op, b);
                const created = await c.create({ password, generation: b.binding.generation, documents }); check(op);
                await phase(op, 'copy-committed'); await unchanged(op, b); const snapshot = await c.read(); check(op); equivalent(b, snapshot);
                return { state: 'staged', alreadyCopied: false, recoverySecret: created.recoverySecret, evidence: evidence(b) };
            } finally { finish(op); }
        },
        async activate({ password, recoverySecret, externalCustodyConfirmed, recoveryTarget }) {
            const op = begin();
            try {
                if (externalCustodyConfirmed !== true || typeof recoverySecret !== 'string') fail('recovery-required');
                requireMigrationCapabilities(source, recoveryTarget);
                if (recoveryTarget.id === target.id) fail('recovery-required');
                const b = await describe(op), c = controller(op), before = await inspectTarget(op, c, b, password);
                if (!before) fail('destination-missing');
                await phase(op, 'equivalence-verified'); await unchanged(op, b);
                const pack = await c.exportRecoveryPackage(); check(op);
                const recovery = controller(op, recoveryTarget);
                const restored = await recovery.importRecoveryPackage(pack, { recoverySecret, newPassword: password }); check(op);
                const recovered = await recovery.read(); check(op); equivalent(b, recovered);
                if (recovered.catalog.keyId === before.catalog.keyId || restored.alreadyRestored) fail('recovery-required');
                recovery.close();
                const reopened = controller(op, recoveryTarget); await reopened.unlockWithRecovery(restored.recoverySecret); check(op);
                equivalent(b, await reopened.read()); check(op); reopened.close();
                await phase(op, 'recovery-restored'); await unchanged(op, b);
                const after = await c.read(); check(op); equivalent(b, after);
                if (after.catalog.revision !== before.catalog.revision || after.catalog.keyId !== before.catalog.keyId) fail('destination-changed');
                await phase(op, 'before-activation'); await unchanged(op, b);
                const finalSnapshot = await c.read(); check(op); equivalent(b, finalSnapshot);
                if (finalSnapshot.catalog.revision !== before.catalog.revision || finalSnapshot.catalog.keyId !== before.catalog.keyId) fail('destination-changed');
                await unchanged(op, b); check(op);
                const record = { op, c }; active = record;
                return Object.freeze({ state: 'active', evidence: Object.freeze({ ...evidence(b), recoveryVerified: true, vaultRevision: before.catalog.revision }),
                    async read() {
                        check(op); if (active !== record) fail('cancelled');
                        try {
                            await unchanged(op, b); const snapshot = await c.read(); check(op); equivalent(b, snapshot);
                            if (snapshot.catalog.revision !== before.catalog.revision || snapshot.catalog.keyId !== before.catalog.keyId) fail('destination-changed');
                            await unchanged(op, b); check(op);
                            return Object.assign(Object.create(b.mapPrototype), copyDocumentMap(Object.fromEntries(Object.keys(b.documents).map(id => [id, snapshot.documents[id]])), codec.encode, codec.decode));
                        } catch (error) { if (active === record && operation === op) cancel(); throw error; }
                    }
                });
            } finally { finish(op); }
        },
        deactivate() { cancel(); return Object.freeze({ state: 'inactive', sourcePreserved: true }); },
        close() { cancel(); closed = true; }
    });
}
