import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("ativação limpa apenas caches deste app e aguarda o controle dos clientes", async () => {
    const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
    const handlers = {};
    const apagados = [];
    let clientesReclamados = false;
    const self = {
        registration: { scope: "https://example.test/finance/" },
        addEventListener: (nome, handler) => { handlers[nome] = handler; },
        skipWaiting: () => Promise.resolve(),
        clients: { claim: async () => { clientesReclamados = true; } }
    };
    const caches = {
        keys: async () => ["outro-app-cache-v1", "controle-financeiro-v5", "controle-financeiro-pwa-cache-v5"],
        delete: async (chave) => { apagados.push(chave); return true; }
    };
    vm.runInNewContext(source, { self, caches, URL, Promise, Set, Response, fetch: globalThis.fetch });

    let aguardado;
    handlers.activate({ waitUntil: (promise) => { aguardado = promise; } });
    await aguardado;

    assert.deepEqual(apagados.sort(), ["controle-financeiro-pwa-cache-v5", "controle-financeiro-v5"]);
    assert.equal(clientesReclamados, true);
});
