// Synthetic write phase only; no app, Auth, Firestore or legacy database imports.
import { createExperimentalAccount } from './finance-vault-persistence.js';
import { createSyntheticMigrator, migrationCanonicalBytes } from './finance-vault-migration.js';
import { requireMigrationCapabilities } from './finance-vault-migration-storage.js';
import { createVaultController } from '../finance-vault-controller.js';
import { createFinancialCodec } from '../finance-vault-codec.js';
import { vaultDigest, validateRecoveryPackage } from '../finance-vault-recovery.js';
import { validarBackup } from '../finance-core.js';
import { financeSettings } from '../automatic-sync-policy.js';
import { makeOperation, recordEntityKey, operationId, recordsEquivalent, applyRemoteRecord, functionalSettings } from '../sync-core.js';

const fail = code => { throw Object.assign(new Error('Escrita sintética não autorizada ou recuperação não verificada.'), { code }); };
const clone = value => structuredClone(value);
const codec = createFinancialCodec();
function same(a, b) {
    const x = migrationCanonicalBytes(codec, a), y = migrationCanonicalBytes(codec, b);
    try { return x.length === y.length && x.every((v, i) => v === y[i]); } finally { x.fill(0); y.fill(0); }
}
function sameDocuments(a, b) {
    const ids = Object.keys(a).sort(); return same(ids, Object.keys(b).sort()) && ids.every(id => same(a[id], b[id]));
}
export function createSyntheticWriter({ source, target, owner, createRecoveryTarget, crypto = globalThis.crypto, locks = globalThis.navigator?.locks }) {
    requireMigrationCapabilities(source, target);
    if (typeof owner?.projectId !== 'string' || !owner.projectId.startsWith('demo-') || !/^synthetic-[A-Za-z0-9_-]{1,110}$/.test(owner.uid || '') || typeof createRecoveryTarget !== 'function') fail('synthetic-only');
    owner = Object.freeze({ ...owner }); const uid = owner.uid, vaultId = 'synthetic-migration';
    const stateId = `estado:${uid}`, queueId = `fila:${uid}`, journalId = `snapshot:${uid}:synthetic-migration-manifest-v1`, grantId = `snapshot:${uid}:synthetic-writes-v1`;
    let current = null, active = null, closed = false;
    function revoke() { const old = current; current = null; active = null; old?.resources.forEach(item => item.close()); }
    function begin() { if (closed) fail('persistence/cancelled'); revoke(); const op = { resources: new Set() }; current = op; return op; }
    const check = op => { if (closed || current !== op) fail('persistence/cancelled'); };
    function vault(op, destination = target) {
        requireMigrationCapabilities(source, destination); check(op);
        const result = createVaultController({ store: { ...destination.store, close() {} }, owner, vaultId, crypto, channelFactory: () => null });
        op.resources.add(result); return result;
    }
    function validate(snapshot, expectedBranch, allowFenced = false) {
        const grant = snapshot.documents[grantId], journal = snapshot.documents[journalId], q = snapshot.documents[queueId];
        if (!journal || journal.format !== 'cf-synthetic-migration-copy' || journal.version !== 1 || journal.binding?.owner?.uid !== uid || journal.binding.owner.projectId !== owner.projectId) fail('migration-required');
        if (!grant || grant.format !== 'cf-synthetic-write-authority' || grant.version !== 1 || grant.owner?.uid !== uid || grant.owner.projectId !== owner.projectId
            || grant.migrationDigest !== journal.digest || grant.keyId !== snapshot.catalog.keyId || grant.generation !== snapshot.generation
            || grant.catalogRevision !== snapshot.catalog.revision || !Number.isSafeInteger(grant.sequence) || grant.sequence < 0 || typeof grant.branchId !== 'string'
            || !['writable', 'recovery-fenced', 'pending-recovery'].includes(grant.mode)
            || (expectedBranch && grant.branchId !== expectedBranch)) fail('write-authority-invalid');
        if (!allowFenced && grant.mode !== 'writable') fail('recovery-in-progress');
        if (!q || q.generation !== snapshot.generation || q.restoreJob || q.compatibilityBlocked) fail('write-blocked');
        return grant;
    }
    async function originUnchanged(op, journal) {
        const raw = await source.read(); check(op); const b = journal?.binding;
        if (!raw || !b || b.storageId !== source.id || raw.owner?.uid !== uid || raw.owner.projectId !== owner.projectId
            || raw.version !== b.version || raw.financialVersion !== b.financialVersion || raw.sourceId !== b.sourceId || raw.revision !== b.revision || raw.generation !== b.generation
            || !same(Object.keys(raw.documents || {}).sort(), b.documents.map(d => d.id).sort())
            || await vaultDigest(new TextEncoder().encode(JSON.stringify(b)), crypto) !== journal.digest) fail('source-changed');
        check(op);
        for (const row of b.documents) {
            const bytes = migrationCanonicalBytes(codec, raw.documents[row.id]);
            try { if (await vaultDigest(bytes, crypto) !== row.sha256) fail('source-changed'); check(op); } finally { bytes.fill(0); }
        }
    }
    const stamp = s => JSON.stringify([s.catalog.keyId, s.catalog.revision, s.generation]);
    async function proveCurrent(op, c, snapshot, password, secret) {
        const pack = await c.exportRecoveryPackage(); check(op);
        const destination = await createRecoveryTarget(); check(op); requireMigrationCapabilities(source, destination);
        if (destination.id === target.id) fail('recovery-required');
        const proof = vault(op, destination); if ((await proof.status()).state !== 'missing') fail('destination-exists'); check(op);
        const restored = await proof.importRecoveryPackage(pack, { recoverySecret: secret, newPassword: password }); check(op);
        const read = await proof.read(); check(op); if (!sameDocuments(snapshot.documents, read.documents) || read.generation !== snapshot.generation || read.catalog.keyId === snapshot.catalog.keyId) fail('equivalence-failed');
        proof.close(); const reopened = vault(op, destination); await reopened.unlockWithRecovery(restored.recoverySecret); check(op);
        if (!sameDocuments(snapshot.documents, (await reopened.read()).documents)) fail('equivalence-failed'); check(op); reopened.close();
        if (stamp(await c.read()) !== stamp(snapshot)) fail('stale-revision'); check(op);
    }
    async function fullDigest(snapshot) {
        const entries = [];
        for (const id of Object.keys(snapshot.documents).sort()) { const bytes = migrationCanonicalBytes(codec, snapshot.documents[id]); try { entries.push([id, await vaultDigest(bytes, crypto)]); } finally { bytes.fill(0); } }
        return vaultDigest(new TextEncoder().encode(JSON.stringify([snapshot.generation, entries])), crypto);
    }
    function grantFor(snapshot, journal, parent = null, sequence = 0) {
        return { format: 'cf-synthetic-write-authority', version: 1, mode: 'writable', owner, migrationDigest: journal.digest, branchId: crypto.randomUUID(), keyId: snapshot.catalog.keyId,
            generation: snapshot.generation, catalogRevision: snapshot.catalog.revision + 1, sequence, parent };
    }
    function finish(op) { if (active?.op !== op) { op.resources.forEach(item => item.close()); if (current === op) current = null; } }
    function bind(op, account, session, initialGrant) {
        const guard = () => { check(op); if (active?.op !== op || !session.isCurrent()) fail('persistence/cancelled'); };
        const read = async () => { guard(); const snapshot = await account.vault.read(); guard(); validate(snapshot, initialGrant.branchId); return snapshot; };
        const transaction = async (keys, fn) => { guard(); const result = await session.db.alterarDocumentos(keys, fn); guard(); return result; };
        async function settleDecisions() {
            await transaction([queueId], docs => {
                const q = docs.get(queueId); q.experimentalDecisions ||= []; q.conflictHistory ||= [];
                for (const d of q.experimentalDecisions) if (d.status === 'pending' && (d.kind === 'settings'
                    ? q.settingsRevision === d.resolutionOperationId && !q.automaticSettingsDirty
                    : q.remoteRevisions?.[d.entityKey] === d.resolutionOperationId && !q.outbox.some(op => op.entityKey === d.entityKey))) {
                    d.status = 'confirmed'; q.conflictHistory.push({ conflict: clone(d.original), choice: d.choice, decisionId: d.id });
                    q.conflicts = q.conflicts.filter(c => (c.kind === 'settings' ? c.experimentalId : c.operation?.id) !== d.conflictId);
                }
                return docs;
            });
        }
        return Object.freeze({
            read,
            async edit(base, desired) {
                guard();
                const result = await session.service.aplicarEdicao(uid, clone(base), clone(desired), (changes, q) => changes.map(value => {
                    const key = recordEntityKey(value), prior = q.outbox.filter(op => op.entityKey === key).at(-1);
                    return makeOperation(key, value, prior && q.attempted?.[prior.id] ? prior.id : q.remoteRevisions?.[key] || null);
                }), (q, state) => {
                    const settings = financeSettings(state);
                    if (!same(settings, q.automaticSettingsValue || q.settingsBaseline)) { q.automaticSettingsDirty = true; q.automaticSettingsValue = clone(settings); }
                }, session.isCurrent, initialGrant.generation); guard(); return result;
            },
            async synchronize(remote) {
                guard();
                const starting = (await read()).documents[queueId], blocked = new Set(starting.conflicts.filter(c => c.kind !== 'settings').map(c => c.operation?.entityKey));
                const resolutions = new Set((starting.experimentalDecisions || []).filter(d => d.status === 'pending').map(d => d.resolutionOperationId));
                // Pending conflicts fence only their entity, without discarding operations.
                await session.service.enviarFila(uid, async (requestedUid, operation) => {
                    guard(); if (requestedUid !== uid) fail('owner-mismatch'); const result = await remote.commit(owner, operation); guard(); return result;
                }, session.isCurrent, operation => {
                    guard(); return !blocked.has(operation.entityKey) || resolutions.has(operation.id);
                }); guard();
                const start = await read(), initialQueue = start.documents[queueId];
                const settingsConflicts = initialQueue.conflicts.filter(c => c.kind === 'settings');
                const reviewed = (initialQueue.experimentalDecisions || []).filter(d => d.kind === 'settings' && d.choice === 'local' && d.status === 'pending');
                // WS-01: retain the conflict until its reviewed resolution is ACKed.
                // Allowing that exact intent breaks the deadlock without unblocking
                // unrelated settings conflicts or confirming a decision prematurely.
                if (initialQueue.automaticSettingsDirty && settingsConflicts.every(c => reviewed.some(d => d.conflictId === c.experimentalId))) {
                    const claimed = await transaction([queueId], docs => {
                        const q = docs.get(queueId);
                        q.experimentalSettings ||= { id: operationId('settings', q.settingsRevision || null, q.automaticSettingsValue), value: clone(q.automaticSettingsValue), baseRevision: q.settingsRevision || null, generation: initialGrant.generation };
                        return docs;
                    });
                    const intent = claimed.get(queueId).experimentalSettings;
                    if (settingsConflicts.length && !reviewed.some(d => d.resolutionOperationId === intent.id)) fail('decision-stale');
                    const ack = await remote.commitSettings(owner, clone(intent)); guard();
                    if (ack?.acknowledged !== true) fail('ack-missing');
                    await transaction([queueId], docs => {
                        const q = docs.get(queueId); if (q.experimentalSettings?.id !== intent.id) fail('stale-revision');
                        if (ack.conflict) {
                            if (!q.conflicts.some(c => c.experimentalId === intent.id)) q.conflicts.push({ kind: 'settings', experimentalId: intent.id, local: clone(intent.value), remote: clone(ack.remote) });
                        } else {
                            q.settingsBaseline = clone(intent.value); q.settingsRevision = ack.revision || intent.id;
                            if (same(q.automaticSettingsValue, intent.value)) q.automaticSettingsDirty = false;
                            q.experimentalSettings = null;
                        }
                        return docs;
                    });
                }
                await settleDecisions(); guard(); return read();
            },
            async resolve(conflictId, choice) {
                guard(); if (!['local', 'remote'].includes(choice)) fail('invalid-choice');
                const archiveId = `restore-recovery:${uid}:decision-${crypto.randomUUID()}`;
                return transaction([stateId, queueId, archiveId], docs => {
                    const state = docs.get(stateId), q = docs.get(queueId), conflict = q.conflicts.find(c => (c.kind === 'settings' ? c.experimentalId : c.operation?.id) === conflictId);
                    if (!conflict || q.experimentalDecisions?.some(d => d.conflictId === conflictId && d.status === 'pending')) fail('decision-stale');
                    const settings = conflict.kind === 'settings', operation = conflict.operation, entityKey = operation?.entityKey;
                    if (!settings && q.outbox.some(op => op.entityKey === entityKey)) fail('decision-stale');
                    if (settings ? !same(financeSettings(state.dados), conflict.local) : !sameCurrentRecord(state.dados, operation.value)) fail('decision-stale');
                    if (!settings && conflict.remote?.deleted && choice === 'local' && !operation.value.deleted) fail('tombstone-barrier');
                    docs.set(archiveId, { reason: 'synthetic-conflict-decision', state: clone(state), queue: clone(q), conflict: clone(conflict), choice });
                    q.recoveryKeys = [...new Set([...(q.recoveryKeys || []), archiveId])]; q.experimentalDecisions ||= [];
                    const decision = { id: archiveId, conflictId, choice, kind: settings ? 'settings' : 'record', entityKey: entityKey || null, original: clone(conflict), status: 'pending' };
                    if (settings) {
                        const remote = functionalSettings(conflict.remote); if (!remote || typeof conflict.remote.revision !== 'string') fail('invalid-remote');
                        if (choice === 'remote') {
                            state.dados = { ...state.dados, tema: remote.theme, categorias: clone(remote.categories), orcamentos: clone(remote.budgets) }; state.revisao++;
                            q.settingsBaseline = clone(remote); q.automaticSettingsValue = clone(remote); q.automaticSettingsDirty = false;
                        } else { q.automaticSettingsDirty = true; q.automaticSettingsValue = financeSettings(state.dados); }
                        q.settingsRevision = conflict.remote.revision; q.experimentalSettings = null;
                        if (choice === 'local') decision.resolutionOperationId = operationId('settings', q.settingsRevision, q.automaticSettingsValue);
                    } else if (choice === 'local') {
                        const next = { ...makeOperation(entityKey, operation.value, conflict.remote?.revision || null), generation: initialGrant.generation };
                        q.outbox.push(next); decision.resolutionOperationId = next.id;
                    } else {
                        if (!conflict.remote) fail('invalid-remote'); state.dados = applyRemoteRecord(state.dados, conflict.remote); state.revisao++;
                        q.remoteRevisions[entityKey] = conflict.remote.revision;
                    }
                    if (!validarBackup(state.dados)) fail('invalid-state');
                    if (choice === 'remote') { decision.status = 'confirmed'; q.conflictHistory ||= []; q.conflictHistory.push({ conflict: clone(conflict), choice, decisionId: archiveId }); q.conflicts = q.conflicts.filter(c => c !== conflict); }
                    q.experimentalDecisions.push(decision); docs.set(stateId, state); docs.set(queueId, q); return docs;
                });
            },
            async checkpoint() {
                const snapshot = await read(), bytes = await account.vault.exportRecoveryPackage(); guard();
                if (stamp(await read()) !== stamp(snapshot)) fail('stale-revision');
                return { bytes, evidence: { digest: await fullDigest(snapshot), sequence: snapshot.documents[grantId].sequence, generation: snapshot.generation, catalogRevision: snapshot.catalog.revision } };
            }
        });
    }
    return Object.freeze({
        async open({ password, recoverySecret, externalCustodyConfirmed, unlockMode = 'password' }) {
            const op = begin();
            try {
                if (externalCustodyConfirmed !== true || typeof recoverySecret !== 'string') fail('recovery-required');
                if (!['password', 'recovery'].includes(unlockMode)) fail('invalid-unlock-mode');
                const c = vault(op); if (unlockMode === 'recovery') await c.unlockWithRecovery(recoverySecret); else await c.unlockWithPassword(password);
                check(op); let snapshot = await c.read(); check(op);
                if (snapshot.documents[queueId]?.restoreJob || snapshot.documents[queueId]?.compatibilityBlocked) fail('write-blocked');
                if (!Object.hasOwn(snapshot.documents, grantId)) {
                    const migrate = createSyntheticMigrator({ source, target, owner, crypto }); op.resources.add(migrate);
                    const verified = await migrate.activate({ password, recoverySecret, externalCustodyConfirmed, recoveryTarget: await createRecoveryTarget() }); check(op); await verified.read(); check(op);
                    if ((await c.read()).catalog.revision !== verified.evidence.vaultRevision) fail('stale-revision');
                    const grant = grantFor(snapshot, snapshot.documents[journalId]);
                    await c.commit(await c.prepare({ expectedRevision: snapshot.catalog.revision, generation: snapshot.generation, updates: { [grantId]: grant } })); check(op); migrate.close();
                    snapshot = await c.read(); check(op);
                }
                const grant = validate(snapshot); await originUnchanged(op, snapshot.documents[journalId]);
                await proveCurrent(op, c, snapshot, password, recoverySecret); check(op);
                const policy = {
                    validate: s => { check(op); validate(s, grant.branchId); },
                    prepareUpdates: (s, updates) => {
                        check(op); const latest = validate(s, grant.branchId);
                        if (Object.hasOwn(updates, journalId) || Object.hasOwn(updates, grantId) || !Number.isSafeInteger(latest.sequence + 1)) fail('write-authority-invalid');
                        return { ...updates, [grantId]: { ...latest, catalogRevision: s.catalog.revision + 1, sequence: latest.sequence + 1 } };
                    }
                };
                const account = createExperimentalAccount({ store: { ...target.store, close() {} }, owner, vaultId, crypto, locks, channelFactory: () => null, snapshotPolicy: policy }); op.resources.add(account);
                const session = await (unlockMode === 'recovery' ? account.unlockWithRecovery(recoverySecret) : account.unlockWithPassword(password)); check(op); validate(await account.vault.read(), grant.branchId); check(op);
                active = { op, account }; return bind(op, account, session, grant);
            } finally { finish(op); }
        },
        async recover({ recoverySecret, newPassword, externalCustodyConfirmed, recoveryTarget, checkpoint }) {
            const op = begin();
            try {
                if (externalCustodyConfirmed !== true) fail('recovery-required'); requireMigrationCapabilities(source, recoveryTarget);
                if (recoveryTarget.id === target.id) fail('destination-exists');
                const c = vault(op); await c.unlockWithRecovery(recoverySecret); check(op); let latest = await c.read(); check(op); let previous = validate(latest, undefined, true);
                if (checkpoint?.bytes) {
                    const parsed = await validateRecoveryPackage(new Uint8Array(checkpoint.bytes), { expected: { owner, vaultId }, recoverySecret, codec, crypto }); check(op);
                    if (!sameDocuments(parsed.documents, latest.documents) || parsed.generation !== latest.generation) fail('stale-checkpoint');
                }
                const restoredVault = vault(op, recoveryTarget), status = await restoredVault.status(); check(op);
                if (previous.mode === 'writable') {
                    if (status.state !== 'missing') fail('destination-exists');
                    const recovery = { id: crypto.randomUUID(), targetId: recoveryTarget.id };
                    const fenced = { ...previous, mode: 'recovery-fenced', recovery, catalogRevision: latest.catalog.revision + 1, sequence: previous.sequence + 1 };
                    await c.commit(await c.prepare({ expectedRevision: latest.catalog.revision, generation: latest.generation, updates: { [grantId]: fenced } })); check(op);
                    latest = await c.read(); check(op); previous = validate(latest, undefined, true);
                }
                if (previous.mode !== 'recovery-fenced' || previous.recovery?.targetId !== recoveryTarget.id) fail('recovery-target-mismatch');
                if (status.state === 'missing') {
                    const bytes = await c.exportRecoveryPackage(); check(op);
                    await restoredVault.importRecoveryPackage(bytes, { recoverySecret, newPassword, retainCustodiedRecoverySecret: true }); check(op);
                } else { await restoredVault.unlockWithRecovery(recoverySecret); check(op); }
                let restored = await restoredVault.read(); check(op);
                const existing = restored.documents[grantId];
                if (existing?.keyId === restored.catalog.keyId) {
                    validate(restored, undefined, true);
                    if (existing.parent?.recoveryId !== previous.recovery.id || existing.parent.originTargetId !== target.id) fail('destination-exists');
                    if (existing.mode === 'writable') return { target: recoveryTarget, recoverySecret, alreadyRecovered: true, evidence: { parent: existing.parent, recoveredSequence: existing.sequence, generation: restored.generation } };
                } else {
                    if (!sameDocuments(restored.documents, latest.documents)) fail('equivalence-failed');
                    const parent = { branchId: previous.branchId, sequence: previous.sequence, digest: await fullDigest(latest), recoveryId: previous.recovery.id, originTargetId: target.id }; check(op);
                    const next = { ...grantFor(restored, restored.documents[journalId], parent, previous.sequence + 1), mode: 'pending-recovery' };
                    const archiveId = `snapshot:${uid}:write-ancestor-${previous.branchId}-${previous.sequence}`;
                    if (Object.hasOwn(restored.documents, archiveId)) fail('destination-exists');
                    await restoredVault.commit(await restoredVault.prepare({ expectedRevision: restored.catalog.revision, generation: restored.generation, updates: { [grantId]: next, [archiveId]: previous } })); check(op);
                    restored = await restoredVault.read(); check(op);
                }
                for (const id of Object.keys(latest.documents)) if (id !== grantId && !same(latest.documents[id], restored.documents[id])) fail('equivalence-failed');
                await proveCurrent(op, restoredVault, restored, newPassword, recoverySecret); check(op);
                if (stamp(await c.read()) !== stamp(latest)) fail('stale-revision'); check(op);
                const pending = validate(restored, undefined, true), next = { ...pending, mode: 'writable', catalogRevision: restored.catalog.revision + 1, sequence: pending.sequence + 1 };
                await restoredVault.commit(await restoredVault.prepare({ expectedRevision: restored.catalog.revision, generation: restored.generation, updates: { [grantId]: next } })); check(op);
                const final = await restoredVault.read(); check(op); validate(final);
                return { target: recoveryTarget, recoverySecret, alreadyRecovered: false, evidence: { parent: next.parent, recoveredSequence: next.sequence, generation: final.generation } };
            } finally { finish(op); }
        },
        async rollback() {
            if (!active) fail('persistence/cancelled'); const op = active.op, snapshot = await active.account.vault.read(); check(op);
            if (validate(snapshot).sequence > 0) fail('rollback-requires-current-recovery'); revoke(); return { state: 'inactive', sourcePreserved: true };
        },
        async lock() {
            const old = current, a = active?.account; current = null; active = null;
            try { if (a) await a.lock(); } finally { old?.resources.forEach(item => item.close()); }
        },
        close() { revoke(); closed = true; }
    });
}
function sameCurrentRecord(state, value) {
    if (!value) return false; const record = state.meses?.[value.month]?.[value.type]?.find(row => row.id === value.id);
    return value.deleted ? record === undefined : recordsEquivalent(record, value.record);
}
