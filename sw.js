const PREFIXO_CACHE = "controle-financeiro-pwa-cache-";
const CACHE = PREFIXO_CACHE + "v7";
const CACHE_ANTIGO = "controle-financeiro-v5";
const ARQUIVOS = [
    "./",
    "./index.html",
    "./style.css",
    "./controls.css",
    "./app.js",
    "./finance-core.js",
    "./preferences.js",
    "./storage.js",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-maskable-192.png",
    "./icons/icon-maskable-512.png"
];

const urlEscopo = new URL(self.registration.scope);
const urlsPrecache = new Set(ARQUIVOS.map((arquivo) => new URL(arquivo, urlEscopo).href));

self.addEventListener("install", (event) => {
    event.waitUntil(Promise.all([
        caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS)),
        self.skipWaiting()
    ]));
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
    if (event.data?.tipo !== "ATUALIZAR_ARQUIVOS" || !event.ports?.[0]) return;
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        const atualizados = [];
        const falhas = [];
        await Promise.all(ARQUIVOS.map(async (arquivo) => {
            const url = new URL(arquivo, urlEscopo);
            try {
                const resposta = await fetch(url, { cache: "no-store" });
                if (!resposta.ok || resposta.type === "opaque") throw new Error("Resposta inválida");
                await cache.put(url.href, resposta.clone());
                atualizados.push(arquivo);
            } catch {
                falhas.push(arquivo);
            }
        }));
        event.ports[0].postMessage({ ok: falhas.length === 0, arquivos: atualizados, falhas });
    })());
});

self.addEventListener("fetch", (event) => {
    const requisicao = event.request;
    if (requisicao.method !== "GET") return;

    const url = new URL(requisicao.url);
    if (url.origin !== urlEscopo.origin || !url.pathname.startsWith(urlEscopo.pathname)) return;

    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
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
