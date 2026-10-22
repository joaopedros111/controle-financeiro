import test from 'node:test';
import assert from 'node:assert/strict';
import { EstadoTransacional, ConflitoPersistencia } from '../transactional-state.js';

function bancoSimulado() {
    const dados = new Map();
    let corrente = Promise.resolve();
    return {
        ler: async (chave) => structuredClone(dados.get(chave) ?? null),
        alterar(chave, transformar) {
            const tarefa = corrente.then(() => {
                const atual = structuredClone(dados.get(chave) ?? null);
                const proximo = transformar(atual);
                dados.set(chave, structuredClone(proximo));
                return structuredClone(proximo);
            });
            corrente = tarefa.catch(() => {});
            return tarefa;
        }
    };
}
const validar = (valor) => valor && Array.isArray(valor.registros);
const estado = (...ids) => ({ registros: ids });
const fonte = (valor) => () => ({ estado: 'valido', valor });

test('importação preserva fonte e não substitui estado existente', async () => {
    const store = new EstadoTransacional(bancoSimulado(), validar);
    const inicial = await store.carregar('u1', fonte(estado('a')));
    assert.equal(inicial.revisao, 0);
    await store.gravar('u1', 0, estado('a', 'b'));
    const recarga = await store.carregar('u1', fonte(estado('antigo')));
    assert.deepEqual(recarga.dados, estado('a', 'b'));
});
test('duas abas com revisão antiga não sobrescrevem dados', async () => {
    const db = bancoSimulado();
    const a = new EstadoTransacional(db, validar), b = new EstadoTransacional(db, validar);
    const [baseA, baseB] = await Promise.all([a.carregar('u1', fonte(estado())), b.carregar('u1', fonte(estado()))]);
    const resultados = await Promise.allSettled([a.gravar('u1', baseA.revisao, estado('a')), b.gravar('u1', baseB.revisao, estado('b'))]);
    assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(resultados.filter((r) => r.reason instanceof ConflitoPersistencia).length, 1);
    assert.equal((await a.consultar('u1')).revisao, 1);
});
test('falha de validação mantém revisão e dados', async () => {
    const store = new EstadoTransacional(bancoSimulado(), validar);
    await store.carregar('u1', fonte(estado('a')));
    await assert.rejects(store.gravar('u1', 0, { registros: null }));
    assert.deepEqual((await store.consultar('u1')).dados, estado('a'));
});
test('fonte legada inválida bloqueia importação', async () => {
    const store = new EstadoTransacional(bancoSimulado(), validar);
    await assert.rejects(store.carregar('u1', () => ({ estado: 'invalido' })));
    assert.equal(await store.consultar('u1'), null);
});
