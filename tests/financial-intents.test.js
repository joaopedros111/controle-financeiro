import test from 'node:test';
import assert from 'node:assert/strict';
import { combinarEdicaoFinanceira, ConflitoEdicao } from '../financial-intents.js';
import { ServicoFinanceiroAtomico } from '../financial-atomic-service.js';

const record = (id, valor = 10) => ({ id, nome: `Synthetic ${id}`, valor });
const estado = (...items) => ({ versao: 3, categorias: ['Outros'], meses: { '2026-10': { receitas: items, despesas: [] } } });
const values = (state) => state.meses['2026-10'].receitas;
const valid = (s) => s && Array.isArray(s.categorias) && s.meses && Array.isArray(values(s));
const validQueue = (q) => q && Array.isArray(q.outbox) && Array.isArray(q.conflicts);
const queue = () => ({ outbox: [], conflicts: [], lastConfirmed: null });
const adapter = () => {
    const data = new Map(); let tail = Promise.resolve();
    const db = { data,
        alterarDocumentos(keys, cb) {
            const run = tail.then(() => {
                const docs = new Map(keys.map((key) => [key, structuredClone(data.get(key) ?? null)]));
                const changed = cb(docs);
                for (const key of keys) data.set(key, structuredClone(changed.get(key)));
                return structuredClone([...changed]);
            }).then((pairs) => new Map(pairs));
            tail = run.catch(() => {});
            return run;
        },
        alterar(key, cb) { return db.alterarDocumentos([key], (values) => { values.set(key, cb(values.get(key))); return values; }).then((res) => res.get(key)); }
    };
    return db;
};

test('duas abas criam registros diferentes: merge sem excluir o primeiro', async () => {
    const db = adapter(), service = new ServicoFinanceiroAtomico(db, valid, validQueue), base = estado();
    await service.inicializar('alice', base, queue());
    const [a, b] = await Promise.all([
        service.aplicarEdicao('alice', base, estado(record('a'))),
        service.aplicarEdicao('alice', base, estado(record('b')))
    ]);
    assert.deepEqual(values(b.estado.dados).map((r) => r.id), ['a', 'b']);
    assert.equal(a.estado.revisao, 1);
    assert.equal(b.estado.revisao, 2);
});

test('editar mesmo registro em abas diferentes gera conflito e preserva a primeira edição', async () => {
    const db = adapter(), service = new ServicoFinanceiroAtomico(db, valid, validQueue), base = estado(record('same'));
    await service.inicializar('alice', base, queue());
    await service.aplicarEdicao('alice', base, estado(record('same', 20)));
    await assert.rejects(service.aplicarEdicao('alice', base, estado(record('same', 30))), ConflitoEdicao);
    assert.equal(values(db.data.get('estado:alice').dados)[0].valor, 20);
});

test('ausência no snapshot antigo não vira exclusão', async () => {
    const base = estado(), fresh = estado(record('added')), edited = estado(record('different'));
    const result = combinarEdicaoFinanceira(base, edited, fresh);
    assert.deepEqual(values(result.estado).map((r) => r.id).sort(), ['added', 'different']);
    assert.equal(result.mudancas.some((op) => op.deleted), false);
});

test('exclusão explícita colide com edição remota do mesmo registro', async () => {
    const base = estado(record('x'));
    assert.throws(() => combinarEdicaoFinanceira(base, estado(), estado(record('x', 30))), ConflitoEdicao);
});

test('configurações divergentes não são sobrescritas', () => {
    const base = estado(), proposed = { ...base, categorias: ['A'] }, fresh = { ...base, categorias: ['B'] };
    assert.throws(() => combinarEdicaoFinanceira(base, proposed, fresh), ConflitoEdicao);
});

test('migração atômica não substitui IndexedDB existente por dados legados diferentes', async () => {
    const db = adapter(), service = new ServicoFinanceiroAtomico(db, valid, validQueue);
    const first = await service.inicializar('alice', estado(record('first')), queue());
    const again = await service.inicializar('alice', estado(record('new')), queue());
    assert.deepEqual(again.estado, first.estado);
    assert.deepEqual(values(again.estado.dados).map((r) => r.id), ['first']);
});

test('migração parcial é bloqueada e preserva dados anteriores', async () => {
    const db = adapter(), service = new ServicoFinanceiroAtomico(db, valid, validQueue);
    db.data.set('estado:alice', { revisao: 4, dados: estado(record('old')) });
    await assert.rejects(service.inicializar('alice', estado(record('new')), queue()), /Migração parcial/);
    assert.equal(db.data.has('fila:alice'), false);
    assert.equal(db.data.get('estado:alice').revisao, 4);
});

test('duas edições e fila atomizadas: falha no validador preserva ambas', async () => {
    const db = adapter(), service = new ServicoFinanceiroAtomico(db, valid, validQueue), base = estado();
    await service.inicializar('alice', base, queue());
    await assert.rejects(service.aplicarEdicao('alice', base, estado(record('a')), () => [{ bad: true }]));
    assert.equal(db.data.get('estado:alice').revisao, 0);
    assert.deepEqual(db.data.get('fila:alice').outbox, []);
});

test('ACK só remove operação específica inserida na mesma transação', async () => {
    const db = adapter(), service = new ServicoFinanceiroAtomico(db, valid, validQueue), base = estado();
    await service.inicializar('alice', base, queue());
    const result = await service.aplicarEdicao('alice', base, estado(record('a')), (changes) => changes.map((x) => ({ id: x.id, ...x })));
    assert.deepEqual(result.fila.outbox.map((op) => op.id), ['a']);
    await service.aplicarEdicao('alice', result.estado.dados, estado(record('a'), record('b')), (changes) => changes.map((x) => ({ id: x.id, ...x })));
    await service.confirmar('alice', 'a', '2026-10-21');
    assert.deepEqual(db.data.get('fila:alice').outbox.map((op) => op.id), ['b']);
});

test('concurrent themes do not conflict or replace critical categories, budgets and records',()=>{
 const base={...estado(record('keep')),tema:'claro',orcamentos:{padrao:{Outros:10},meses:{}}};
 const fresh={...structuredClone(base),tema:'escuro',categorias:['Outros','Moto','Serasa']};
 const result=combinarEdicaoFinanceira(base,{...structuredClone(base),tema:'rosa'},fresh);
 assert.equal(result.estado.tema,'rosa');assert.deepEqual(result.estado.categorias,fresh.categorias);assert.deepEqual(result.estado.orcamentos,base.orcamentos);assert.deepEqual(values(result.estado),values(base));
});
