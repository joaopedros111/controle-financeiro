import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarEstado } from '../finance-core.js';
import { makeOperation, recordEntityKey } from '../sync-core.js';
import { reconcileAutomatic, prepareAutomaticBackup, financeSettings, transientSyncError, captureRejectedLocalEdit } from '../automatic-sync-policy.js';
const row = (valor = 10) => ({ id: 'r1', nome: 'Synthetic', valor });
const entry = (revision = 'server-b', valor = 20, deleted = false) => ({ month: '2026-10', type: 'receitas', id: 'r1',
    ...(deleted ? {} : { record: row(valor) }), deleted, revision, updatedAt: { seconds: 100, nanoseconds: 0 } });
const state = (valor = 30) => normalizarEstado({ versao: 3, meses: { '2026-10': { receitas: [row(valor)], despesas: [] } } });
const queue = (operations = []) => ({ initialized: true, outbox: operations, conflicts: [], remoteRevisions: { [recordEntityKey(entry())]: 'server-a' }, lastConfirmed: null });
const op = (deleted = false) => makeOperation(recordEntityKey(entry()), { month: '2026-10', type: 'receitas', id: 'r1',
    ...(deleted ? {} : { record: row(30) }), deleted }, 'server-a');
test('server-confirmed revision wins concurrent edits, preserving original intention and reliable server metadata', () => {
    const original = queue([op()]), before = structuredClone(original);
    const result = reconcileAutomatic(state(), original, [entry()], null);
    assert.equal(result.state.meses['2026-10'].receitas[0].valor, 20);
    assert.equal(result.queue.outbox.length, 0);
    assert.deepEqual(result.queue.automaticHistory[0].local.operations[0], op());
    assert.equal(result.queue.automaticHistory[0].remote.updatedAt.seconds, 100);
    assert.deepEqual(original, before);
});
test('local deletion beats a concurrent edit by rebasing only the tombstone, preserving rejected remote edit', () => {
    const a = reconcileAutomatic(state(), queue([op(true)]), [entry()], null);
    assert.equal(a.state.meses['2026-10'].receitas.length, 0);
    assert.equal(a.queue.outbox[0].value.deleted, true);
    assert.equal(a.queue.outbox[0].baseRevision, 'server-b');
    assert.equal(a.queue.automaticHistory[0].remote.record.valor, 20);
    const b = reconcileAutomatic(a.state, a.queue, [entry()], null);
    assert.deepEqual(b.queue.outbox, a.queue.outbox);
    assert.equal(b.queue.automaticHistory.length, a.queue.automaticHistory.length);
});
test('server tombstone always defeats a delayed edit, including a matching tombstone revision', () => {
    const pending = op(); pending.baseRevision = 'server-b';
    const a = reconcileAutomatic(state(), queue([pending]), [entry('server-b', 20, true)], null);
    assert.equal(a.state.meses['2026-10'].receitas.length, 0);
    assert.equal(a.queue.outbox.length, 0);
    assert.equal(a.queue.automaticHistory[0].local.operations[0].value.record.valor, 30);
    const b = reconcileAutomatic(a.state, a.queue, [entry('server-b', 20, true)], null);
    assert.equal(b.queue.automaticHistory.length, a.queue.automaticHistory.length);
});

test('a rejected deletion left by an older client is completed automatically from its server conflict', () => {
    const rejected = { operationId: op(true).id, entityKey: recordEntityKey(entry()), local: op(true).value, remote: entry() };
    const a = reconcileAutomatic(state(), queue(), [entry()], null, [rejected]);
    assert.equal(a.state.meses['2026-10'].receitas.length, 0);
    assert.equal(a.queue.outbox[0].value.deleted, true);
    assert.equal(a.queue.outbox[0].baseRevision, 'server-b');
    assert.equal(a.queue.automaticResolutions[0].choice, 'local');
});
test('ordinary confirmed snapshots never create an operation or a recovery upload', () => {
    const a = reconcileAutomatic(state(10), queue(), [entry()], null);
    assert.equal(a.state.meses['2026-10'].receitas[0].valor, 20);
    assert.equal(a.queue.outbox.length, 0);
    assert.equal(a.queue.automaticHistory?.length || 0, 0);
});
test('matching base and lost ACK preserve the immutable queued operation', () => {
    for (const revision of ['server-a', op().id]) {
        const a = reconcileAutomatic(state(), queue([op()]), [entry(revision)], null);
        assert.deepEqual(a.queue.outbox, [op()]);
        assert.equal(a.state.meses['2026-10'].receitas[0].valor, 30);
    }
});
test('latest server settings defeat concurrent categories and budgets; local alternative is recoverable', () => {
    const s = state(), q = queue(); q.settingsBaseline = financeSettings(s);
    s.categorias.push('Local'); s.orcamentos.padrao.Local = 30; q.automaticSettingsDirty = true;
    const remote = { ...q.settingsBaseline, categories: ['Remote'], budgets: { padrao: { Remote: 50 }, meses: {} }, revision: 's-new' };
    const a = reconcileAutomatic(s, q, [entry()], remote);
    assert.deepEqual(a.state.categorias, ['Remote']);
    assert.equal(a.state.orcamentos.padrao.Remote, 50);
    assert.ok(a.queue.automaticHistory.some(item => item.entityKey === 'settings' && item.local.categories.includes('Local')));
    assert.equal(a.queue.automaticSettingsDirty, false);
});
test('local-only settings edit survives while server still equals the known base', () => {
    const s = state(), q = queue(); const remote = { ...financeSettings(s), revision: 's-base' };
    q.settingsBaseline = financeSettings(s); q.automaticSettingsDirty = true; s.categorias.push('Local');
    const a = reconcileAutomatic(s, q, [entry()], remote);
    assert.ok(a.state.categorias.includes('Local'));
    assert.equal(a.queue.automaticSettingsDirty, true);
});

test('legacy pending backup alternatives are preserved and its changed settings resume automatically', () => {
    const s = state(30), q = queue(); q.restoredPending = true;
    q.settingsBaseline = financeSettings(s); s.categorias.push('Imported');
    const remote = { ...q.settingsBaseline, revision: 'settings-base' };
    const a = reconcileAutomatic(s, q, [entry('server-a', 10)], remote);
    assert.equal(a.state.meses['2026-10'].receitas[0].valor, 10);
    assert.equal(a.queue.automaticHistory[0].local.record.record.valor, 30);
    assert.equal(a.queue.automaticSettingsDirty, true);
    assert.ok(a.state.categorias.includes('Imported'));
    const deleted = reconcileAutomatic(s, q, [entry('server-b', 10, true)], remote);
    assert.equal(deleted.state.meses['2026-10'].receitas.length, 0);
    assert.equal(deleted.queue.automaticHistory[0].local.record.record.valor, 30);
    const oldOperation = op(); oldOperation.value.record.valor = 20;
    const pending = reconcileAutomatic(s, { ...q, outbox: [oldOperation] }, [entry('server-a', 10)], remote);
    assert.equal(pending.queue.automaticHistory[0].local.record.record.valor, 30);
});

test('derived remote categories after bootstrap never become a settings upload intention', () => {
    const s = state(), q = queue(); q.settingsBaseline = financeSettings(s); q.automaticPolicyInitialized = true;
    s.categorias.push('Derived from a snapshot');
    const a = reconcileAutomatic(s, q, [entry()], { ...q.settingsBaseline, revision: 'settings-base' });
    assert.equal(!!a.queue.automaticSettingsDirty, false);
    assert.deepEqual(a.state.categorias, q.settingsBaseline.categories);
});
test('backup import is deterministic without IDs and preserves multiplicity, installments, recurrence and budgets', () => {
    const raw = { versao: 3, categorias: ['Casa'], orcamentos: { padrao: { Casa: 100 }, meses: {} }, meses: {
        '2026-10': { receitas: [{ nome: 'Salary', valor: 100, serie: 'salary-series' }], despesas: [
            { nome: 'Parcel', valor: 20, categoria: 'Casa', serie: 's1', parcela: { atual: 1, total: 3 } },
            { nome: 'Parcel', valor: 20, categoria: 'Casa', serie: 's1', parcela: { atual: 2, total: 3 } }] }
    } };
    const q = queue(), initial = normalizarEstado(null);
    const a = prepareAutomaticBackup(raw, initial, q), b = prepareAutomaticBackup(raw, a, q);
    assert.deepEqual(a, b); assert.equal(q.backupJobs.length, 1);
    assert.equal(a.meses['2026-10'].despesas.length, 2);
    assert.equal(a.meses['2026-10'].despesas[1].parcela.atual, 2);
    assert.equal(a.meses['2026-10'].receitas[0].serie, 'salary-series');
    assert.equal(a.orcamentos.padrao.Casa, 100);
    assert.throws(() => prepareAutomaticBackup({ meses: { bad: {} } }, a, q));
});
test('backup never restores metadata or silently overwrites a record edited after a prior import', () => {
    const raw = { ...state(10), conflicts: [{ bad: true }], outbox: [{ bad: true }], revision: 'old', uid: 'someone-else' };
    const q = queue(); const a = prepareAutomaticBackup(raw, state(30), q);
    assert.equal(a.meses['2026-10'].receitas[0].valor, 30);
    assert.equal(a.conflicts, undefined); assert.equal(q.outbox.length, 0);
    assert.equal(q.automaticHistory[0].local.record.valor, 10);
});
test('old conflict/decision recovery is idempotent and never requires another manual review', () => {
    const q = queue(); q.conflicts = [{ kind: 'concurrent-change', operation: op(), remote: entry() }];
    q.conflictDecisions = [{ status: 'failed', choice: 'local', conflict: q.conflicts[0] }];
    const a = reconcileAutomatic(state(), q, [entry()], null);
    assert.equal(a.queue.conflicts.length, 0); assert.equal(a.queue.conflictDecisions[0].status, 'confirmed');
    const b = reconcileAutomatic(a.state, a.queue, [entry()], null);
    assert.equal(b.queue.automaticHistory.length, a.queue.automaticHistory.length);
});
test('transient failures retry; permanent permission/storage/validation errors remain visible', () => {
    assert.equal(transientSyncError({ code: 'unavailable' }), true);
    assert.equal(transientSyncError({ code: 'permission-denied' }), false);
    assert.equal(transientSyncError({ code: 'sync/invalid-data' }), false);
    assert.equal(transientSyncError({ code: 'QuotaExceededError' }), false);
});

test('backup identity excludes synchronization metadata; unsupported budgets fail before any partial import', () => {
    const raw = { versao: 3, meses: { '2026-10': { receitas: [{ nome: 'Synthetic', valor: 10 }], despesas: [] } } };
    const q = queue(), a = prepareAutomaticBackup(raw, normalizarEstado(null), q);
    const b = prepareAutomaticBackup({ ...raw, uid: 'old', outbox: [op()], conflicts: [{ old: true }] }, a, q);
    assert.deepEqual(a, b); assert.equal(q.backupJobs.length, 1);
    const before = structuredClone(q);
    assert.throws(() => prepareAutomaticBackup({ ...raw, orcamentos: { padrao: {}, meses: { '2026-10': { Casa: 5 } } } }, a, q), /Nenhum dado/);
    assert.deepEqual(q, before);
});

test('same-browser rejected edits are recoverable and a concurrent local deletion still stages a tombstone', () => {
    const q = queue([op()]);
    captureRejectedLocalEdit(q, state(10), state(40));
    assert.equal(q.automaticHistory[0].local.proposal.record.valor, 40);
    assert.deepEqual(q.outbox, [op()]);
    const deleted = state(); deleted.meses['2026-10'].receitas = [];
    captureRejectedLocalEdit(q, state(), deleted);
    assert.equal(q.outbox.at(-1).value.deleted, true);
    assert.equal(q.outbox.at(-1).baseRevision, op().id);
});
