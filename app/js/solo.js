// Modo solo: el reto del día y la práctica (docs/modo_solo.md). Una escalera de 10 preguntas, del nivel 1 al
// 10, con 8 opciones cada una. Cada acierto suma al bote 10 × nivel × multiplicador (×2 al instante, ×1 al
// agotar el tiempo); fallar, o quedarse sin tiempo, lo deja en 0. Antes de cada pregunta se puede plantar.
// Funciones puras: no tocan el navegador (se prueban en tests/solo.test.js).

import { barajar, elegir, rngConSemilla } from "./azar.js";
import { fnv1a, segundosCronometro } from "./util.js";

export const PASOS = 10;
export const INCORRECTAS = 7;

// ---------------------------------------------------------------- fechas
// El día del reto es el de una zona horaria fija (config.solo.zona_horaria, la de España): así es el mismo para
// todos, aunque alguien tenga el móvil en otra hora. Si el navegador no conoce la zona, la del móvil.

const dos = (n) => String(n).padStart(2, "0");
export function fechaLocal(d = new Date(), zona = null) {
  if (zona) {
    try {
      const partes = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((p) => [p.type, p.value]),
      );
      if (/^\d{4}$/.test(partes.year) && /^\d{2}$/.test(partes.month) && /^\d{2}$/.test(partes.day)) return `${partes.year}-${partes.month}-${partes.day}`;
    } catch {
      // Zona desconocida: la del móvil.
    }
  }
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

// "2026-11-06" → Date a las 12:00 de ese día (a mediodía, para que un cambio de hora no lo mueva de día).
export function diaDe(fecha) {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(a, m - 1, d, 12);
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const fechaLegible = (fecha, { conDia = false } = {}) => {
  const d = diaDe(fecha);
  return `${conDia ? `${DIAS[d.getDay()]} ` : ""}${d.getDate()} de ${MESES[d.getMonth()]}`;
};

export const semilla = (texto) => parseInt(fnv1a(String(texto)), 16);

// ---------------------------------------------------------------- opciones

const textoValido = (x) => typeof x === "string" && x.trim() !== "";

// Las opciones de una pregunta, si las tiene completas para su versión: { correcta, incorrectas } o null.
// Las de mapa no llevan: se responden en el mapa.
export function opcionesDe(q, opciones) {
  const o = opciones?.get(q.id);
  if (!o || o.v !== q.v || !Array.isArray(o.incorrectas) || o.incorrectas.length !== INCORRECTAS || !o.incorrectas.every(textoValido)) return null;
  if (o.correcta != null && !textoValido(o.correcta)) return null;
  return { correcta: o.correcta || q.respuesta, incorrectas: o.incorrectas };
}

// Si una pregunta se puede jugar a solas: las de mapa siempre; las de texto, si tienen opciones.
export const jugable = (q, opciones) => q.tipo === "mapa" || Boolean(opcionesDe(q, opciones));

// Las 8 opciones en orden: el del reto, igual para todos ese día (semilla: fecha e id); el de la práctica, al azar.
export function ordenOpciones(q, opciones, rng) {
  const o = opcionesDe(q, opciones);
  if (!o) return null;
  return barajar([o.correcta, ...o.incorrectas], rng);
}

// Huella de las opciones de una pregunta: si se rehacen, los registros lo dicen (para no mezclar datos).
export function huellaOpciones(q, opciones) {
  const o = opcionesDe(q, opciones);
  return o ? fnv1a(JSON.stringify([o.correcta, ...o.incorrectas])) : null;
}

// Lo que hace falta de una pregunta para enseñarla y corregirla, guardado con la escalera: si mientras tanto llega
// otra versión del banco o de la configuración, la pregunta en pantalla (y las ya respondidas) siguen siendo las que
// se vieron, con sus reglas: segundos, puntos del escalón, multiplicador máximo y zona de acierto del mapa.
export function fotoPregunta(q, opciones, config, nivel) {
  const campos = ["id", "v", "tipo", "categoria", "subtema", "nivel", "nivelEfectivo", "pregunta", "respuesta", "explicacion", "lat", "lon", "distancia_max_km", "vista"];
  const foto = Object.fromEntries(campos.filter((c) => q[c] !== undefined).map((c) => [c, q[c]]));
  if (q.tipo !== "mapa") {
    foto.correcta = opcionesDe(q, opciones).correcta;
    foto.huella = huellaOpciones(q, opciones);
  }
  if (config) {
    foto.reglas = {
      segundos: segundosPregunta(config, q, nivel),
      puntos: config.solo.puntos[nivel - 1],
      multiplicador_max: config.solo.multiplicador_max,
      ...(q.tipo === "mapa" ? { acierto_fraccion: config.mapa?.acierto_fraccion ?? 0.75 } : {}),
    };
  }
  return foto;
}

// Las reglas de la pregunta en pantalla: las de su foto o, si no las lleva, las de la configuración.
export function reglasDe(e, config) {
  const nivel = e.paso + 1;
  return e.actual?.reglas ?? { segundos: segundosPregunta(config, e.actual, nivel), puntos: config.solo.puntos[nivel - 1], multiplicador_max: config.solo.multiplicador_max };
}

// ---------------------------------------------------------------- tiempo y puntos

// Segundos para responder: Mates y lógica, los de su cronómetro en la partida; mapa y texto, los de config.solo.
export function segundosPregunta(config, q, nivel) {
  const s = config.solo;
  if (q.tipo === "mapa") return s.segundos_mapa[nivel - 1];
  return segundosCronometro(config, q.categoria, nivel, q.subtema) ?? s.segundos[nivel - 1];
}

// ×2 al mostrar la pregunta, ×1 al agotar el tiempo (en línea recta), con dos decimales.
export function multiplicador(ms, segundos, maximo = 2) {
  const fraccion = Math.min(1, Math.max(0, ms / (segundos * 1000)));
  return Math.round((maximo - (maximo - 1) * fraccion) * 100) / 100;
}

// Puntos de un acierto: los de su escalón (config.solo.puntos, 10 × nivel) por el multiplicador de velocidad.
export const puntosAcierto = (config, nivel, mult) => Math.round(config.solo.puntos[nivel - 1] * mult);

// ---------------------------------------------------------------- qué preguntas salen

const nivelDe = (q) => q.nivelEfectivo ?? q.nivel;
const porId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Todas las preguntas del calendario a partir de `fecha` (incluida), y las de `extra`: no salen en la práctica, para
// que nadie se encuentre en el reto una pregunta que ya ha practicado.
export function reservadas(calendario, fecha, extra = []) {
  const ids = new Set(extra);
  for (const d of calendario?.dias ?? []) if (d.fecha >= fecha) for (const id of d.preguntas) ids.add(id);
  return ids;
}

// Lo mismo, con los retos tal como se juegan (con sus sustitutas): los del calendario de hoy en adelante y, si el
// calendario no llega a hoy, el de hoy por semilla.
export function reservadasParaPractica(fecha, ctx) {
  const extra = [];
  const dias = (ctx.calendario?.dias ?? []).filter((d) => d.fecha >= fecha).map((d) => d.fecha);
  for (const f of dias.includes(fecha) ? dias : [fecha, ...dias]) extra.push(...(retoDelDia(f, ctx)?.preguntas ?? []));
  return reservadas(ctx.calendario, fecha, extra);
}

// Las categorías de un día mezclado: config.solo.mezcla dice cuántas de cada una, y `extra` cuántas más de las
// categorías de texto del tablero, elegidas al azar. Cada una va a un escalón al azar.
function categoriasMezcla(config, rng) {
  const { mezcla } = config.solo;
  const lista = [];
  for (const [cat, n] of Object.entries(mezcla)) if (cat !== "extra") for (let i = 0; i < n; i++) lista.push(cat);
  const deTexto = config.categorias.filter((c) => c.tipo !== "mapa").map((c) => c.id);
  for (let i = 0; i < (mezcla.extra ?? 0); i++) lista.push(elegir(deTexto, rng));
  return barajar(lista, rng).slice(0, PASOS);
}

// Una pregunta jugable de esa categoría y nivel, que no esté en `excluir`, sin repetir subtema en el día si se
// puede; si no hay de ese nivel, la del nivel más cercano. Las candidatas van por id: el resultado no depende del
// orden de los archivos.
function elegirDeCelda(indice, opciones, { categoria, nivel, excluir, subtemasUsados, rng, preferir = () => 0, distanciaMax = 9 }) {
  for (let d = 0; d <= distanciaMax; d++) {
    for (const l of d ? [nivel - d, nivel + d] : [nivel]) {
      const c = [...indice.porId.values()].filter((q) => q.categoria === categoria && nivelDe(q) === l && !excluir.has(q.id) && jugable(q, opciones)).sort(porId);
      if (!c.length) continue;
      const mejor = Math.min(...c.map(preferir));
      const buenas = c.filter((q) => preferir(q) === mejor);
      const nuevas = buenas.filter((q) => !subtemasUsados.has(q.subtema));
      return elegir(nuevas.length ? nuevas : buenas, rng);
    }
  }
  return null;
}

// Los retos del calendario tal como se juegan, día a día y en orden: una pregunta retirada o sin opciones, o que ya
// salió en un día anterior (como sustituta), se sustituye por otra de su categoría y nivel, elegida con la fecha
// como semilla entre las que no han salido en ningún reto anterior ni están en el del día. Cada día depende solo de
// los anteriores: ampliar el calendario no cambia los ya publicados. Se calcula una vez por calendario, banco y
// opciones. Devuelve un Map fecha → ids (o null si ese día no se puede armar).
const cacheRetos = new WeakMap();
const SIN_OPCIONES = {};
const SIN_CALENDARIO = {};
function retosDelCalendario({ calendario, indice, opciones }) {
  const clave = [calendario ?? SIN_CALENDARIO, indice, opciones ?? SIN_OPCIONES];
  let nivel = cacheRetos;
  for (const k of clave.slice(0, -1)) {
    if (!nivel.has(k)) nivel.set(k, new WeakMap());
    nivel = nivel.get(k);
  }
  if (nivel.has(clave[2])) return nivel.get(clave[2]);
  const salidas = new Set();
  const porFecha = new Map();
  const dias = [...(calendario?.dias ?? [])].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  for (const dia of dias) {
    const rng = rngConSemilla(semilla(`reto|${dia.fecha}`));
    const delDia = new Set(dia.preguntas);
    const usados = new Set();
    let ids = [];
    for (let i = 0; i < dia.preguntas.length; i++) {
      const q = indice.porId.get(dia.preguntas[i]);
      if (q && jugable(q, opciones) && !usados.has(q.id) && !salidas.has(q.id)) {
        ids.push(q.id);
        usados.add(q.id);
        continue;
      }
      const cat = dia.categorias?.[i] ?? q?.categoria;
      const buscar = (excluir) => elegirDeCelda(indice, opciones, { categoria: cat, nivel: i + 1, excluir, subtemasUsados: new Set(), rng });
      // Mejor una que no haya salido nunca; si no queda ninguna, una que ya salió hace tiempo.
      const sustituta = cat ? (buscar(new Set([...salidas, ...delDia, ...usados])) ?? buscar(new Set([...delDia, ...usados]))) : null;
      if (!sustituta) {
        ids = null;
        break;
      }
      ids.push(sustituta.id);
      usados.add(sustituta.id);
    }
    porFecha.set(dia.fecha, ids);
    for (const id of ids ?? []) salidas.add(id);
  }
  nivel.set(clave[2], porFecha);
  return porFecha;
}

// El reto de un día. Del calendario (app/data/retos.json) si lo tiene, tal como se juega (retosDelCalendario). Si el
// calendario no llega a ese día, se arma con la fecha como semilla (igual en todos los móviles con la misma versión
// del banco). Devuelve { fecha, titulo, tema, preguntas: [ids], origen } o null si no se puede armar.
export function retoDelDia(fecha, { calendario, indice, opciones, config }) {
  const dia = calendario?.dias?.find((d) => d.fecha === fecha);
  const efectivos = retosDelCalendario({ calendario, indice, opciones });
  if (dia) {
    const ids = efectivos.get(fecha);
    return ids ? { fecha, titulo: dia.titulo ?? null, tema: dia.tema ?? null, preguntas: ids, origen: "calendario" } : null;
  }
  const hastaHoy = new Set();
  for (const d of calendario?.dias ?? []) {
    if (d.fecha > fecha) continue;
    for (const id of [...d.preguntas, ...(efectivos.get(d.fecha) ?? [])]) hastaHoy.add(id);
  }
  return retoPorSemilla(fecha, { indice, opciones, config, rng: rngConSemilla(semilla(`reto|${fecha}`)), excluir: hastaHoy });
}

function retoPorSemilla(fecha, { indice, opciones, config, rng, excluir }) {
  // Una escalera con estas categorías; `soloEstas`: sin cambiar de categoría ni de nivel (un día temático no mezcla,
  // y si a su tema le falta un nivel, mejor otro tema).
  const armar = (categorias, soloEstas) => {
    const delTablero = config.categorias.map((c) => c.id);
    const usados = new Set();
    const subtemas = new Set();
    const ids = [];
    for (let i = 0; i < PASOS; i++) {
      // Mejor una que no haya salido en un reto; si no queda, cualquiera. En un día mezclado, si su categoría no
      // tiene ninguna jugable (un archivo de opciones que falta), otra del tablero.
      const buscar = (categoria) =>
        elegirDeCelda(indice, opciones, { categoria, nivel: i + 1, excluir: usados, subtemasUsados: subtemas, rng, preferir: (x) => (excluir.has(x.id) ? 1 : 0), distanciaMax: soloEstas ? 0 : 9 });
      let q = buscar(categorias[i]);
      if (!soloEstas) for (const otra of delTablero) q ??= buscar(otra);
      if (!q) return null;
      ids.push(q.id);
      usados.add(q.id);
      subtemas.add(q.subtema);
    }
    return ids;
  };
  if (config.solo.dias_tematicos.includes(diaDe(fecha).getDay())) {
    const temas = barajar(config.solo.temas_dia, rng);
    for (const tema of temas) {
      const ids = armar(Array(PASOS).fill(tema.id), true);
      if (ids) return { fecha, titulo: tema.titulo, tema: tema.id, preguntas: ids, origen: "semilla" };
    }
  }
  const ids = armar(categoriasMezcla(config, rng), false);
  return ids ? { fecha, titulo: null, tema: null, preguntas: ids, origen: "semilla" } : null;
}

// Una escalera de práctica: por cada nivel, una pregunta jugable de las categorías pedidas (todas las del
// tablero si no se pide ninguna), nunca reservada para un reto, mejor sin ver por quien juega y, si no queda,
// la vista hace más tiempo. Si un nivel no tiene ninguna, la del nivel más cercano.
export function escaleraPractica({ indice, opciones, config, categoria = null, vistas = {}, reservadas: reserva = new Set(), rng }) {
  const cats = categoria ? [categoria] : config.categorias.map((c) => c.id);
  const posibles = [...indice.porId.values()].filter((q) => cats.includes(q.categoria) && !reserva.has(q.id) && jugable(q, opciones)).sort(porId);
  const ids = [];
  const usados = new Set();
  let anterior = null;
  for (let nivel = 1; nivel <= PASOS; nivel++) {
    let elegida = null;
    for (let d = 0; d <= 9 && !elegida; d++) {
      for (const l of d ? [nivel - d, nivel + d] : [nivel]) {
        const c = posibles.filter((q) => nivelDe(q) === l && !usados.has(q.id));
        if (!c.length) continue;
        const nuevas = c.filter((q) => !(q.id in vistas));
        let grupo = nuevas;
        if (!grupo.length) {
          const masAntigua = c.map((q) => vistas[q.id]).sort()[0];
          grupo = c.filter((q) => vistas[q.id] === masAntigua);
        }
        // Mejor no repetir la categoría del escalón anterior.
        const otraCat = grupo.filter((q) => q.categoria !== anterior);
        elegida = elegir(otraCat.length ? otraCat : grupo, rng);
        break;
      }
    }
    if (!elegida) return null;
    ids.push(elegida.id);
    usados.add(elegida.id);
    anterior = elegida.categoria;
  }
  return ids;
}

// ---------------------------------------------------------------- la escalera

// fase: "decidir" (antes de cada pregunta: empezar, seguir o plantarse), "pregunta" (en pantalla, con el tiempo
// corriendo desde `inicio`), "resultado" (acaba de responder) o "fin". `actual` es la foto de la pregunta en
// pantalla (fotoPregunta); `consumido`, los milisegundos que ya se sabe que han pasado (si el reloj del móvil se
// atrasa, no se recuperan).
export function nuevaEscalera({ id, modo, fecha, titulo = null, tema = null, categoria = null, origen = null, preguntas, jugador, ahora, versiones = null }) {
  return { id, modo, fecha, titulo, tema, categoria, origen, preguntas, jugador, versiones, creada: ahora, paso: 0, bote: 0, fase: "decidir", inicio: null, consumido: 0, actual: null, orden: null, resultados: [], final: null, terminada: null };
}

// Empieza la pregunta del escalón actual: desde ahora corre el tiempo. `foto`: la de la pregunta (fotoPregunta);
// `orden`: las opciones barajadas (o null en las de mapa).
export function empezarPregunta(e, { ahoraMs, foto, orden }) {
  if (e.fase !== "decidir") throw new Error("No toca empezar una pregunta.");
  return { ...e, fase: "pregunta", inicio: ahoraMs, consumido: 0, actual: foto, orden };
}

// Milisegundos que lleva la pregunta en pantalla: nunca menos de lo ya consumido (un reloj que se atrasa no
// devuelve tiempo), y `extra` (otro reloj, el monotónico de la sesión) si dice que ha pasado más.
export const transcurrido = (e, ahoraMs, extra = 0) => Math.max(0, Math.round(ahoraMs - e.inicio), e.consumido ?? 0, Math.round(extra));

// Responde la pregunta en pantalla. `acierto` lo decide quien llama (la opción correcta, o el mapa); se acaba el
// tiempo si `ms` llega a los segundos de la pregunta. Devuelve la escalera con el resultado apuntado y el bote al día.
export function responderPregunta(e, { config, acierto, ms, ts, elegida = null, mapa = null }) {
  if (e.fase !== "pregunta") throw new Error("No hay ninguna pregunta en pantalla.");
  const q = e.actual;
  const nivel = e.paso + 1;
  const reglas = reglasDe(e, config);
  const segundos = reglas.segundos;
  const agotado = ms >= segundos * 1000;
  const bien = Boolean(acierto) && !agotado;
  const mult = bien ? multiplicador(ms, segundos, reglas.multiplicador_max) : 0;
  const puntos = bien ? Math.round(reglas.puntos * mult) : 0;
  const bote = bien ? e.bote + puntos : 0;
  const resultado = { pregunta: q.id, q, ts, nivel, acierto: bien, agotado, ms, segundos, multiplicador: mult, puntos, bote, elegida, ...(mapa ? { mapa } : {}) };
  const final = !bien ? (agotado ? "tiempo" : "fallo") : nivel === PASOS ? "completo" : null;
  return { ...e, fase: "resultado", paso: e.paso + 1, bote, resultados: [...e.resultados, resultado], final, consumido: ms };
}

// Tras ver el resultado: a la siguiente decisión, o al final si se ha fallado o completado.
export function seguir(e, { ts } = {}) {
  if (e.fase !== "resultado") throw new Error("No hay ningún resultado que dejar atrás.");
  return { ...e, fase: e.final ? "fin" : "decidir", inicio: null, consumido: 0, actual: null, orden: null, terminada: e.final ? ts : null };
}

export function plantarse(e, { ts } = {}) {
  if (e.fase !== "decidir" || e.paso === 0) throw new Error("Solo se puede plantar antes de una pregunta, con algo en el bote.");
  return { ...e, fase: "fin", final: "plantado", terminada: ts };
}

// Si la pregunta en pantalla ya no tiene tiempo (se cerró la app y se ha vuelto tarde).
export function tiempoAgotado(e, config, ahoraMs, extra = 0) {
  return e.fase === "pregunta" && transcurrido(e, ahoraMs, extra) >= reglasDe(e, config).segundos * 1000;
}

// ---------------------------------------------------------------- compartir

export function emojis(e) {
  const marcas = e.resultados.map((r) => (r.acierto ? (r.multiplicador >= 1.5 ? "⚡" : "🟩") : r.agotado ? "⏰" : "🟥"));
  if (e.final === "plantado") marcas.push("✋");
  if (e.final === "completo") marcas.push("🏆");
  return marcas.join("");
}

export function frasePuntos(e) {
  const n = (x) => new Intl.NumberFormat("es-ES").format(x);
  if (e.final === "completo") return `¡Escalera completa! ${n(e.bote)} puntos`;
  if (e.final === "plantado") return `Me planté con ${n(e.bote)} puntos (${e.paso} de ${PASOS})`;
  return `Caí en el escalón ${e.paso}: 0 puntos`;
}

export function textoCompartir(e, { nombreApp, url = null }) {
  return [
    `${nombreApp} · ${e.modo === "reto" ? `Reto del ${fechaLegible(e.fecha)}` : "Práctica"}`,
    e.titulo,
    e.emojis ?? emojis(e), // un resultado guardado ya lleva los suyos
    frasePuntos(e),
    url,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------- registros (docs/esquema_datos.md)
// Cada registro tiene un id fijo (el de la escalera y su escalón, o «fin»): se pueden volver a guardar sin
// duplicarse, por ejemplo al retomar una escalera cuyo último registro no llegó a guardarse.

const comunes = (e, ctx) => ({
  dispositivo: ctx.dispositivo,
  version_banco: (e.versiones ?? ctx.versiones).banco,
  version_ajustes: (e.versiones ?? ctx.versiones).ajustes,
  escalera: e.id,
  modo: e.modo,
  reto: e.modo === "reto" ? e.fecha : null,
  reto_origen: e.modo === "reto" ? e.origen : null,
  tema_dia: e.tema,
  categoria_practica: e.categoria,
  jugador: e.jugador.clave,
});

export function registrosEscalera(e, ctx) {
  const registros = e.resultados.map((r) => ({
    id: `${e.id}-r${r.nivel}`,
    tipo: "solo",
    ts: r.ts,
    ...comunes(e, ctx),
    // Las versiones con las que se vio esta pregunta (si se actualizó la app entre dos preguntas, cambian).
    ...(r.q.versiones ? { version_banco: r.q.versiones.banco, version_ajustes: r.q.versiones.ajustes } : {}),
    turno: r.nivel,
    pregunta: r.q.id,
    v: r.q.v,
    categoria: r.q.categoria,
    subtema: r.q.subtema,
    nivel_inicial: r.q.nivel,
    nivel_mostrado: r.q.nivelEfectivo ?? r.q.nivel,
    respuesta_dada: r.elegida == null ? null : String(r.elegida).slice(0, 200),
    opciones: r.q.huella ?? null,
    acierto: r.acierto,
    tiempo_agotado: r.agotado,
    ms: r.ms,
    segundos: r.segundos,
    multiplicador: r.multiplicador,
    puntos: r.puntos,
    bote: r.bote,
    ...(r.mapa ? { lat_senalada: r.mapa.lat, lon_senalada: r.mapa.lon, distancia_km: r.mapa.distancia_km, distancia_max_km: r.q.distancia_max_km } : {}),
  }));
  if (e.fase === "fin") {
    registros.push({
      id: `${e.id}-fin`,
      tipo: "solo_fin",
      ts: e.terminada ?? e.resultados[e.resultados.length - 1]?.ts ?? e.creada,
      ...comunes(e, ctx),
      pasos: e.resultados.filter((r) => r.acierto).length,
      bote: e.bote,
      final: e.final,
    });
  }
  return registros;
}
