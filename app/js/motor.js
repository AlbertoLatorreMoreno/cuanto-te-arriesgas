// Motor del juego: reglas puras, sin interfaz ni almacenamiento.
//
// Cada acción recibe la partida y un contexto, y devuelve
//   { partida, registros, vistas }
// donde `partida` es una copia nueva, `registros` son los eventos que hay que
// guardar y `vistas` son pares [jugador, pregunta] que acaban de verse.
//
// Contexto: { indice, config, rng, vistasDe(clave) -> {id: ts}, ahora() -> ISO }

import { barajar, elegir } from "./azar.js";
import { elegirFinal, elegirPregunta, elegirRonda, elegirSubtema } from "./banco.js";
import { aciertoMapa, distanciaKm, puntosMapa } from "./geo.js";
import { clonar, segundosCronometro } from "./util.js";

export const FASE = Object.freeze({
  ANUNCIO: "anuncio", // categoría (y nivel si es la final) anunciados; se espera la apuesta
  PASAR: "pasar", // pregunta elegida; el móvil pasa al lector (con narrador no hay esta fase)
  LECTURA: "lectura", // el lector ve la pregunta, la respuesta está oculta
  RESPUESTA: "respuesta", // respuesta visible; se espera el juicio
  RESULTADO: "resultado", // juzgada; valoración opcional antes de cerrar el turno
  FIN: "fin",
});

// Rondas divertidas: «lista» (nombra todos los que puedas) y «rafaga» (descripciones seguidas).
export const TIPOS_RONDA = ["lista", "rafaga"];

export class ErrorJuego extends Error {}

function exigir(condicion, mensaje) {
  if (!condicion) throw new ErrorJuego(mensaje);
}

export function generarTablero(meta, categorias, rng) {
  const tablero = [null]; // casilla 0: salida
  while (tablero.length < meta) {
    const bloque = barajar(categorias, rng);
    if (categorias.length > 1 && bloque[0] === tablero[tablero.length - 1]) bloque.push(bloque.shift());
    for (const c of bloque) if (tablero.length < meta) tablero.push(c);
  }
  return tablero;
}

// Casillas de ronda divertida: una en cada bloque de `cada` casillas (desde la 1), nunca en la salida
// ni en la meta. Se elige lejos de los bordes del bloque, así que nunca hay dos seguidas.
export function generarEspeciales(meta, cada, rng) {
  const especiales = [];
  if (!(cada >= 4)) return especiales;
  for (let inicio = 1; inicio + cada - 1 < meta; inicio += cada) {
    const desde = inicio + 1;
    const hasta = inicio + cada - 2;
    especiales.push(desde + Math.floor(rng() * (hasta - desde + 1)));
  }
  return especiales;
}

// Nivel de la final: el base, más 1 por cada `pasoFinal` puntos de ventaja sobre el último (hasta el
// máximo), menos 1 por cada final que ya haya fallado ese jugador (nunca por debajo del base). La
// rebaja evita que alguien se atasque turno tras turno en la final más difícil.
export function calcularFinal(jugadores, idx, pasoFinal, { nivel_base, nivel_max }) {
  const otros = jugadores.filter((_, i) => i !== idx);
  const ultimo = Math.min(...otros.map((j) => j.pos));
  const ventaja = Math.max(0, jugadores[idx].pos - ultimo);
  const porVentaja = Math.min(nivel_max, nivel_base + Math.floor(ventaja / pasoFinal));
  const falladas = jugadores[idx].finalesFalladas ?? 0;
  const nivel = Math.max(nivel_base, porVentaja - falladas);
  return { nivel, ventaja, rebaja: porVentaja - nivel };
}

// Una partida guardada por una versión anterior de la app (u otra cosa rara en el almacén)
// no se debe intentar reanudar: se comprueba la forma antes de ofrecer «Continuar».
const FASES_CON_PREGUNTA = new Set([FASE.PASAR, FASE.LECTURA, FASE.RESPUESTA, FASE.RESULTADO]);

export function partidaReanudable(p) {
  if (!p || typeof p !== "object" || p.formato !== 1) return false;
  if (!Array.isArray(p.jugadores) || p.jugadores.length < 2 || !Array.isArray(p.tablero) || !Array.isArray(p.usadas)) return false;
  if (!Number.isInteger(p.meta) || !Number.isInteger(p.idx) || !p.jugadores[p.idx]) return false;
  if (p.narrador != null && (typeof p.narrador.clave !== "string" || !p.narrador.clave)) return false;
  if (p.especiales != null && !Array.isArray(p.especiales)) return false;
  const t = p.turno;
  if (!t || !Object.values(FASE).includes(t.fase)) return false;
  if (t.ronda) {
    const r = t.rondaDatos;
    if (!r || !TIPOS_RONDA.includes(r.tipo) || !Array.isArray(r.elementos) || !r.elementos.length || !Array.isArray(t.marcados)) return false;
  } else if (t.reto) {
    const f = t.finalDatos;
    if (!f || !Array.isArray(f.elementos) || !f.elementos.length || !Number.isInteger(f.minimo) || !Array.isArray(t.marcados)) return false;
  } else if (FASES_CON_PREGUNTA.has(t.fase)) {
    // Una final propia no tiene categoría (tema libre); las demás preguntas, sí.
    const q = t.preguntaDatos;
    if (!q || typeof q.pregunta !== "string" || typeof q.respuesta !== "string" || (!q.categoria && !t.final)) return false;
  }
  return true;
}

// Partida que se puede continuar y aún no ha terminado (la que ofrece «Continuar» y la que se perdería al empezar otra).
export function partidaAMedias(p) {
  return partidaReanudable(p) && p.turno.fase !== FASE.FIN;
}

// Claves de quienes están en la partida a medias (jugadores y narrador): no se pueden olvidar mientras tanto.
export function clavesEnPartida(p) {
  if (!partidaAMedias(p)) return new Set();
  return new Set([...p.jugadores.map((j) => j.clave), ...(p.narrador ? [p.narrador.clave] : [])]);
}

export function indiceLector(partida) {
  return (partida.idx + 1) % partida.jugadores.length;
}

// Quien lee la pregunta: el narrador, si lo hay (no juega y el móvil no se pasa), o el siguiente jugador.
function lectorDelTurno(partida) {
  return partida.narrador ?? partida.jugadores[indiceLector(partida)];
}

function modo(partida) {
  return partida.narrador ? "narrador" : "pasar";
}

function contextoSeleccion(partida, ctx) {
  return { vistas: ctx.vistasDe(partida.turno?.jugador ?? partida.jugadores[partida.idx].clave), usadas: new Set(partida.usadas), rng: ctx.rng };
}

function prepararTurno(partida, ctx) {
  const j = partida.jugadores[partida.idx];
  const lector = lectorDelTurno(partida);
  const categorias = ctx.config.categorias.map((c) => c.id);
  const turno = {
    fase: FASE.ANUNCIO,
    jugador: j.clave,
    lector: lector.clave,
    esFinal: false,
    salida: false,
    nivelFinal: null,
    ventaja: null,
    rebajaFinal: 0, // escalones que baja la final por las ya falladas
    categoria: null,
    subtema: null,
    apuesta: null,
    pregunta: null,
    preguntaDatos: null,
    alternativa: null,
    acierto: null,
    posAntes: null,
    posDespues: null,
    valoracion: null,
    mala: null,
    cronometro: null, // segundos para responder, si la pregunta lleva cronómetro (en una ronda, siempre)
    tiempoAgotado: null,
    // Ronda divertida (en una casilla especial): en vez de pregunta y apuesta.
    ronda: null,
    rondaDatos: null,
    marcados: [], // índices de los elementos acertados
    extra: 0, // en una lista abierta: respuestas que valen y no están en la lista de referencia
    indice: 0, // en una ráfaga: la descripción que toca
    aciertos: null,
    // Final propia (app/data/finales.json): una pregunta o un reto «acierta k de n», sin categoría.
    final: null,
    finalDatos: null,
    reto: false,
    // Pregunta de mapa: el punto señalado, a cuántos km quedó y cuántos puntos sumó.
    mapa: null,
  };
  partida.turno = turno;
  if (j.pos >= partida.meta) {
    const { nivel, ventaja, rebaja } = calcularFinal(partida.jugadores, partida.idx, partida.pasoFinal, ctx.config.final);
    Object.assign(turno, { esFinal: true, nivelFinal: nivel, ventaja, rebajaFinal: rebaja });
    // Con finales propias, la final no tiene categoría y se elige al empezar (como las preguntas, tras la apuesta).
    if (ctx.finales?.length) return;
    turno.categoria = elegir(categorias, ctx.rng);
  } else {
    const enCasilla = partida.tablero[j.pos];
    Object.assign(turno, { salida: enCasilla == null, categoria: enCasilla ?? elegir(categorias, ctx.rng) });
    // En una casilla especial toca ronda; si no hay ninguna (archivo sin cargar), pregunta normal.
    if (partida.especiales?.includes(j.pos) && asignarRonda(partida, ctx)) return;
  }
  turno.subtema = elegirSubtema(ctx.indice, turno.categoria, contextoSeleccion(partida, ctx));
}

// El turno guarda una copia de la ronda, como de la pregunta: la partida guardada no depende del archivo.
const CAMPOS_RONDA = ["id", "v", "tipo", "titulo", "enunciado", "segundos", "cerrada", "nota", "elementos"];

function asignarRonda(partida, ctx, excluir = new Set()) {
  const t = partida.turno;
  const r = elegirRonda(ctx.rondas ?? [], contextoSeleccion(partida, ctx), excluir);
  if (!r) return false;
  t.ronda = r.ronda.id;
  t.rondaDatos = clonar(Object.fromEntries(CAMPOS_RONDA.map((k) => [k, r.ronda[k] ?? null])));
  t.alternativa = r.repetida ? "repetida" : null;
  t.cronometro = r.ronda.segundos; // la ronda siempre va con tiempo: es lo que pone el tope
  t.tiempoAgotado = null;
  t.marcados = [];
  t.extra = 0;
  t.indice = 0;
  partida.usadas.push(r.ronda.id);
  return true;
}

// La copia de la final propia que guarda el turno.
const CAMPOS_FINAL = ["id", "v", "nivel", "tipo", "titulo", "pregunta", "respuesta", "tambien_vale", "criterio", "explicacion", "enunciado", "minimo", "segundos", "nota", "elementos"];

function asignarFinal(partida, ctx, excluir = new Set()) {
  const t = partida.turno;
  const r = elegirFinal(ctx.finales ?? [], t.nivelFinal, contextoSeleccion(partida, ctx), excluir);
  exigir(r, "No hay preguntas finales.");
  const f = r.final;
  t.final = f.id;
  t.finalDatos = clonar(Object.fromEntries(CAMPOS_FINAL.map((k) => [k, f[k] ?? null])));
  t.alternativa = r.alternativa;
  t.tiempoAgotado = null;
  t.marcados = [];
  t.indice = 0;
  t.extra = 0;
  partida.usadas.push(f.id);
  if (f.tipo === "reto") {
    // Un reto siempre va con tiempo, como una ráfaga: es lo que lo hace difícil.
    Object.assign(t, { reto: true, pregunta: null, preguntaDatos: null, cronometro: f.segundos });
  } else {
    // Una final que es una pregunta se juega como las demás; su tiempo (si lo tiene) sigue la opción de cronómetro.
    t.reto = false;
    t.pregunta = f.id;
    t.preguntaDatos = {
      id: f.id, v: f.v, categoria: null, subtema: null, nivel: f.nivel, nivelEfectivo: f.nivel, pregunta: f.pregunta,
      respuesta: f.respuesta, tambien_vale: f.tambien_vale ?? [], criterio: f.criterio ?? null, explicacion: f.explicacion ?? null,
    };
    t.cronometro = partida.cronometro && f.segundos ? f.segundos : null;
  }
}

// Lo que se ha visto en el turno: la pregunta, la ronda o la final propia.
const vistoEnTurno = (t) => t.ronda ?? t.final ?? t.pregunta;

export function nuevaPartida({ id, jugadores, metaId, narrador = null, cronometro = false, rondas = false }, ctx) {
  const { config } = ctx;
  exigir(jugadores.length >= config.jugadores.min && jugadores.length <= config.jugadores.max, `Hacen falta entre ${config.jugadores.min} y ${config.jugadores.max} jugadores.`);
  const claves = jugadores.map((j) => j.clave);
  exigir(claves.every((c) => c), "Todos los jugadores necesitan un nombre.");
  exigir(new Set(claves).size === claves.length, "Hay dos jugadores con el mismo nombre.");
  if (narrador) {
    exigir(narrador.clave, "El narrador necesita un nombre.");
    exigir(!claves.includes(narrador.clave), "Quien narra no juega: no puede estar también entre los jugadores.");
  }
  const meta = config.metas.find((m) => m.id === metaId);
  exigir(meta, `Meta desconocida: ${metaId}`);

  const partida = {
    formato: 1,
    id,
    creada: ctx.ahora(),
    terminada: null,
    metaId: meta.id,
    meta: meta.puntos,
    pasoFinal: meta.paso_final,
    tablero: generarTablero(meta.puntos, config.categorias.map((c) => c.id), ctx.rng),
    // Casillas con ronda divertida (si se han activado y hay rondas que jugar).
    especiales: rondas && ctx.rondas?.length ? generarEspeciales(meta.puntos, config.rondas?.cada, ctx.rng) : [],
    jugadores: jugadores.map((j) => ({ clave: j.clave, nombre: j.nombre, pos: 0, aciertos: 0, fallos: 0, sumaApuestas: 0, nApuestas: 0, mejorAcierto: 0, rondas: 0, casillasRonda: 0, finalesFalladas: 0 })),
    narrador: narrador ? { clave: narrador.clave, nombre: narrador.nombre } : null,
    cronometro: Boolean(cronometro), // cronómetro en las categorías de config.cronometro
    rondas: Boolean(rondas),
    idx: 0,
    n: 1,
    usadas: [],
    ganador: null,
    turno: null,
  };
  prepararTurno(partida, ctx);
  return { partida, registros: [], vistas: [] };
}

// El turno guarda una copia de la pregunta: así una partida guardada sigue
// funcionando aunque el banco cambie (pregunta editada o retirada) antes de reanudarla.
const CAMPOS_COPIADOS = ["id", "v", "categoria", "subtema", "nivel", "nivelEfectivo", "tipo", "pregunta", "respuesta", "tambien_vale", "criterio", "explicacion",
  "lat", "lon", "distancia_max_km", "vista"];

function camposPregunta(turno) {
  const p = turno.preguntaDatos;
  return { pregunta: p.id, v: p.v, categoria: p.categoria, subtema: p.subtema, nivel_inicial: p.nivel, nivel_mostrado: p.nivelEfectivo };
}

function asignarPregunta(partida, ctx, excluir = new Set()) {
  const t = partida.turno;
  if (t.esFinal && ctx.finales?.length) return asignarFinal(partida, ctx, excluir);
  if (!t.categoria) {
    // Una final pensada para finales propias, reanudada sin ellas (el archivo no cargó): una del banco, como antes.
    t.categoria = elegir(ctx.config.categorias.map((c) => c.id), ctx.rng);
    t.subtema = elegirSubtema(ctx.indice, t.categoria, contextoSeleccion(partida, ctx));
  }
  const r = elegirPregunta(ctx.indice, { categoria: t.categoria, subtema: t.subtema, nivel: t.apuesta }, contextoSeleccion(partida, ctx));
  exigir(r, `No hay preguntas de la categoría ${t.categoria}.`);
  t.pregunta = r.pregunta.id;
  t.preguntaDatos = Object.fromEntries(CAMPOS_COPIADOS.map((k) => [k, r.pregunta[k] ?? null]));
  t.alternativa = r.alternativa;
  // Una pregunta nueva (también al cambiarla) trae su propio tiempo, según su nivel.
  t.cronometro = partida.cronometro ? segundosCronometro(ctx.config, r.pregunta.categoria, r.pregunta.nivelEfectivo) : null;
  t.tiempoAgotado = null;
  partida.usadas.push(r.pregunta.id);
}

export function apostar(partida0, apuesta, ctx) {
  const partida = clonar(partida0);
  const t = partida.turno;
  exigir(t.fase === FASE.ANUNCIO, "Ahora no toca apostar.");
  exigir(!t.ronda, "En una ronda no se apuesta: avanzas tantas casillas como aciertes.");
  const { min, max } = ctx.config.niveles;
  if (t.esFinal) exigir(apuesta === t.nivelFinal, "En la final el nivel no se elige.");
  else exigir(Number.isInteger(apuesta) && apuesta >= min && apuesta <= max, `La apuesta va del ${min} al ${max}.`);
  t.apuesta = apuesta;
  asignarPregunta(partida, ctx);
  if (partida.narrador) {
    // El narrador ya tiene el móvil: ve la pregunta en cuanto se apuesta.
    t.fase = FASE.LECTURA;
    return { partida, registros: [], vistas: [[t.jugador, vistoEnTurno(t)], [t.lector, vistoEnTurno(t)]] };
  }
  t.fase = FASE.PASAR;
  return { partida, registros: [], vistas: [] };
}

export function empezarLectura(partida0) {
  const partida = clonar(partida0);
  const t = partida.turno;
  exigir(t.fase === FASE.PASAR, "Ahora no toca leer.");
  t.fase = FASE.LECTURA;
  return { partida, registros: [], vistas: [[t.jugador, vistoEnTurno(t)], [t.lector, vistoEnTurno(t)]] };
}

// `tiempoAgotado`: si la pregunta llevaba cronómetro, si se acabó el tiempo antes de ver la respuesta.
export function revelar(partida0, { tiempoAgotado = false } = {}) {
  const partida = clonar(partida0);
  const t = partida.turno;
  exigir(t.fase === FASE.LECTURA && !t.ronda && !t.reto, "Ahora no toca ver la respuesta.");
  exigir(t.preguntaDatos?.tipo !== "mapa", "Esta pregunta se responde señalando en el mapa.");
  if (t.cronometro) t.tiempoAgotado = Boolean(tiempoAgotado);
  t.fase = FASE.RESPUESTA;
  return { partida, registros: [], vistas: [] };
}

export function otraPregunta(partida0, motivo, ctx) {
  const partida = clonar(partida0);
  const t = partida.turno;
  exigir((t.fase === FASE.LECTURA || t.fase === FASE.RESPUESTA) && !t.ronda, "Ahora no se puede cambiar la pregunta.");
  exigir(ctx.config.motivos_anulacion.some((m) => m.id === motivo), `Motivo desconocido: ${motivo}`);
  const comun = { ts: ctx.ahora(), partida: partida.id, turno: partida.n, jugador: t.jugador, lector: t.lector, modo: modo(partida), motivo,
                  momento: t.fase === FASE.LECTURA ? "antes" : "despues" };
  // Una final propia anulada va aparte: no es una pregunta del banco.
  const registro = t.final
    ? { tipo: "final_anulada", ...comun, final: t.final, v: t.finalDatos.v, nivel: t.finalDatos.nivel }
    : { tipo: "anulacion", ...comun, ...camposPregunta(t) };
  asignarPregunta(partida, ctx, new Set(t.final ? [t.final] : []));
  t.fase = FASE.LECTURA;
  return { partida, registros: [registro], vistas: [[t.jugador, vistoEnTurno(t)], [t.lector, vistoEnTurno(t)]] };
}

export function juzgar(partida0, acierto) {
  const partida = clonar(partida0);
  const t = partida.turno;
  exigir(t.fase === FASE.RESPUESTA, "Ahora no toca juzgar.");
  exigir(typeof acierto === "boolean", "El juicio es acierto o fallo.");
  aplicarJuicio(partida, acierto);
  return { partida, registros: [], vistas: [] };
}

// Pregunta de mapa: quien juega señala un punto y la app lo puntúa por la distancia. Suma lo
// arriesgado menos un punto por cada paso de distancia, y nada fuera de la zona de acierto (ver
// geo.js); para el modelo de niveles y para ganar la final cuenta como acierto quedarse dentro.
export function senalar(partida0, punto, ctx) {
  const partida = clonar(partida0);
  const t = partida.turno;
  const q = t.preguntaDatos;
  exigir(t.fase === FASE.LECTURA && q?.tipo === "mapa", "Ahora no toca señalar en el mapa.");
  const { lat, lon } = punto ?? {};
  exigir(Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180, "Ese punto no está en el mapa.");
  const distancia = distanciaKm({ lat, lon }, q);
  const fraccion = ctx.config.mapa?.acierto_fraccion ?? 0.5;
  const acierto = aciertoMapa(distancia, q.distancia_max_km, fraccion);
  const puntos = t.esFinal ? null : puntosMapa(distancia, t.apuesta, q.distancia_max_km, fraccion);
  const redondear = (x) => Math.round(x * 10000) / 10000;
  t.mapa = { lat: redondear(lat), lon: redondear(lon), distancia_km: Math.round(distancia), puntos };
  aplicarJuicio(partida, acierto, puntos ?? 0);
  return { partida, registros: [], vistas: [] };
}

// El resultado de una pregunta (o de un reto final): avanza, o gana si era la final. Una pregunta
// de mapa avanza lo que haya puntuado (`avance`), aunque no llegue a contar como acierto.
function aplicarJuicio(partida, acierto, avance = acierto ? partida.turno.apuesta : 0) {
  const t = partida.turno;
  const j = partida.jugadores[partida.idx];
  t.acierto = acierto;
  t.posAntes = j.pos;
  if (!t.esFinal) {
    // La apuesta media solo cuenta los niveles que elige el jugador, no los de la final.
    j.sumaApuestas += t.apuesta;
    j.nApuestas = (j.nApuestas ?? 0) + 1;
  }
  if (acierto) {
    j.aciertos++;
    j.mejorAcierto = Math.max(j.mejorAcierto, t.apuesta);
    if (t.esFinal) partida.ganador = j.clave;
  } else {
    j.fallos++;
    if (t.esFinal) j.finalesFalladas = (j.finalesFalladas ?? 0) + 1;
  }
  if (!t.esFinal) j.pos = Math.min(partida.meta, j.pos + avance);
  t.posDespues = j.pos;
  t.fase = FASE.RESULTADO;
}

export function valorar(partida0, valoracion) {
  const partida = clonar(partida0);
  exigir(partida.turno.fase === FASE.RESULTADO && !partida.turno.ronda && !partida.turno.reto, "Ahora no toca valorar.");
  exigir([null, "facil", "justa", "dificil"].includes(valoracion), `Valoración desconocida: ${valoracion}`);
  partida.turno.valoracion = valoracion;
  return { partida, registros: [], vistas: [] };
}

export function marcarMala(partida0, motivo, ctx) {
  const partida = clonar(partida0);
  exigir(partida.turno.fase === FASE.RESULTADO, "Ahora no se puede marcar la pregunta.");
  exigir(motivo === null || ctx.config.motivos_mala.some((m) => m.id === motivo), `Motivo desconocido: ${motivo}`);
  partida.turno.mala = motivo;
  return { partida, registros: [], vistas: [] };
}

// ---------------------------------------------------------------- rondas divertidas
// Quien lee ve la lista (o la descripción y su respuesta), pone el tiempo y va marcando lo que se
// acierta. Al terminar, quien juega avanza una casilla por acierto (como mucho, hasta la meta).

function exigirRonda(t, tipo = null) {
  exigir(t.ronda && t.fase === FASE.LECTURA && (!tipo || t.rondaDatos.tipo === tipo), "Ahora no se puede hacer eso en la ronda.");
}

export function empezarRonda(partida0) {
  const partida = clonar(partida0);
  const t = partida.turno;
  exigir(t.ronda && t.fase === FASE.ANUNCIO, "Ahora no toca empezar una ronda.");
  if (partida.narrador) {
    t.fase = FASE.LECTURA;
    return { partida, registros: [], vistas: [[t.jugador, t.ronda], [t.lector, t.ronda]] };
  }
  t.fase = FASE.PASAR;
  return { partida, registros: [], vistas: [] };
}

// Lista: marca o desmarca un elemento dicho.
export function marcarElemento(partida0, i) {
  const partida = clonar(partida0);
  const t = partida.turno;
  exigirRonda(t, "lista");
  exigir(Number.isInteger(i) && i >= 0 && i < t.rondaDatos.elementos.length, "Ese elemento no está en la lista.");
  t.marcados = t.marcados.includes(i) ? t.marcados.filter((x) => x !== i) : [...t.marcados, i];
  return { partida, registros: [], vistas: [] };
}

// Lista abierta: una respuesta que el grupo da por buena aunque no esté en la lista de referencia (o quitarla).
export function contarOtro(partida0, delta) {
  const partida = clonar(partida0);
  const t = partida.turno;
  exigirRonda(t, "lista");
  exigir(!t.rondaDatos.cerrada, "En una lista cerrada solo cuentan los de la lista.");
  exigir(delta === 1 || delta === -1, "Se cuenta de uno en uno.");
  t.extra = Math.max(0, t.extra + delta);
  return { partida, registros: [], vistas: [] };
}

// Ráfaga (o reto final, que se juega igual): la descripción actual, acertada o pasada; se va a la siguiente.
export function marcarRafaga(partida0, acierto) {
  const partida = clonar(partida0);
  const t = partida.turno;
  if (t.reto) exigir(t.fase === FASE.LECTURA, "Ahora no se puede hacer eso en el reto.");
  else exigirRonda(t, "rafaga");
  exigir(typeof acierto === "boolean", "Acertada o pasada.");
  exigir(t.indice < (t.reto ? t.finalDatos : t.rondaDatos).elementos.length, "No quedan más descripciones.");
  if (acierto) t.marcados = [...t.marcados, t.indice];
  t.indice++;
  return { partida, registros: [], vistas: [] };
}

// Reto final: se gana si se llega al mínimo de aciertos («acierta 4 de 5») antes de que se acabe el tiempo.
export function terminarReto(partida0, { tiempoAgotado = false } = {}) {
  const partida = clonar(partida0);
  const t = partida.turno;
  exigir(t.reto && t.fase === FASE.LECTURA, "Ahora no toca terminar el reto.");
  t.aciertos = t.marcados.length;
  t.tiempoAgotado = Boolean(tiempoAgotado);
  aplicarJuicio(partida, t.aciertos >= t.finalDatos.minimo);
  return { partida, registros: [], vistas: [] };
}

export function terminarRonda(partida0, { tiempoAgotado = false } = {}) {
  const partida = clonar(partida0);
  const t = partida.turno;
  exigirRonda(t);
  const j = partida.jugadores[partida.idx];
  t.aciertos = t.marcados.length + t.extra;
  t.tiempoAgotado = Boolean(tiempoAgotado);
  t.posAntes = j.pos;
  j.pos = Math.min(partida.meta, j.pos + t.aciertos);
  t.posDespues = j.pos;
  j.rondas = (j.rondas ?? 0) + 1;
  j.casillasRonda = (j.casillasRonda ?? 0) + (t.posDespues - t.posAntes);
  t.fase = FASE.RESULTADO;
  return { partida, registros: [], vistas: [] };
}

export function cambiarRonda(partida0, motivo, ctx) {
  const partida = clonar(partida0);
  const t = partida.turno;
  exigirRonda(t);
  exigir(ctx.config.motivos_anulacion.some((m) => m.id === motivo), `Motivo desconocido: ${motivo}`);
  const registro = {
    tipo: "ronda_anulada",
    ts: ctx.ahora(),
    partida: partida.id,
    turno: partida.n,
    jugador: t.jugador,
    lector: t.lector,
    modo: modo(partida),
    ronda: t.ronda,
    v: t.rondaDatos.v,
    motivo,
  };
  exigir(asignarRonda(partida, ctx, new Set([t.ronda])), "No quedan otras rondas.");
  return { partida, registros: [registro], vistas: [[t.jugador, t.ronda], [t.lector, t.ronda]] };
}

function registroRonda(partida, t, ctx) {
  const r = t.rondaDatos;
  return {
    tipo: "ronda",
    ts: ctx.ahora(),
    partida: partida.id,
    turno: partida.n,
    jugador: t.jugador,
    lector: t.lector,
    modo: modo(partida),
    ronda: r.id,
    v: r.v,
    tipo_ronda: r.tipo,
    segundos: r.segundos,
    total: r.elementos.length, // elementos de la lista o descripciones de la ráfaga
    leidos: r.tipo === "rafaga" ? t.indice : null, // descripciones a las que dio tiempo
    marcados: [...t.marcados].sort((a, b) => a - b),
    extra: t.extra,
    aciertos: t.aciertos,
    alternativa: t.alternativa,
    tiempo_agotado: t.tiempoAgotado,
    mala: t.mala,
  };
}

// Una final propia jugada: va aparte de las respuestas porque no entra en el modelo de niveles.
function registroFinal(partida, t, ctx) {
  const f = t.finalDatos;
  return {
    tipo: "final",
    ts: ctx.ahora(),
    partida: partida.id,
    turno: partida.n,
    jugador: t.jugador,
    lector: t.lector,
    modo: modo(partida),
    final: f.id,
    v: f.v,
    tipo_final: f.tipo,
    nivel: f.nivel,
    nivel_pedido: t.nivelFinal, // el que tocaba por la ventaja y la rebaja (puede no haber quedado ninguna nueva de ese nivel)
    ventaja: t.ventaja,
    rebaja: t.rebajaFinal ?? 0, // escalones que bajó por las finales que ya había fallado

    alternativa: t.alternativa,
    cronometro: t.cronometro ?? null,
    tiempo_agotado: t.tiempoAgotado ?? null,
    acierto: t.acierto,
    // En un reto: cuántas acertó, cuántas necesitaba, de cuántas, a cuántas dio tiempo y cuáles.
    aciertos: t.reto ? t.aciertos : null,
    minimo: t.reto ? f.minimo : null,
    total: t.reto ? f.elementos.length : null,
    leidos: t.reto ? t.indice : null,
    marcados: t.reto ? [...t.marcados].sort((a, b) => a - b) : null,
    valoracion: t.valoracion,
    mala: t.mala,
  };
}

export function cerrarTurno(partida0, ctx) {
  const partida = clonar(partida0);
  const t = partida.turno;
  exigir(t.fase === FASE.RESULTADO, "El turno aún no está juzgado.");
  const registro = t.ronda ? registroRonda(partida, t, ctx) : t.final ? registroFinal(partida, t, ctx) : {
    tipo: "respuesta",
    ts: ctx.ahora(),
    partida: partida.id,
    turno: partida.n,
    jugador: t.jugador,
    lector: t.lector,
    modo: modo(partida),
    ...camposPregunta(t),
    subtema_anunciado: t.subtema,
    apuesta: t.apuesta,
    es_final: t.esFinal,
    alternativa: t.alternativa,
    cronometro: t.cronometro ?? null,
    tiempo_agotado: t.tiempoAgotado ?? null,
    acierto: t.acierto,
    valoracion: t.valoracion,
    mala: t.mala,
    // Pregunta de mapa: el punto señalado, la distancia al correcto, la máxima y los puntos sumados.
    ...(t.mapa
      ? { lat_senalada: t.mapa.lat, lon_senalada: t.mapa.lon, distancia_km: t.mapa.distancia_km, distancia_max_km: t.preguntaDatos.distancia_max_km, puntos: t.mapa.puntos }
      : {}),
  };
  if (partida.ganador) {
    t.fase = FASE.FIN;
    partida.terminada = ctx.ahora();
  } else {
    partida.idx = (partida.idx + 1) % partida.jugadores.length;
    partida.n++;
    prepararTurno(partida, ctx);
  }
  return { partida, registros: [registro], vistas: [] };
}
