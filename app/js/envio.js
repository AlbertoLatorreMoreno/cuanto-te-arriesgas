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

// Valoraciones de «Revisar preguntas» por las que aún no se ha preguntado.
export function revisionesSinDecidir(registros, revisiones) {
  return registros.filter((r) => r.tipo === "revision" && !r.partida && !(r.id in revisiones));
}

const MENSAJES = {
  cupo: "La hoja ya ha recibido hoy todos los datos que admite: se volverá a intentar más adelante.",
};

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
    return datos.ok ? datos : { ok: false, mensaje: MENSAJES[datos.error] ?? datos.mensaje ?? "El script no ha guardado los datos." };
  } catch (e) {
    return { ok: false, mensaje: e?.name === "AbortError" ? "El script no ha contestado a tiempo." : "No hay conexión con el script." };
  } finally {
    clearTimeout(reloj);
  }
}

// Envía los registros por tandas, de los más antiguos a los más nuevos, y devuelve { ok, enviados (ids que
// ya están en la hoja), nuevos, error }. Si una tanda falla, se para: lo anterior queda enviado.
export async function enviarRegistros(registros, { url, dispositivo, versiones, fetch = globalThis.fetch, ahora = () => new Date().toISOString() }) {
  const ordenados = construirExportacion({ registros, dispositivo, versiones }).registros;
  const enviados = [];
  let nuevos = 0;
  for (let i = 0; i < ordenados.length; i += TANDA) {
    const tanda = ordenados.slice(i, i + TANDA);
    const exportacion = construirExportacion({ registros: tanda, dispositivo, versiones, ahora: ahora() });
    const r = await peticion(String(url).trim(), { accion: "enviar", exportacion }, fetch);
    if (!r.ok) return { ok: false, enviados, nuevos, error: r.mensaje };
    enviados.push(...tanda.map((x) => x.id));
    nuevos += Number(r.nuevos) || 0;
  }
  return { ok: true, enviados, nuevos, error: null };
}
