import test from 'node:test';
import assert from 'node:assert/strict';
import { ServicoFinanceiroAtomico } from '../financial-atomic-service.js';
import { ConflitoPersistencia } from '../transactional-state.js';

function banco() {
    const data = new Map();
    let previous = Promise.resolve();
    const alterarDocumentos = (keys, transformer) => {
        const run = previous.then(() => {
            const source = new Map(keys.map((k) => [k, structuredClone(data.get(k) ?? null)]));
            const modified = transformer(source);
            for (const key of keys) data.set(key, structuredClone(modified.get(key)));
            return modified;
        });
        previous = run.catch(() => {});
        return run;
    };
    return {
        data,
        alterarDocumentos,
        ler: async (key) => structuredClone(data.get(key) ?? null),
        alterar: async (key, transformer) => (await alterarDocumentos([key], (doc) => {
            doc.set(key, transformer(doc.get(key))); return doc;
        })).get(key)
    };
}
const valid = (value) => value && Array.isArray(value.registros);
const filaValida = (fila) => Array.isArray(fila.outbox) && Array.isArray(fila.conflicts);
const init = (db) => db.data.set('estado:u1', { revisao: 0, dados: { registros: [] } });
const op = (id) => ({ id, month: '2026-10' });

test('duas abas concorrentes: uma revisão é rejeitada, dados e fila permanecem coerentes', async () => {
    const db = banco(); init(db); const a = new ServicoFinanceiroAtomico(db, valid, filaValida);
    const b = new ServicoFinanceiroAtomico(db, valid, filaValida);
    const results = await Promise.allSettled([
        a.aplicar('u1', 0, { registros: ['a'] }, [op('a')]),
        b.aplicar('u1', 0, { registros: ['b'] }, [op('b')])
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter((r) => r.reason instanceof ConflitoPersistencia).length, 1);
    const committed = results.find((r) => r.status === 'fulfilled').value;
    assert.equal(committed.fila.outbox.length, 1);
    assert.deepEqual(committed.estado.dados.registros, [committed.fila.outbox[0].id]);
});
test('erro de fila não modifica estado nem fila', async () => {
    const db = banco(); init(db);
    db.data.set('fila:u1', { outbox: 'corrompido', conflicts: [] });
    const service = new ServicoFinanceiroAtomico(db, valid, filaValida);
    await assert.rejects(service.aplicar('u1', 0, { registros: ['a'] }, [op('a')]));
    assert.equal(db.data.get('estado:u1').revisao, 0);
    assert.equal(db.data.get('fila:u1').outbox, 'corrompido');
});
test('ACK inexistente não remove operações de outras abas', async () => {
    const db = banco(); init(db);
    const service = new ServicoFinanceiroAtomico(db, valid, filaValida);
    await service.aplicar('u1', 0, { registros: ['a', 'b'] }, [op('a'), op('b')]);
    await service.confirmar('u1', 'missing', '2026-10-21');
    assert.deepEqual(db.data.get('fila:u1').outbox.map((o) => o.id), ['a', 'b']);
    await service.confirmar('u1', 'a', '2026-10-21');
    assert.deepEqual(db.data.get('fila:u1').outbox.map((o) => o.id), ['b']);
});
test('ID repetido divergente é rejeitado e mantém revisão', async () => {
    const db = banco(); init(db); const service = new ServicoFinanceiroAtomico(db, valid, filaValida);
    await service.aplicar('u1', 0, { registros: ['a'] }, [op('a')]);
    await assert.rejects(service.aplicar('u1', 1, { registros: ['a', 'b'] }, [{ id: 'a', month: '2026-11' }]));
    assert.equal(db.data.get('estado:u1').revisao, 1);
});

test('duas inclusões em abas diferentes permanecem na fila transacional', async () => {
    const db = banco();
    const a = new ServicoFinanceiroAtomico(db, valid, filaValida);
    const b = new ServicoFinanceiroAtomico(db, valid, filaValida);
    await a.inicializar('u1', { registros: [] }, { outbox: [], conflicts: [], lastConfirmed: null });
    await Promise.all([a.enfileirar('u1', op('a')), b.enfileirar('u1', op('b'))]);
    assert.deepEqual((await a.lerFila('u1')).outbox.map((item) => item.id).sort(), ['a', 'b']);
});
test('ACK de uma aba não remove inclusão concorrente de outra', async () => {
    const db = banco();
    const a = new ServicoFinanceiroAtomico(db, valid, filaValida);
    const b = new ServicoFinanceiroAtomico(db, valid, filaValida);
    await a.inicializar('u1', { registros: [] }, { outbox: [], conflicts: [], lastConfirmed: null });
    await a.enfileirar('u1', op('a'));
    await Promise.all([a.confirmar('u1', 'a', '2026-10-21'), b.enfileirar('u1', op('b'))]);
    assert.deepEqual((await a.lerFila('u1')).outbox.map((item) => item.id), ['b']);
});
test('operação com mesmo ID e payload diferente não altera fila', async () => {
    const db = banco();
    const s = new ServicoFinanceiroAtomico(db, valid, filaValida);
    await s.inicializar('u1', { registros: [] }, { outbox: [], conflicts: [], lastConfirmed: null });
    await s.enfileirar('u1', op('a'));
    await assert.rejects(s.enfileirar('u1', { id: 'a', month: '2026-11' }));
    assert.equal((await s.lerFila('u1')).outbox[0].month, '2026-10');
});
test('falha de gravação de conflito conserva fila anterior', async () => {
    const db = banco();
    const s = new ServicoFinanceiroAtomico(db, valid, filaValida);
    await s.inicializar('u1', { registros: [] }, { outbox: [], conflicts: [], lastConfirmed: null });
    await assert.rejects(s.registrarConflito('u1', {}));
    assert.deepEqual((await s.lerFila('u1')).conflicts, []);
});
