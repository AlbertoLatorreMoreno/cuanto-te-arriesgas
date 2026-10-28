// El tema de cada jugador: en cada tanda de 5 turnos normales suyos, uno al azar (ni el primero ni el
// último de la tanda) es una pregunta de su tema. Nunca en la final ni en una ronda, y solo a quien lo eligió.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rngConSemilla } from "../app/js/azar.js";
import { crearIndice } from "../app/js/banco.js";
import * as M from "../app/js/motor.js";
import { bancoSintetico, config, contexto, responder, rondasSinteticas } from "./ayudas.js";

const CADA = config.temas.cada;
const TEMAS = new Set(config.temas.lista.map((t) => t.id));

test("la pregunta de tema cae en el 2.º, 3.º o 4.º turno de cada tanda de 5", () => {
  const rng = rngConSemilla(3);
  const vistos = new Set();
  for (let i = 0; i < 300; i++) {
    for (const tanda of [0, 1, 7]) {
      const n = M.turnoDeTema(tanda, CADA, rng);
      assert.ok(n >= tanda * CADA + 2 && n <= tanda * CADA + CADA - 1, `turno ${n} fuera de la tanda ${tanda}`);
      if (tanda === 0) vistos.add(n);
    }
  }
  assert.deepEqual([...vistos].sort(), [2, 3, 4], "las tres posiciones salen");
});

// Juega una partida entera (sin rondas ni finales propias) y devuelve, por jugador, sus turnos normales en
// orden: si fue de tema y su categoría.
function jugar(semilla, jugadores, { rondas = [], preguntas = bancoSintetico(2), acierto = 0.5 } = {}) {
  const ctx = contexto({ semilla, preguntas, rondas });
  const azar = rngConSemilla(semilla * 31);
  let p = M.nuevaPartida({ id: `t${semilla}`, jugadores, metaId: "media", rondas: rondas.length > 0 }, ctx).partida;
  const turnos = Object.fromEntries(jugadores.map((j) => [j.clave, []]));
  for (let paso = 0; paso < 3000 && p.turno.fase !== M.FASE.FIN; paso++) {
    const t = p.turno;
    if (t.ronda) {
      assert.equal(t.tema, null, "una ronda nunca es de tema");
      p = M.empezarLectura(M.empezarRonda(p).partida).partida;
      p = M.cerrarTurno(M.terminarRonda(p).partida, ctx).partida;
      continue;
    }
    if (t.esFinal) assert.equal(t.tema, null, "la final nunca es de tema");
    else turnos[t.jugador].push({ tema: t.tema, categoria: t.categoria });
    p = M.empezarLectura(M.apostar(p, t.esFinal ? t.nivelFinal : 5, ctx).partida).partida;
    if (t.tema) assert.equal(p.turno.preguntaDatos.categoria, t.tema, "la pregunta es de su tema");
    p = responder(p, ctx, azar() < acierto);
    p = M.cerrarTurno(p, ctx).partida;
  }
  return { p, turnos };
}

test("a quien elige un tema le sale una de su tema en cada tanda de 5 turnos normales, y a los demás nunca", () => {
  const jugadores = [
    { clave: "ana", nombre: "Ana", tema: "harry_potter" },
    { clave: "luis", nombre: "Luis" },
    { clave: "marta", nombre: "Marta", tema: "sorpresa" },
  ];
  for (let semilla = 1; semilla <= 40; semilla++) {
    const { turnos } = jugar(semilla, jugadores);
    for (const j of jugadores) {
      const lista = turnos[j.clave];
      if (!j.tema) {
        assert.ok(lista.every((x) => x.tema === null && !TEMAS.has(x.categoria)), "sin tema, nunca una de un tema");
        continue;
      }
      for (let inicio = 0; inicio < lista.length; inicio += CADA) {
        const tanda = lista.slice(inicio, inicio + CADA);
        const posiciones = tanda.map((x, i) => (x.tema ? i + 1 : null)).filter(Boolean);
        assert.ok(posiciones.length <= 1, `dos de tema en una tanda: ${posiciones}`);
        if (tanda.length === CADA) assert.equal(posiciones.length, 1, "una tanda completa sin su pregunta de tema");
        for (const n of posiciones) assert.ok(n >= 2 && n <= CADA - 1, `en el turno ${n} de la tanda`);
      }
      for (const x of lista) if (x.tema) assert.equal(x.categoria, j.tema);
      for (let i = 1; i < lista.length; i++) assert.ok(!(lista[i].tema && lista[i - 1].tema), "dos seguidas");
    }
  }
});

test("las rondas ★ no cuentan como turnos normales: la pregunta de tema se mantiene en su tanda", () => {
  const jugadores = [
    { clave: "ana", nombre: "Ana", tema: "star_wars" },
    { clave: "luis", nombre: "Luis", tema: "marvel" },
  ];
  for (let semilla = 1; semilla <= 30; semilla++) {
    const { p, turnos } = jugar(semilla, jugadores, { rondas: rondasSinteticas(30) });
    assert.ok(p.especiales.length > 0);
    for (const j of jugadores) {
      const lista = turnos[j.clave];
      assert.equal(p.jugadores.find((x) => x.clave === j.clave).turnosNormales, lista.length, "cuenta solo los turnos normales");
      const deTema = lista.filter((x) => x.tema).length;
      assert.ok(deTema >= Math.floor(lista.length / CADA) && deTema <= Math.ceil(lista.length / CADA), `${deTema} de tema en ${lista.length} turnos normales`);
    }
  }
});

test("el registro de la respuesta lleva el tema como categoría, y cada turno, el tema que eligió quien juega", () => {
  const ctx = contexto({ semilla: 5 });
  let p = M.nuevaPartida({ id: "r", jugadores: [{ clave: "ana", nombre: "Ana", tema: "juego_de_tronos" }, { clave: "luis", nombre: "Luis" }], metaId: "corta" }, ctx).partida;
  const antes = [];
  for (let paso = 0; paso < 200 && !p.turno.tema; paso++) {
    p = M.empezarLectura(M.apostar(p, 3, ctx).partida).partida;
    const r = M.cerrarTurno(responder(p, ctx, false), ctx);
    antes.push(...r.registros);
    p = r.partida;
  }
  // También en los turnos normales, aunque aún no le haya tocado su tema; sin tema, null.
  assert.ok(antes.length >= 2);
  for (const r of antes) assert.equal(r.tema_elegido, r.jugador === "ana" ? "juego_de_tronos" : null);
  assert.equal(p.turno.tema, "juego_de_tronos");
  const subtemas = config.temas.lista.find((t) => t.id === "juego_de_tronos").subtemas.map((s) => s.id);
  assert.ok(subtemas.includes(p.turno.subtema), "anuncia un subtema del tema");
  p = M.empezarLectura(M.apostar(p, 6, ctx).partida).partida;
  const r = M.cerrarTurno(responder(p, ctx, true), ctx).registros[0];
  assert.equal(r.categoria, "juego_de_tronos");
  assert.equal(r.apuesta, 6);
  assert.ok(subtemas.includes(r.subtema_anunciado));
  assert.equal(r.tema_elegido, "juego_de_tronos");
  // Un campo lógico que no conoce la descarga de la hoja descartaría el registro entero: el tema va como texto.
  assert.ok(!("tema" in r) && typeof r.tema_elegido === "string");
});

test("un tema desconocido no se acepta", () => {
  const ctx = contexto();
  assert.throws(() => M.nuevaPartida({ id: "x", jugadores: [{ clave: "a", nombre: "A", tema: "pokemon" }, { clave: "b", nombre: "B" }], metaId: "corta" }, ctx), M.ErrorJuego);
});

test("si el tema no tiene preguntas (su archivo no cargó), juega la de la casilla y la tanda sigue", () => {
  const preguntas = bancoSintetico(2).filter((q) => q.categoria !== "marvel");
  const { turnos, p } = jugar(2, [{ clave: "ana", nombre: "Ana", tema: "marvel" }, { clave: "luis", nombre: "Luis" }], { preguntas });
  assert.ok(turnos.ana.length > CADA);
  assert.ok(turnos.ana.every((x) => x.tema === null && !TEMAS.has(x.categoria)));
  assert.ok(p.jugadores[0].turnoTema > CADA, "la siguiente pregunta de tema pasa a otra tanda");
});

test("una partida guardada sin temas (de antes de esta versión) sigue jugándose igual", () => {
  const ctx = contexto({ semilla: 9 });
  let p = M.nuevaPartida({ id: "vieja", jugadores: [{ clave: "ana", nombre: "Ana" }, { clave: "luis", nombre: "Luis" }], metaId: "corta" }, ctx).partida;
  for (const j of p.jugadores) {
    delete j.tema;
    delete j.turnosNormales;
    delete j.turnoTema;
  }
  delete p.turno.tema;
  assert.ok(M.partidaReanudable(p));
  for (let paso = 0; paso < 30; paso++) {
    p = M.empezarLectura(M.apostar(p, p.turno.esFinal ? p.turno.nivelFinal : 4, ctx).partida).partida;
    p = M.cerrarTurno(responder(p, ctx, paso % 2 === 0), ctx).partida;
    if (p.turno.fase === M.FASE.FIN) break;
    assert.ok(!p.turno.tema);
  }
});

test("el índice incluye los temas, pero el tablero no", () => {
  const indice = crearIndice(bancoSintetico(1), config);
  for (const t of config.temas.lista) assert.deepEqual(indice.subtemas.get(t.id), t.subtemas.map((s) => s.id));
  const ctx = contexto();
  const p = M.nuevaPartida({ id: "tab", jugadores: [{ clave: "a", nombre: "A", tema: "sorpresa" }, { clave: "b", nombre: "B" }], metaId: "media" }, ctx).partida;
  assert.ok(p.tablero.every((c) => c === null || !TEMAS.has(c)));
});
