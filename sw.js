const CACHE = 'controle-financeiro-v5';
const ARQUIVOS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(
        chaves
          .filter((chave) => chave !== CACHE)
          .map((chave) => caches.delete(chave))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data?.tipo !== 'ATUALIZAR_ARQUIVOS' || !event.ports?.[0]) return;

  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const arquivos = [];

    await Promise.all(ARQUIVOS.map(async (arquivo) => {
      try {
        const url = new URL(arquivo, self.registration.scope);
        const resposta = await fetch(url, { cache: 'no-store' });
        if (!resposta.ok || resposta.type === 'opaque') return;

        await cache.put(url.href, resposta.clone());
        arquivos.push(arquivo);
      } catch {
        // Mantém a cópia existente se um recurso não puder ser baixado.
      }
    }));

    event.ports[0].postMessage({ ok: true, arquivos });
  })());
});

self.addEventListener('fetch', (event) => {
  const requisicao = event.request;

  if (requisicao.method !== 'GET') return;

  event.respondWith(
    caches.match(requisicao).then((resposta) => {
      if (resposta) return resposta;

      return fetch(requisicao)
        .then((novaResposta) => {
          const copia = novaResposta.clone();

          caches.open(CACHE).then((cache) => {
            cache.put(requisicao, copia);
          });

          return novaResposta;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
