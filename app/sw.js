// Service worker: primero la red (siempre la última versión del banco y los ajustes)
// y, sin conexión, la copia guardada. VERSION la pone herramientas/versionar.py (no la toques a mano).

const VERSION = "cta-f5146016ef";
const ARCHIVOS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/estilos.css",
  "js/main.js",
  "js/almacen.js",
  "js/azar.js",
  "js/banco.js",
  "js/dom.js",
  "js/exportar.js",
  "js/geo.js",
  "js/mapa.js",
  "js/motor.js",
  "js/sesion.js",
  "js/util.js",
  "js/pantallas/comun.js",
  "js/pantallas/datos.js",
  "js/pantallas/fin.js",
  "js/pantallas/inicio.js",
  "js/pantallas/juego.js",
  "js/pantallas/nueva.js",
  "js/pantallas/reglas.js",
  "js/pantallas/revision.js",
  "data/config.json",
  "data/ajustes.json",
  "data/rondas.json",
  "data/finales.json",
  "data/preguntas/ciencias.json",
  "data/preguntas/historia.json",
  "data/preguntas/entretenimiento.json",
  "data/preguntas/mates.json",
  "data/preguntas/geohistoria.json",
  "data/mapa.json",
  "icons/icono-180.png",
  "icons/icono-192.png",
  "icons/icono-512.png",
];

self.addEventListener("install", (e) => {
  // «reload» descarga del servidor, sin pasar por la caché HTTP, para no guardar copias viejas.
  const peticiones = ARCHIVOS.map((ruta) => new Request(ruta, { cache: "reload" }));
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(peticiones)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  // Solo se borran las cachés antiguas de esta app: en GitHub Pages todos los proyectos de un
  // usuario comparten la misma dirección (usuario.github.io) y, con ella, el almacén de cachés.
  e.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k.startsWith("cta-") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Con mala cobertura, la red puede tardar muchísimo sin llegar a fallar, y la app se quedaba en
// «Cargando…». Si hay una copia de esa misma dirección y la red no contesta en este tiempo, se usa la copia.
const ESPERA_RED_MS = 4000;

self.addEventListener("fetch", (e) => {
  const peticion = e.request;
  if (peticion.method !== "GET" || new URL(peticion.url).origin !== self.location.origin) return;
  e.respondWith(responder(peticion));
});

async function responder(peticion) {
  // «no-cache» obliga a preguntar al servidor si hay versión nueva (una petición condicional,
  // barata): sin esto, tras publicar una actualización el navegador podía seguir usando
  // archivos viejos de su caché HTTP durante un rato.
  const red = fetch(peticion, { cache: "no-cache" }).then((respuesta) => {
    if (respuesta.ok) {
      const copia = respuesta.clone();
      caches.open(VERSION).then((c) => c.put(peticion, copia));
    }
    return respuesta;
  });
  // Sin conexión vale cualquier copia del archivo, aunque sea de otra versión (`ignoreSearch`): todo lo
  // guardado es de la misma. Si no hay ninguna, a una página se le da la portada y a un dato, un error
  // (antes se devolvía la portada también a los JSON, y fallaba al leerla con un error confuso).
  const sinRed = () =>
    caches.match(peticion, { ignoreSearch: true }).then((r) => r ?? (peticion.mode === "navigate" ? caches.match("index.html") : Response.error()));
  // La espera solo se acorta con la copia exacta de esa dirección: un archivo con otra versión en la
  // dirección (?v=…) no está guardado todavía, así que nunca se mezclan archivos de dos versiones.
  const exacta = await caches.match(peticion);
  if (!exacta) return red.catch(sinRed);
  const espera = new Promise((resolver) => setTimeout(() => resolver(exacta), ESPERA_RED_MS));
  return Promise.race([red.catch(sinRed), espera]);
}
