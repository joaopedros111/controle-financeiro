import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function lerVersaoRelease() {
    const metadados = await readFile(new URL("../version.json", import.meta.url), "utf8");
    return JSON.parse(metadados).version;
}

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
    const versao = await lerVersaoRelease();
    const handlers = {};
    let skipWaitingChamado = 0;
    const self = {
        registration: { scope: "https://example.test/finance/" },
        addEventListener: (nome, handler) => { handlers[nome] = handler; },
        skipWaiting: async () => { skipWaitingChamado += 1; },
        clients: { claim: async () => {} }
    };
    const caches = {
        open: async () => ({
            addAll: async () => {},
            match: async () => new Response(JSON.stringify({ version: versao }), {
                headers: { "Content-Type": "application/json" }
            })
        })
    };
    vm.runInNewContext(source, { self, caches, URL, Promise, Set, Request, Response, fetch: globalThis.fetch });

    let instalacao;
    handlers.install({ waitUntil: (promise) => { instalacao = promise; } });
    await instalacao;
    assert.equal(skipWaitingChamado, 0);
    assert.doesNotMatch(source, /localStorage|indexedDB/);

    let ativacao;
    handlers.message({
        data: { tipo: "ATIVAR_ATUALIZACAO", versao },
        waitUntil: (promise) => { ativacao = promise; }
    });
    await ativacao;
    assert.equal(skipWaitingChamado, 1);
});

test("instalação precacheia recursos com URL exclusiva do release e revalida o cache HTTP", async () => {
    const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
    const versao = await lerVersaoRelease();
    const handlers = {};
    const requisicoes = [];
    const self = {
        registration: { scope: "https://example.test/finance/" },
        addEventListener: (nome, handler) => { handlers[nome] = handler; },
        skipWaiting: async () => {},
        clients: { claim: async () => {} }
    };
    const caches = {
        open: async () => ({
            addAll: async (lote) => { requisicoes.push(...lote); },
            match: async (url) => url.endsWith("/version.json")
                ? new Response(JSON.stringify({ version: versao }))
                : null
        })
    };
    vm.runInNewContext(source, { self, caches, URL, Promise, Set, Request, Response, fetch: globalThis.fetch });

    let instalacao;
    handlers.install({ waitUntil: (promise) => { instalacao = promise; } });
    await instalacao;

    assert.ok(requisicoes.length > 0);
    assert.ok(requisicoes.every((request) => request.cache === "reload"));
    assert.ok(requisicoes.some((request) => request.url.endsWith(`/app.js?_release=${versao}`)));
    assert.ok(requisicoes.some((request) => request.url.endsWith(`/index.html?_release=${versao}`)));
});

test("navegações recebem o index.html do mesmo release do Service Worker ativo", async () => {
    const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
    const versao = await lerVersaoRelease();
    const handlers = {};
    const chavesConsultadas = [];
    const self = {
        registration: { scope: "https://example.test/finance/" },
        addEventListener: (nome, handler) => { handlers[nome] = handler; },
        skipWaiting: async () => {},
        clients: { claim: async () => {} }
    };
    const caches = {
        open: async () => ({
            match: async (chave) => {
                chavesConsultadas.push(String(chave));
                return String(chave).endsWith(`/index.html?_release=${versao}`)
                    ? new Response("shell do release ativo")
                    : null;
            }
        })
    };
    vm.runInNewContext(source, { self, caches, URL, Promise, Set, Request, Response, fetch: globalThis.fetch });
    let resposta;
    handlers.fetch({
        request: { method: "GET", url: "https://example.test/finance/", mode: "navigate" },
        respondWith: (promise) => { resposta = promise; }
    });

    assert.equal(await (await resposta).text(), "shell do release ativo");
    assert.ok(chavesConsultadas.some((chave) => chave.endsWith(`/index.html?_release=${versao}`)));
});

test("Service Worker informa sua identidade de build", async () => {
    const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
    const versao = await lerVersaoRelease();
    const handlers = {};
    const self = {
        registration: { scope: "https://example.test/finance/" },
        addEventListener: (nome, handler) => { handlers[nome] = handler; },
        skipWaiting: async () => {},
        clients: { claim: async () => {} }
    };
    vm.runInNewContext(source, { self, caches: {}, URL, Promise, Set, Response, fetch: globalThis.fetch });

    const respostas = [];
    handlers.message({
        data: { tipo: "OBTER_VERSAO" },
        ports: [{ postMessage: (mensagem) => respostas.push(mensagem) }],
        waitUntil() {}
    });
    assert.equal(versao, "1.1.9");
    assert.equal(respostas.length, 1);
    assert.deepEqual(Object.keys(respostas[0]).sort(), ["tipo", "versao"]);
    assert.equal(respostas[0].tipo, "VERSAO_SERVICE_WORKER");
    assert.equal(respostas[0].versao, versao);
});

test("Service Worker só executa skipWaiting se a versão aceita corresponder ao build", async () => {
    const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
    const versao = await lerVersaoRelease();
    const versaoDiferente = versao === "0.0.0" ? "0.0.1" : "0.0.0";
    const handlers = {};
    let skipWaitingChamado = 0;
    const self = {
        registration: { scope: "https://example.test/finance/" },
        addEventListener: (nome, handler) => { handlers[nome] = handler; },
        skipWaiting: async () => { skipWaitingChamado += 1; },
        clients: { claim: async () => {} }
    };
    vm.runInNewContext(source, { self, caches: {}, URL, Promise, Set, Response, fetch: globalThis.fetch });

    const respostas = [];
    const evento = (versao) => ({
        data: { tipo: "ATIVAR_ATUALIZACAO", versao },
        ports: [{ postMessage: (mensagem) => respostas.push(mensagem) }],
        waitUntil: (promessa) => { evento.ativacao = promessa; }
    });
    const desatualizado = evento(versaoDiferente);
    handlers.message(desatualizado);
    await Promise.resolve();
    assert.equal(skipWaitingChamado, 0);
    const respostaRecusada = respostas.pop();
    assert.deepEqual(Object.keys(respostaRecusada).sort(), ["tipo", "versao"]);
    assert.equal(respostaRecusada.tipo, "ATUALIZACAO_RECUSADA");
    assert.equal(respostaRecusada.versao, versao);

    const esperado = evento(versao);
    handlers.message(esperado);
    await esperado.ativacao;
    assert.equal(skipWaitingChamado, 1);
    const respostaAceita = respostas.pop();
    assert.equal(versao, "1.1.9");
    assert.deepEqual(Object.keys(respostaAceita).sort(), ["tipo", "versao"]);
    assert.equal(respostaAceita.tipo, "ATUALIZACAO_ACEITA");
    assert.equal(respostaAceita.versao, versao);
});

test("consultas de version.json para verificação ignoram o cache do Service Worker", async () => {
    const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
    const handlers = {};
    let cacheMatchChamado = 0;
    const requisicoesRede = [];
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
        requisicoesRede.push({ request, options });
        return new Response("versão publicada", { status: 200 });
    };
    vm.runInNewContext(source, { self, caches, URL, Promise, Set, Response, fetch });

    for (const requisicao of [
        { method: "GET", url: "https://example.test/finance/version.json?_verificacao=42" },
        { method: "GET", url: "https://example.test/finance/version.json", cache: "no-cache" }
    ]) {
        let resultado;
        handlers.fetch({ request: requisicao, respondWith: (promise) => { resultado = promise; } });
        assert.equal(await (await resultado).text(), "versão publicada");
    }
    assert.equal(cacheMatchChamado, 0);
    assert.equal(requisicoesRede.length, 2);
    assert.ok(requisicoesRede.every(({ options }) => options.cache === "no-store"));
});
