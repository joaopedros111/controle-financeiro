const URL_VERSAO = new URL("./version.json", import.meta.url);
const FORMATO_VERSAO = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function versaoValida(versao) {
    return typeof versao === "string" && FORMATO_VERSAO.test(versao)
        && versao.split(".").every((parte) => Number.isSafeInteger(Number(parte)));
}

export function compararVersoes(a, b) {
    if (!versaoValida(a) || !versaoValida(b)) throw new Error("Formato de versão inválido.");
    const partesA = a.split(".").map(Number);
    const partesB = b.split(".").map(Number);
    for (let indice = 0; indice < partesA.length; indice += 1) {
        if (partesA[indice] !== partesB[indice]) return partesA[indice] > partesB[indice] ? 1 : -1;
    }
    return 0;
}

export function validarVersaoAplicacao({ documento, bundle = null, controlador }) {
    const versoes = [
        ["documento HTML", documento],
        ...(bundle === null ? [] : [["módulo JavaScript", bundle]]),
        ["Service Worker", controlador]
    ];
    for (const [origem, versao] of versoes) {
        if (!versaoValida(versao)) throw new Error(`A versão informada por ${origem} é inválida.`);
    }
    if (versoes.some(([, versao]) => versao !== controlador)) {
        throw new Error("Os arquivos da interface não correspondem à versão ativa do Service Worker.");
    }
    return controlador;
}

function validarMetadados(metadados) {
    if (!metadados || metadados.name !== "Controle Financeiro" || !versaoValida(metadados.version)) {
        throw new Error("O arquivo de versão publicado está inválido.");
    }
    return metadados;
}

async function lerMetadados(url, { fetchImpl = fetch, cachesApi = globalThis.caches, cache = "no-cache" } = {}) {
    try {
        const resposta = await fetchImpl(url, { cache });
        if (!resposta.ok) throw new Error(`O servidor respondeu com status ${resposta.status}.`);
        return validarMetadados(await resposta.json());
    } catch (erro) {
        const respostaEmCache = await cachesApi?.match?.(url);
        if (respostaEmCache && cache !== "no-store") {
            return validarMetadados(await respostaEmCache.json());
        }
        throw erro;
    }
}

export function lerVersaoInstalada(opcoes = {}) {
    return lerMetadados(URL_VERSAO, opcoes);
}

export function lerVersaoPublicada({ agora = Date.now(), ...opcoes } = {}) {
    const url = new URL(URL_VERSAO);
    url.searchParams.set("_verificacao", String(agora));
    return lerMetadados(url, { ...opcoes, cache: "no-store" });
}

export async function verificarComConfirmacao({ instalada, publicada, confirmar, atualizar }) {
    const comparacao = compararVersoes(publicada, instalada);
    if (comparacao < 0) throw new Error("A versão publicada é anterior à versão instalada. Confira os metadados de publicação.");
    if (comparacao <= 0) return "atualizado";
    if (!confirmar(instalada, publicada)) return "cancelado";
    await atualizar();
    return "atualizado-agora";
}

export function criarConfirmacaoAtualizacao(confirmar) {
    let versaoAdiada = null;
    return {
        foiAdiada: (publicada) => publicada === versaoAdiada,
        confirmar(instalada, publicada, automatica = false) {
            if (automatica && publicada === versaoAdiada) return false;
            const aceita = confirmar(instalada, publicada);
            versaoAdiada = aceita ? null : publicada;
            return aceita;
        }
    };
}

export function criarVerificadorAutomatico(verificar, {
    agora = Date.now,
    intervaloMinimoMs = 60000
} = {}) {
    let verificacaoAtiva = null;
    let ultimaVerificacaoBemSucedida = null;

    return () => {
        if (verificacaoAtiva) return verificacaoAtiva;
        const instante = agora();
        if (ultimaVerificacaoBemSucedida !== null
            && instante - ultimaVerificacaoBemSucedida < intervaloMinimoMs) {
            return Promise.resolve("ignorada");
        }

        verificacaoAtiva = Promise.resolve()
            .then(verificar)
            .then((resultado) => {
                if (!["falha", "offline", "em-andamento"].includes(resultado)) {
                    ultimaVerificacaoBemSucedida = agora();
                }
                return resultado;
            })
            .finally(() => {
                verificacaoAtiva = null;
            });
        return verificacaoAtiva;
    };
}

function comTimeout(promessa, timeoutMs, mensagem) {
    let temporizador;
    return Promise.race([
        promessa,
        new Promise((_, reject) => {
            temporizador = setTimeout(() => reject(new Error(mensagem)), timeoutMs);
        })
    ]).finally(() => clearTimeout(temporizador));
}

function enviarMensagemWorker(worker, mensagem, tipoResposta, timeoutMs) {
    return new Promise((resolve, reject) => {
        if (typeof MessageChannel === "undefined") {
            reject(new Error("Este navegador não permite confirmar a identidade do Service Worker."));
            return;
        }
        const canal = new MessageChannel();
        const temporizador = setTimeout(() => terminar(new Error("O Service Worker não confirmou a solicitação dentro do prazo.")), timeoutMs);
        const terminar = (erro, resposta) => {
            clearTimeout(temporizador);
            canal.port1.close();
            if (erro) reject(erro);
            else resolve(resposta);
        };
        canal.port1.onmessage = (evento) => {
            const resposta = evento.data;
            if (!resposta || resposta.tipo !== tipoResposta) {
                terminar(new Error("O Service Worker respondeu com uma identidade inválida."));
            } else {
                terminar(null, resposta);
            }
        };
        canal.port1.onmessageerror = () => terminar(new Error("Não foi possível ler a resposta do Service Worker."));
        try {
            worker.postMessage(mensagem, [canal.port2]);
        } catch (erro) {
            terminar(new Error(`Não foi possível consultar o Service Worker: ${erro.message || "erro desconhecido"}.`));
        }
    });
}

async function lerIdentidadeWorker(worker, timeoutMs) {
    const resposta = await enviarMensagemWorker(
        worker,
        { tipo: "OBTER_VERSAO" },
        "VERSAO_SERVICE_WORKER",
        timeoutMs
    );
    if (!versaoValida(resposta.versao)) {
        throw new Error("O Service Worker não informou uma versão válida.");
    }
    return resposta.versao;
}

export async function lerVersaoControlador(serviceWorkers, timeoutMs = 5000) {
    const controlador = serviceWorkers?.controller;
    return controlador ? lerIdentidadeWorker(controlador, timeoutMs) : null;
}

function esperarInstalacao(worker, timeoutMs) {
    return new Promise((resolve, reject) => {
        let temporizador;
        const verificar = () => {
            if (worker.state === "installed" || worker.state === "activated") terminar(null, worker);
            else if (worker.state === "redundant") terminar(new Error("A instalação da atualização falhou e o worker foi descartado."));
        };
        const terminar = (erro, resultado) => {
            clearTimeout(temporizador);
            worker.removeEventListener("statechange", verificar);
            if (erro) reject(erro);
            else resolve(resultado);
        };
        temporizador = setTimeout(() => terminar(new Error("A instalação da atualização demorou demais.")), timeoutMs);
        worker.addEventListener("statechange", verificar);
        verificar();
    });
}

function esperarControlador(serviceWorkers, controladorAnterior, timeoutMs) {
    return new Promise((resolve, reject) => {
        let temporizador;
        const terminar = (erro, controlador) => {
            clearTimeout(temporizador);
            serviceWorkers.removeEventListener("controllerchange", aoMudar);
            if (erro) reject(erro);
            else resolve(controlador);
        };
        const aoMudar = () => {
            const controlador = serviceWorkers.controller;
            if (controlador && controlador !== controladorAnterior) terminar(null, controlador);
        };
        temporizador = setTimeout(() => terminar(
            new Error("A nova versão foi ativada, mas ainda não controla esta página."),
            null
        ), timeoutMs);
        serviceWorkers.addEventListener("controllerchange", aoMudar);
        aoMudar();
    });
}

export async function instalarAtualizacao(registro, serviceWorkers, versaoEsperada, timeoutMs = 60000) {
    if (!registro || typeof registro.update !== "function") {
        throw new Error("O registro do Service Worker não está disponível para atualização.");
    }
    if (!serviceWorkers || typeof serviceWorkers.addEventListener !== "function"
        || typeof serviceWorkers.removeEventListener !== "function") {
        throw new Error("O navegador não disponibilizou o controlador do Service Worker.");
    }
    if (!versaoValida(versaoEsperada)) throw new Error("A versão esperada da atualização é inválida.");

    const controladorAnterior = serviceWorkers.controller || null;
    await comTimeout(
        registro.update(),
        timeoutMs,
        "A verificação do Service Worker demorou demais."
    );

    let workerInstalado = registro.installing;
    if (workerInstalado) workerInstalado = await esperarInstalacao(workerInstalado, timeoutMs);
    const worker = workerInstalado || registro.waiting;
    if (!worker) {
        const controladorAtual = serviceWorkers.controller || null;
        const versaoControlador = controladorAtual
            ? await lerIdentidadeWorker(controladorAtual, timeoutMs)
            : null;
        if (versaoControlador === versaoEsperada) return versaoControlador;
        throw new Error("Não foi encontrada uma instalação do Service Worker para a versão esperada.");
    }
    if (worker.state !== "installed" && worker.state !== "activated") {
        throw new Error("O Service Worker candidato ainda não terminou a instalação.");
    }

    const versaoWorker = await lerIdentidadeWorker(worker, timeoutMs);
    if (versaoWorker !== versaoEsperada) {
        throw new Error(`O Service Worker aguardando é da versão ${versaoWorker}, não da versão esperada ${versaoEsperada}. Tente novamente quando a instalação mais recente terminar.`);
    }
    if (serviceWorkers.controller === worker) return versaoEsperada;

    const resposta = await enviarMensagemWorker(
        worker,
        { tipo: "ATIVAR_ATUALIZACAO", versao: versaoEsperada },
        "ATUALIZACAO_ACEITA",
        timeoutMs
    );
    if (resposta.versao !== versaoEsperada) {
        throw new Error("O Service Worker recusou a ativação da versão esperada.");
    }

    const controlador = await esperarControlador(serviceWorkers, controladorAnterior, timeoutMs);
    const versaoControlador = await lerIdentidadeWorker(controlador, timeoutMs);
    if (versaoControlador !== versaoEsperada) {
        throw new Error(`A versão ${versaoControlador} assumiu o controle; a versão esperada era ${versaoEsperada}.`);
    }
    return versaoControlador;
}
