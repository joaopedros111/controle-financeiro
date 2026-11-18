const PREFIXO_CACHE = "controle-financeiro-pwa-cache-";
const CACHE = PREFIXO_CACHE + "v23";
const VERSAO_SERVICE_WORKER = "1.1.12";
const CACHE_ANTIGO = "controle-financeiro-v5";
// Admission limits, not eviction targets. Old windows need not cooperate.
const MAX_RELEASES_RETIDOS = 4;
const MAX_BYTES_RETIDOS = 64 * 1024 * 1024;
const MAX_BYTES_RELEASE = 16 * 1024 * 1024;
const RESERVA_META_RELEASE = 1024;
// Filled by the official build after all release files have been rendered.
const INTEGRIDADE_RELEASE = {"./index.html":{"bytes":28990,"sha256":"c1fa193471c3caaf017586a52fcc0bb028a30f54238b8fe804c2bac7d08f0f68"},"./style.css":{"bytes":72440,"sha256":"be11554e22d5962a7eb8139210ce2eeae6aa7145377fd1a1b72b4b7917e8db44"},"./controls.css":{"bytes":11867,"sha256":"a77ed9d12ec4c6815277eb173e7b4abddf6e9270d9aaa8a795002e7400a030de"},"./app.js":{"bytes":254726,"sha256":"bdd080b043e6ed8bfacc8b9f7fc29c484971ad839e07e15a23c0cdb6d656842a"},"./cube3d-preview.css":{"bytes":4404,"sha256":"8886e81319ab863ad4b6a6f3ce626c8fbff51647b8ed8dc1ed172989eb6b3dd9"},"./cube3d-preview.js":{"bytes":5853,"sha256":"1966ee6462568345971ded6e2a0d9db9f3518f6fa2a859eaadeb2a5275abcb7c"},"./finance-core.js":{"bytes":25111,"sha256":"da09fa6cae1624d476265dbd8eca62bb9bf3db0d29347ab12caea1f75a887050"},"./preferences.js":{"bytes":6079,"sha256":"ea1628c614d56d92a946961dc2e76e610794a2350203d6102f1dfc3217eab85b"},"./localization.js":{"bytes":137140,"sha256":"43a05c809b1f69169c5b2963b71b33786cf70c47717ed448f4f9cdc7cc379a4c"},"./storage.js":{"bytes":6456,"sha256":"036b1269190366435aa0f2cd1d1f31fd8d14eb739d987b841b3393c079ca5c26"},"./account-data-policy.js":{"bytes":16294,"sha256":"d2272d991207a6fdffd8f9914a9eb913cdb0410feff205c2529db61f5e4dae20"},"./account-offline-access.js":{"bytes":3217,"sha256":"09f2f2e54d977e575ef18b990fd27d4c2f3786bef5ea824ef09db87bee8e1bd2"},"./account-local-migration.js":{"bytes":39257,"sha256":"5978b9a15578b43b95c07ecb2e940120603046a4fa3af9e34be8e4df08bc685b"},"./sync-core.js":{"bytes":25206,"sha256":"13633d0b7693b7c5e934810c62cdab1c007a5659716b2397f062023724056bee"},"./automatic-finance-sync.js":{"bytes":46843,"sha256":"b594a76c4f3e94a04377eccc6745c1eac4da0a5a1b015fec48c2ab3d639a410f"},"./automatic-sync-policy.js":{"bytes":13044,"sha256":"f1be76e982227cf43ef969983195a83d5f847ed513d83e4e08669e06577235df"},"./indexeddb-persistence.js":{"bytes":16637,"sha256":"76b724500f1fd778c3386d7b852a59b1b4dbfd9275af35ab99011e76007d280a"},"./transactional-state.js":{"bytes":2157,"sha256":"822e9f83737600b14c31270ff3e10fcdf51fb28693e27e4595a071bc61eb4d9a"},"./financial-intents.js":{"bytes":4574,"sha256":"2c07521176ada71a386aaa9bb759c4822f5104ffb4ab6cc262ee363e314c7fb1"},"./financial-atomic-service.js":{"bytes":28860,"sha256":"49b27551b09f9cc1f4c183a64ec53037e33dc3f004704ba768b3057f2cc72171"},"./firebase-config.js":{"bytes":600,"sha256":"544d1577d2ad3df95292cfc9274c8aafb1c56731a95a9471a3cb24d0ca66ceee"},"./firebase-sync.bundle.js":{"bytes":619029,"sha256":"2c9ba56a9385a051a8fe158f36aad126b408602359cbf704b0ff7dd48b87538b"},"./update-manager.js":{"bytes":13407,"sha256":"6665e3055131b3b3b0da194d6a269996be7e90053c268c30738e59cb9fba34ea"},"./update-persistence-barrier.js":{"bytes":9521,"sha256":"c9b6a539d59d61d8dc9e1a3657bbdff1f7b28840b1bb1288670c0465556bd4a1"},"./version.json":{"bytes":59,"sha256":"790a5932361a6cdc1ca6857927c999f78d23b5b409fb4a0c79d61045c8910cf9"},"./manifest.json":{"bytes":969,"sha256":"0162a41cef26e69c7272e843ceb7717c1bb28ea08f4476f985283014e2ad982d"},"./icons/apple-touch-icon.png":{"bytes":48461,"sha256":"373706f45e37d4e92cebebd48cc5c570855faf688546d779db32e7ee8fe71a00"},"./icons/icon-192.png":{"bytes":44677,"sha256":"1ee78185f839c331748a5de2e95866c640787ce8f209d64e19c079b1c45e3040"},"./icons/icon-512.png":{"bytes":257661,"sha256":"9b966f88f94b211ccf0f660eeca3f07f552949e7bc83c091b8c15a7dd92f0e40"},"./icons/icon-maskable-192.png":{"bytes":50941,"sha256":"1585af24f3980642cccc5aca53b88808b413616cf886f91fc4b1a82a98c7dc42"},"./icons/icon-maskable-512.png":{"bytes":317487,"sha256":"6d14e151ebc692adf2de75240770a3b978b67fcdbec2a0533436d72058994218"},"./":{"bytes":28990,"sha256":"c1fa193471c3caaf017586a52fcc0bb028a30f54238b8fe804c2bac7d08f0f68"}};
const ARQUIVOS = [
    "./",
    "./index.html",
    "./style.css",
    "./controls.css",
    "./app.js",
    "./cube3d-preview.css",
    "./cube3d-preview.js",
    "./finance-core.js",
    "./preferences.js",
    "./localization.js",
    "./storage.js",
    "./account-data-policy.js",
    "./account-offline-access.js",
    "./account-local-migration.js",
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
    "./update-persistence-barrier.js",
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
const chaveEstadoRelease = new URL('./.__controle-financeiro-release-state-v1.json', urlEscopo).href;

const cacheDoApp = nome => nome.startsWith(PREFIXO_CACHE) || nome === CACHE_ANTIGO;
async function validarConteudo(resposta, esperado) {
    if (!resposta || !resposta.ok || resposta.type === 'opaque') throw new Error('Recurso de release indisponível.');
    const bytes = await resposta.clone().arrayBuffer();
    if (bytes.byteLength !== esperado.bytes) throw new Error('Tamanho incompatível com o release.');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== esperado.sha256) throw new Error('Conteúdo incompatível com o release.');
}
async function validarCache(cache, instalando = false) {
    const marcador = await cache.match(chaveEstadoRelease);
    if (marcador) {
        const estado = await marcador.json();
        if (estado.version !== VERSAO_SERVICE_WORKER || !(estado.status === 'ready' || instalando && estado.status === 'installing')) throw new Error('Cache de release ainda não disponível.');
    }
    const versao = await cache.match(new URL('./version.json', urlEscopo).href);
    if (!versao || (await versao.json()).version !== VERSAO_SERVICE_WORKER) throw new Error('Metadados incompatíveis com o release.');
    let bytes = 0;
    for (const arquivo of ARQUIVOS) {
        const resposta = await cache.match(urlRelease(arquivo));
        if (!resposta || !resposta.ok) throw new Error('Precache de release incompleto.');
        bytes += (await resposta.clone().arrayBuffer()).byteLength;
        if (INTEGRIDADE_RELEASE) await validarConteudo(resposta, INTEGRIDADE_RELEASE[arquivo]);
    }
    if (bytes + RESERVA_META_RELEASE > MAX_BYTES_RELEASE) throw new Error('Release excede o limite de armazenamento.');
}
const indisponivel = () => new Response('Release indisponível neste dispositivo. Nenhuma versão foi substituída.',
    { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const existentes = (await caches.keys()).filter(cacheDoApp);
        // A reused cache name may still belong to a running worker. Never
        // overwrite it, including after a failed/retried installation.
        if (existentes.includes(CACHE)) {
            await validarCache(await caches.open(CACHE));
            return;
        }
        if (existentes.length >= MAX_RELEASES_RETIDOS) throw new Error('Limite de releases retidos; atualização preservada no servidor.');
        let total = 0;
        for (const nome of existentes) {
            const cache = await caches.open(nome);
            for (const chave of await cache.keys()) {
                const resposta = await cache.match(chave);
                if (resposta) total += (await resposta.arrayBuffer()).byteLength;
            }
        }
        const previsto = INTEGRIDADE_RELEASE ? Object.values(INTEGRIDADE_RELEASE).reduce((sum, item) => sum + item.bytes, RESERVA_META_RELEASE) : MAX_BYTES_RELEASE;
        if (previsto > MAX_BYTES_RELEASE || total + previsto > MAX_BYTES_RETIDOS) throw new Error('Limite de armazenamento de releases.');
        let criado = false;
        try {
            const requisicoes = [...urlsPrecache].map((url) => new Request(url, { cache: "reload" }));
            // Verify before persisting: even an interrupted installation must
            // not expose incompatible bytes through another worker's lookup.
            const respostas = await Promise.all(requisicoes.map(async request => {
                const resposta = await fetch(request);
                const arquivo = ARQUIVOS.find(arquivo => urlRelease(arquivo) === request.url);
                if (!resposta.ok || resposta.type === 'opaque') throw new Error('Recurso de release indisponível.');
                if (INTEGRIDADE_RELEASE) await validarConteudo(resposta, INTEGRIDADE_RELEASE[arquivo]);
                return resposta;
            }));
            let tamanho = 0;
            for (const resposta of respostas) tamanho += (await resposta.clone().arrayBuffer()).byteLength;
            if (tamanho + RESERVA_META_RELEASE > MAX_BYTES_RELEASE || total + tamanho + RESERVA_META_RELEASE > MAX_BYTES_RETIDOS) throw new Error('Limite de armazenamento de releases.');
            // Downloads yield to other workers. A cache that appeared meanwhile
            // is not ours to overwrite or to clean up on failure.
            if ((await caches.keys()).includes(CACHE)) {
                await validarCache(await caches.open(CACHE));
                return;
            }
            const cache = await caches.open(CACHE);
            criado = true;
            await cache.put(chaveEstadoRelease, new Response(JSON.stringify({ status: 'installing', version: VERSAO_SERVICE_WORKER })));
            for (let i = 0; i < requisicoes.length; i++) await cache.put(requisicoes[i], respostas[i]);
            await validarCache(cache, true);
            await cache.put(chaveEstadoRelease, new Response(JSON.stringify({ status: 'ready', version: VERSAO_SERVICE_WORKER })));
        } catch (cause) {
            // Only this new, unsuccessful candidate is eligible for cleanup.
            if (criado) await caches.delete(CACHE);
            throw cause;
        }
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
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
        if (!url.searchParams.has('_release') && url.pathname === new URL("./version.json", urlEscopo).pathname
            && (url.searchParams.has("_verificacao") || requisicao.cache === "no-cache")) {
            return fetch(requisicao, { cache: "no-store" });
        }
        const nomes = (await caches.keys()).filter(cacheDoApp);
        const release = url.searchParams.get('_release');
        // A bare module URL carries no trustworthy identity for an old tab.
        // Official artifacts pin every application module to its release.
        if (!url.searchParams.has('_release') && /\.m?js$/.test(url.pathname)) return indisponivel();
        const chave = requisicao.mode === 'navigate' && !url.searchParams.has('_release') ? urlIndexRelease : requisicao;
        // Exact URL lookup only; never infer a release from a tab heartbeat.
        for (const nome of [CACHE, ...nomes.filter(nome => nome !== CACHE)]) {
            if (!nomes.includes(nome)) continue;
            const cache = await caches.open(nome), marcador = await cache.match(chaveEstadoRelease);
            if (marcador) {
                try { if ((await marcador.json()).status !== 'ready') continue; }
                catch { continue; }
            }
            const armazenada = await cache.match(chave);
            if (armazenada) return armazenada;
        }
        if (url.searchParams.has('_release')) {
            const arquivo = ARQUIVOS.find(arquivo => urlRelease(arquivo) === url.href);
            const esperado = release === VERSAO_SERVICE_WORKER && INTEGRIDADE_RELEASE?.[arquivo];
            if (!esperado) return indisponivel();
            try {
                const resposta = await fetch(requisicao, { cache: 'no-store' });
                await validarConteudo(resposta, esperado);
                return resposta;
            } catch { return indisponivel(); }
        }
        if (requisicao.mode === 'navigate') return indisponivel();

        try {
            const resposta = await fetch(requisicao);
            return resposta;
        } catch {
            return Response.error();
        }
    })());
});
