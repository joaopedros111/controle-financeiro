import { createSyntheticWriter } from '../../experimental/finance-vault-writes.js';
import { createSyntheticMigrator, migrationCanonicalBytes } from '../../experimental/finance-vault-migration.js';
import { syntheticTargetCapability, SYNTHETIC_TARGET_PREFIX } from '../../experimental/finance-vault-migration-storage.js';
import { createVaultController } from '../../finance-vault-controller.js';
import { createFinancialCodec } from '../../finance-vault-codec.js';
import { normalizarEstado } from '../../finance-core.js';
import { financeSettings } from '../../automatic-sync-policy.js';
import { makeOperation, recordEntityKey, operationId } from '../../sync-core.js';
import { memoryMigrationSource } from './vault-migration-scenarios.mjs';
import { syntheticWriteRemote } from './vault-write-remote.mjs';
export const writeOwner = { projectId: 'demo-vault-writes', uid: 'synthetic-write-A' };
export const writePassword = 'synthetic-write-passphrase';
export const writeMonth = '2026-10';
export function writingSourceFixture(owner = writeOwner) {
    const state = normalizarEstado({ versao: 3, categorias: ['Casa', 'recoveryKeys'], orcamentos: { padrao: { Casa: 500 }, meses: {} }, meses: { [writeMonth]: {
        receitas: [{ id: 'synthetic-original', nome: 'SYNTHETIC WRITE ORIGINAL', valor: 321.09, recebido: true }], despesas: [] } } });
    const recovery = `restore-recovery:${owner.uid}:synthetic-before-writes`;
    return { format: 'cf-synthetic-financial-source', version: 1, owner, sourceId: `synthetic-source-${owner.uid}`, revision: 11, financialVersion: 3, generation: 'legacy', documents: {
        [`estado:${owner.uid}`]: { revisao: 4, dados: state, unknownOptional: undefined, storedDate: new Date('2026-10-29T12:00:00Z') },
        [`fila:${owner.uid}`]: { generation: 'legacy', outbox: [], conflicts: [], attempted: {}, remoteRevisions: {}, recoveryKeys: [recovery], automaticSettingsDirty: false,
            automaticSettingsValue: financeSettings(state), settingsBaseline: financeSettings(state), settingsRevision: null,
            automaticHistory: [{ id: 'synthetic-old-history', uploaded: false }], backupJobs: [{ id: 'synthetic-backup', status: 'pending' }], unknownLegacy: { optional: undefined } },
        [recovery]: { state: structuredClone(state), reason: 'synthetic-before-writes' }
    } };
}
const codec = createFinancialCodec();
const ok = value => { if (!value) throw new Error('Synthetic write assertion failed'); };
const equal = (a, b) => { const x = migrationCanonicalBytes(codec, a), y = migrationCanonicalBytes(codec, b); try { ok(x.length === y.length && x.every((v, i) => v === y[i])); } finally { x.fill(0); y.fill(0); } };
async function rejects(fn, codes) { let error; try { await fn(); } catch (e) { error = e; } ok(error); if (codes) ok([].concat(codes).includes(error.code)); return error; }
export async function writeEdit(lease, uid, mutate) {
    const current = await lease.read(), base = current.documents[`estado:${uid}`].dados, desired = structuredClone(base); mutate(desired.meses[writeMonth], desired); return lease.edit(base, desired);
}
export const writeIncome = (lease, uid = writeOwner.uid, id = 'synthetic-new-income') => writeEdit(lease, uid,
    month => month.receitas.push({ id, nome: 'SYNTHETIC WRITTEN INCOME', valor: 456.78, recebido: false }));
export function writeCases({ makeStore, makeSource = async snapshot => memoryMigrationSource(snapshot), crypto }) {
    const cases = [], closers = [];
    const add = (name, run) => cases.push({ name, run: async () => { try { await run(); } finally { closers.splice(0).reverse().forEach(fn => fn()); } } });
    async function target() { const storage = await makeStore(); closers.push(() => storage.store.close()); return { storage, capability: syntheticTargetCapability({ id: storage.name || `${SYNTHETIC_TARGET_PREFIX}${crypto.randomUUID()}`, store: storage.store }) }; }
    const scratch = async () => (await target()).capability;
    function manager(source, destination, owner = writeOwner) { const m = createSyntheticWriter({ source, target: destination, owner, crypto, createRecoveryTarget: scratch }); closers.push(() => m.close()); return m; }
    async function setup(owner = writeOwner, modifyFixture) {
        const fixture = writingSourceFixture(owner); modifyFixture?.(fixture);
        const origin = await makeSource(fixture); closers.push(() => origin.close()); const destination = await target();
        const migrate = createSyntheticMigrator({ source: origin.source, target: destination.capability, owner, crypto }); closers.push(() => migrate.close());
        const prepared = await migrate.prepare({ password: writePassword }); const writer = manager(origin.source, destination.capability, owner);
        return { origin, destination, prepared, writer, owner, open: () => writer.open({ password: writePassword, recoverySecret: prepared.recoverySecret, externalCustodyConfirmed: true }) };
    }
    const q = async (lease, uid = writeOwner.uid) => (await lease.read()).documents[`fila:${uid}`];
    const data = async (lease, uid = writeOwner.uid) => (await lease.read()).documents[`estado:${uid}`].dados;
    const grant = (snapshot, uid = writeOwner.uid) => snapshot.documents[`snapshot:${uid}:synthetic-writes-v1`];
    add('write activation proves migrated equivalence, unlocked keys and current independent recovery', async () => {
        const s = await setup(), before = await s.origin.read(); await rejects(() => s.writer.open({ password: writePassword, externalCustodyConfirmed: true }), 'recovery-required');
        const lease = await s.open(); equal((await data(lease)).meses[writeMonth].receitas, before.documents[`estado:${writeOwner.uid}`].dados.meses[writeMonth].receitas);
        ok(grant(await lease.read()).mode === 'writable'); equal(await s.origin.read(), before);
    });
    add('income, expenses, edits and durable deletion tombstones share one atomic financial/queue revision', async () => {
        const s = await setup(), before = await s.origin.read(), lease = await s.open(); await writeIncome(lease);
        await writeEdit(lease, writeOwner.uid, month => month.despesas.push({ id: 'synthetic-expense', nome: 'SYNTHETIC EXPENSE', valor: 19.87, categoria: 'Casa', pago: false }));
        await writeEdit(lease, writeOwner.uid, month => { month.receitas.find(r => r.id === 'synthetic-new-income').valor = 111.11; month.despesas = []; });
        const queue = await q(lease); equal(queue.outbox.length, 2); ok(queue.outbox.some(op => op.value.deleted)); equal(queue.outbox.find(op => op.value.id === 'synthetic-new-income').value.record.valor, 111.11);
        equal((await data(lease)).meses[writeMonth].despesas.length, 0); equal(await s.origin.read(), before);
    });
    add('offline inclusion synchronizes once and duplicate ACK cannot duplicate a financial record', async () => {
        const s = await setup(), lease = await s.open(), remote = syntheticWriteRemote(); await writeIncome(lease); const operation = (await q(lease)).outbox[0];
        await lease.synchronize(remote); equal((await q(lease)).outbox.length, 0); equal(remote.inspect(writeOwner).records.length, 1);
        await remote.commit(writeOwner, operation); await lease.synchronize(remote); equal(remote.inspect(writeOwner).writes, 1); equal((await data(lease)).meses[writeMonth].receitas.length, 2);
    });
    for (const code of ['unavailable', 'permission-denied']) add(`server ${code} preserves the attempted operation and its exact retry identity`, async () => {
        const s = await setup(), lease = await s.open(), remote = syntheticWriteRemote(); await writeIncome(lease); const before = (await q(lease)).outbox[0]; remote.failNext(code);
        await rejects(() => lease.synchronize(remote), code); equal((await q(lease)).outbox[0], before); ok((await q(lease)).attempted[before.id]);
        await lease.synchronize(remote); equal((await q(lease)).outbox.length, 0); equal(remote.inspect(writeOwner).writes, 1);
    });
    add('lost ACK and restart before confirmation resume the same operation without duplication', async () => {
        const s = await setup(), lease = await s.open(), remote = syntheticWriteRemote(); await writeIncome(lease); const id = (await q(lease)).outbox[0].id; remote.loseNextAck();
        await rejects(() => lease.synchronize(remote), 'unavailable'); await s.writer.lock();
        const reopened = manager(s.origin.source, syntheticTargetCapability({ id: s.destination.capability.id, store: await s.destination.storage.reopen() }));
        const resumed = await reopened.open({ password: writePassword, recoverySecret: s.prepared.recoverySecret, externalCustodyConfirmed: true }); equal((await q(resumed)).outbox[0].id, id);
        await resumed.synchronize(remote); equal(remote.inspect(writeOwner).writes, 1); equal((await q(resumed)).outbox.length, 0);
    });
    add('an edit while an older ACK is pending chains base revision and keeps the newer intent', async () => {
        const s = await setup(), lease = await s.open(), remote = syntheticWriteRemote(); await writeIncome(lease);
        let enter, release; const started = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; });
        const pending = lease.synchronize({ ...remote, commit: async (...args) => { const ack = await remote.commit(...args); enter(); await gate; return ack; } });
        await started; await writeEdit(lease, writeOwner.uid, month => { month.receitas.find(r => r.id === 'synthetic-new-income').valor = 222.22; });
        equal((await q(lease)).outbox.length, 2); release(); await pending; equal((await q(lease)).outbox.length, 1);
        await lease.synchronize(remote); equal(remote.inspect(writeOwner).records[0][1].record.valor, 222.22); equal((await q(lease)).conflicts.length, 0);
    });
    add('concurrent edits preserve conflict versions and explicit local resolution is acknowledged and archived', async () => {
        const s = await setup(), lease = await s.open(), remote = syntheticWriteRemote(); await writeIncome(lease); await lease.synchronize(remote);
        const existing = remote.inspect(writeOwner).records[0][1], key = recordEntityKey(existing);
        await writeEdit(lease, writeOwner.uid, month => { month.receitas.find(r => r.id === existing.id).valor = 88.88; });
        await remote.commit(writeOwner, makeOperation(key, { ...existing, record: { ...existing.record, valor: 99.99 }, deleted: false }, existing.revision));
        await lease.synchronize(remote); const conflict = (await q(lease)).conflicts[0]; equal(conflict.remote.record.valor, 99.99); equal(conflict.operation.value.record.valor, 88.88);
        await lease.resolve(conflict.operation.id, 'local'); await lease.synchronize(remote);
        const queue = await q(lease); equal(queue.conflicts.length, 0); equal(queue.experimentalDecisions[0].status, 'confirmed'); ok(queue.recoveryKeys.length > 1); equal(remote.inspect(writeOwner).records[0][1].record.valor, 88.88);
    });
    add('remote deletion cannot be resurrected; explicit remote choice preserves the tombstone and archives the edit', async () => {
        const s = await setup(), lease = await s.open(), remote = syntheticWriteRemote(); await writeIncome(lease); await lease.synchronize(remote);
        const old = remote.inspect(writeOwner).records[0][1], key = recordEntityKey(old);
        await writeEdit(lease, writeOwner.uid, month => { month.receitas.find(r => r.id === old.id).valor = 3.21; });
        await remote.commit(writeOwner, makeOperation(key, { month: old.month, type: old.type, id: old.id, deleted: true }, old.revision));
        await lease.synchronize(remote); const conflict = (await q(lease)).conflicts[0]; await rejects(() => lease.resolve(conflict.operation.id, 'local'), 'tombstone-barrier');
        await lease.resolve(conflict.operation.id, 'remote'); equal((await q(lease)).conflicts.length, 0); ok(remote.inspect(writeOwner).records[0][1].deleted);
        ok(!(await data(lease)).meses[writeMonth].receitas.some(r => r.id === old.id));
    });
    add('local deletion concurrent with remote edit is preserved and can be rebased as a tombstone', async () => {
        const s = await setup(), lease = await s.open(), remote = syntheticWriteRemote(); await writeIncome(lease); await lease.synchronize(remote);
        const old = remote.inspect(writeOwner).records[0][1], key = recordEntityKey(old);
        await writeEdit(lease, writeOwner.uid, month => { month.receitas = month.receitas.filter(r => r.id !== old.id); });
        await remote.commit(writeOwner, makeOperation(key, { ...old, record: { ...old.record, valor: 9.87 } }, old.revision));
        await lease.synchronize(remote); const conflict = (await q(lease)).conflicts[0]; await lease.resolve(conflict.operation.id, 'local'); await lease.synchronize(remote);
        ok(remote.inspect(writeOwner).records[0][1].deleted); equal((await q(lease)).conflicts.length, 0);
    });
    add('categories, budgets and preferences are durable, sync idempotently and preserve financial entries', async () => {
        const s = await setup(), before = await s.origin.read(), lease = await s.open(), remote = syntheticWriteRemote();
        await writeEdit(lease, writeOwner.uid, (_, state) => { state.categorias.push('Transporte'); state.orcamentos.padrao.Transporte = 123.45; state.tema = 'rosa'; });
        ok((await q(lease)).automaticSettingsDirty); remote.loseNextAck(); await rejects(() => lease.synchronize(remote), 'unavailable'); const claimed = (await q(lease)).experimentalSettings;
        await lease.synchronize(remote); equal(remote.inspect(writeOwner).settings.revision, claimed.id); equal((await q(lease)).automaticSettingsDirty, false); equal(await s.origin.read(), before);
    });
    add('settings conflict supports reviewed local resolution without discarding the financial queue', async () => {
        const s = await setup(), lease = await s.open(), remote = syntheticWriteRemote();
        const base = financeSettings(await data(lease)), competing = { ...base, categories: [...base.categories, 'Remota'] };
        await remote.commitSettings(writeOwner, { id: operationId('settings', null, competing), baseRevision: null, value: competing });
        await writeEdit(lease, writeOwner.uid, (_, state) => { state.categorias.push('Local'); }); await lease.synchronize(remote);
        const conflict = (await q(lease)).conflicts.find(c => c.kind === 'settings'); ok(conflict);
        // An unreviewed conflict must not be resent or silently dismissed.
        const writes = remote.inspect(writeOwner).writes; await lease.synchronize(remote); equal(remote.inspect(writeOwner).writes, writes);
        await lease.resolve(conflict.experimentalId, 'local'); await writeIncome(lease);
        const financialIntent = (await q(lease)).outbox[0]; remote.failNext();
        await rejects(() => lease.synchronize(remote), 'unavailable'); equal((await q(lease)).outbox[0], financialIntent);
        let enter, release; const started = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; });
        const pending = lease.synchronize({ ...remote, commitSettings: async (...args) => { const ack = await remote.commitSettings(...args); enter(); await gate; return ack; } });
        await started;
        try {
            const queue = await q(lease); equal(queue.conflicts.length, 1); equal(queue.experimentalDecisions[0].status, 'pending');
            equal(queue.experimentalSettings.id, queue.experimentalDecisions[0].resolutionOperationId);
        } finally { release(); }
        await pending;
        const queue = await q(lease); equal(queue.conflicts.length, 0); equal(queue.experimentalDecisions[0].status, 'confirmed'); equal(queue.outbox.length, 0);
        ok(remote.inspect(writeOwner).settings.categories.includes('Local')); equal((await data(lease)).meses[writeMonth].receitas.length, 2);
        equal(remote.inspect(writeOwner).records[0][1].revision, financialIntent.id);
    });
    add('late ACK after lock and same account unlock cannot modify the new session', async () => {
        const s = await setup(), lease = await s.open(), remote = syntheticWriteRemote(); await writeIncome(lease);
        let enter, release; const started = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; });
        const pending = lease.synchronize({ ...remote, commit: async (...args) => { const ack = await remote.commit(...args); enter(); await gate; return ack; } }).then(() => null, e => e.code);
        await started; await s.writer.lock(); const next = await s.open(); release(); equal(await pending, 'persistence/cancelled'); equal((await q(next)).outbox.length, 1);
        await next.synchronize(remote); equal(remote.inspect(writeOwner).writes, 1); await rejects(() => writeIncome(lease), 'persistence/cancelled');
    });
    add('A-B-A never publishes A operations into B and never reuses an old A lease', async () => {
        const a = await setup(), al = await a.open(); await writeIncome(al); const original = await q(al); await a.writer.lock();
        const ownerB = { ...writeOwner, uid: 'synthetic-write-B' }, b = await setup(ownerB), bl = await b.open(), remote = syntheticWriteRemote(); await writeIncome(bl, ownerB.uid, 'synthetic-income-B'); await bl.synchronize(remote);
        equal(remote.inspect(writeOwner).writes, 0); equal(remote.inspect(ownerB).writes, 1); await b.writer.lock(); const returned = await a.open(); equal(await q(returned), original);
        await rejects(() => al.read(), 'persistence/cancelled'); await rejects(() => bl.read(), 'persistence/cancelled');
    });
    add('two writers merge independent edits and reject conflicting financial revisions', async () => {
        const s = await setup(), one = await s.open(), second = manager(s.origin.source, syntheticTargetCapability({ id: s.destination.capability.id, store: await s.destination.storage.reopen() }));
        const two = await second.open({ password: writePassword, recoverySecret: s.prepared.recoverySecret, externalCustodyConfirmed: true });
        const results = await Promise.allSettled([writeIncome(one, writeOwner.uid, 'synthetic-tab-a'), writeIncome(two, writeOwner.uid, 'synthetic-tab-b')]);
        for (let i = 0; i < results.length; i++) if (results[i].status === 'rejected') {
            ok(['cancelled', 'stale-revision'].includes(results[i].reason.code)); await writeIncome(i ? two : one, writeOwner.uid, i ? 'synthetic-tab-b' : 'synthetic-tab-a');
        }
        equal((await data(one)).meses[writeMonth].receitas.length, 3);
        const base = await data(two), desired = structuredClone(base); desired.meses[writeMonth].receitas[0].valor = 6;
        await writeEdit(one, writeOwner.uid, month => { month.receitas[0].valor = 7; }); await rejects(() => two.edit(base, desired)); equal((await data(two)).meses[writeMonth].receitas[0].valor, 7);
    });
    for (const fault of ['quota', 'abort']) add(`${fault} preserves financial state, queue and the write authority atomically`, async () => {
        const s = await setup(), lease = await s.open(), before = JSON.stringify((await s.destination.storage.inspect()).snapshots);
        s.destination.storage.setFaults(fault === 'quota' ? { beforePut() { throw Object.assign(new Error('Synthetic quota'), { name: 'QuotaExceededError' }); } } : { afterPut(tx) { tx.abort(); } });
        await rejects(() => writeIncome(lease)); s.destination.storage.setFaults({}); equal(JSON.stringify((await s.destination.storage.inspect()).snapshots), before); await writeIncome(lease);
    });
    add('recovery retains newer financial revisions, pending attempts, conflicts and all recovery references', async () => {
        const s = await setup(), before = await s.origin.read(), lease = await s.open(), remote = syntheticWriteRemote(); await writeIncome(lease); remote.failNext(); await rejects(() => lease.synchronize(remote));
        const snapshot = await lease.read(), recovery = await target(); const result = await s.writer.recover({ recoverySecret: s.prepared.recoverySecret, newPassword: writePassword, externalCustodyConfirmed: true, recoveryTarget: recovery.capability });
        equal(result.recoverySecret, s.prepared.recoverySecret); await rejects(() => s.open(), 'recovery-in-progress');
        const recovered = manager(s.origin.source, recovery.capability), resumed = await recovered.open({ password: writePassword, recoverySecret: result.recoverySecret, externalCustodyConfirmed: true });
        equal((await resumed.read()).documents[`estado:${writeOwner.uid}`], snapshot.documents[`estado:${writeOwner.uid}`]); equal(await q(resumed), snapshot.documents[`fila:${writeOwner.uid}`]);
        await resumed.synchronize(remote); equal((await q(resumed)).outbox.length, 0); equal(await s.origin.read(), before);
        await writeIncome(resumed, writeOwner.uid, 'synthetic-after-recovery'); const raw = JSON.stringify((await recovery.storage.inspect()).snapshots);
        const repeated = await s.writer.recover({ recoverySecret: s.prepared.recoverySecret, newPassword: writePassword, externalCustodyConfirmed: true, recoveryTarget: recovery.capability }); ok(repeated.alreadyRecovered);
        equal(JSON.stringify((await recovery.storage.inspect()).snapshots), raw);
    });
    add('a stale checkpoint and the old plaintext source cannot roll back newer writes', async () => {
        const s = await setup(), lease = await s.open(), checkpoint = await lease.checkpoint(); await writeIncome(lease); await rejects(() => s.writer.rollback(), 'rollback-requires-current-recovery');
        const recovery = await target(); await rejects(() => s.writer.recover({ recoverySecret: s.prepared.recoverySecret, newPassword: writePassword, externalCustodyConfirmed: true, recoveryTarget: recovery.capability, checkpoint }), 'stale-checkpoint');
        equal((await recovery.storage.inspect()).snapshots.length, 0); const resumed = await s.open(); equal((await data(resumed)).meses[writeMonth].receitas.length, 2);
    });
    add('interrupted recovery resumes the same fenced target without losing pending operations', async () => {
        const s = await setup(), lease = await s.open(); await writeIncome(lease); const before = await q(lease), recovery = await target();
        recovery.storage.setFaults({ beforePut() { throw new Error('Synthetic recovery interruption'); } });
        await rejects(() => s.writer.recover({ recoverySecret: s.prepared.recoverySecret, newPassword: writePassword, externalCustodyConfirmed: true, recoveryTarget: recovery.capability }));
        recovery.storage.setFaults({}); await rejects(() => s.open(), 'recovery-in-progress');
        const recovered = await s.writer.recover({ recoverySecret: s.prepared.recoverySecret, newPassword: writePassword, externalCustodyConfirmed: true, recoveryTarget: recovery.capability });
        const m = manager(s.origin.source, recovery.capability), resumed = await m.open({ password: writePassword, recoverySecret: recovered.recoverySecret, externalCustodyConfirmed: true }); equal(await q(resumed), before);
    });
    add('persisted restore jobs are preserved and block write activation instead of being cleared', async () => {
        const s = await setup(writeOwner, fixture => { fixture.documents[`fila:${writeOwner.uid}`].restoreJob = { generation: 'legacy', pending: true }; });
        const before = JSON.stringify((await s.destination.storage.inspect()).snapshots); await rejects(() => s.open(), 'write-blocked'); equal(JSON.stringify((await s.destination.storage.inspect()).snapshots), before);
    });
    add('all encrypted stores hide written finance values and preserve globally unique durable reservations', async () => {
        const s = await setup(), lease = await s.open(); await writeIncome(lease); const raw = await s.destination.storage.inspect(), text = JSON.stringify(raw);
        for (const marker of ['SYNTHETIC WRITTEN INCOME', '456.78', 'synthetic-new-income', writePassword, s.prepared.recoverySecret]) ok(!text.includes(marker));
        const reservations = raw.nonces.map(([key, value]) => `${value.keyFingerprint}:${value.iv}`); equal(new Set(reservations).size, reservations.length); ok(reservations.length > 0);
    });
    add('recovery commit ACK loss is resumed using the already custodied secret and a fresh DEK', async () => {
        const s = await setup(), lease = await s.open(); await writeIncome(lease); const before = await q(lease), recovery = await target(); let lose = true;
        const wrapped = syntheticTargetCapability({ id: recovery.capability.id, store: { ...recovery.capability.store, compareAndSwap: async (...args) => {
            const value = await recovery.capability.store.compareAndSwap(...args); if (lose) { lose = false; throw Object.assign(new Error('Synthetic lost restore ACK'), { code: 'write-failed' }); } return value;
        } } });
        await rejects(() => s.writer.recover({ recoverySecret: s.prepared.recoverySecret, newPassword: writePassword, externalCustodyConfirmed: true, recoveryTarget: wrapped }), 'write-failed');
        equal((await recovery.storage.inspect()).snapshots.length, 1); await rejects(() => s.open(), 'recovery-in-progress');
        const result = await s.writer.recover({ recoverySecret: s.prepared.recoverySecret, newPassword: writePassword, externalCustodyConfirmed: true, recoveryTarget: wrapped });
        equal(result.recoverySecret, s.prepared.recoverySecret);
        const m = manager(s.origin.source, wrapped), resumed = await m.open({ password: writePassword, recoverySecret: s.prepared.recoverySecret, externalCustodyConfirmed: true }); equal(await q(resumed), before);
    });
    add('recovery preserves a pending reviewed conflict and resumes its exact resolution operation', async () => {
        const s = await setup(), lease = await s.open(), remote = syntheticWriteRemote(); await writeIncome(lease); await lease.synchronize(remote);
        const old = remote.inspect(writeOwner).records[0][1], key = recordEntityKey(old);
        await writeEdit(lease, writeOwner.uid, month => { month.receitas.find(r => r.id === old.id).valor = 4.56; });
        await remote.commit(writeOwner, makeOperation(key, { ...old, record: { ...old.record, valor: 7.89 } }, old.revision)); await lease.synchronize(remote);
        const conflict = (await q(lease)).conflicts[0]; await lease.resolve(conflict.operation.id, 'local'); const before = await q(lease), recovery = await target();
        const result = await s.writer.recover({ recoverySecret: s.prepared.recoverySecret, newPassword: writePassword, externalCustodyConfirmed: true, recoveryTarget: recovery.capability });
        const m = manager(s.origin.source, recovery.capability), resumed = await m.open({ password: writePassword, recoverySecret: result.recoverySecret, externalCustodyConfirmed: true }); equal(await q(resumed), before);
        await resumed.synchronize(remote); equal((await q(resumed)).conflicts.length, 0); equal((await q(resumed)).experimentalDecisions[0].status, 'confirmed'); equal(remote.inspect(writeOwner).records[0][1].record.valor, 4.56);
    });
    add('unrelated existing or newer recovery destinations are never overwritten', async () => {
        const s = await setup(), lease = await s.open(); await writeIncome(lease); const recovery = await target();
        const other = createVaultController({ store: { ...recovery.capability.store, close() {} }, owner: writeOwner, vaultId: 'synthetic-migration', crypto, channelFactory: () => null }); closers.push(() => other.close());
        await other.create({ password: writePassword, generation: 'legacy', documents: writingSourceFixture().documents });
        const before = JSON.stringify((await recovery.storage.inspect()).snapshots);
        await rejects(() => s.writer.recover({ recoverySecret: s.prepared.recoverySecret, newPassword: writePassword, externalCustodyConfirmed: true, recoveryTarget: recovery.capability }), 'destination-exists');
        equal(JSON.stringify((await recovery.storage.inspect()).snapshots), before); const resumed = await s.open(); equal((await q(resumed)).outbox.length, 1);
    });
    add('settings ACK for an older value cannot clear a newer durable settings intent', async () => {
        const s = await setup(), lease = await s.open(), remote = syntheticWriteRemote();
        await writeEdit(lease, writeOwner.uid, (_, state) => { state.categorias.push('Primeira'); });
        let enter, release; const started = new Promise(r => { enter = r; }), gate = new Promise(r => { release = r; });
        const pending = lease.synchronize({ ...remote, commitSettings: async (...args) => { const ack = await remote.commitSettings(...args); enter(); await gate; return ack; } });
        await started; await writeEdit(lease, writeOwner.uid, (_, state) => { state.categorias.push('Segunda'); }); release(); await pending;
        ok((await q(lease)).automaticSettingsDirty); await lease.synchronize(remote); ok(remote.inspect(writeOwner).settings.categories.includes('Segunda')); equal((await q(lease)).automaticSettingsDirty, false);
    });
    return cases;
}
