import test from "node:test";
import assert from "node:assert/strict";
import { criarArmazenamento } from "../storage.js";

function armazenamentoFalso() {
    const dados = new Map();
    return {
        dados,
        getItem: (chave) => dados.get(chave) ?? null,
        setItem: (chave, valor) => dados.set(chave, String(valor)),
        removeItem: (chave) => dados.delete(chave)
    };
}

test("camada de armazenamento lê e grava JSON no armazenamento persistente", () => {
    const fake = armazenamentoFalso();
    const store = criarArmazenamento(fake);
    assert.equal(store.persistente, true);
    assert.equal(store.escreverJson("estado", { valor: 42 }), true);
    assert.deepEqual(store.lerJson("estado"), { valor: 42 });
    store.remover("estado");
    assert.equal(store.ler("estado"), null);
});

test("camada mantém cópia temporária quando o armazenamento persistente falha", () => {
    const fake = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem() {} };
    const store = criarArmazenamento(fake);
    assert.equal(store.escreverJson("estado", { valor: 7 }), false);
    assert.deepEqual(store.lerJson("estado"), { valor: 7 });
    assert.equal(store.persistente, false);
});

test("camada sem armazenamento local mantém os dados apenas na memória", () => {
    const store = criarArmazenamento(null, new Map());
    assert.equal(store.persistente, false);
    assert.equal(store.escrever("chave", "valor"), false);
    assert.equal(store.ler("chave"), "valor");
});
