// Finales propias: preguntas y retos «acierta k de n» de nivel 8, 9 y 10, sin categoría.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rngConSemilla } from "../app/js/azar.js";
import { elegirFinal } from "../app/js/banco.js";
import * as M from "../app/js/motor.js";
import { Sesion, almacenEnMemoria } from "../app/js/sesion.js";
import { responder, JUGADORES, contexto, finalesSinteticas } from "./ayudas.js";

const FINALES = finalesSinteticas();
const PREGUNTA = FINALES.find((f) => f.tipo === "pregunta" && !f.segundos);
const CON_TIEMPO = FINALES.find((f) => f.tipo === "pregunta" && f.segundos);
const RETO = FINALES.find((f) => f.tipo === "reto");

// Partida de dos en la que Ana llega a la meta y le toca la final. Luis va en `posLuis`.
function enFinal({ finales = FINALES, posLuis = 0, narrador = null, cronometro = false, vistas = {} } = {}) {
  const ctx = contexto({ finales, vistas });
  let p = M.nuevaPartida({ id: "p", jugadores: JUGADORES.slice(0, 2), metaId: "corta", narrador, cronometro }, ctx).partida;
  p.jugadores[0].pos = 22;
  p.jugadores[1].pos = posLuis;
  const turno = (q, acierto) => {
    q = M.apostar(q, 3, ctx).partida;
    if (!narrador) q = M.empezarLectura(q).partida;
    return M.cerrarTurno(responder(q, ctx, acierto), ctx).partida;
  };
  p = turno(p, true); // Ana llega a 25
  p = turno(p, false); // Luis falla
  return { p, ctx };
}

function hastaLectura(p, ctx) {
  p = M.apostar(p, p.turno.nivelFinal, ctx).partida;
  return p.narrador ? p : M.empezarLectura(p).partida;
}

test("con finales propias, la final no tiene categoría y su nivel sigue la ventaja", () => {
  const { p } = enFinal({ posLuis: 21 });
  assert.equal(p.turno.esFinal, true);
  assert.equal(p.turno.categoria, null);
  assert.equal(p.turno.subtema, null);
  assert.equal(p.turno.nivelFinal, 9, "4 puntos de ventaja con paso 4: 8 + 1");
  assert.equal(enFinal({ posLuis: 0 }).p.turno.nivelFinal, 10);
  assert.equal(enFinal({ posLuis: 25 - 2 }).p.turno.nivelFinal, 8);
});

test("una final que es una pregunta se juega como las demás y deja un registro «final»", () => {
  let { p, ctx } = enFinal({ finales: [PREGUNTA], posLuis: 0 });
  p = M.apostar(p, p.turno.nivelFinal, ctx).partida;
  assert.equal(p.turno.final, PREGUNTA.id);
  assert.equal(p.turno.reto, false);
  assert.equal(p.turno.preguntaDatos.pregunta, PREGUNTA.pregunta);
  assert.equal(p.turno.preguntaDatos.categoria, null);
  assert.ok(M.partidaReanudable(JSON.parse(JSON.stringify(p))), "se puede reanudar aunque no tenga categoría");
  const lectura = M.empezarLectura(p);
  assert.deepEqual(lectura.vistas, [["ana", PREGUNTA.id], ["luis", PREGUNTA.id]]);
  p = M.juzgar(M.revelar(lectura.partida).partida, true).partida;
  assert.equal(p.ganador, "ana");
  p = M.valorar(p, "facil").partida;
  const r = M.cerrarTurno(p, ctx);
  assert.equal(r.partida.turno.fase, M.FASE.FIN);
  const reg = r.registros[0];
  assert.equal(reg.tipo, "final");
  assert.equal(reg.final, PREGUNTA.id);
  assert.equal(reg.tipo_final, "pregunta");
  assert.equal(reg.nivel, PREGUNTA.nivel);
  assert.equal(reg.nivel_pedido, 10);
  assert.equal(reg.alternativa, PREGUNTA.nivel === 10 ? null : "otro_nivel");
  assert.equal(reg.acierto, true);
  assert.equal(reg.valoracion, "facil");
  assert.equal(reg.aciertos, null);
  assert.equal(reg.pregunta, undefined, "no es una pregunta del banco: no entra en el modelo de niveles");
});

test("el tiempo de una final-pregunta sigue la opción de cronómetro", () => {
  for (const cronometro of [true, false]) {
    const { p, ctx } = enFinal({ finales: [CON_TIEMPO], cronometro });
    assert.equal(M.apostar(p, p.turno.nivelFinal, ctx).partida.turno.cronometro, cronometro ? CON_TIEMPO.segundos : null);
  }
});

test("un reto final se gana si se llega al mínimo de aciertos", () => {
  for (const [marcas, gana] of [[[true, true, false, true], true], [[true, false, true, false, false], false]]) {
    let { p, ctx } = enFinal({ finales: [RETO] });
    p = hastaLectura(p, ctx);
    assert.equal(p.turno.reto, true);
    assert.equal(p.turno.cronometro, RETO.segundos, "un reto siempre lleva tiempo");
    assert.throws(() => M.revelar(p), /no toca/);
    assert.throws(() => M.marcarElemento(p, 0), /no se puede/);
    for (const m of marcas) p = M.marcarRafaga(p, m).partida;
    p = M.terminarReto(p, { tiempoAgotado: true }).partida;
    assert.equal(p.turno.fase, M.FASE.RESULTADO);
    assert.equal(p.turno.aciertos, marcas.filter(Boolean).length);
    assert.equal(p.ganador, gana ? "ana" : null);
    assert.equal(p.jugadores[0].pos, 25, "en la final no se avanza");
    assert.throws(() => M.valorar(p, "justa"), /no toca valorar/);
    const reg = M.cerrarTurno(p, ctx).registros[0];
    assert.equal(reg.tipo_final, "reto");
    assert.equal(reg.acierto, gana);
    assert.deepEqual([reg.aciertos, reg.minimo, reg.total, reg.leidos], [marcas.filter(Boolean).length, 3, 5, marcas.length]);
    assert.equal(reg.tiempo_agotado, true);
  }
});

test("cambiar la final la anula con un registro aparte y saca otra", () => {
  let { p, ctx } = enFinal();
  p = hastaLectura(p, ctx);
  const primera = p.turno.final;
  const r = M.otraPregunta(p, "conocida", ctx);
  assert.equal(r.registros[0].tipo, "final_anulada");
  assert.equal(r.registros[0].final, primera);
  assert.notEqual(r.partida.turno.final, primera);
  assert.deepEqual(r.vistas, [["ana", r.partida.turno.final], ["luis", r.partida.turno.final]]);
  assert.equal(r.partida.turno.fase, M.FASE.LECTURA);
});

test("fallar la final obliga a repetirla en el siguiente turno, con otra final", () => {
  let { p, ctx } = enFinal({ finales: FINALES.filter((f) => f.tipo === "pregunta") });
  p = hastaLectura(p, ctx);
  const primera = p.turno.final;
  p = M.cerrarTurno(M.juzgar(M.revelar(p).partida, false).partida, ctx).partida;
  p = M.cerrarTurno(responder(M.empezarLectura(M.apostar(p, 2, ctx).partida).partida, ctx, false), ctx).partida;
  assert.equal(p.turno.esFinal, true);
  p = M.apostar(p, p.turno.nivelFinal, ctx).partida;
  assert.notEqual(p.turno.final, primera, "no se repite la final en la misma partida");
});

test("con narrador, la final propia también se lee sin pasar el móvil", () => {
  const { p, ctx } = enFinal({ narrador: { clave: "pepe", nombre: "Pepe" } });
  const r = M.apostar(p, p.turno.nivelFinal, ctx);
  assert.equal(r.partida.turno.fase, M.FASE.LECTURA);
  assert.deepEqual(r.vistas, [["ana", r.partida.turno.final], ["pepe", r.partida.turno.final]]);
});

test("elegirFinal: nueva del nivel; si no, más fácil o repetida; una más difícil, solo si no queda otra", () => {
  const rng = rngConSemilla(2);
  const f = (id, nivel) => ({ id, nivel, tipo: "pregunta" });
  const finales = [f("a8", 8), f("b9", 9), f("c10", 10)];
  const elige = (nivel, vistas, lista = finales, usadas = new Set()) => {
    const r = elegirFinal(lista, nivel, { vistas, usadas, rng });
    return [r.final.id, r.alternativa];
  };
  assert.deepEqual(elegirFinal(finales, 9, { vistas: {}, usadas: new Set(), rng }), { final: finales[1], alternativa: null });
  assert.deepEqual(elige(9, { b9: "2026-10-01" }), ["a8", "otro_nivel"], "sin nuevas de su nivel, una nueva más fácil, no la de 10");
  assert.deepEqual(elige(9, { a8: "2026-10-02", b9: "2026-10-01" }), ["b9", "repetida"], "antes que subir, la de su nivel ya vista");
  // El caso que atascaba las partidas: con la rebaja se pide el 8, y las de 8 ya las ha visto todas.
  assert.deepEqual(elige(8, { a8: "2026-10-02" }), ["a8", "repetida"], "en el nivel base no sube a 9 ni a 10");
  const vistas = { a8: "2026-10-02", b9: "2026-10-03", c10: "2026-10-01" };
  assert.deepEqual(elige(9, vistas), ["b9", "repetida"], "si ya las ha visto todas, la de su nivel");
  assert.deepEqual(elige(8, {}, [f("b9", 9), f("c10", 10)]), ["b9", "otro_nivel"], "si no hay ninguna de su nivel ni más fácil, la más cercana");
  assert.deepEqual(elige(9, {}, finales, new Set(["a8", "b9", "c10"])), ["b9", "repetida"], "con todas usadas en la partida, la de su nivel");
  assert.equal(elegirFinal([], 9, { vistas: {}, usadas: new Set(), rng }), null);
});

test("sin finales propias, la final es una pregunta del banco como antes", () => {
  const { p, ctx } = enFinal({ finales: [] });
  assert.ok(p.turno.categoria, "con categoría");
  const q = M.apostar(p, p.turno.nivelFinal, ctx).partida;
  assert.equal(q.turno.final, null);
  assert.ok(q.turno.preguntaDatos.categoria);
});

test("una final propia guardada se reanuda sin el archivo de finales: sale una del banco", () => {
  const { p } = enFinal();
  const sinArchivo = contexto({ finales: [] });
  const q = M.apostar(p, p.turno.nivelFinal, sinArchivo).partida;
  assert.ok(q.turno.categoria && q.turno.preguntaDatos.categoria);
  assert.equal(q.turno.final, null);
});

test("la sesión registra, guarda y deshace un reto final", async () => {
  const { p, ctx } = enFinal({ finales: [RETO] });
  const almacen = almacenEnMemoria();
  const s = new Sesion({ ctx, almacen, dispositivo: "d", versiones: { banco: "b", ajustes: "a" }, partida: p });
  await s.ejecutar("apostar", p.turno.nivelFinal);
  await s.ejecutar("empezarLectura");
  for (const m of [true, true, true]) await s.ejecutar("marcarRafaga", m);
  await s.deshacer();
  assert.deepEqual(s.turno.marcados, [0, 1]);
  await s.ejecutar("marcarRafaga", true);
  await s.ejecutar("terminarReto", { tiempoAgotado: false });
  assert.equal(s.partida.ganador, "ana");
  await s.ejecutar("cerrarTurno");
  const regs = await almacen.todosLosRegistros();
  assert.equal(regs.length, 1);
  assert.equal(regs[0].tipo, "final");
  assert.ok(M.partidaReanudable(almacen.estado.guardada.partida));
});
