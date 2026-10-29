import { test } from "node:test";
import assert from "node:assert/strict";
import { rngConSemilla } from "../app/js/azar.js";
import * as M from "../app/js/motor.js";
import { JUGADORES, config, contexto, responder, sinMapa } from "./ayudas.js";

const CATS = config.categorias.map((c) => c.id);

function partidaNueva(ctx = contexto(), jugadores = JUGADORES, metaId = "corta") {
  return M.nuevaPartida({ id: "p1", jugadores, metaId }, ctx).partida;
}

// Juega el turno actual hasta el resultado (sin cerrarlo).
function jugarHastaResultado(p, ctx, { apuesta = 3, acierto = true } = {}) {
  const nivel = p.turno.esFinal ? p.turno.nivelFinal : apuesta;
  p = M.apostar(p, nivel, ctx).partida;
  p = M.empezarLectura(p).partida;
  return responder(p, ctx, acierto);
}

test("el tablero empieza en la salida, cubre la meta y no repite categoría en casillas seguidas", () => {
  for (let s = 0; s < 200; s++) {
    for (const meta of [25, 50]) {
      const t = M.generarTablero(meta, CATS, rngConSemilla(s));
      assert.equal(t.length, meta);
      assert.equal(t[0], null);
      for (let i = 2; i < t.length; i++) assert.notEqual(t[i], t[i - 1], `semilla ${s}, casilla ${i}`);
      // Cada bloque de tantas casillas como categorías (desde la 1) las tiene todas.
      const n = CATS.length;
      for (let i = 1; i + n <= t.length; i += n) assert.equal(new Set(t.slice(i, i + n)).size, n);
    }
  }
});

test("nueva partida: valida jugadores y meta", () => {
  const ctx = contexto();
  assert.throws(() => M.nuevaPartida({ id: "x", jugadores: [JUGADORES[0]], metaId: "corta" }, ctx), M.ErrorJuego);
  const siete = Array.from({ length: 7 }, (_, i) => ({ clave: `j${i}`, nombre: `J${i}` }));
  assert.throws(() => M.nuevaPartida({ id: "x", jugadores: siete, metaId: "corta" }, ctx), M.ErrorJuego);
  assert.throws(() => M.nuevaPartida({ id: "x", jugadores: [JUGADORES[0], JUGADORES[0]], metaId: "corta" }, ctx), /mismo nombre/);
  assert.throws(() => M.nuevaPartida({ id: "x", jugadores: JUGADORES, metaId: "eterna" }, ctx), /Meta desconocida/);
  const p = partidaNueva(ctx, JUGADORES, "media");
  assert.equal(p.meta, 50);
  assert.equal(p.pasoFinal, 8);
});

test("primer turno: salida con categoría al azar, subtema anunciado y lector = siguiente jugador", () => {
  const p = partidaNueva();
  assert.equal(p.turno.fase, M.FASE.ANUNCIO);
  assert.equal(p.turno.salida, true);
  assert.ok(CATS.includes(p.turno.categoria));
  const subs = config.categorias.find((c) => c.id === p.turno.categoria).subtemas.map((s) => s.id);
  assert.ok(subs.includes(p.turno.subtema));
  assert.equal(p.turno.jugador, "ana");
  assert.equal(p.turno.lector, "luis");
});

test("con dos jugadores, cada uno lee las preguntas del otro", () => {
  const ctx = contexto();
  let p = partidaNueva(ctx, JUGADORES.slice(0, 2));
  assert.equal(p.turno.lector, "luis");
  p = M.cerrarTurno(jugarHastaResultado(p, ctx), ctx).partida;
  assert.equal(p.turno.jugador, "luis");
  assert.equal(p.turno.lector, "ana");
});

test("turno completo: acierto avanza lo apostado y deja un registro completo", () => {
  const ctx = contexto();
  const p0 = sinMapa(partidaNueva(ctx));
  let r = M.apostar(p0, 6, ctx);
  assert.equal(p0.turno.fase, M.FASE.ANUNCIO, "la partida original no cambia");
  assert.equal(r.partida.turno.fase, M.FASE.PASAR);
  const preguntaId = r.partida.turno.pregunta;
  assert.equal(ctx.indice.porId.get(preguntaId).nivelEfectivo, 6);

  r = M.empezarLectura(r.partida);
  assert.deepEqual(r.vistas, [["ana", preguntaId], ["luis", preguntaId]]);
  r = M.revelar(r.partida);
  r = M.juzgar(r.partida, true);
  assert.equal(r.partida.jugadores[0].pos, 6);
  assert.equal(r.partida.turno.posAntes, 0);
  assert.equal(r.partida.turno.posDespues, 6);
  r = M.valorar(r.partida, "dificil");
  r = M.marcarMala(r.partida, "ambigua", ctx);
  r = M.cerrarTurno(r.partida, ctx);

  assert.equal(r.registros.length, 1);
  const reg = r.registros[0];
  assert.equal(reg.tipo, "respuesta");
  assert.equal(reg.jugador, "ana");
  assert.equal(reg.lector, "luis");
  assert.equal(reg.pregunta, preguntaId);
  assert.equal(reg.apuesta, 6);
  assert.equal(reg.nivel_mostrado, 6);
  assert.equal(reg.nivel_inicial, 6);
  assert.equal(reg.acierto, true);
  assert.equal(reg.valoracion, "dificil");
  assert.equal(reg.mala, "ambigua");
  assert.equal(reg.es_final, false);
  assert.equal(reg.turno, 1);
  assert.ok(reg.subtema_anunciado);

  assert.equal(r.partida.idx, 1);
  assert.equal(r.partida.n, 2);
  assert.equal(r.partida.turno.jugador, "luis");
  assert.equal(r.partida.turno.lector, "marta");
});

test("fallo: no se avanza", () => {
  const ctx = contexto();
  const p = jugarHastaResultado(partidaNueva(ctx), ctx, { apuesta: 9, acierto: false });
  assert.equal(p.jugadores[0].pos, 0);
  assert.equal(p.jugadores[0].fallos, 1);
});

test("la categoría del turno es la de la casilla en la que estás", () => {
  const ctx = contexto();
  let p = partidaNueva(ctx);
  p = M.cerrarTurno(jugarHastaResultado(p, ctx, { apuesta: 5 }), ctx).partida; // Ana a la 5
  p = M.cerrarTurno(jugarHastaResultado(p, ctx, { acierto: false }), ctx).partida; // Luis
  p = M.cerrarTurno(jugarHastaResultado(p, ctx, { acierto: false }), ctx).partida; // Marta
  assert.equal(p.turno.jugador, "ana");
  assert.equal(p.turno.salida, false);
  assert.equal(p.turno.categoria, p.tablero[5]);
});

test("no se pasa de la meta", () => {
  const ctx = contexto();
  let p = partidaNueva(ctx);
  p.jugadores[0].pos = 22;
  p = jugarHastaResultado(p, ctx, { apuesta: 10 });
  assert.equal(p.jugadores[0].pos, 25);
});

test("nivel de la final según la ventaja sobre el último", () => {
  const js = (...pos) => pos.map((x) => ({ pos: x }));
  // La fórmula, con otro nivel base: base + 1 por cada paso de ventaja, con tope.
  const base5 = { nivel_base: 5, nivel_max: 10 };
  assert.deepEqual(M.calcularFinal(js(50, 26, 40), 0, 8, base5), { nivel: 8, ventaja: 24, rebaja: 0 });
  assert.deepEqual(M.calcularFinal(js(25, 18), 0, 4, base5), { nivel: 6, ventaja: 7, rebaja: 0 });

  // La del juego (config.json): la final va del 8 al 10.
  const final = config.final;
  // Fase 14: con sus propias finales; desde la fase 16 buscan acertarse un 12, 6 y 3 % de las veces.
  assert.deepEqual(final, { nivel_base: 8, nivel_max: 10, archivo: "data/finales.json", objetivo_acierto: [0.12, 0.06, 0.03] });
  assert.deepEqual(M.calcularFinal(js(50, 50), 0, 8, final), { nivel: 8, ventaja: 0, rebaja: 0 });
  assert.deepEqual(M.calcularFinal(js(50, 43), 0, 8, final), { nivel: 8, ventaja: 7, rebaja: 0 });
  assert.deepEqual(M.calcularFinal(js(50, 42), 0, 8, final), { nivel: 9, ventaja: 8, rebaja: 0 });
  assert.deepEqual(M.calcularFinal(js(50, 26, 40), 0, 8, final), { nivel: 10, ventaja: 24, rebaja: 0 });
  assert.deepEqual(M.calcularFinal(js(50, 0, 0), 0, 8, final), { nivel: 10, ventaja: 50, rebaja: 0 });
  assert.deepEqual(M.calcularFinal(js(25, 18), 0, 4, final), { nivel: 9, ventaja: 7, rebaja: 0 });
  assert.deepEqual(M.calcularFinal(js(25, 25, 3), 1, 4, final), { nivel: 10, ventaja: 22, rebaja: 0 }, "el último de los demás, aunque otro esté en la meta");
});

test("cada final fallada baja un escalón la siguiente, nunca por debajo del nivel base", () => {
  const final = config.final;
  const js = (fallos, ...pos) => pos.map((x, i) => ({ pos: x, finalesFalladas: i === 0 ? fallos : 0 }));
  assert.deepEqual(M.calcularFinal(js(1, 50, 0), 0, 8, final), { nivel: 9, ventaja: 50, rebaja: 1 });
  assert.deepEqual(M.calcularFinal(js(2, 50, 0), 0, 8, final), { nivel: 8, ventaja: 50, rebaja: 2 });
  assert.deepEqual(M.calcularFinal(js(5, 50, 0), 0, 8, final), { nivel: 8, ventaja: 50, rebaja: 2 }, "no baja del 8");
  assert.deepEqual(M.calcularFinal(js(3, 50, 50), 0, 8, final), { nivel: 8, ventaja: 0, rebaja: 0 }, "en el 8 no hay nada que rebajar");

  // En partida: Ana falla la final de nivel 10, la siguiente es de 9 y luego de 8; se registra la rebaja.
  const ctx = contexto();
  let p = partidaNueva(ctx, JUGADORES.slice(0, 2));
  p.jugadores[0].pos = 25;
  assert.equal(p.turno.esFinal, false, "el turno ya estaba preparado al crear la partida");
  p = M.cerrarTurno(jugarHastaResultado(p, ctx, { acierto: false }), ctx).partida; // Ana falla su pregunta
  p = M.cerrarTurno(jugarHastaResultado(p, ctx, { acierto: false }), ctx).partida; // Luis falla
  for (const [nivel, rebaja] of [[10, 0], [9, 1], [8, 2], [8, 2]]) {
    assert.equal(p.turno.esFinal, true);
    assert.deepEqual([p.turno.nivelFinal, p.turno.rebajaFinal], [nivel, rebaja]);
    const r = M.cerrarTurno(jugarHastaResultado(p, ctx, { acierto: false }), ctx);
    assert.equal(r.registros[0].apuesta, nivel);
    p = M.cerrarTurno(jugarHastaResultado(r.partida, ctx, { acierto: false }), ctx).partida; // Luis falla
  }
  assert.equal(p.jugadores[0].finalesFalladas, 4);
});

test("final: se juega en el turno siguiente a llegar, fallarla obliga a repetirla y acertarla gana", () => {
  const ctx = contexto();
  let p = partidaNueva(ctx, JUGADORES.slice(0, 2));
  p.jugadores[0].pos = 20;
  p.jugadores[1].pos = 10;
  p = M.cerrarTurno(jugarHastaResultado(p, ctx, { apuesta: 5 }), ctx).partida; // Ana llega a 25
  assert.equal(p.jugadores[0].pos, 25);
  assert.equal(p.ganador, null, "llegar a la meta no gana");
  p = M.cerrarTurno(jugarHastaResultado(p, ctx, { acierto: false }), ctx).partida; // Luis falla (sigue en 10)

  assert.equal(p.turno.jugador, "ana");
  assert.equal(p.turno.esFinal, true);
  assert.equal(p.turno.nivelFinal, 10); // ventaja 15, paso 4 → 8 + 3, máximo 10
  assert.throws(() => M.apostar(p, 3, ctx), /final/);

  p = jugarHastaResultado(p, ctx, { acierto: false });
  assert.equal(p.ganador, null);
  let r = M.cerrarTurno(p, ctx);
  assert.equal(r.registros[0].es_final, true);
  assert.equal(r.registros[0].apuesta, 10);
  p = r.partida;
  p = M.cerrarTurno(jugarHastaResultado(p, ctx, { apuesta: 10 }), ctx).partida; // Luis a 20
  assert.equal(p.turno.esFinal, true);
  assert.equal(p.turno.nivelFinal, 8, "la ventaja ha bajado a 5 (8 + 1), y como ya falló una, un escalón menos");

  p = jugarHastaResultado(p, ctx, { acierto: true });
  assert.deepEqual(p.acertantes, ["ana"]);
  r = M.cerrarTurno(p, ctx);
  assert.equal(r.partida.turno.fase, M.FASE.FIN);
  assert.equal(r.partida.ganador, "ana", "Luis no está en la meta: gana Ana al cerrar el turno");
  assert.ok(r.partida.terminada);
});

test("otra pregunta: anula la actual con su motivo y saca otra del mismo pedido", () => {
  const ctx = contexto();
  let p = M.apostar(sinMapa(partidaNueva(ctx)), 4, ctx).partida;
  p = M.empezarLectura(p).partida;
  const primera = p.turno.pregunta;
  let r = M.otraPregunta(p, "conocida", ctx);
  assert.equal(r.registros.length, 1);
  assert.equal(r.registros[0].tipo, "anulacion");
  assert.equal(r.registros[0].pregunta, primera);
  assert.equal(r.registros[0].momento, "antes");
  assert.equal(r.registros[0].motivo, "conocida");
  assert.notEqual(r.partida.turno.pregunta, primera);
  assert.equal(r.partida.turno.fase, M.FASE.LECTURA);
  assert.ok(r.partida.usadas.includes(primera));
  assert.deepEqual(r.vistas.map((v) => v[1]), [r.partida.turno.pregunta, r.partida.turno.pregunta]);

  p = M.revelar(r.partida).partida;
  r = M.otraPregunta(p, "erronea", ctx);
  assert.equal(r.registros[0].momento, "despues");
  assert.throws(() => M.otraPregunta(r.partida, "porque si", ctx), /Motivo/);
});

test("cada acción solo vale en su fase", () => {
  const ctx = contexto();
  const p = partidaNueva(ctx);
  assert.throws(() => M.revelar(p), M.ErrorJuego);
  assert.throws(() => M.juzgar(p, true), M.ErrorJuego);
  assert.throws(() => M.cerrarTurno(p, ctx), M.ErrorJuego);
  assert.throws(() => M.empezarLectura(p), M.ErrorJuego);
  assert.throws(() => M.apostar(p, 0, ctx), M.ErrorJuego);
  assert.throws(() => M.apostar(p, 11, ctx), M.ErrorJuego);
  assert.throws(() => M.apostar(p, 2.5, ctx), M.ErrorJuego);
  const res = jugarHastaResultado(p, ctx);
  assert.throws(() => M.valorar(res, "regular"), M.ErrorJuego);
  assert.throws(() => M.marcarMala(res, "fea", ctx), M.ErrorJuego);
  assert.throws(() => M.otraPregunta(res, "erronea", ctx), M.ErrorJuego);
});

test("una pregunta vista por quien responde no se le vuelve a dar si hay otras", () => {
  const vistas = {};
  const ctx = contexto({ vistas });
  let p = partidaNueva(ctx);
  // Marcamos como vistas por Ana todas las preguntas de nivel 3 excepto una.
  const nivel3 = [...ctx.indice.porId.values()].filter((q) => q.nivelEfectivo === 3);
  const libre = nivel3.find((q) => q.categoria === p.turno.categoria && q.subtema === p.turno.subtema);
  vistas.ana = Object.fromEntries(nivel3.filter((q) => q.id !== libre.id).map((q) => [q.id, "2026-01-01"]));
  p = M.apostar(p, 3, ctx).partida;
  assert.equal(p.turno.pregunta, libre.id);
  assert.equal(p.turno.alternativa, null);
});

test("partidaReanudable acepta partidas válidas y rechaza las rotas o antiguas", () => {
  const ctx = contexto();
  let p = partidaNueva(ctx);
  assert.equal(M.partidaReanudable(p), true);
  p = M.empezarLectura(M.apostar(p, 4, ctx).partida).partida;
  assert.equal(M.partidaReanudable(p), true);
  const sinCopia = structuredClone(p);
  delete sinCopia.turno.preguntaDatos; // guardada por una versión anterior
  assert.equal(M.partidaReanudable(sinCopia), false);
  assert.equal(M.partidaReanudable(null), false);
  assert.equal(M.partidaReanudable({ formato: 2 }), false);
  assert.equal(M.partidaReanudable({ ...p, turno: { ...p.turno, fase: "inventada" } }), false);
  assert.equal(M.partidaReanudable({ ...p, jugadores: [p.jugadores[0]] }), false);
  assert.equal(M.partidaAMedias(p), true);
  assert.equal(M.partidaAMedias(sinCopia), false);
  assert.equal(M.partidaAMedias({ ...p, turno: { fase: M.FASE.FIN } }), false); // terminada
});

test("clavesEnPartida: jugadores y narrador de la partida a medias (no se pueden olvidar mientras)", () => {
  const ctx = contexto();
  const p = partidaNueva(ctx);
  assert.deepEqual([...M.clavesEnPartida(p)].sort(), ["ana", "luis", "marta"]);
  const conNarrador = M.nuevaPartida({ id: "p2", jugadores: JUGADORES.slice(0, 2), metaId: "corta", narrador: { clave: "pepe", nombre: "Pepe" } }, ctx).partida;
  assert.deepEqual([...M.clavesEnPartida(conNarrador)].sort(), ["ana", "luis", "pepe"]);
  assert.equal(M.clavesEnPartida({ ...p, turno: { fase: M.FASE.FIN } }).size, 0, "una terminada no protege a nadie");
  assert.equal(M.clavesEnPartida(null).size, 0);
  assert.equal(M.clavesEnPartida({ formato: 2 }).size, 0);
});

test("la apuesta media solo cuenta las apuestas, no las finales", () => {
  const ctx = contexto();
  let p = partidaNueva(ctx, JUGADORES.slice(0, 2));
  p.jugadores[0].pos = 24;
  p = M.cerrarTurno(jugarHastaResultado(p, ctx, { apuesta: 3 }), ctx).partida; // Ana: apuesta 3, llega a 25
  p = M.cerrarTurno(jugarHastaResultado(p, ctx, { acierto: false, apuesta: 7 }), ctx).partida; // Luis: apuesta 7
  assert.equal(p.turno.esFinal, true);
  p = jugarHastaResultado(p, ctx, { acierto: true }); // Ana acierta la final (nivel 10)
  const ana = p.jugadores[0];
  assert.equal(ana.nApuestas, 1);
  assert.equal(ana.sumaApuestas, 3);
  assert.equal(ana.mejorAcierto, 10, "el mayor acierto sí incluye la final");
  assert.equal(p.jugadores[1].nApuestas, 1);
});

test("con narrador, el móvil no se pasa: quien narra lee todas las preguntas y no juega", () => {
  const ctx = contexto();
  const narrador = { clave: "pepe", nombre: "Pepe" };
  assert.throws(() => M.nuevaPartida({ id: "x", jugadores: JUGADORES, metaId: "corta", narrador: { clave: "ana", nombre: "Ana" } }, ctx), /no juega/);
  let p = M.nuevaPartida({ id: "n1", jugadores: JUGADORES.slice(0, 2), metaId: "corta", narrador }, ctx).partida;
  assert.deepEqual(p.narrador, narrador);
  assert.equal(p.jugadores.length, 2, "el narrador no está entre los jugadores");
  for (let turno = 1; turno <= 4; turno++) {
    assert.equal(p.turno.lector, "pepe", `turno ${turno}: lee el narrador`);
    const r = M.apostar(p, 3, ctx);
    assert.equal(r.partida.turno.fase, M.FASE.LECTURA, "sin la pantalla de pasar el móvil");
    assert.deepEqual(r.vistas, [[p.turno.jugador, r.partida.turno.pregunta], ["pepe", r.partida.turno.pregunta]]);
    const q = responder(r.partida, ctx, turno % 2 === 0);
    const cierre = M.cerrarTurno(q, ctx);
    assert.equal(cierre.registros[0].lector, "pepe");
    assert.equal(cierre.registros[0].modo, "narrador");
    p = cierre.partida;
  }
  // Una anulación también queda apuntada como partida con narrador.
  const lectura = M.apostar(p, 4, ctx).partida;
  const anulacion = M.otraPregunta(lectura, ctx.config.motivos_anulacion[0].id, ctx);
  assert.equal(anulacion.registros[0].modo, "narrador");
  assert.equal(M.partidaReanudable(p), true);
  assert.equal(M.partidaReanudable({ ...p, narrador: { nombre: "Sin clave" } }), false);
  // Sin narrador, como siempre.
  const normal = M.cerrarTurno(jugarHastaResultado(partidaNueva(ctx), ctx), ctx);
  assert.equal(normal.registros[0].modo, "pasar");
  assert.equal(normal.partida.narrador, null);
});

test("cronómetro: solo en las categorías de la configuración, con el tiempo de su nivel, y queda registrado", () => {
  const ctx = contexto();
  const { segundos_por_nivel, categorias } = ctx.config.cronometro;
  // Turno de una categoría con cronómetro y de otra sin él, forzando la categoría del anuncio.
  const conCategoria = (p, categoria) => {
    const q = structuredClone(p);
    q.turno.categoria = categoria;
    q.turno.subtema = ctx.config.categorias.find((c) => c.id === categoria).subtemas[0].id;
    return q;
  };
  const sinReloj = ctx.config.categorias.map((c) => c.id).find((c) => !categorias.includes(c));
  let p = M.nuevaPartida({ id: "c1", jugadores: JUGADORES, metaId: "corta", cronometro: true }, ctx).partida;
  assert.equal(p.cronometro, true);

  let r = M.apostar(conCategoria(p, categorias[0]), 7, ctx);
  const nivel = r.partida.turno.preguntaDatos.nivelEfectivo;
  assert.equal(r.partida.turno.cronometro, segundos_por_nivel[nivel - 1], "el tiempo depende del nivel de la pregunta");
  r = M.empezarLectura(r.partida);
  r = M.revelar(r.partida, { tiempoAgotado: true });
  assert.equal(r.partida.turno.tiempoAgotado, true);
  r = M.cerrarTurno(M.juzgar(r.partida, false).partida, ctx);
  assert.equal(r.registros[0].cronometro, segundos_por_nivel[nivel - 1]);
  assert.equal(r.registros[0].tiempo_agotado, true);

  // Las series numéricas tienen su propia tabla: en los niveles altos, más tiempo que el resto.
  const series = structuredClone(r.partida);
  series.turno.categoria = categorias[0];
  series.turno.subtema = "series_num";
  const s = M.apostar(series, 9, ctx).partida.turno;
  assert.equal(s.preguntaDatos.subtema, "series_num");
  assert.ok(s.preguntaDatos.nivelEfectivo >= 8, "una serie de nivel alto");
  assert.equal(s.cronometro, ctx.config.cronometro.por_subtema.series_num[s.preguntaDatos.nivelEfectivo - 1]);
  assert.ok(s.cronometro > segundos_por_nivel[s.preguntaDatos.nivelEfectivo - 1]);

  p = r.partida;
  r = M.apostar(conCategoria(p, sinReloj), 4, ctx);
  assert.equal(r.partida.turno.cronometro, null, "las demás categorías no llevan cronómetro");
  r = M.revelar(M.empezarLectura(r.partida).partida, { tiempoAgotado: true });
  r = M.cerrarTurno(M.juzgar(r.partida, true).partida, ctx);
  assert.equal(r.registros[0].cronometro, null);
  assert.equal(r.registros[0].tiempo_agotado, null);

  // Sin la opción, nunca hay cronómetro; y una partida guardada antes de existir la opción tampoco lo tiene.
  const sin = M.nuevaPartida({ id: "c2", jugadores: JUGADORES, metaId: "corta" }, ctx).partida;
  assert.equal(M.apostar(conCategoria(sin, categorias[0]), 7, ctx).partida.turno.cronometro, null);
  const antigua = structuredClone(sin);
  delete antigua.cronometro;
  delete antigua.narrador;
  delete antigua.turno.cronometro;
  delete antigua.turno.tiempoAgotado;
  assert.equal(M.partidaReanudable(antigua), true);
  const q = M.apostar(conCategoria(antigua, categorias[0]), 7, ctx).partida;
  assert.equal(q.turno.cronometro, null);
  assert.equal(q.turno.fase, M.FASE.PASAR);
});
