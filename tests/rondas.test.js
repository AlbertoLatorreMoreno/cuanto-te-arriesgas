// Rondas divertidas: casillas especiales, listas y ráfagas, puntuación, cambios y registro.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rngConSemilla } from "../app/js/azar.js";
import { elegirRonda } from "../app/js/banco.js";
import * as M from "../app/js/motor.js";
import { Sesion, almacenEnMemoria } from "../app/js/sesion.js";
import { responder, JUGADORES, config, contexto, rondasSinteticas } from "./ayudas.js";

const RONDAS = rondasSinteticas();
const LISTA = RONDAS.find((r) => r.tipo === "lista" && r.cerrada);
const ABIERTA = RONDAS.find((r) => r.tipo === "lista" && !r.cerrada);
const RAFAGA = RONDAS.find((r) => r.tipo === "rafaga");

// Partida corta con rondas en la que Luis empieza su turno en una casilla especial.
function enRonda({ rondas = RONDAS, narrador = null, vistas = {}, jugadores = JUGADORES.slice(0, 2) } = {}) {
  const ctx = contexto({ rondas, vistas });
  let p = M.nuevaPartida({ id: "p", jugadores, metaId: "corta", narrador, rondas: true }, ctx).partida;
  p.jugadores[1].pos = p.especiales[0];
  // Ana juega su turno (falla) y le toca a Luis.
  p = M.apostar(p, 3, ctx).partida;
  if (!narrador) p = M.empezarLectura(p).partida;
  p = responder(p, ctx, false);
  p = M.cerrarTurno(p, ctx).partida;
  return { p, ctx };
}

function hastaLectura(p) {
  p = M.empezarRonda(p).partida;
  return p.narrador ? p : M.empezarLectura(p).partida;
}

test("casillas especiales: una por cada 8, nunca en la salida, la meta ni seguidas", () => {
  for (let s = 0; s < 500; s++) {
    for (const [meta, n] of [[25, 3], [50, 6]]) {
      const e = M.generarEspeciales(meta, config.rondas.cada, rngConSemilla(s));
      assert.equal(e.length, n, `meta ${meta}, semilla ${s}`);
      e.forEach((c, k) => {
        assert.ok(c >= 2 + 8 * k && c <= 7 + 8 * k, `casilla ${c} fuera de su bloque`);
        if (k) assert.ok(c - e[k - 1] >= 3, "dos casillas especiales casi seguidas");
      });
      assert.ok(e.every((c) => c > 0 && c < meta));
    }
  }
  assert.deepEqual(M.generarEspeciales(25, 0, rngConSemilla(1)), [], "sin un tamaño de bloque válido no hay especiales");
});

test("las rondas se activan al crear la partida y solo si hay rondas que jugar", () => {
  const con = M.nuevaPartida({ id: "a", jugadores: JUGADORES, metaId: "media", rondas: true }, contexto({ rondas: RONDAS })).partida;
  assert.equal(con.especiales.length, 6);
  assert.equal(con.rondas, true);
  assert.equal(con.jugadores[0].casillasRonda, 0);
  const sin = M.nuevaPartida({ id: "b", jugadores: JUGADORES, metaId: "media", rondas: false }, contexto({ rondas: RONDAS })).partida;
  assert.deepEqual(sin.especiales, []);
  const sinArchivo = M.nuevaPartida({ id: "c", jugadores: JUGADORES, metaId: "media", rondas: true }, contexto({ rondas: [] })).partida;
  assert.deepEqual(sinArchivo.especiales, [], "sin rondas cargadas, el tablero es el de siempre");
  // Las casillas especiales se eligen después del tablero: con la misma semilla, las categorías no cambian.
  assert.deepEqual(con.tablero, sin.tablero);
});

test("quien empieza su turno en una casilla especial juega una ronda, sin apuesta", () => {
  const { p, ctx } = enRonda();
  const t = p.turno;
  assert.equal(t.jugador, "luis");
  assert.ok(t.ronda?.startsWith("ron-"));
  assert.equal(t.rondaDatos.id, t.ronda);
  assert.ok(t.rondaDatos.elementos.length >= 6, "el turno guarda una copia de la ronda");
  assert.equal(t.cronometro, t.rondaDatos.segundos, "la ronda siempre va con tiempo, aunque la partida no tenga cronómetro");
  assert.equal(p.cronometro, false);
  assert.ok(p.usadas.includes(t.ronda));
  assert.throws(() => M.apostar(p, 5, ctx), /no se apuesta/);
  assert.ok(M.partidaReanudable(p));
});

test("lista: se marcan y desmarcan los dichos y se avanza una casilla por acierto", () => {
  let { p, ctx } = enRonda({ rondas: [LISTA] });
  p = M.empezarRonda(p).partida;
  assert.equal(p.turno.fase, M.FASE.PASAR);
  const lectura = M.empezarLectura(p);
  assert.deepEqual(lectura.vistas, [["luis", LISTA.id], ["ana", LISTA.id]], "la ronda cuenta como vista para quien juega y quien lee");
  p = lectura.partida;
  for (const i of [0, 2, 2, 3, 5]) p = M.marcarElemento(p, i).partida;
  assert.deepEqual(p.turno.marcados, [0, 3, 5]);
  assert.throws(() => M.marcarElemento(p, 99), /no está en la lista/);
  assert.throws(() => M.contarOtro(p, 1), /cerrada/);
  assert.throws(() => M.marcarRafaga(p, true), /no se puede/);
  assert.throws(() => M.revelar(p), /no toca/);
  assert.throws(() => M.otraPregunta(p, "conocida", ctx), /no se puede/);
  const pos = p.jugadores[1].pos;
  p = M.terminarRonda(p, { tiempoAgotado: true }).partida;
  assert.equal(p.turno.fase, M.FASE.RESULTADO);
  assert.equal(p.turno.aciertos, 3);
  assert.equal(p.jugadores[1].pos, pos + 3);
  assert.equal(p.jugadores[1].casillasRonda, 3);
  assert.throws(() => M.valorar(p, "facil"), /no toca valorar/);
  p = M.marcarMala(p, "aburrida", ctx).partida;
  const r = M.cerrarTurno(p, ctx);
  assert.equal(r.registros.length, 1);
  const reg = r.registros[0];
  assert.equal(reg.tipo, "ronda");
  assert.equal(reg.ronda, LISTA.id);
  assert.equal(reg.tipo_ronda, "lista");
  assert.equal(reg.total, LISTA.elementos.length);
  assert.deepEqual(reg.marcados, [0, 3, 5]);
  assert.equal(reg.aciertos, 3);
  assert.equal(reg.leidos, null);
  assert.equal(reg.tiempo_agotado, true);
  assert.equal(reg.mala, "aburrida");
  assert.equal(reg.segundos, LISTA.segundos);
  assert.equal(r.partida.turno.jugador, "ana");
});

test("lista abierta: cuentan también las que el grupo da por buenas fuera de la lista", () => {
  let { p } = enRonda({ rondas: [ABIERTA] });
  p = hastaLectura(p);
  p = M.marcarElemento(p, 1).partida;
  for (const d of [1, 1, -1, 1]) p = M.contarOtro(p, d).partida;
  assert.equal(p.turno.extra, 2);
  p = M.contarOtro(M.contarOtro(M.contarOtro(p, -1).partida, -1).partida, -1).partida;
  assert.equal(p.turno.extra, 0, "nunca por debajo de 0");
  p = M.contarOtro(p, 1).partida;
  assert.throws(() => M.contarOtro(p, 2), /uno en uno/);
  p = M.terminarRonda(p).partida;
  assert.equal(p.turno.aciertos, 2);
});

test("ráfaga: cada descripción se acierta o se pasa, y no se pasa de la última", () => {
  let { p, ctx } = enRonda({ rondas: [RAFAGA] });
  p = hastaLectura(p);
  for (const a of [true, false, true]) p = M.marcarRafaga(p, a).partida;
  assert.equal(p.turno.indice, 3);
  assert.deepEqual(p.turno.marcados, [0, 2]);
  assert.throws(() => M.marcarElemento(p, 0), /no se puede/);
  while (p.turno.indice < RAFAGA.elementos.length) p = M.marcarRafaga(p, false).partida;
  assert.throws(() => M.marcarRafaga(p, true), /No quedan/);
  p = M.terminarRonda(p).partida;
  const reg = M.cerrarTurno(p, ctx).registros[0];
  assert.equal(reg.tipo_ronda, "rafaga");
  assert.equal(reg.leidos, RAFAGA.elementos.length);
  assert.equal(reg.aciertos, 2);
});

test("una ronda no lleva más allá de la meta, y después toca la final", () => {
  let { p, ctx } = enRonda({ rondas: [LISTA] });
  p.jugadores[1].pos = p.meta - 2;
  p = hastaLectura(p);
  for (const i of [0, 1, 2, 3, 4]) p = M.marcarElemento(p, i).partida;
  p = M.terminarRonda(p).partida;
  assert.equal(p.jugadores[1].pos, p.meta);
  assert.equal(p.jugadores[1].casillasRonda, 2, "solo cuentan las casillas que de verdad avanza");
  p = M.cerrarTurno(p, ctx).partida; // turno de Ana
  p = M.cerrarTurno(responder(M.empezarLectura(M.apostar(p, 2, ctx).partida).partida, ctx, false), ctx).partida;
  assert.equal(p.turno.jugador, "luis");
  assert.equal(p.turno.esFinal, true, "en la meta toca la final, no una ronda");
  assert.equal(p.turno.ronda, null);
});

test("cambiar la ronda la anula, con su motivo, y saca otra distinta", () => {
  let { p, ctx } = enRonda();
  p = hastaLectura(p);
  const primera = p.turno.ronda;
  p = p.turno.rondaDatos.tipo === "lista" ? M.marcarElemento(p, 0).partida : M.marcarRafaga(p, true).partida;
  assert.deepEqual(p.turno.marcados, [0]);
  const r = M.cambiarRonda(p, "conocida", ctx);
  assert.equal(r.registros[0].tipo, "ronda_anulada");
  assert.equal(r.registros[0].ronda, primera);
  assert.equal(r.registros[0].motivo, "conocida");
  assert.notEqual(r.partida.turno.ronda, primera);
  assert.deepEqual(r.partida.turno.marcados, []);
  assert.equal(r.partida.turno.fase, M.FASE.LECTURA);
  assert.deepEqual(r.vistas, [["luis", r.partida.turno.ronda], ["ana", r.partida.turno.ronda]]);
  assert.throws(() => M.cambiarRonda(r.partida, "inventado", ctx), /Motivo/);
  // Con una sola ronda no hay otra que sacar.
  const unica = enRonda({ rondas: [LISTA] });
  assert.throws(() => M.cambiarRonda(hastaLectura(unica.p), "conocida", unica.ctx), /No quedan otras rondas/);
});

test("con narrador, la ronda se lee sin pasar el móvil", () => {
  const narrador = { clave: "pepe", nombre: "Pepe" };
  const { p } = enRonda({ narrador });
  const r = M.empezarRonda(p);
  assert.equal(r.partida.turno.fase, M.FASE.LECTURA);
  assert.deepEqual(r.vistas, [["luis", p.turno.ronda], ["pepe", p.turno.ronda]]);
});

test("elegirRonda: primero una que no haya visto; si no, la vista hace más tiempo, y lo dice", () => {
  const [a, b, c] = RONDAS;
  const rng = rngConSemilla(3);
  const vistas = { [a.id]: "2026-10-01", [b.id]: "2026-09-01" };
  assert.equal(elegirRonda([a, b, c], { vistas, usadas: new Set(), rng }).ronda.id, c.id);
  const r = elegirRonda([a, b, c], { vistas, usadas: new Set([c.id]), rng });
  assert.deepEqual([r.ronda.id, r.repetida], [b.id, true]);
  assert.equal(elegirRonda([a], { vistas: {}, usadas: new Set([a.id]), rng }, new Set([a.id])), null);
  assert.equal(elegirRonda([], { vistas: {}, usadas: new Set(), rng }), null);
  // En la partida, una ronda repetida queda marcada para no mezclarla en las estadísticas.
  const { p } = enRonda({ rondas: [LISTA], vistas: { luis: { [LISTA.id]: "2026-10-01" } } });
  assert.equal(p.turno.alternativa, "repetida");
});

test("sin rondas cargadas, una casilla especial da una pregunta normal", () => {
  const ctxCon = contexto({ rondas: RONDAS });
  let p = M.nuevaPartida({ id: "p", jugadores: JUGADORES.slice(0, 2), metaId: "corta", rondas: true }, ctxCon).partida;
  p.jugadores[1].pos = p.especiales[0];
  const ctxSin = contexto({ rondas: [] }); // p. ej., el archivo no se pudo descargar al reanudar
  p = M.cerrarTurno(responder(M.empezarLectura(M.apostar(p, 3, ctxSin).partida).partida, ctxSin, false), ctxSin).partida;
  assert.equal(p.turno.ronda, null);
  assert.ok(p.turno.subtema);
});

test("partidas guardadas: con ronda a medias se reanudan; sin su copia, no; las de antes de las rondas, sí", () => {
  let { p } = enRonda({ rondas: [LISTA] });
  p = M.marcarElemento(hastaLectura(p), 0).partida;
  assert.ok(M.partidaReanudable(p));
  assert.ok(M.partidaReanudable(JSON.parse(JSON.stringify(p))), "también tras guardarla en localStorage");
  assert.equal(M.partidaReanudable({ ...p, turno: { ...p.turno, rondaDatos: null } }), false);
  assert.equal(M.partidaReanudable({ ...p, turno: { ...p.turno, rondaDatos: { ...p.turno.rondaDatos, tipo: "otra" } } }), false);
  const antigua = structuredClone(p);
  delete antigua.especiales;
  antigua.turno = { ...M.nuevaPartida({ id: "x", jugadores: JUGADORES, metaId: "corta" }, contexto()).partida.turno };
  delete antigua.turno.ronda;
  assert.ok(M.partidaReanudable(antigua));
});

test("las rondas reales (app/data/rondas.json) se juegan con el motor", () => {
  const reales = JSON.parse(readFileSync(new URL("../app/data/rondas.json", import.meta.url), "utf8")).rondas;
  assert.ok(reales.length >= 30, `hay ${reales.length} rondas`);
  for (const ronda of reales) {
    let { p, ctx } = enRonda({ rondas: [ronda] });
    assert.equal(p.turno.ronda, ronda.id);
    p = hastaLectura(p);
    const n = ronda.elementos.length;
    for (let i = 0; i < n; i += 2) p = ronda.tipo === "lista" ? M.marcarElemento(p, i).partida : M.marcarRafaga(M.marcarRafaga(p, true).partida, false).partida;
    p = M.terminarRonda(p).partida;
    assert.equal(p.turno.aciertos, Math.ceil(n / 2), ronda.id);
    assert.equal(M.cerrarTurno(p, ctx).registros[0].total, n);
  }
});

test("la sesión guarda, registra y deshace los pasos de una ronda", async () => {
  const { p, ctx } = enRonda({ rondas: [LISTA] });
  const almacen = almacenEnMemoria();
  const s = new Sesion({ ctx, almacen, dispositivo: "d", versiones: { banco: "b", ajustes: "a" }, partida: p });
  await s.ejecutar("empezarRonda");
  await s.ejecutar("empezarLectura");
  assert.ok(almacen.vistasDe("luis")[LISTA.id], "la ronda queda vista");
  await s.ejecutar("marcarElemento", 0);
  await s.ejecutar("marcarElemento", 1);
  await s.deshacer();
  assert.deepEqual(s.turno.marcados, [0]);
  await s.ejecutar("terminarRonda", { tiempoAgotado: false });
  await s.ejecutar("cerrarTurno");
  const regs = await almacen.todosLosRegistros();
  assert.equal(regs.length, 1);
  assert.equal(regs[0].tipo, "ronda");
  assert.equal(regs[0].aciertos, 1);
  assert.ok(regs[0].id && regs[0].dispositivo === "d" && regs[0].version_banco === "b");
  await s.deshacer();
  assert.equal((await almacen.todosLosRegistros()).length, 0, "deshacer el cierre borra el registro");
  assert.equal(almacen.estado.guardada.partida.turno.fase, M.FASE.RESULTADO);
});
