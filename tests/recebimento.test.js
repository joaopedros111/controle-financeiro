import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { normalizarEstado, validarBackup, criarSerieReceitas, editarReceita, excluirReceita, somarCentavos } from '../finance-core.js';
import { validConflictRecord, registrosFinanceiros, recordEntityKey, makeOperation, signature, combinarRegistros } from '../sync-core.js';
import { reconcileAutomatic, prepareAutomaticBackup } from '../automatic-sync-policy.js';
import { IDIOMAS, textoTraduzido } from '../localization.js';

const month = '2026-10';
const state = (...receitas) => normalizarEstado({ versao: 3, meses: { [month]: { receitas, despesas: [] } } });
const row = (recebido) => ({ id: 'receipt', nome: 'Synthetic income', valor: 123.45,
    ...(recebido === undefined ? {} : { recebido }) });

test('receipt status survives normalization, backup roundtrip, editing and delete/undo; legacy records are unchanged', () => {
    for (const received of [undefined, false, true]) {
        const original = state(row(received));
        assert.equal(validarBackup(original), true);
        const restored = normalizarEstado(JSON.parse(JSON.stringify(original)));
        assert.deepEqual(restored, original);
        const record = restored.meses[month].receitas[0];
        assert.equal(record.recebido, received);
        editarReceita(restored.meses, month, record.id, { nome: 'Edited', valor: 200 });
        assert.equal(record.recebido, received);
        const removed = excluirReceita(restored.meses, month, record.id);
        restored.meses[month].receitas.splice(removed.indice, 0, removed.item);
        assert.equal(restored.meses[month].receitas[0].recebido, received);
        if (received === undefined) assert.equal(Object.hasOwn(record, 'recebido'), false);
    }
    for (const invalid of ['true', 1, null, {}, []]) {
        assert.equal(validarBackup({ meses: { [month]: { receitas: [row(invalid)], despesas: [] } } }), false);
        assert.equal(validConflictRecord({ month, type: 'receitas', id: 'receipt', deleted: false, record: row(invalid) }), false);
    }
});

test('recurring creation receives only the initial occurrence, while status never excludes income from totals', () => {
    for (const received of [false, true]) {
        let id = 0;
        const months = {};
        const created = criarSerieReceitas(months, { chaveInicial: month, nome: 'Monthly', valor: 100, serie: 'series', recebido: received }, () => `r${++id}`);
        assert.equal(created[0].item.recebido, received);
        assert.ok(created.slice(1).every(({ item }) => item.recebido === false));
        assert.equal(somarCentavos(created.map(({ item }) => item.valor)), 120000);
    }
    const records = [row(true), { ...row(false), id: 'pending' }, { ...row(), id: 'legacy' }];
    assert.equal(somarCentavos(state(...records).meses[month].receitas.map(item => item.valor)), 37035);
});

test('receipt changes travel through the existing queue and remote reconciliation in both directions', () => {
    let local = state(row());
    let revision = null;
    for (const received of [true, false]) {
        const updated = state(row(received));
        const record = registrosFinanceiros(updated)[0];
        const key = recordEntityKey(record);
        const operation = makeOperation(key, { ...record, deleted: false }, revision);
        assert.equal(validConflictRecord(operation.value), true);
        assert.equal(operation.value.record.recebido, received);
        const remote = { ...operation.value, revision: operation.id, updatedAt: { seconds: 100, nanoseconds: 0 } };
        assert.equal(validConflictRecord(remote, { remote: true }), true);
        const result = reconcileAutomatic(local, { initialized: true, outbox: [], conflicts: [], remoteRevisions: {} }, [remote], null);
        assert.equal(result.state.meses[month].receitas[0].recebido, received);
        local = normalizarEstado(JSON.parse(JSON.stringify(result.state)));
        revision = operation.id;
    }
    const received = registrosFinanceiros(state(row(true)))[0];
    const pending = registrosFinanceiros(state({ ...row(false), id: 'other' }))[0];
    assert.notEqual(signature(received), signature(pending));
    assert.equal(combinarRegistros([received], [pending], { deduplicarExatos: true }).records.length, 2);
});

test('automatic backup merge preserves received state and does not silently replace the current record', () => {
    const current = state(row(false));
    const backup = state({ ...row(true), id: 'from-backup' });
    const result = prepareAutomaticBackup(backup, current, { outbox: [], conflicts: [] });
    assert.ok(result);
    const serialized = JSON.stringify(result);
    assert.match(serialized, /"recebido":true/);
    assert.match(serialized, /"recebido":false/);
    const queue = { outbox: [], conflicts: [] };
    const preserved = prepareAutomaticBackup(state(row(true)), current, queue);
    assert.equal(preserved.meses[month].receitas[0].recebido, false);
    assert.equal(queue.automaticHistory[0].local.record.recebido, true);
    const markedJob = { outbox: [], conflicts: [] }, unmarkedJob = { outbox: [], conflicts: [] };
    prepareAutomaticBackup(state(row(true)), state(), markedJob);
    prepareAutomaticBackup(state(row(false)), state(), unmarkedJob);
    assert.notEqual(markedJob.backupJobs[0].id, unmarkedJob.backupJobs[0].id);
});

test('the real receipt checkbox handler toggles, saves via summary and restores focus', async () => {
    const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
    let handler, renders = 0, saves = 0, focused = 0;
    const receipt = row();
    const context = vm.createContext({
        ui: { listaReceitas: { addEventListener: (_event, fn) => { handler = fn; }, querySelector: () => ({ focus: () => focused++ }) } },
        obterMes: () => ({ receitas: [receipt] }), renderReceitas: () => renders++, atualizarResumo: () => saves++
    });
    const start = source.indexOf('ui.listaReceitas.addEventListener("change",');
    const end = source.indexOf('ui.listaReceitas.addEventListener("click",', start);
    vm.runInContext(source.slice(start, end), context);
    for (const checked of [true, false]) {
        handler({ target: { checked, classList: { contains: () => true }, closest: () => ({ dataset: { id: receipt.id } }) } });
        assert.equal(receipt.recebido, checked);
    }
    assert.equal(renders, 2); assert.equal(saves, 2); assert.equal(focused, 2);
});

test('receipt statuses and checkbox labels are available in all six interface languages', () => {
    for (const language of IDIOMAS.filter(value => value !== 'pt-BR')) {
        for (const text of ['A receber', 'Recebido', 'Entrada recebida', 'Marcar como a receber', 'Marcar como recebido']) {
            assert.notEqual(textoTraduzido(text, language), text);
        }
    }
});
