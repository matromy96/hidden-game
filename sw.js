// Service Worker de HIDDEN
// Estrategia: "cache first, con actualización en segundo plano".
// - La primera vez que se abre el juego con internet, cada archivo que se
//   pide (html, imágenes, audios, manifest) queda guardado en un caché local.
// - Las siguientes veces, aunque no haya conexión, esos archivos se sirven
//   directamente desde el caché, así el juego abre y funciona sin internet.
// - Si hay conexión, en paralelo se revisa si el archivo cambió en el
//   servidor y se actualiza el caché para la próxima vez (sin bloquear el
//   juego actual).

// v2: se sube la versión para forzar que los dispositivos descarten el
// caché viejo (que tenía roto el guardado de los audios largos) y arranquen
// de cero con la lógica corregida.
const CACHE_NAME = 'hidden-game-cache-v2';

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
      // Se piden uno por uno (en vez de cache.addAll) para que, si alguno
      // fallara por lo que sea, no arruine el guardado del resto. También
      // se fuerza "cache: reload" para no quedarnos con una copia parcial
      // que el propio navegador tuviera en su caché HTTP interno.
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

// Los elementos <audio> piden sus archivos por partes usando el
// encabezado "Range" (para poder reproducir/adelantar sin bajar todo el
// archivo de una), y esperan una respuesta 206 Partial Content. Si le
// devolvemos el archivo completo con 200, algunos navegadores (Chrome
// incluido) se niegan a reproducir el audio. Esta función arma esa
// respuesta parcial a partir de la versión completa que ya tenemos
// guardada en el caché.
async function buildRangeResponse(request, cachedResponse){
  const rangeHeader = request.headers.get('range');
  const buffer = await cachedResponse.arrayBuffer();
  const totalLength = buffer.byteLength;

  const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
  const start = match && match[1] ? parseInt(match[1], 10) : 0;
  const end = match && match[2] ? parseInt(match[2], 10) : totalLength - 1;
  const sliceEnd = Math.min(end, totalLength - 1);

  const chunk = buffer.slice(start, sliceEnd + 1);

  const headers = new Headers(cachedResponse.headers);
  headers.set('Content-Range', 'bytes ' + start + '-' + sliceEnd + '/' + totalLength);
  headers.set('Content-Length', chunk.byteLength);

  return new Response(chunk, {
    status: 206,
    statusText: 'Partial Content',
    headers: headers
  });
}

// Baja el archivo completo (sin encabezado Range) y lo guarda en el
// caché. Se usa cuando llega un pedido con Range y todavía no teníamos
// el archivo completo guardado: sin esto, el audio se reproduce bien la
// primera vez (porque hay internet) pero nunca queda disponible offline,
// ya que el servidor respondería 206 en vez de 200 a cada pedido parcial.
function cacheFullFileInBackground(url){
  fetch(url, { cache: 'reload' }).then(function(fullResponse){
    if (fullResponse && fullResponse.ok) {
      caches.open(CACHE_NAME).then(function(cache){
        cache.put(url, fullResponse);
      });
    }
  }).catch(function(){ /* sin conexión: no hay nada para bajar todavía */ });
}

self.addEventListener('fetch', function(event){
  const request = event.request;
  const url = new URL(request.url);

  // Solo nos interesa cachear pedidos GET del mismo origen (el propio
  // juego). Pedidos a otros dominios (si los hubiera) se dejan pasar tal
  // cual, sin interceptar.
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  const isRangeRequest = request.headers.has('range');

  event.respondWith(
    caches.match(request).then(function(cachedResponse){
      // Caso más común offline/online normal: ya tenemos el archivo
      // completo guardado. Si el pedido es por rango (audio), le
      // recortamos el pedazo que corresponde; si no, lo servimos entero.
      if (cachedResponse) {
        if (isRangeRequest) {
          return buildRangeResponse(request, cachedResponse.clone());
        }
        // Devolvemos el caché al toque, y de paso revisamos en segundo
        // plano si el archivo cambió en el servidor, para la próxima vez.
        fetch(request).then(function(networkResponse){
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then(function(cache){
              cache.put(request, networkResponse);
            });
          }
        }).catch(function(){ /* sin conexión: no pasa nada, ya respondimos con el caché */ });
        return cachedResponse;
      }

      // No lo teníamos cacheado todavía: hay que pedirlo a la red sí o sí.
      if (isRangeRequest) {
        // Si es un audio pedido por rango y nunca lo guardamos completo,
        // bajamos el pedazo pedido para reproducir ahora mismo, y en
        // paralelo bajamos el archivo entero para tenerlo disponible
        // offline la próxima vez.
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
