// Almacenamiento en el navegador.
// - localStorage: partida en curso, preguntas vistas, jugadores conocidos, preferencias.
// - IndexedDB: registro de respuestas, anulaciones y revisiones (puede crecer mucho).
// Si el navegador no deja guardar (modo privado, almacenamiento bloqueado), se usa memoria
// y `almacen.persistente` queda en false para avisar en la interfaz.

import { uuid } from "./azar.js";
import { normalizarNombre } from "./util.js";

export const PREFIJO = "cta.";
const BD = "cuanto-te-arriesgas";
const ALMACEN = "registros";
const DIA_MS = 24 * 60 * 60 * 1000;

// Jugadores recordados que llevan más de `dias` sin jugar (ni revisar), salvo los `protegidos`
// (los de la partida a medias). Una fecha que no se entiende cuenta como reciente: ante la duda, no se olvida.
export function jugadoresInactivos(jugadores, { ahora, dias, protegidos = new Set() }) {
  if (!(dias > 0)) return [];
  const limite = new Date(ahora).getTime() - dias * DIA_MS;
  return jugadores.filter((j) => {
    const ultima = new Date(j.ultima).getTime();
    return !protegidos.has(j.clave) && Number.isFinite(ultima) && ultima < limite;
  });
}

function leer(clave, porDefecto) {
  try {
    const crudo = localStorage.getItem(PREFIJO + clave);
    return crudo == null ? porDefecto : JSON.parse(crudo);
  } catch {
    return porDefecto;
  }
}

// Lo guardado puede tener otra forma (una versión anterior, un fallo a medio escribir): se lee con
// la forma esperada o vacío, para que nunca impida arrancar la app.
function leerMapa(clave) {
  const x = leer(clave, {});
  return x !== null && typeof x === "object" && !Array.isArray(x) ? x : {};
}

function leerJugadores() {
  const x = leer("jugadores", []);
  return Array.isArray(x) ? x.filter((j) => j && typeof j.clave === "string" && j.clave) : [];
}

function escribir(clave, valor) {
  try {
    if (valor === undefined) localStorage.removeItem(PREFIJO + clave);
    else localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

function abrirBD() {
  return new Promise((resolver, rechazar) => {
    if (!("indexedDB" in globalThis)) return rechazar(new Error("Sin IndexedDB"));
    const peticion = indexedDB.open(BD, 1);
    peticion.onupgradeneeded = () => {
      const bd = peticion.result;
      if (!bd.objectStoreNames.contains(ALMACEN)) {
        const tienda = bd.createObjectStore(ALMACEN, { keyPath: "id" });
        tienda.createIndex("tipo", "tipo");
      }
    };
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
    peticion.onblocked = () => rechazar(new Error("IndexedDB bloqueada"));
  });
}

function operacion(bd, modo, fn) {
  return new Promise((resolver, rechazar) => {
    const tx = bd.transaction(ALMACEN, modo);
    const resultado = fn(tx.objectStore(ALMACEN));
    tx.oncomplete = () => resolver(resultado?.result);
    tx.onerror = () => rechazar(tx.error);
    tx.onabort = () => rechazar(tx.error);
  });
}

export async function crearAlmacen() {
  let bd = null;
  let memoria = null;
  try {
    bd = await abrirBD();
  } catch {
    memoria = new Map();
  }
  const localOk = escribir("prueba", 1);
  escribir("prueba", undefined);

  // Caché en memoria de las vistas: se consultan muchas veces por turno. Antes de escribir se vuelve a
  // leer lo guardado, y si otra pestaña lo cambia se refresca: con la app abierta dos veces, cada una
  // escribía su copia entera y borraba lo que había visto la otra.
  let vistas = leerMapa("vistas");
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key === null || e.key === PREFIJO + "vistas") vistas = leerMapa("vistas");
    });
  }
  const mapaDe = (todas, clave) => {
    const m = todas[clave];
    return m !== null && typeof m === "object" ? m : {};
  };

  let dispositivo = leer("dispositivo", null);
  if (!dispositivo) {
    dispositivo = uuid();
    escribir("dispositivo", dispositivo);
  }

  return {
    persistente: Boolean(bd) && localOk,
    dispositivo,

    // --- partida en curso
    cargarPartida: () => leer("partida", null),
    guardarPartida: (x) => escribir("partida", x),
    borrarPartida: () => escribir("partida", undefined),

    // --- preguntas vistas por jugador: { clave: { idPregunta: ts } }
    vistasDe: (clave) => mapaDe(vistas, clave),
    marcarVistas(pares, ts) {
      vistas = leerMapa("vistas");
      for (const [jugador, pregunta] of pares) (vistas[jugador] = mapaDe(vistas, jugador))[pregunta] = ts;
      escribir("vistas", vistas);
    },
    vistoPorAlguien() {
      const todas = new Set();
      for (const clave of Object.keys(vistas)) for (const id of Object.keys(mapaDe(vistas, clave))) todas.add(id);
      return todas;
    },
    olvidarVistas() {
      vistas = {};
      escribir("vistas", vistas);
    },

    // --- preguntas revisadas por evaluador (para no repetir en el modo revisión)
    revisadasDe: (clave) => mapaDe(leerMapa("revisadas"), clave),
    marcarRevisada(clave, pregunta, ts) {
      const todas = leerMapa("revisadas");
      (todas[clave] = mapaDe(todas, clave))[pregunta] = ts;
      escribir("revisadas", todas);
    },

    // --- jugadores conocidos, para autocompletar: [{ clave, nombre, ultima }], los más recientes primero.
    // Con la misma fecha (los de una misma partida) se conserva su orden: la ordenación es estable.
    jugadoresConocidos: () => leerJugadores().sort((a, b) => (a.ultima < b.ultima ? 1 : a.ultima > b.ultima ? -1 : 0)),
    recordarJugadores(lista, ts) {
      const conocidos = new Map(leerJugadores().map((j) => [j.clave, j]));
      for (const j of lista) conocidos.set(j.clave, { clave: j.clave, nombre: j.nombre, ultima: ts });
      escribir("jugadores", [...conocidos.values()]);
    },
    // Olvida a un jugador en este móvil: su nombre, sus preguntas vistas y revisadas, y las
    // preferencias que lo nombran. Nunca toca el registro de IndexedDB: R lo necesita para calibrar.
    olvidarJugador(clave) {
      escribir("jugadores", leerJugadores().filter((j) => j.clave !== clave));
      vistas = leerMapa("vistas");
      if (clave in vistas) {
        delete vistas[clave];
        escribir("vistas", vistas);
      }
      const revisadas = leerMapa("revisadas");
      if (clave in revisadas) {
        delete revisadas[clave];
        escribir("revisadas", revisadas);
      }
      if (leer("pref.evaluador", null)?.clave === clave) escribir("pref.evaluador", undefined);
      if (normalizarNombre(leer("pref.narrador", "")) === clave) escribir("pref.narrador", undefined);
    },
    // Olvida a los que llevan más de `dias` sin jugar; devuelve a quiénes.
    olvidarInactivos({ ahora, dias, protegidos }) {
      const olvidados = jugadoresInactivos(leerJugadores(), { ahora, dias, protegidos });
      for (const j of olvidados) this.olvidarJugador(j.clave);
      return olvidados;
    },

    // --- preferencias y metadatos
    preferencia: (clave, porDefecto) => leer(`pref.${clave}`, porDefecto),
    guardarPreferencia: (clave, valor) => escribir(`pref.${clave}`, valor),

    // --- registro de eventos (IndexedDB)
    async guardarRegistro(reg) {
      if (memoria) return void memoria.set(reg.id, reg);
      await operacion(bd, "readwrite", (t) => t.put(reg));
    },
    async borrarRegistro(id) {
      if (memoria) return void memoria.delete(id);
      await operacion(bd, "readwrite", (t) => t.delete(id));
    },
    async todosLosRegistros() {
      if (memoria) return [...memoria.values()];
      return operacion(bd, "readonly", (t) => t.getAll());
    },
  };
}

export async function pedirAlmacenamientoPersistente() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
