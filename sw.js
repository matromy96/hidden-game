// Service Worker de HIDDEN
// Estrategia: "cache first, con actualización en segundo plano".
// - La primera vez que se abre el juego con internet, cada archivo que se
//   pide (html, imágenes, audios, manifest) queda guardado en un caché local.
// - Las siguientes veces, aunque no haya conexión, esos archivos se sirven
//   directamente desde el caché, así el juego abre y funciona sin internet.
// - Si hay conexión, en paralelo se revisa si el archivo cambió en el
//   servidor y se actualiza el caché para la próxima vez (sin bloquear el
//   juego actual).

const CACHE_NAME = 'hidden-game-cache-v1';

// Archivos clave que se guardan de entrada, apenas se instala el Service
// Worker, para que el juego arranque offline incluso si el usuario nunca
// llegó a tocar cada sprite individual (por ejemplo, si cierra el juego
// muy rápido la primera vez).
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './MainTheme.mp3',
  './MainTheme2.mp3',
  './MenuTheme.mp3'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(CORE_ASSETS);
    })
  );
  // Activa este Service Worker apenas termina de instalarse, sin esperar
  // a que se cierren pestañas viejas.
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

self.addEventListener('fetch', function(event){
  const request = event.request;

  // Solo nos interesa cachear pedidos GET del mismo origen (el propio
  // juego). Pedidos a otros dominios (si los hubiera) se dejan pasar tal
  // cual, sin interceptar.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then(function(cachedResponse){
      // Además de devolver el caché (si existe), disparamos en paralelo
      // un pedido a la red para mantener el caché al día para la próxima
      // vez, sin que esto retrase la respuesta actual.
      const networkFetch = fetch(request).then(function(networkResponse){
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache){
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      }).catch(function(){
        // Sin conexión y sin caché: no hay nada que devolver.
        return cachedResponse;
      });

      // Si ya lo teníamos cacheado, respondemos al toque con eso
      // (rápido, y funciona offline). Si no, esperamos la red.
      return cachedResponse || networkFetch;
    })
  );
});
