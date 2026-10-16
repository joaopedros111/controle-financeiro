import test from "node:test";
import assert from "node:assert/strict";
import {
    compararVersoes,
    instalarAtualizacao,
    lerVersaoInstalada,
    lerVersaoPublicada,
    versaoValida,
    verificarComConfirmacao
} from "../update-manager.js";

test("versões usam MAJOR.MINOR.PATCH e são comparadas numericamente", () => {
    assert.equal(versaoValida("1.1.0"), true);
    assert.equal(versaoValida("01.1.0"), false);
    assert.equal(versaoValida("1.1"), false);
    assert.equal(compararVersoes("1.10.0", "1.9.9"), 1);
    assert.equal(compararVersoes("2.0.0", "2.0.1"), -1);
    assert.equal(compararVersoes("1.2.3", "1.2.3"), 0);
    assert.throws(() => compararVersoes("invalida", "1.0.0"), /inválido/);
});

test("metadados instalados e publicados usam caminho relativo e bypass de cache na consulta publicada", async () => {
    const requisicoes = [];
    const fetchImpl = async (url, opcoes) => {
        requisicoes.push({ url: new URL(url), opcoes });
        return new Response(JSON.stringify({ name: "Controle Financeiro", version: "1.2.0" }), { status: 200 });
    };

    const instalada = await lerVersaoInstalada({ fetchImpl });
    const publicada = await lerVersaoPublicada({ fetchImpl, agora: 12345 });
    assert.equal(instalada.version, "1.2.0");
    assert.equal(publicada.version, "1.2.0");
    assert.equal(requisicoes[0].url.pathname, requisicoes[1].url.pathname);
    assert.ok(requisicoes[0].url.pathname.endsWith("/version.json"));
    assert.equal(requisicoes[0].url.search, "");
    assert.equal(requisicoes[1].url.searchParams.get("_verificacao"), "12345");
    assert.equal(requisicoes[0].opcoes.cache, "no-cache");
    assert.equal(requisicoes[1].opcoes.cache, "no-store");
});

test("versão instalada pode ser lida do precache offline sem usar esse cache como versão publicada", async () => {
    const cachesApi = {
        match: async (url) => {
            assert.ok(new URL(url).pathname.endsWith("/version.json"));
            return new Response(JSON.stringify({ name: "Controle Financeiro", version: "1.0.0" }), { status: 200 });
        }
    };
    const instalada = await lerVersaoInstalada({
        fetchImpl: async () => { throw new Error("offline"); },
        cachesApi
    });
    assert.equal(instalada.version, "1.0.0");

    await assert.rejects(lerVersaoPublicada({
        fetchImpl: async () => { throw new Error("offline"); },
        cachesApi,
        agora: 99
    }), /offline/);
});

test("metadados inválidos e falha de rede não são tratados como aplicativo atualizado", async () => {
    await assert.rejects(
        lerVersaoPublicada({ fetchImpl: async () => new Response("{}", { status: 200 }), agora: 1 }),
        /arquivo de versão publicado está inválido/
    );
    await assert.rejects(
        lerVersaoPublicada({ fetchImpl: async () => { throw new Error("offline"); }, cachesApi: undefined, agora: 1 }),
        /offline/
    );
    await assert.rejects(
        verificarComConfirmacao({
            instalada: "1.2.0", publicada: "1.1.9",
            confirmar: () => true, atualizar: async () => {}
        }),
        /anterior à versão instalada/
    );
});

test("verificação sem versão mais nova não pede confirmação nem executa atualização", async () => {
    let confirmou = false;
    let atualizou = false;
    const resultado = await verificarComConfirmacao({
        instalada: "1.2.0", publicada: "1.2.0",
        confirmar: () => { confirmou = true; return true; },
        atualizar: async () => { atualizou = true; }
    });
    assert.equal(resultado, "atualizado");
    assert.equal(confirmou, false);
    assert.equal(atualizou, false);
});

test("cancelar atualização não instala nem ativa o novo Service Worker", async () => {
    let atualizou = false;
    const resultado = await verificarComConfirmacao({
        instalada: "1.2.0", publicada: "1.3.0",
        confirmar: (instalada, publicada) => instalada === "1.2.0" && publicada === "1.3.0" && false,
        atualizar: async () => { atualizou = true; }
    });
    assert.equal(resultado, "cancelado");
    assert.equal(atualizou, false);
});

test("aceitar atualização espera instalação, ativa o worker aguardando e aguarda controllerchange", async () => {
    const listeners = new Map();
    const containerListeners = new Set();
    const controladorAntigo = {};
    const registro = { waiting: null, installing: null };
    let mensagemRecebida;
    const container = {
        controller: controladorAntigo,
        addEventListener: (nome, listener) => containerListeners.add(listener),
        removeEventListener: (nome, listener) => containerListeners.delete(listener)
    };
    const worker = {
        state: "installing",
        addEventListener: (nome, listener) => listeners.set(nome, listener),
        removeEventListener: (nome) => listeners.delete(nome),
        postMessage: (mensagem) => {
            mensagemRecebida = mensagem;
            worker.state = "activated";
            registro.waiting = null;
            registro.installing = null;
            container.controller = worker;
            containerListeners.forEach((listener) => listener());
        }
    };
    registro.installing = worker;
    registro.update = async () => {
        setTimeout(() => {
            worker.state = "installed";
            registro.waiting = worker;
            listeners.get("statechange")?.();
        }, 0);
    };

    await instalarAtualizacao(registro, container, 1000);
    assert.deepEqual(mensagemRecebida, { tipo: "ATIVAR_ATUALIZACAO" });
    assert.equal(container.controller, worker);
    assert.equal(containerListeners.size, 0);
});

test("erro de instalação é propagado e não simula sucesso de atualização", async () => {
    const registro = { waiting: null, installing: null, update: async () => {} };
    await assert.rejects(instalarAtualizacao(registro, {}, 100), /não encontrou uma nova versão/);
});
