// Diagnostic probes only. A secure:false result documents a defect, not a fix.
import { normalizarEstado, validarBackup } from '../../finance-core.js';
import { makeOperation, recordEntityKey, registrosFinanceiros } from '../../sync-core.js';
import { financeSettings } from '../../automatic-sync-policy.js';
import { createVaultController } from '../../finance-vault-controller.js';
import { createFinancialCodec } from '../../finance-vault-codec.js';
import { VaultStoreError } from '../../finance-vault-store.js';
export const auditOwner = { projectId: 'demo-independent-audit', uid: 'synthetic-audit-A' };
export const auditPassword = 'synthetic-independent-audit-password';
const vaultId = 'synthetic-independent-audit';
const codec = createFinancialCodec();
export function realFinancialFixture(category = 'Moradia') {
    const state = normalizarEstado({ versao: 3, tema: 'claro', categorias: [category],
        orcamentos: { padrao: { [category]: 100 }, meses: {} }, meses: {
            '2026-10': { receitas: [
                { id: 'synthetic-income', nome: 'Synthetic income', valor: 1234.56, recebido: false },
                { id: 'synthetic-legacy-income', nome: 'Synthetic legacy income', valor: 12.34 }
            ], despesas: [{ id: 'synthetic-expense', nome: 'Synthetic expense', valor: 42.17, categoria: category, pago: false }] }
        } });
    if (!validarBackup(state)) throw new Error('Invalid synthetic financial fixture');
    const income = state.meses['2026-10'].receitas[0];
    const value = { month: '2026-10', type: 'receitas', id: income.id, record: income, deleted: false };
    const deleted = { month: '2026-10', type: 'despesas', id: 'synthetic-deleted', deleted: true };
    const live = { ...makeOperation(recordEntityKey(value), value), generation: 'legacy' };
    const deletion = { ...makeOperation(recordEntityKey(deleted), deleted, 'synthetic-remote-1'), generation: 'legacy' };
    const remote = { ...value, revision: 'synthetic-remote-2', updatedAt: { seconds: 1793275200, nanoseconds: 123456789 } };
    const conflict = { operation: live, remote, source: 'firestore', operationId: live.id };
    const recovery = `restore-recovery:${auditOwner.uid}:synthetic-before`;
    const queue = { generation: 'legacy', outbox: [live, deletion], conflicts: [conflict],
    attempted: { [live.id]: true }, remoteRevisions: { [recordEntityKey(value)]: 'synthetic-remote-2' },
    conflictDecisions: [{ status: 'pending', conflict, choice: 'local', state, supersededOperations: [live] }],
    automaticSettingsDirty: true, automaticSettingsValue: financeSettings(state),
    settingsBaseline: financeSettings(state), settingsRevision: 'synthetic-settings-1',
    settingsPristine: false, automaticHasLocalSettings: true,
    automaticHistory: [{ id: 'synthetic-history-1', uploaded: false, entityKey: recordEntityKey(value), policy: 'server-confirmed-wins', local: conflict, remote }],
    automaticResolutions: [{ id: 'synthetic-resolution-1', choice: 'remote', confirmed: false }],
    backupJobs: [{ id: 'synthetic-backup-1', status: 'pending', records: registrosFinanceiros(state).map(recordEntityKey), count: registrosFinanceiros(state).length }],
    recoveryKeys: [recovery], recoveryNotices: [{ id: recovery, acknowledged: false }],
    restoreJob: { generation: 'legacy', baseGeneration: 'legacy', state } };
    return { [`estado:${auditOwner.uid}`]: { revisao: 7, dados: state, origem: 'synthetic-audit' },
        [`fila:${auditOwner.uid}`]: queue, [recovery]: { state, queue: { outbox: queue.outbox, conflicts: queue.conflicts }, reason: 'generation-replaced' } };
}
async function failure(fn) { try { return { value: await fn(), code: null }; } catch (error) { return { code: error.code || error.name }; } }

export function independentAuditCases({ makeStore, crypto }) {
    const cases = [], controllers = [];
    const controller = store => { const c = createVaultController({ store, owner: auditOwner, vaultId, codec, crypto, channelFactory: () => null }); controllers.push(c); return c; };
    const add = (id, name, fn) => cases.push({ id, name, run: async () => { try { return await fn(); } finally { controllers.splice(0).forEach(c => c.close()); } } });
    async function setup(store) {
        const c = controller(store), created = await c.create({ password: auditPassword, generation: 'legacy', documents: realFinancialFixture() }); return { c, created };
    }
    for (const variant of [
        { id: 'A01', method: 'loadCatalog', operation: 'read', code: 'read-failed' },
        { id: 'A02', method: 'load', operation: 'read', code: 'read-failed' },
        { id: 'A02C', method: 'load', operation: 'read', resolve: true },
        { id: 'A03', method: 'loadCatalog', operation: 'status', code: 'corruption' }
    ]) add(variant.id, `late ${variant.operation}/${variant.method} error must not lock a new session`, async () => {
        const storage = await makeStore(); let armed = false, release, entered;
        const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
        const store = { ...storage.store, [variant.method]: async (...args) => {
            if (armed) { armed = false; entered(); await gate; if (!variant.resolve) throw new VaultStoreError(variant.code); }
            return storage.store[variant.method](...args);
        } };
        const { c } = await setup(store), beforeRows = JSON.stringify((await storage.inspect()).snapshots);
        armed = true; const old = failure(() => c[variant.operation]()); await started;
        await c.unlockWithPassword(auditPassword); const before = (await c.status()).state;
        release(); const oldResult = await old, after = (await c.status()).state;
        return { secure: after === 'unlocked', observation: { before, after, oldResult: oldResult.code || oldResult.value?.state,
            persistedUnchanged: beforeRows === JSON.stringify((await storage.inspect()).snapshots) } };
    });
    add('A04', 'valid category recoveryKeys must not be interpreted as an internal graph reference', async () => {
        const storage = await makeStore(), c = controller(storage.store), documents = realFinancialFixture('recoveryKeys');
        const roundTrip = codec.decode(codec.encode(documents));
        const created = await failure(() => c.create({ password: auditPassword, generation: 'legacy', documents }));
        return { secure: !created.code, observation: { applicationValid: validarBackup(documents[`estado:${auditOwner.uid}`].dados),
            codecPreservedBudget: roundTrip[`estado:${auditOwner.uid}`].dados.orcamentos.padrao.recoveryKeys === 100,
            creationError: created.code, persistedSnapshots: (await storage.inspect()).snapshots.length } };
    });
    add('A05', 'lost recovery-renewal acknowledgement must not strand a recovery-only user', async () => {
        const storage = await makeStore(); let lose = false;
        const store = { ...storage.store, compareAndSwap: async (...args) => {
            const result = await storage.store.compareAndSwap(...args); if (lose) { lose = false; throw new VaultStoreError('write-failed'); } return result;
        } };
        const { c, created } = await setup(store);
        await c.lock(); await c.unlockWithRecovery(created.recoverySecret); lose = true;
        const renewal = await failure(() => c.renewRecovery());
        await c.lock(); const reopened = await failure(() => c.unlockWithRecovery(created.recoverySecret));
        const raw = (await storage.inspect()).snapshots[0][1];
        return { secure: !reopened.code || !!renewal.value?.recoverySecret, observation: {
            renewalError: renewal.code, oldRecoveryError: reopened.code, newSecretDelivered: !!renewal.value?.recoverySecret,
            persistedRevision: raw.revision, ciphertextRetained: raw.documents.length >= 3, state: (await c.status()).state } };
    });
    add('A06', 'an accepted growing history must remain importable from its exported package', async () => {
        const storage = await makeStore(), { c, created } = await setup(storage.store);
        const base = realFinancialFixture(), original = base[`estado:${auditOwner.uid}`].dados;
        const state = { ...original, meses: { '2026-10': { receitas: Array.from({ length: 4000 }, (_, i) => ({ id: `synthetic-history-${i}`, nome: 'Synthetic history income', valor: 1.25, recebido: false })), despesas: [] } } };
        if (!validarBackup(state)) throw new Error('Invalid synthetic large history');
        const queue = structuredClone(base[`fila:${auditOwner.uid}`]);
        for (let i = 0; i < 5; i++) {
            const key = `restore-recovery:${auditOwner.uid}:synthetic-growth-${i}`; queue.recoveryKeys.push(key);
            const token = await c.prepare({ expectedRevision: i + 1, generation: 'legacy', updates: {
                [key]: { state, reason: 'synthetic-history-growth' }, [`fila:${auditOwner.uid}`]: queue
            } }); await c.commit(token);
        }
        const pack = await c.exportRecoveryPackage(), targetStorage = await makeStore(), target = controller(targetStorage.store);
        const restored = await failure(() => target.importRecoveryPackage(pack, { recoverySecret: created.recoverySecret, newPassword: auditPassword }));
        return { secure: !restored.code, observation: { historyDocuments: 5, receiptsPerHistory: 4000, packageBytes: pack.length,
            packageUnder32MiB: pack.length < 32 * 1024 * 1024, sourceRevision: (await c.read()).catalog.revision,
            importError: restored.code, destinationSnapshots: (await targetStorage.inspect()).snapshots.length } };
    });
    return cases;
}
