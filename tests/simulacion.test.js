// Cientos de partidas simuladas con la tabla de aciertos objetivo (y la de las finales propias):
// todas terminan, el ganador está en la meta y no se repiten preguntas.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rngConSemilla } from "../app/js/azar.js";
import * as M from "../app/js/motor.js";
import { bancoSintetico, config, contexto, finalesSinteticas, rondasSinteticas } from "./ayudas.js";

function simular(semilla, nJugadores, metaId, preguntas, vistas = {}, rondas = [], finales = []) {
  const ctx = contexto({ semilla, preguntas, vistas, rondas, finales });
  const azar = rngConSemilla(semilla * 7919);
  const jugadores = Array.from({ length: nJugadores }, (_, i) => ({ clave: `j${i}`, nombre: `J${i}` }));
  let p = M.nuevaPartida({ id: `sim${semilla}`, jugadores, metaId, rondas: rondas.length > 0 }, ctx).partida;
  const registros = [];
  const aplicar = (r) => {
    for (const [j, q] of r.vistas) (vistas[j] ??= {})[q] = ctx.ahora();
    registros.push(...r.registros);
    return r.partida;
  };

  let turnos = 0;
  let empates = 0;
  while (true) {
    if (p.turno.fase === M.FASE.FIN) {
      if (p.ganador) break;
      // Empate: se desempata con la ronda de oro.
      empates++;
      p = aplicar(M.rondaDeOro(p, ctx));
      continue;
    }
    assert.ok(++turnos < 5000, "la partida no termina");
    if (p.turno.ronda) {
      // Ronda: cada elemento se acierta con probabilidad 0,4 (ráfaga: hasta donde dé tiempo).
      p = aplicar(M.empezarLectura(M.empezarRonda(p).partida));
      const n = p.turno.rondaDatos.elementos.length;
      for (let i = 0; i < n; i++) {
        if (p.turno.rondaDatos.tipo === "lista") {
          if (azar() < 0.4) p = aplicar(M.marcarElemento(p, i));
        } else if (azar() < 0.8) p = aplicar(M.marcarRafaga(p, azar() < 0.5));
      }
      p = aplicar(M.terminarRonda(p, { tiempoAgotado: true }));
      p = aplicar(M.cerrarTurno(p, ctx));
      continue;
    }
    const apuesta = p.turno.esFinal ? p.turno.nivelFinal : 1 + Math.floor(azar() * 10);
    p = aplicar(M.apostar(p, apuesta, ctx));
    p = aplicar(M.empezarLectura(p));
    if (azar() < 0.05) p = aplicar(M.otraPregunta(p, "conocida", ctx));
    if (p.turno.reto) {
      // Reto final: cada descripción, acertada al 45 % (4 de 5 sale entonces 1 de cada 8 veces, más o menos).
      for (const _ of p.turno.finalDatos.elementos) p = aplicar(M.marcarRafaga(p, azar() < 0.45));
      p = aplicar(M.terminarReto(p, { tiempoAgotado: true }));
      p = aplicar(M.cerrarTurno(p, ctx));
      continue;
    }
    if (p.turno.preguntaDatos?.tipo === "mapa") {
      const q = p.turno.preguntaDatos;
      const nivel = ctx.indice.porId.get(p.turno.pregunta).nivelEfectivo;
      // Acierto: en el punto. Fallo: entre el borde de la zona de acierto y el doble, hacia el norte o el sur.
      const km = azar() < config.objetivo_acierto[nivel - 1] ? 0 : q.distancia_max_km * config.mapa.acierto_fraccion * (1 + azar());
      const lat = q.lat + (q.lat > 0 ? -1 : 1) * (km / 111.2);
      p = aplicar(M.senalar(p, { lat, lon: q.lon }, ctx));
      p = aplicar(M.cerrarTurno(p, ctx));
      continue;
    }
    p = aplicar(M.revelar(p));
    if (p.turno.final) {
      const { nivel_base, objetivo_acierto } = config.final;
      p = aplicar(M.juzgar(p, azar() < objetivo_acierto[p.turno.finalDatos.nivel - nivel_base]));
      p = aplicar(M.cerrarTurno(p, ctx));
      continue;
    }
    const nivel = ctx.indice.porId.get(p.turno.pregunta).nivelEfectivo;
    p = aplicar(M.juzgar(p, azar() < config.objetivo_acierto[nivel - 1]));
    if (azar() < 0.3) p = aplicar(M.valorar(p, ["facil", "justa", "dificil"][Math.floor(azar() * 3)]));
    p = aplicar(M.cerrarTurno(p, ctx));
  }
  return { p, registros, turnos, empates };
}

const leer = (ruta) => JSON.parse(readFileSync(new URL(`../app/${ruta}`, import.meta.url), "utf8"));

test("el banco real funciona con el motor: 50 partidas seguidas con las mismas vistas", () => {
  const preguntas = config.categorias.flatMap((c) => leer(c.archivo).preguntas);
  const finales = leer(config.final.archivo).finales;
  assert.ok(preguntas.length >= 400, `el banco tiene ${preguntas.length} preguntas`);
  const vistas = {}; // los mismos 4 amigos jugando 50 partidas: el banco se agota y entran las alternativas
  const alternativas = {};
  const deFinales = {};
  for (let s = 1; s <= 50; s++) {
    const { p, registros } = simular(s, 4, "media", preguntas, vistas, [], finales);
    assert.ok(p.ganador);
    assert.equal(new Set(p.usadas).size, p.usadas.length);
    for (const r of registros) if (r.tipo === "respuesta") alternativas[r.alternativa ?? "ninguna"] = (alternativas[r.alternativa ?? "ninguna"] ?? 0) + 1;
    for (const r of registros) if (r.tipo === "final") deFinales[r.alternativa ?? "ninguna"] = (deFinales[r.alternativa ?? "ninguna"] ?? 0) + 1;
    assert.equal(registros.at(-1).tipo, "final", "la partida acaba con una final propia");
  }
  assert.ok(alternativas.repetida > 0, "con el banco agotado se repiten preguntas vistas hace tiempo");
  assert.ok(deFinales.ninguna > 0 && deFinales.repetida > 0, `finales: ${JSON.stringify(deFinales)}`);
});

const RONDAS = rondasSinteticas(60);
// Unas 24 por escalón, como las reales: desde la fase 16 las finales son más difíciles y, con
// 4 jugadores, una de cada cien partidas pasa de 55 intentos, que agotarían un juego de 30.
const FINALES = finalesSinteticas(24);

test("300 partidas simuladas terminan y son coherentes, también con rondas", () => {
  const preguntas = bancoSintetico(2);
  let totalRondas = 0;
  let totalEmpates = 0;
  for (let s = 1; s <= 300; s++) {
    const nJugadores = 2 + (s % 5);
    const metaId = s % 2 ? "corta" : "media";
    const conRondas = s % 3 !== 0;
    const conFinales = s % 4 !== 0;
    const { p, registros, turnos, empates } = simular(s, nJugadores, metaId, preguntas, {}, conRondas ? RONDAS : [], conFinales ? FINALES : []);
    totalEmpates += empates;

    const ganador = p.jugadores.find((j) => j.clave === p.ganador);
    assert.ok(ganador, `partida ${s} sin ganador`);
    assert.equal(ganador.pos, p.meta);
    for (const j of p.jugadores) assert.ok(j.pos >= 0 && j.pos <= p.meta);

    const respuestas = registros.filter((r) => r.tipo === "respuesta");
    const rondas = registros.filter((r) => r.tipo === "ronda");
    const finales = registros.filter((r) => r.tipo === "final");
    assert.equal(respuestas.length + rondas.length + finales.length, turnos);
    // La última final de quien gana es un acierto (después pueden haber fallado otros al intentar empatar).
    const ultimo = registros.filter((r) => r.jugador === p.ganador && r.tipo !== "anulacion" && r.tipo !== "final_anulada").at(-1);
    assert.equal(conFinales ? ultimo.tipo : ultimo.es_final, conFinales ? "final" : true);
    assert.equal(ultimo.acierto, true);
    assert.equal(ultimo.ronda_oro, p.oro?.ronda ?? null, `partida ${s}: gana en una ronda de oro distinta de la última`);
    if (p.oro) assert.ok(p.empate.length > 1 && p.empate.includes(p.ganador));
    if (!conFinales) assert.equal(finales.length, 0);
    if (!conRondas) assert.equal(rondas.length, 0);
    totalRondas += rondas.length;
    assert.equal(new Set(p.usadas).size, p.usadas.length, `partida ${s}: pregunta repetida`);
  }
  assert.ok(totalRondas > 300, `pocas rondas jugadas: ${totalRondas}`);
  assert.ok(totalEmpates > 0, "ninguna partida ha acabado en empate");
});
