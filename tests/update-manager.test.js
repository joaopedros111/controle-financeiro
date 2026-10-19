import test from "node:test";
import assert from "node:assert/strict";
import {
    criarConfirmacaoAtualizacao,
    criarVerificadorAutomatico,
    compararVersoes,
    instalarAtualizacao,
    lerVersaoControlador,
    lerVersaoInstalada,
    lerVersaoPublicada,
    validarVersaoAplicacao,
    versaoValida,
    verificarComConfirmacao
} from "../update-manager.js";

test("a aplicação rejeita documento ou módulo de uma versão diferente do Service Worker ativo", () => {
    assert.equal(validarVersaoAplicacao({
        documento: "1.2.0", bundle: "1.2.0", controlador: "1.2.0"
    }), "1.2.0");
    assert.throws(
        () => validarVersaoAplicacao({
            documento: "1.1.9", bundle: "1.1.9", controlador: "1.2.0"
        }),
        /interface não correspondem/
    );
    assert.throws(
        () => validarVersaoAplicacao({
            documento: "1.2.0", bundle: "1.1.9", controlador: "1.2.0"
        }),
        /interface não correspondem/
    );
});

test("confirmação automática não repete aviso adiado da mesma versão e manual pode reabrir", () => {
    const solicitacoes = [];
    const confirmar = criarConfirmacaoAtualizacao((instalada, publicada) => {
        solicitacoes.push([instalada, publicada]);
        return false;
    });

    assert.equal(confirmar.confirmar("1.1.6", "1.2.0", true), false);
    assert.equal(confirmar.foiAdiada("1.2.0"), true);
    assert.equal(confirmar.confirmar("1.1.6", "1.2.0", true), false);
    assert.equal(solicitacoes.length, 1);
    assert.equal(confirmar.confirmar("1.1.6", "1.2.0", false), false);
    assert.equal(solicitacoes.length, 2);
    assert.equal(confirmar.confirmar("1.1.6", "1.3.0", true), false);
    assert.equal(solicitacoes.length, 3);
});

test("verificador automático compartilha consulta em andamento e limita verificações bem-sucedidas", async () => {
    let agora = 1000;
    let chamadas = 0;
    let concluir;
    const executarVerificacao = () => {
        chamadas += 1;
        if (chamadas === 1) {
            return new Promise((resolve) => { concluir = resolve; });
        }
        return Promise.resolve("atualizado");
    };
    const verificar = criarVerificadorAutomatico(
        executarVerificacao,
        { agora: () => agora, intervaloMinimoMs: 60000 }
    );

    const primeira = verificar();
    const concorrente = verificar();
    assert.strictEqual(concorrente, primeira);
    await Promise.resolve();
    assert.equal(chamadas, 1);
    concluir("atualizado");
    assert.equal(await primeira, "atualizado");
    assert.equal(await verificar(), "ignorada");

    agora += 60000;
    assert.equal(await verificar(), "atualizado");
    assert.equal(chamadas, 2);
});

test("verificador automático permite nova tentativa após falha ou ausência de conexão", async () => {
    let chamadas = 0;
    const verificar = criarVerificadorAutomatico(async () => {
        chamadas += 1;
        return chamadas === 1 ? "offline" : chamadas === 2 ? "falha" : "atualizado";
    }, { intervaloMinimoMs: 60000 });

    assert.equal(await verificar(), "offline");
    assert.equal(await verificar(), "falha");
    assert.equal(await verificar(), "atualizado");
    assert.equal(chamadas, 3);
});

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

test("após recarregar, a identidade do controlador evita repetir aviso por metadados em cache", async () => {
    const controlador = criarWorker("1.1.13", { state: "activated" });
    const instalada = await lerVersaoControlador(criarServiceWorkers(controlador));
    let confirmou = false;
    const resultado = await verificarComConfirmacao({
        instalada,
        publicada: "1.1.13",
        confirmar: () => { confirmou = true; return true; },
        atualizar: async () => assert.fail("não deve reinstalar a versão que já controla a página")
    });

    assert.equal(instalada, "1.1.13");
    assert.equal(resultado, "atualizado");
    assert.equal(confirmou, false);
});

test("identidade inválida do controlador falha e ausência de controlador permite fallback", async () => {
    assert.equal(await lerVersaoControlador(criarServiceWorkers()), null);

    const controladorInvalido = {
        postMessage(_mensagem, portas) {
            portas[0].postMessage({ tipo: "VERSAO_SERVICE_WORKER", versao: "inválida" });
        }
    };
    await assert.rejects(
        lerVersaoControlador(criarServiceWorkers(controladorInvalido)),
        /versão válida/
    );
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

function criarServiceWorkers(controlador = null) {
    const listeners = new Set();
    return {
        controller: controlador,
        addEventListener: (nome, listener) => {
            if (nome === "controllerchange") listeners.add(listener);
        },
        removeEventListener: (nome, listener) => {
            if (nome === "controllerchange") listeners.delete(listener);
        },
        alterarControlador(novo) {
            this.controller = novo;
            listeners.forEach((listener) => listener());
        },
        get listenersAtivos() { return listeners.size; }
    };
}

function criarWorker(versao, { state = "installed", aoAtivar = null } = {}) {
    const listeners = new Set();
    return {
        version: versao,
        state,
        addEventListener: (nome, listener) => {
            if (nome === "statechange") listeners.add(listener);
        },
        removeEventListener: (nome, listener) => {
            if (nome === "statechange") listeners.delete(listener);
        },
        alterarEstado(novo) {
            this.state = novo;
            listeners.forEach((listener) => listener());
        },
        postMessage(mensagem, portas = []) {
            const porta = portas[0];
            if (mensagem.tipo === "OBTER_VERSAO") {
                porta.postMessage({ tipo: "VERSAO_SERVICE_WORKER", versao });
                return;
            }
            if (mensagem.tipo === "ATIVAR_ATUALIZACAO") aoAtivar?.(this, mensagem, porta);
        }
    };
}

test("atualiza o registro antes de escolher worker e ativa a versão nova apesar do waiting antigo", async () => {
    const ordem = [];
    const antigo = criarWorker("1.1.6");
    const container = criarServiceWorkers(criarWorker("1.1.5", { state: "activated" }));
    const novo = criarWorker("1.1.7", {
        state: "installing",
        aoAtivar(worker, mensagem, porta) {
            ordem.push("ativar-nova");
            assert.equal(mensagem.versao, "1.1.7");
            worker.alterarEstado("activated");
            porta.postMessage({ tipo: "ATUALIZACAO_ACEITA", versao: "1.1.7" });
            container.alterarControlador(worker);
        }
    });
    const registro = {
        waiting: antigo,
        installing: null,
        async update() {
            ordem.push("update");
            this.installing = novo;
            setTimeout(() => {
                this.installing = null;
                this.waiting = novo;
                novo.alterarEstado("installed");
                ordem.push("instalado");
            }, 0);
        }
    };

    const versao = await instalarAtualizacao(registro, container, "1.1.7", 1000);
    assert.equal(versao, "1.1.7");
    assert.ok(ordem.indexOf("update") < ordem.indexOf("ativar-nova"));
    assert.equal(container.controller, novo);
    assert.equal(container.listenersAtivos, 0);
});

test("aceita a versão esperada que já controla a página após update mesmo sem waiting ou installing", async () => {
    const controlador = criarWorker("1.1.7", { state: "activated" });
    const container = criarServiceWorkers();
    const registro = {
        waiting: null,
        installing: null,
        async update() {
            container.alterarControlador(controlador);
        }
    };

    assert.equal(await instalarAtualizacao(registro, container, "1.1.7", 1000), "1.1.7");
});

test("recusa worker waiting antigo se update não entregar a versão esperada", async () => {
    let ativacoes = 0;
    const antigo = criarWorker("1.1.6", {
        aoAtivar() { ativacoes += 1; }
    });
    const registro = { waiting: antigo, installing: null, update: async () => {} };
    const container = criarServiceWorkers(criarWorker("1.1.5", { state: "activated" }));

    await assert.rejects(
        instalarAtualizacao(registro, container, "1.1.7", 1000),
        /versão 1\.1\.6.*versão esperada 1\.1\.7/
    );
    assert.equal(ativacoes, 0);
    assert.equal(container.listenersAtivos, 0);
});

test("permite nova tentativa após falha por identidade incompatível", async () => {
    const container = criarServiceWorkers(criarWorker("1.1.5", { state: "activated" }));
    const antigo = criarWorker("1.1.6");
    const atual = criarWorker("1.1.7", {
        aoAtivar(worker, mensagem, porta) {
            porta.postMessage({ tipo: "ATUALIZACAO_ACEITA", versao: mensagem.versao });
            container.alterarControlador(worker);
        }
    });
    let verificacoes = 0;
    const registro = {
        waiting: antigo,
        installing: null,
        async update() { verificacoes += 1; }
    };

    await assert.rejects(
        instalarAtualizacao(registro, container, "1.1.7", 1000),
        /versão 1\.1\.6.*versão esperada 1\.1\.7/
    );
    registro.waiting = atual;
    assert.equal(await instalarAtualizacao(registro, container, "1.1.7", 1000), "1.1.7");
    assert.equal(verificacoes, 2);
    assert.equal(container.listenersAtivos, 0);
});

test("falha com segurança se a instalação não terminar dentro do timeout", async () => {
    const instalando = criarWorker("1.1.7", { state: "installing" });
    const registro = { waiting: null, installing: instalando, update: async () => {} };
    const container = criarServiceWorkers();
    await assert.rejects(
        instalarAtualizacao(registro, container, "1.1.7", 5),
        /instalação da atualização demorou demais/
    );
    assert.equal(container.listenersAtivos, 0);
});

test("falha se controllerchange não ocorrer mesmo após confirmação do worker", async () => {
    const controlador = criarWorker("1.1.7", {
        aoAtivar(worker, mensagem, porta) {
            porta.postMessage({ tipo: "ATUALIZACAO_ACEITA", versao: mensagem.versao });
        }
    });
    const container = criarServiceWorkers(criarWorker("1.1.5", { state: "activated" }));
    const registro = { waiting: controlador, installing: null, update: async () => {} };

    await assert.rejects(
        instalarAtualizacao(registro, container, "1.1.7", 5),
        /ainda não controla esta página/
    );
    assert.equal(container.listenersAtivos, 0);
});

test("falha de confirmação do worker não deixa listener de controllerchange ativo", async () => {
    const worker = criarWorker("1.1.7", {
        aoAtivar(_worker, _mensagem, porta) {
            porta.postMessage({ tipo: "ATUALIZACAO_RECUSADA", versao: "1.1.7" });
        }
    });
    const container = criarServiceWorkers(criarWorker("1.1.5", { state: "activated" }));
    const registro = { waiting: worker, installing: null, update: async () => {} };

    await assert.rejects(
        instalarAtualizacao(registro, container, "1.1.7", 1000),
        /identidade inválida/
    );
    assert.equal(container.listenersAtivos, 0);
});

test("propaga falha do registro e rejeita ausência de worker ou do container", async () => {
    const container = criarServiceWorkers();
    await assert.rejects(
        instalarAtualizacao({ update: async () => { throw new Error("rede"); } }, container, "1.1.7"),
        /rede/
    );
    await assert.rejects(instalarAtualizacao(null, container, "1.1.7"), /registro.*não está disponível/);
    await assert.rejects(
        instalarAtualizacao({ update: async () => {} }, null, "1.1.7"),
        /controlador do Service Worker/
    );
    await assert.rejects(
        instalarAtualizacao({ waiting: null, installing: null, update: async () => {} }, container, "1.1.7"),
        /Não foi encontrada uma instalação/
    );
});

test("timeout da verificação do registro não ativa um worker pendente", async () => {
    let ativacoes = 0;
    const waiting = criarWorker("1.1.7", { aoAtivar() { ativacoes += 1; } });
    const registro = {
        waiting,
        installing: null,
        update: () => new Promise(() => {})
    };
    await assert.rejects(instalarAtualizacao(registro, criarServiceWorkers(), "1.1.7", 5), /verificação do Service Worker demorou demais/);
    assert.equal(ativacoes, 0);
});
