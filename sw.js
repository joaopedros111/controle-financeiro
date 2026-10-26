const PREFIXO_CACHE = "controle-financeiro-pwa-cache-";
const CACHE = PREFIXO_CACHE + "v20";
const VERSAO_SERVICE_WORKER = "1.1.9";
const CACHE_ANTIGO = "controle-financeiro-v5";
const ARQUIVOS = [
    "./",
    "./index.html",
    "./style.css",
    "./controls.css",
    "./app.js",
    "./finance-core.js",
    "./preferences.js",
    "./localization.js",
    "./storage.js",
    "./sync-core.js",
    "./automatic-finance-sync.js",
    "./automatic-sync-policy.js",
    "./indexeddb-persistence.js",
    "./transactional-state.js",
    "./financial-intents.js",
    "./financial-atomic-service.js",
    "./firebase-config.js",
    "./firebase-sync.bundle.js",
    "./update-manager.js",
    "./version.json",
    "./manifest.json",
    "./icons/apple-touch-icon.png",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-maskable-192.png",
    "./icons/icon-maskable-512.png"
];

const urlEscopo = new URL(self.registration.scope);
function urlRelease(arquivo) {
    const url = new URL(arquivo, urlEscopo);
    if (!url.pathname.endsWith("/version.json")) url.searchParams.set("_release", VERSAO_SERVICE_WORKER);
    return url.href;
}
const urlsPrecache = new Set(ARQUIVOS.map(urlRelease));
const urlIndexRelease = urlRelease("./index.html");

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        const requisicoes = [...urlsPrecache].map((url) => new Request(url, { cache: "reload" }));
        await cache.addAll(requisicoes);
        const versaoEmCache = await cache.match(new URL("./version.json", urlEscopo).href);
        if (!versaoEmCache || (await versaoEmCache.json()).version !== VERSAO_SERVICE_WORKER) {
            throw new Error("Os metadados precacheados não correspondem à versão do Service Worker.");
        }
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil(Promise.all([
        caches.keys().then((chaves) => Promise.all(
            chaves.filter((chave) => (chave.startsWith(PREFIXO_CACHE) || chave === CACHE_ANTIGO) && chave !== CACHE)
                .map((chave) => caches.delete(chave))
        )),
        self.clients.claim()
    ]));
});

self.addEventListener("message", (event) => {
    const resposta = event.ports?.[0];
    if (event.data?.tipo === "OBTER_VERSAO") {
        resposta?.postMessage({ tipo: "VERSAO_SERVICE_WORKER", versao: VERSAO_SERVICE_WORKER });
        return;
    }
    if (event.data?.tipo !== "ATIVAR_ATUALIZACAO") return;
    if (event.data.versao !== VERSAO_SERVICE_WORKER) {
        resposta?.postMessage({ tipo: "ATUALIZACAO_RECUSADA", versao: VERSAO_SERVICE_WORKER });
        return;
    }
    event.waitUntil(self.skipWaiting().then(() => {
        resposta?.postMessage({ tipo: "ATUALIZACAO_ACEITA", versao: VERSAO_SERVICE_WORKER });
    }).catch(() => {
        resposta?.postMessage({ tipo: "ATUALIZACAO_RECUSADA", versao: VERSAO_SERVICE_WORKER });
    }));
});

self.addEventListener("fetch", (event) => {
    const requisicao = event.request;
    if (requisicao.method !== "GET") return;

    const url = new URL(requisicao.url);
    if (url.origin !== urlEscopo.origin || !url.pathname.startsWith(urlEscopo.pathname)) return;

    event.respondWith((async () => {
        if (url.pathname === new URL("./version.json", urlEscopo).pathname
            && (url.searchParams.has("_verificacao") || requisicao.cache === "no-cache")) {
            return fetch(requisicao, { cache: "no-store" });
        }
        const cache = await caches.open(CACHE);
        if (requisicao.mode === "navigate") {
            const pagina = await cache.match(urlIndexRelease);
            if (pagina) return pagina;
        }
        const armazenada = await cache.match(requisicao);
        if (armazenada) return armazenada;

        try {
            const resposta = await fetch(requisicao);
            if (resposta.ok && resposta.type !== "opaque" && urlsPrecache.has(url.href)) {
                await cache.put(requisicao, resposta.clone());
            }
            return resposta;
        } catch {
            if (requisicao.mode === "navigate") {
                return (await cache.match(new URL("./index.html", urlEscopo).href)) || Response.error();
            }
            return Response.error();
        }
    })());
});
