// Envío de datos a la hoja del grupo, a través de un Apps Script de Google publicado como aplicación web
// (herramientas/apps_script.gs; el formato, en docs/esquema_datos.md). La dirección va en config.json
// (`envio.url`), así que nadie tiene que configurar nada en el móvil. Solo se envía lo que el grupo acepta:
// al acabar cada partida y al salir de «Revisar preguntas», la app pregunta. Cada móvil recuerda qué ha
// enviado; reenviar no hace daño, porque la hoja y la calibración descartan los repetidos.

import { construirExportacion } from "./exportar.js";

export const TANDA = 250; // registros por petición (el script admite hasta 500)
const ESPERA_MS = 30000;

// null si la dirección vale; si no, qué falla. Tiene que ser https (o el propio ordenador, para probar).
export function errorDireccion(url) {
  let u;
  try {
    u = new URL(String(url ?? "").trim());
  } catch {
    return "La dirección del script no es válida.";
  }
  const local = ["localhost", "127.0.0.1"].includes(u.hostname);
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return "La dirección del script tiene que empezar por https://.";
  return null;
}

// Los que faltan por enviar: de una partida que el grupo aceptó enviar (`partidas[id] === true`) o, sin
// partida (las valoraciones de «Revisar preguntas»), aceptados uno a uno (`revisiones[id] === true`). Los
// de la partida a medias esperan a que acabe: «Deshacer» puede borrar el registro de un turno ya cerrado.
export function porEnviar(registros, { enviados, partidas, revisiones }, partidaAMedias = null) {
  return registros.filter(
    (r) => !enviados.has(r.id) && r.partida !== partidaAMedias && (r.partida ? partidas[r.partida] === true : revisiones[r.id] === true),
  );
}

// Registros del modo solo: las respuestas, el final de cada escalera y las opiniones sobre la dificultad que se
// dan al jugar (valoraciones con `origen: "solo"`). No tienen partida: se deciden uno a uno, pero con una sola
// pregunta para siempre (la preferencia `envioSolo`).
export const TIPOS_SOLO = new Set(["solo", "solo_fin"]);
export const esDeSolo = (r) => TIPOS_SOLO.has(r.tipo) || (r.tipo === "revision" && r.origen === "solo");
export function soloSinDecidir(registros, revisiones) {
  return registros.filter((r) => esDeSolo(r) && !(r.id in revisiones));
}

// Valoraciones de «Revisar preguntas» por las que aún no se ha preguntado.
export function revisionesSinDecidir(registros, revisiones) {
  return registros.filter((r) => r.tipo === "revision" && !r.partida && !esDeSolo(r) && !(r.id in revisiones));
}

// Partidas ya acabadas (o abandonadas) con registros y por las que no se llegó a contestar si se envían: la
// pregunta sale en la pantalla del final, y quien cierra la app antes ya no vuelve a verla.
export function partidasSinDecidir(registros, partidas, partidaAMedias = null) {
  return [...new Set(registros.filter((r) => r.partida && r.partida !== partidaAMedias && !(r.partida in partidas)).map((r) => r.partida))];
}

const MENSAJES = {
  cupo: "La hoja ya ha recibido hoy todos los datos que admite: se volverá a intentar más adelante.",
};
// Lo que el script contesta cuando no admite un registro (un tipo que no conoce, o demasiado grande).
const RECHAZOS = new Set(["formato", "tamano"]);

async function peticion(url, cuerpo, fetch) {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ESPERA_MS);
  try {
    // Como texto plano, es una petición «simple» (sin consulta previa de CORS), que es la que admite Apps Script.
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(cuerpo),
      credentials: "omit",
      redirect: "follow",
      signal: control.signal,
    });
    if (!r.ok) return { ok: false, mensaje: `El script ha respondido con un error ${r.status}.` };
    const datos = await r.json().catch(() => null);
    if (!datos || typeof datos !== "object" || typeof datos.ok !== "boolean") return { ok: false, mensaje: "La respuesta no es la del script de la app: ¿es buena la dirección de config.json?" };
    return datos.ok ? datos : { ok: false, codigo: datos.error, mensaje: MENSAJES[datos.error] ?? datos.mensaje ?? "El script no ha guardado los datos." };
  } catch (e) {
    return { ok: false, mensaje: e?.name === "AbortError" ? "El script no ha contestado a tiempo." : "No hay conexión con el script." };
  } finally {
    clearTimeout(reloj);
  }
}

// Envía los registros por tandas, de los más antiguos a los más nuevos, y devuelve { ok, enviados (ids que
// ya están en la hoja), rechazados (ids que el script no admite), nuevos, error }. Si una tanda falla (sin
// conexión, cupo…), se para: lo anterior queda enviado.
// El script rechaza la tanda entera si no admite uno de sus registros: entonces se parte en dos hasta aislarlo,
// para que un registro malo no deje sin enviar todos los demás, ni los que vengan detrás, para siempre.
// Los del modo solo van al final y en tandas aparte: un script desplegado antes de que existieran los rechaza
// («tipo desconocido») hasta que se despliegue su versión nueva, y así no frenan los de las partidas.
export async function enviarRegistros(registros, { url, dispositivo, versiones, fetch = globalThis.fetch, ahora = () => new Date().toISOString() }) {
  const todos = construirExportacion({ registros, dispositivo, versiones }).registros;
  const ordenados = [...todos.filter((r) => !TIPOS_SOLO.has(r.tipo)), ...todos.filter((r) => TIPOS_SOLO.has(r.tipo))];
  const deSolo = ordenados.findIndex((r) => TIPOS_SOLO.has(r.tipo));
  const enviados = [];
  const rechazados = [];
  let nuevos = 0;
  // Cortes de las tandas: cada TANDA registros, y uno más donde empiezan los del modo solo.
  const cortes = [];
  for (let i = 0; i < ordenados.length; ) {
    const fin = deSolo > i ? Math.min(i + TANDA, deSolo) : i + TANDA;
    cortes.push([i, fin]);
    i = fin;
  }
  // Devuelve el error que obliga a parar, o null.
  async function enviarTanda(tanda) {
    const exportacion = construirExportacion({ registros: tanda, dispositivo, versiones, ahora: ahora() });
    const r = await peticion(String(url).trim(), { accion: "enviar", exportacion }, fetch);
    if (r.ok) {
      enviados.push(...tanda.map((x) => x.id));
      nuevos += Number(r.nuevos) || 0;
      return null;
    }
    if (!RECHAZOS.has(r.codigo)) return r.mensaje;
    if (tanda.length === 1) {
      rechazados.push(tanda[0].id);
      return null;
    }
    const mitad = Math.ceil(tanda.length / 2);
    return (await enviarTanda(tanda.slice(0, mitad))) ?? (await enviarTanda(tanda.slice(mitad)));
  }
  for (const [i, fin] of cortes) {
    const error = await enviarTanda(ordenados.slice(i, fin));
    if (error) return { ok: false, enviados, rechazados, nuevos, error };
  }
  return { ok: true, enviados, rechazados, nuevos, error: null };
}
