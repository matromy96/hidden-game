// Service Worker de HIDDEN (v2.2 - Fix versión pegada)
const CACHE_NAME = 'hidden-game-cache-v3'; // <- IMPORTANTE: subir este número cada vez que
                                            //    cambies este mismo sw.js, para forzar limpieza
                                            //    de caché vieja en el activate()

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './MainTheme.mp3',
  './MainTheme2.mp3',
  './MenuTheme.mp3'
];

// archivos que SIEMPRE deben intentarse desde la red primero (nunca servir
// caché vieja sin más: acá vive el número de versión y el HTML del juego)
const NETWORK_FIRST = [
  './',
  './index.html',
  './manifest.json',
  './version.txt'
];

function isNetworkFirst(url){
  const path = url.pathname;
  return NETWORK_FIRST.some(function(nf){
    return path.endsWith(nf.replace('./','/')) || path === self.registration.scope.replace(location.origin,'') && nf === './';
  }) || path.endsWith('/version.txt') || path.endsWith('/index.html') || path.endsWith('/manifest.json');
}

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return Promise.all(
        CORE_ASSETS.map(function(url){
          return fetch(url, { cache: 'reload' })
            .then(function(response){
              if (response && response.ok) {
                return cache.put(url, response);
              }
            })
            .catch(function(err){
              console.warn('No se pudo precachear', url, err);
            });
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(cacheNames){
      return Promise.all(
        cacheNames
          .filter(function(name){ return name !== CACHE_NAME; })
          .map(function(name){ return caches.delete(name); })
      );
    })
  );
  self.clients.claim();
});

// Parche 1: Corrección de parseo del Range Header cuando viene sin límite superior ("bytes=0-")
async function buildRangeResponse(request, cachedResponse){
  const rangeHeader = request.headers.get('range');
  const buffer = await cachedResponse.arrayBuffer();
  const totalLength = buffer.byteLength;

  let start = 0;
  let end = totalLength - 1;

  if (rangeHeader) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (match) {
      start = parseInt(match[1], 10) || 0;
      if (match[2]) {
        end = parseInt(match[2], 10);
      }
    }
  }

  const sliceEnd = Math.min(end, totalLength - 1);
  const chunk = buffer.slice(start, sliceEnd + 1);

  const headers = new Headers(cachedResponse.headers);
  headers.set('Content-Range', 'bytes ' + start + '-' + sliceEnd + '/' + totalLength);
  headers.set('Content-Length', chunk.byteLength);
  headers.set('Accept-Ranges', 'bytes');

  return new Response(chunk, {
    status: 206,
    statusText: 'Partial Content',
    headers: headers
  });
}

function cacheFullFileInBackground(url){
  fetch(url, { cache: 'reload' }).then(function(fullResponse){
    if (fullResponse && fullResponse.ok) {
      caches.open(CACHE_NAME).then(function(cache){
        cache.put(url, fullResponse);
      });
    }
  }).catch(function(){ /* sin conexión */ });
}

self.addEventListener('fetch', function(event){
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // --- network-first para HTML / manifest / version.txt --------------------
  // Nunca queremos mostrar una versión vieja de estos archivos "a propósito":
  // intentamos la red primero (sin caché HTTP), y solo si falla (sin conexión)
  // usamos lo último que tengamos guardado.
  if (isNetworkFirst(url)) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(function(networkResponse){
          if (networkResponse && networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(function(cache){ cache.put(request, clone); });
          }
          return networkResponse;
        })
        .catch(function(){
          return caches.match(request).then(function(cached){
            return cached || caches.match('./index.html');
          });
        })
    );
    return;
  }

  const isRangeRequest = request.headers.has('range');

  event.respondWith(
    // OJO: sin ignoreSearch. Cada URL con su ?v=X distinto es una entrada de
    // caché distinta, así el ?v= que agrega version.txt SÍ hace lo que debe:
    // forzar que se pida y guarde una copia nueva cuando cambia la versión.
    caches.match(request).then(function(cachedResponse){

      if (cachedResponse) {
        if (isRangeRequest) {
          return buildRangeResponse(request, cachedResponse.clone());
        }

        // Revalidación en segundo plano si no es Range Request
        fetch(request).then(function(networkResponse){
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then(function(cache){
              cache.put(request, networkResponse);
            });
          }
        }).catch(function(){});

        return cachedResponse;
      }

      // Si no estaba en caché:
      if (isRangeRequest) {
        cacheFullFileInBackground(url.href);
        return fetch(request);
      }

      return fetch(request).then(function(networkResponse){
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache){
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      });
    })
  );
});
