// Partidas con acciones al azar a través de la sesión real: deshacer en cualquier momento,
// cambiar la pregunta antes y después de ver la respuesta, valorar, marcar como mala y
// cerrar y reanudar la app a mitad de partida, con y sin narrador, jugar rondas divertidas
// (marcar, contar, cambiar la ronda) y finales propias (preguntas y retos «acierta k de n»).
// Tras cada paso se comprueban las reglas que nunca deben romperse.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rngConSemilla } from "../app/js/azar.js";
import * as M from "../app/js/motor.js";
import { Sesion, almacenEnMemoria } from "../app/js/sesion.js";
import { bancoSintetico, config, contexto, finalesSinteticas, rondasSinteticas } from "./ayudas.js";

const PREGUNTAS = bancoSintetico(4); // como el banco real: con menos, una partida larga agota los 3 subtemas de Localízalo
const RONDAS = rondasSinteticas(60); // de sobra: en una partida no debería repetirse ninguna
const FINALES = finalesSinteticas(24); // como las reales: con finales difíciles hay muchos intentos
const VERSIONES = { banco: "prueba", ajustes: "inicial" };

function elegir(azar, lista) {
  return lista[Math.floor(azar() * lista.length)];
}

async function comprobar(s, almacen, donde) {
  const p = s.partida;
  assert.ok(M.partidaReanudable(p), `${donde}: la partida no tiene una forma válida`);
  assert.ok(p.idx >= 0 && p.idx < p.jugadores.length, `${donde}: turno de un jugador que no existe`);
  for (const j of p.jugadores) assert.ok(j.pos >= 0 && j.pos <= p.meta, `${donde}: ${j.clave} fuera del tablero (${j.pos})`);
  assert.equal(new Set(p.usadas).size, p.usadas.length, `${donde}: pregunta repetida en la partida`);
  if (p.ganador) {
    // El ganador se decide al cerrar el turno, cuando ya no queda nadie que pueda empatar.
    const ganador = p.jugadores.find((j) => j.clave === p.ganador);
    assert.ok(ganador && ganador.pos === p.meta, `${donde}: el ganador no está en la meta`);
    assert.equal(p.turno.fase, M.FASE.FIN, `${donde}: hay ganador y la partida sigue`);
    assert.ok((p.oro ? p.oro.aciertos : p.acertantes).includes(p.ganador), `${donde}: gana alguien que no ha acertado la final`);
  } else if (p.turno.fase === M.FASE.FIN) {
    assert.ok(p.empate?.length > 1 && p.empate.every((c) => p.jugadores.find((j) => j.clave === c).pos === p.meta),
      `${donde}: partida terminada sin ganador ni empate`);
  }
  // Quien ha acertado la final ya no vuelve a jugar mientras se completa la ronda.
  if (p.acertantes?.length && !p.oro && p.turno.fase !== M.FASE.FIN) {
    assert.ok(p.turno.esFinal && p.jugadores.findIndex((j) => j.clave === p.acertantes[0]) <= p.idx, `${donde}: turno de más tras acertar la final`);
  }
  if (p.oro) assert.ok(p.oro.vivos.includes(p.turno.jugador) && p.turno.esFinal, `${donde}: en la ronda de oro juega alguien que no está empatado`);
  const registros = await almacen.todosLosRegistros();
  const respuestas = registros.filter((r) => r.tipo === "respuesta");
  const rondas = registros.filter((r) => r.tipo === "ronda");
  const finales = registros.filter((r) => r.tipo === "final");
  const turnos = [...respuestas, ...rondas, ...finales];
  // Cada turno cerrado deja exactamente un registro (deshacer lo borra), y nunca dos del mismo turno.
  const cerrados = p.n - 1 + (p.turno.fase === M.FASE.FIN ? 1 : 0);
  assert.equal(turnos.length, cerrados, `${donde}: ${turnos.length} turnos registrados para ${cerrados} turnos cerrados`);
  assert.equal(new Set(turnos.map((r) => r.turno)).size, turnos.length, `${donde}: dos registros del mismo turno`);
  for (const r of rondas) {
    assert.ok(p.especiales.length, `${donde}: ronda en una partida sin casillas especiales`);
    assert.equal(r.aciertos, r.marcados.length + r.extra, `${donde}: aciertos de la ronda mal contados`);
    assert.ok(r.marcados.every((i) => i >= 0 && i < r.total) && new Set(r.marcados).size === r.marcados.length, `${donde}: marcados imposibles`);
    assert.equal(r.leidos === null, r.tipo_ronda === "lista", `${donde}: «leidos» solo en las ráfagas`);
    if (r.tipo_ronda === "rafaga") assert.ok(r.marcados.every((i) => i < r.leidos), `${donde}: acierto en una descripción no leída`);
  }
  if (p.turno.ronda) assert.equal(p.turno.esFinal, false, `${donde}: ronda en la final`);
  if (p.turno.final) assert.equal(p.turno.esFinal, true, `${donde}: final propia fuera de la final`);
  for (const r of finales) {
    assert.ok(r.final && !("pregunta" in r), `${donde}: registro de final sin su id`);
    if (r.tipo_final === "reto") assert.equal(r.acierto, r.aciertos >= r.minimo, `${donde}: reto mal juzgado`);
    else assert.equal(r.aciertos, null, `${donde}: aciertos en una final que no es un reto`);
  }
  for (const r of registros) assert.ok(r.turno <= p.n, `${donde}: registro de un turno futuro`);
  for (const r of respuestas) {
    assert.equal(r.cronometro === null, r.tiempo_agotado === null, `${donde}: tiempo agotado sin cronómetro, o al revés`);
    if (!p.cronometro) assert.equal(r.cronometro, null, `${donde}: cronómetro en una partida sin él`);
  }
  if (p.narrador) {
    assert.notEqual(p.turno.fase, M.FASE.PASAR, `${donde}: con narrador no se pasa el móvil`);
    assert.equal(p.turno.lector, p.narrador.clave, `${donde}: con narrador, lee siempre el narrador`);
    for (const r of respuestas) assert.equal(r.lector, p.narrador.clave, `${donde}: respuesta leída por otro`);
  }
}

async function jugar(semilla) {
  const azar = rngConSemilla(semilla * 104729);
  const almacen = almacenEnMemoria();
  const nJugadores = 2 + (semilla % 5);
  const jugadores = Array.from({ length: nJugadores }, (_, i) => ({ clave: `j${i}`, nombre: `J${i}` }));
  const narrador = semilla % 3 === 0 ? { clave: "narra", nombre: "Narra" } : null;
  const conRondas = semilla % 5 !== 0;
  // Una de cada cuatro, sin finales propias (como si su archivo no cargara): la final sale del banco.
  const ctx = contexto({ semilla, preguntas: PREGUNTAS, rondas: RONDAS, finales: semilla % 4 === 3 ? [] : FINALES });
  let s = Sesion.nueva({ ctx, almacen, dispositivo: "prueba", versiones: VERSIONES, id: `p${semilla}`, jugadores, metaId: semilla % 2 ? "corta" : "media", narrador, cronometro: semilla % 4 < 2, rondas: conRondas });
  const cuenta = { deshacer: 0, reanudar: 0, anular: 0, mala: 0, narrador: narrador ? 1 : 0, rondas: 0, cambiarRonda: 0, retos: 0 };

  for (let paso = 0; paso < 3000; paso++) {
    const t = s.turno;
    if (t.fase === M.FASE.FIN && azar() < 0.7) break;
    if (t.fase === M.FASE.FIN && s.partida.empate && !s.partida.ganador && azar() < 0.8) {
      await s.ejecutar("rondaDeOro");
      cuenta.oro = (cuenta.oro ?? 0) + 1;
    } else if (s.puedeDeshacer() && azar() < 0.12) {
      await s.deshacer();
      cuenta.deshacer++;
    } else if (azar() < 0.04) {
      // Se cierra la app y se vuelve a abrir: nueva sesión con lo guardado.
      const guardada = JSON.parse(JSON.stringify(almacen.cargarPartida()));
      s = new Sesion({ ctx, almacen, dispositivo: "prueba", versiones: VERSIONES, partida: guardada.partida, pila: guardada.pila });
      cuenta.reanudar++;
    } else if (t.fase === M.FASE.ANUNCIO && t.ronda) {
      await s.ejecutar("empezarRonda");
    } else if (t.fase === M.FASE.ANUNCIO) {
      await s.ejecutar("apostar", t.esFinal ? t.nivelFinal : 1 + Math.floor(azar() * 10));
    } else if (t.fase === M.FASE.PASAR) {
      await s.ejecutar("empezarLectura");
    } else if (t.fase === M.FASE.LECTURA && t.ronda) {
      const r = azar();
      const n = t.rondaDatos.elementos.length;
      if (r < 0.05) {
        await s.ejecutar("cambiarRonda", elegir(azar, config.motivos_anulacion).id);
        cuenta.cambiarRonda++;
      } else if (t.rondaDatos.tipo === "lista" && r < 0.75) {
        await s.ejecutar("marcarElemento", Math.floor(azar() * n));
      } else if (t.rondaDatos.tipo === "lista" && !t.rondaDatos.cerrada && r < 0.85) {
        await s.ejecutar("contarOtro", azar() < 0.7 ? 1 : -1);
      } else if (t.rondaDatos.tipo === "rafaga" && t.indice < n && r < 0.85) {
        await s.ejecutar("marcarRafaga", azar() < 0.5);
      } else {
        await s.ejecutar("terminarRonda", { tiempoAgotado: azar() < 0.5 });
        cuenta.rondas++;
      }
    } else if (t.fase === M.FASE.LECTURA && t.reto) {
      const r = azar();
      if (r < 0.05) await s.ejecutar("otraPregunta", elegir(azar, config.motivos_anulacion).id);
      else if (t.indice < t.finalDatos.elementos.length && r < 0.85) await s.ejecutar("marcarRafaga", azar() < 0.6);
      else {
        await s.ejecutar("terminarReto", { tiempoAgotado: azar() < 0.5 });
        cuenta.retos++;
      }
    } else if (t.fase === M.FASE.LECTURA || t.fase === M.FASE.RESPUESTA) {
      if (azar() < 0.08) {
        await s.ejecutar("otraPregunta", elegir(azar, config.motivos_anulacion).id);
        cuenta.anular++;
      } else if (t.fase === M.FASE.LECTURA && t.preguntaDatos?.tipo === "mapa") {
        // Como una persona: a veces en el sitio y, si no, a una distancia de hasta el doble de la máxima.
        // (Tocando en cualquier parte del planeta casi nunca se puntúa y la partida se atasca en esa casilla.)
        const q = t.preguntaDatos;
        const km = azar() < 0.5 ? 0 : q.distancia_max_km * 2 * azar();
        await s.ejecutar("senalar", { lat: Math.max(-89, Math.min(89, q.lat + (azar() < 0.5 ? -1 : 1) * (km / 111.2))), lon: q.lon });
        cuenta.mapa = (cuenta.mapa ?? 0) + 1;
      } else if (t.fase === M.FASE.LECTURA) {
        await s.ejecutar("revelar", { tiempoAgotado: azar() < 0.3 });
      } else {
        await s.ejecutar("juzgar", azar() < 0.55);
      }
    } else if (t.fase === M.FASE.RESULTADO) {
      const r = azar();
      if (r < 0.2 && !t.ronda && !t.reto) await s.ejecutar("valorar", elegir(azar, [null, "facil", "justa", "dificil"]));
      else if (r < 0.3) {
        await s.ejecutar("marcarMala", elegir(azar, [null, ...config.motivos_mala.map((m) => m.id)]));
        cuenta.mala++;
      } else await s.ejecutar("cerrarTurno");
    } else {
      continue; // en FIN solo se puede deshacer
    }
    await comprobar(s, almacen, `partida ${semilla}, paso ${paso}`);
  }
  return cuenta;
}

test("200 partidas con acciones al azar, deshacer y reanudar mantienen las reglas", async () => {
  const total = { deshacer: 0, reanudar: 0, anular: 0, mala: 0, narrador: 0, rondas: 0, cambiarRonda: 0, retos: 0, oro: 0 };
  for (let semilla = 1; semilla <= 200; semilla++) {
    const cuenta = await jugar(semilla);
    for (const k in total) total[k] += cuenta[k] ?? 0;
  }
  // Que la prueba de verdad haya pasado por todos los caminos (los empates son raros: unos pocos).
  const minimo = (k) => (k === "oro" ? 2 : ["narrador", "cambiarRonda", "retos"].includes(k) ? 50 : 100);
  for (const [k, n] of Object.entries(total)) assert.ok(n > minimo(k), `pocas acciones de tipo ${k}: ${n}`);
});
