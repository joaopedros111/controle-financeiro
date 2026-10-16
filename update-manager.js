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

function esperarInstalacao(worker, registro, timeoutMs) {
    return new Promise((resolve, reject) => {
        const temporizador = setTimeout(() => terminar(new Error("A instalação da atualização demorou demais.")), timeoutMs);
        const verificar = () => {
            if (worker.state === "installed") terminar(null, registro.waiting || worker);
            else if (worker.state === "redundant") terminar(new Error("A instalação da atualização falhou."));
        };
        const terminar = (erro, resultado) => {
            clearTimeout(temporizador);
            worker.removeEventListener("statechange", verificar);
            if (erro) reject(erro);
            else resolve(resultado);
        };
        worker.addEventListener("statechange", verificar);
        verificar();
    });
}

export async function instalarAtualizacao(registro, serviceWorkers, timeoutMs = 60000) {
    let worker = registro.waiting;
    if (!worker) {
        const atualizacao = registro.update();
        await atualizacao;
        worker = registro.waiting || registro.installing;
    }
    if (!worker) throw new Error("O Service Worker não encontrou uma nova versão para instalar. Verifique se a versão e o cache foram publicados juntos.");
    if (worker.state !== "installed" && worker.state !== "activated") {
        worker = await esperarInstalacao(worker, registro, timeoutMs);
    }
    if (worker.state === "activated" && serviceWorkers.controller === worker) return;

    const controladorAnterior = serviceWorkers.controller;
    let temporizador;
    const controladorNovo = new Promise((resolve, reject) => {
        const aoMudar = () => {
            if (serviceWorkers.controller && serviceWorkers.controller !== controladorAnterior) terminar();
        };
        const terminar = (erro) => {
            clearTimeout(temporizador);
            serviceWorkers.removeEventListener("controllerchange", aoMudar);
            if (erro) reject(erro);
            else resolve();
        };
        temporizador = setTimeout(() => terminar(new Error("A nova versão foi instalada, mas ainda não assumiu o controle desta página.")), timeoutMs);
        serviceWorkers.addEventListener("controllerchange", aoMudar);
    });
    worker.postMessage({ tipo: "ATIVAR_ATUALIZACAO" });
    await controladorNovo;
}
