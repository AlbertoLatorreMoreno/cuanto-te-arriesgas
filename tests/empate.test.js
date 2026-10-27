// Quien acierta la final no gana en el acto: la ronda se completa y quienes llevan un turno menos (y
// están en la meta) pueden empatar. Tras un empate, la ronda de oro desempata.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../app/js/motor.js";
import { Sesion, almacenEnMemoria } from "../app/js/sesion.js";
import { JUGADORES, config, contexto, finalesSinteticas, responder } from "./ayudas.js";

const FINALES = finalesSinteticas().filter((f) => f.tipo === "pregunta");

// Partida de Ana, Luis y Marta (en ese orden) con cada uno en la casilla que se diga. A Ana ya le
// habían preparado un turno normal (en la salida): se juega como tal.
function partida(posiciones, { finales = FINALES } = {}) {
  const ctx = contexto({ finales });
  const p = M.nuevaPartida({ id: "e", jugadores: JUGADORES, metaId: "corta" }, ctx).partida;
  posiciones.forEach((pos, i) => (p.jugadores[i].pos = pos));
  return { p, ctx };
}

// Juega el turno que toque (apuesta 3, o el nivel de la final) hasta el resultado.
function hastaResultado(p, ctx, acierto) {
  p = M.apostar(p, p.turno.esFinal ? p.turno.nivelFinal : 3, ctx).partida;
  return responder(M.empezarLectura(p).partida, ctx, acierto);
}

function jugar(p, ctx, aciertos, registros = []) {
  for (const acierto of aciertos) {
    const r = M.cerrarTurno(hastaResultado(p, ctx, acierto), ctx);
    registros.push(...r.registros);
    p = r.partida;
  }
  return p;
}

test("quien va detrás y está en la meta puede empatar; quien no ha llegado no juega", () => {
  let { p, ctx } = partida([25, 25, 10]);
  p = jugar(p, ctx, [false, false, false]); // Ana (turno normal), Luis (final) y Marta fallan
  assert.equal(p.turno.jugador, "ana");
  assert.equal(p.turno.esFinal, true);

  p = hastaResultado(p, ctx, true);
  assert.deepEqual(p.acertantes, ["ana"]);
  assert.equal(p.ganador, null, "acertar la final no gana todavía");
  assert.deepEqual(M.quienSigue(p), { idx: 1 }, "Luis lleva un turno menos y está en la meta");

  const n = p.n;
  p = M.cerrarTurno(p, ctx).partida;
  assert.equal(p.turno.jugador, "luis");
  assert.equal(p.turno.esFinal, true);
  assert.equal(p.n, n + 1);

  p = hastaResultado(p, ctx, true);
  assert.equal(M.quienSigue(p), null, "Marta no está en la meta: no puede empatar y no juega");
  const r = M.cerrarTurno(p, ctx);
  assert.equal(r.partida.turno.fase, M.FASE.FIN);
  assert.deepEqual(r.partida.empate, ["ana", "luis"]);
  assert.equal(r.partida.ganador, null);
  assert.ok(r.partida.terminada);
  assert.equal(r.registros[0].ronda_oro, null);
});

test("si quien va detrás falla la final, gana quien la acertó", () => {
  let { p, ctx } = partida([25, 25, 10]);
  p = jugar(p, ctx, [false, false, false, true, false]);
  assert.equal(p.turno.fase, M.FASE.FIN);
  assert.equal(p.ganador, "ana");
  assert.equal(p.empate, null);
});

test("solo juegan los que van detrás en el orden, saltándose a los que no han llegado", () => {
  let { p, ctx } = partida([25, 10, 25]);
  p = jugar(p, ctx, [false, false, false]); // Ana (normal), Luis (normal) y Marta (final) fallan
  p = hastaResultado(p, ctx, true); // Ana acierta su final
  assert.deepEqual(M.quienSigue(p), { idx: 2 }, "Luis no está en la meta: le toca a Marta");
  p = M.cerrarTurno(p, ctx).partida;
  assert.equal(p.turno.jugador, "marta");
  p = jugar(p, ctx, [true]);
  assert.deepEqual(p.empate, ["ana", "marta"]);
});

test("si quien acierta es el último del orden, todos han jugado lo mismo: gana sin más", () => {
  let { p, ctx } = partida([10, 25, 25]);
  p = jugar(p, ctx, [false, false]); // Ana (normal) y Luis (final) fallan
  p = hastaResultado(p, ctx, true); // Marta acierta
  assert.equal(M.quienSigue(p), null, "Luis también está en la meta, pero ya ha jugado los mismos turnos");
  p = M.cerrarTurno(p, ctx).partida;
  assert.equal(p.ganador, "marta");
});

test("ronda de oro: rondas de finales de nivel base hasta que la acierta uno solo", () => {
  let { p, ctx } = partida([25, 25, 10]);
  p = jugar(p, ctx, [false, false, false, true, true]);
  assert.deepEqual(p.empate, ["ana", "luis"]);
  assert.throws(() => M.cerrarTurno(p, ctx), /no está juzgado/);

  const registros = [];
  p = M.rondaDeOro(p, ctx).partida;
  assert.equal(p.terminada, null);
  assert.deepEqual(p.oro, { ronda: 1, vivos: ["ana", "luis"], aciertos: [] });
  assert.deepEqual([p.turno.jugador, p.turno.esFinal, p.turno.nivelFinal, p.turno.oro], ["ana", true, config.final.nivel_base, 1]);

  p = jugar(p, ctx, [false, false], registros); // nadie la acierta: otra ronda
  assert.deepEqual([p.oro.ronda, p.oro.vivos, p.turno.jugador], [2, ["ana", "luis"], "ana"]);
  p = jugar(p, ctx, [true, true], registros); // la aciertan los dos: otra ronda
  assert.deepEqual([p.oro.ronda, p.oro.vivos], [3, ["ana", "luis"]]);
  p = jugar(p, ctx, [false], registros); // Ana falla…
  p = hastaResultado(p, ctx, true); // …y Luis acierta
  assert.equal(M.quienSigue(p), null);
  const r = M.cerrarTurno(p, ctx);
  registros.push(...r.registros);
  assert.equal(r.partida.turno.fase, M.FASE.FIN);
  assert.equal(r.partida.ganador, "luis");
  assert.deepEqual(r.partida.empate, ["ana", "luis"], "el empate queda apuntado");
  assert.deepEqual(registros.map((x) => [x.tipo, x.ronda_oro, x.nivel_pedido]), [1, 1, 2, 2, 3, 3].map((n) => ["final", n, config.final.nivel_base]));
  assert.throws(() => M.rondaDeOro(r.partida, ctx), /empate/);
});

test("ronda de oro entre tres: quien falla cuando otros aciertan queda fuera", () => {
  let { p, ctx } = partida([25, 25, 25]);
  p = jugar(p, ctx, [false, false, false, true, true, true]); // Ana (normal), Luis y Marta fallan; después aciertan los tres
  assert.deepEqual(p.empate, ["ana", "luis", "marta"]);
  p = M.rondaDeOro(p, ctx).partida;
  p = jugar(p, ctx, [true, true, false]);
  assert.deepEqual([p.oro.ronda, p.oro.vivos, p.turno.jugador], [2, ["ana", "luis"], "ana"]);
  p = jugar(p, ctx, [false, false]);
  assert.deepEqual(p.oro.vivos, ["ana", "luis"], "si nadie acierta, repiten los mismos (Marta sigue fuera)");
  p = jugar(p, ctx, [true, false]);
  assert.equal(p.ganador, "ana");
});

test("sin finales propias, el empate y la ronda de oro van con preguntas del banco", () => {
  let { p, ctx } = partida([25, 25, 10], { finales: [] });
  p = jugar(p, ctx, [false, false, false, true, true]);
  assert.deepEqual(p.empate, ["ana", "luis"]);
  const registros = [];
  p = jugar(M.rondaDeOro(p, ctx).partida, ctx, [false, true], registros);
  assert.equal(p.ganador, "luis");
  assert.deepEqual(registros.map((x) => [x.tipo, x.es_final, x.ronda_oro, x.apuesta]), [["respuesta", true, 1, 8], ["respuesta", true, 1, 8]]);
});

test("la sesión deshace la ronda de oro hasta el empate, y la partida con ronda de oro se puede reanudar", async () => {
  let { p, ctx } = partida([25, 25, 10]);
  p = jugar(p, ctx, [false, false, false, true, true]);
  const almacen = almacenEnMemoria();
  const s = new Sesion({ ctx, almacen, dispositivo: "d", versiones: { banco: "b", ajustes: "a" }, partida: p });
  await s.ejecutar("rondaDeOro");
  assert.equal(s.turno.oro, 1);
  assert.ok(M.partidaReanudable(almacen.estado.guardada.partida));
  assert.ok(M.partidaAMedias(almacen.estado.guardada.partida), "en la ronda de oro, «Continuar» la ofrece");
  await s.deshacer();
  assert.equal(s.turno.fase, M.FASE.FIN);
  assert.deepEqual([s.partida.empate, s.partida.oro], [["ana", "luis"], null]);
  assert.equal(M.partidaReanudable({ ...p, oro: { ronda: 1, vivos: [], aciertos: [] } }), false, "una ronda de oro sin nadie no vale");
});

test("una partida guardada por la versión anterior, con el ganador ya apuntado, termina al cerrar el turno", () => {
  let { p, ctx } = partida([25, 25, 10]);
  p = jugar(p, ctx, [false, false, false]);
  p = hastaResultado(p, ctx, true);
  // Antes, acertar la final apuntaba al ganador en el acto y no había lista de acertantes.
  const antigua = { ...structuredClone(p), ganador: "ana" };
  delete antigua.acertantes;
  assert.ok(M.partidaReanudable(antigua));
  const fin = M.cerrarTurno(antigua, ctx).partida;
  assert.deepEqual([fin.turno.fase, fin.ganador, fin.empate ?? null], [M.FASE.FIN, "ana", null]);
});
