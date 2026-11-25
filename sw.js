/* ═══════════════════════════════════════════════════════════════════════
   CANCIONERO PASTORAL — funcionamiento sin conexión ("service worker")
   Versión 6 · 24/11/2026
   El navegador lo instala al abrir la web y se pone en medio de cada petición:
   - Siempre pide PRIMERO lo nuevo a internet (la web y las canciones del Sheet) y guarda
     una copia en el móvil/ordenador. Así nadie se queda con una versión vieja.
   - Solo si NO hay conexión usa la copia guardada.
   - Las canciones del Sheet las guarda la propia página (cancionero.js, apartado 12e), con la
     fecha; si vienen de la copia, sw.js lo marca (X-Cancionero-Copia) y la web avisa.
   No hace falta tocar este archivo al cambiar la web: guarda lo que index.html cargue.
   ═══════════════════════════════════════════════════════════════════════ */

const CACHE = 'cancionero';

// Al instalarse: guarda la página y todo lo que carga (estilos, código, librería)
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const resp  = await fetch('./', { cache: 'reload' });
    if (!resp.ok) return;
    const html  = await resp.clone().text();
    await cache.put('./', resp);
    const files = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])
      .filter(f => !/^(data:|https?:|#|mailto:)/.test(f));
    await Promise.all(files.map(f =>
      fetch(f, { cache: 'reload' }).then(r => r.ok && cache.put(f, r)).catch(() => {})));
  })().catch(() => {}));
  self.skipWaiting();   // la versión nueva de este archivo empieza a funcionar ya
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isSheet = url.hostname === 'docs.google.com';
  if (url.origin !== location.origin && !isSheet) return;   // lo demás, como siempre

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // 1.º internet (la página, preguntando siempre si hay una versión nueva)
      let resp = req.mode === 'navigate'
        ? await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        : await fetch(req);
      if (resp.redirected && req.mode === 'navigate') resp = await fetch(req);   // por si la dirección redirige
      if (resp.ok) {
        const key = req.mode === 'navigate' ? './' : req;   // la página se guarda siempre como './'
        if (!isSheet) await cache.put(key, resp.clone());   // las canciones las guarda la página (cancionero.js, 12e)
      }
      return resp;
    } catch (e) {
      // 2.º sin conexión: la copia guardada
      const saved = req.mode === 'navigate'
        ? await cache.match('./')
        : (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
      if (saved) {
        if (!isSheet) return saved;
        const headers = new Headers(saved.headers);
        headers.set('X-Cancionero-Copia', '1');
        return new Response(await saved.blob(), { status: 200, headers });
      }
      throw e;
    }
  })());
});
