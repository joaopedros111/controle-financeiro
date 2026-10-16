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

test("Service Worker não ativa atualização pendente automaticamente e só faz skipWaiting após confirmação", async () => {
    const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
    const handlers = {};
    let skipWaitingChamado = 0;
    const self = {
        registration: { scope: "https://example.test/finance/" },
        addEventListener: (nome, handler) => { handlers[nome] = handler; },
        skipWaiting: async () => { skipWaitingChamado += 1; },
        clients: { claim: async () => {} }
    };
    const caches = { open: async () => ({ addAll: async () => {} }) };
    vm.runInNewContext(source, { self, caches, URL, Promise, Set, Response, fetch: globalThis.fetch });

    let instalacao;
    handlers.install({ waitUntil: (promise) => { instalacao = promise; } });
    await instalacao;
    assert.equal(skipWaitingChamado, 0);
    assert.doesNotMatch(source, /localStorage|indexedDB/);

    let ativacao;
    handlers.message({
        data: { tipo: "ATIVAR_ATUALIZACAO" },
        waitUntil: (promise) => { ativacao = promise; }
    });
    await ativacao;
    assert.equal(skipWaitingChamado, 1);
});

test("consulta de version.json com parâmetro de verificação ignora o cache do Service Worker", async () => {
    const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
    const handlers = {};
    let cacheMatchChamado = 0;
    let requisicaoRede;
    const respostaCache = new Response("versão antiga", { status: 200 });
    const caches = {
        open: async () => ({
            match: async () => { cacheMatchChamado += 1; return respostaCache; },
            put: async () => {}
        })
    };
    const self = {
        registration: { scope: "https://example.test/finance/" },
        addEventListener: (nome, handler) => { handlers[nome] = handler; },
        skipWaiting: async () => {},
        clients: { claim: async () => {} }
    };
    const fetch = async (request, options) => {
        requisicaoRede = { request, options };
        return new Response("versão publicada", { status: 200 });
    };
    vm.runInNewContext(source, { self, caches, URL, Promise, Set, Response, fetch });

    let resultado;
    const requisicao = { method: "GET", url: "https://example.test/finance/version.json?_verificacao=42" };
    handlers.fetch({ request: requisicao, respondWith: (promise) => { resultado = promise; } });
    assert.equal(await (await resultado).text(), "versão publicada");
    assert.equal(cacheMatchChamado, 0);
    assert.equal(requisicaoRede.options.cache, "no-store");
});
