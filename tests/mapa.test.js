// Preguntas de mapa (Localízalo): distancia, puntos, proyección y el turno en el motor.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../app/js/motor.js";
import { aciertoMapa, desproyectar, distanciaKm, pasoKm, proyectar, puntosMapa } from "../app/js/geo.js";
import { JUGADORES, config, contexto } from "./ayudas.js";

const MAPA = config.categorias.find((c) => c.tipo === "mapa");
const FRACCION = config.mapa.acierto_fraccion; // la zona de acierto, en fracción de la distancia máxima

test("distancia sobre la Tierra (haversine)", () => {
  const madrid = { lat: 40.4168, lon: -3.7038 };
  const barcelona = { lat: 41.3874, lon: 2.1686 };
  assert.ok(Math.abs(distanciaKm(madrid, barcelona) - 505) < 3, "Madrid–Barcelona, unos 505 km");
  assert.equal(distanciaKm(madrid, madrid), 0);
  assert.ok(Math.abs(distanciaKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }) - 20015) < 5, "media vuelta al ecuador");
  // Cruzando el antimeridiano no da la vuelta larga.
  assert.ok(distanciaKm({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 }) < 120);
});

test("puntos: lo arriesgado menos uno por cada paso, y nada fuera de la zona de acierto", () => {
  // Con una zona de la mitad de la distancia máxima (500 km de 1000), repartida entre lo arriesgado.
  assert.equal(pasoKm(1000, 5, 0.5), 100);
  assert.equal(pasoKm(1000, 5, 0.25), 50, "la fracción sale de la configuración");
  assert.equal(pasoKm(1000, 5), 150, "por defecto, tres cuartos (750 km de 1000)");
  assert.deepEqual([0, 99, 100, 199, 499, 500, 5000].map((d) => puntosMapa(d, 5, 1000, 0.5)), [5, 5, 4, 4, 1, 0, 0]);
  // Cuanto más se arriesga, más corto es el paso: a la misma distancia se pierden más puntos.
  assert.equal(puntosMapa(300, 1, 1000, 0.5), 1);
  assert.equal(puntosMapa(300, 10, 1000, 0.5), 4);
  // Fuera de la zona no se suma nada, se arriesgue lo que se arriesgue: antes, con 10 y a 1900 km de
  // un sitio del resto del mundo (3000 km), se sumaban 4 puntos sin tener ni idea.
  assert.equal(puntosMapa(1900, 10, 3000, 0.5), 0);
  assert.equal(aciertoMapa(499, 1000, 0.5), true);
  assert.equal(aciertoMapa(500, 1000, 0.5), false, "en el borde de la zona ya no se suma nada: no es acierto");
  assert.equal(aciertoMapa(300, 1000, 0.25), false, "la fracción sale de la configuración");
  assert.equal(aciertoMapa(700, 1000), true, "por defecto, la zona es de tres cuartos");
});

test("acertar una de mapa es lo mismo que sumar al menos un punto", () => {
  for (const max of [200, 1000, 3000]) {
    for (let apuesta = 1; apuesta <= 10; apuesta++) {
      for (let d = 0; d <= max; d += max / 400) {
        assert.equal(puntosMapa(d, apuesta, max, FRACCION) > 0, aciertoMapa(d, max, FRACCION), `${d} km de ${max}, arriesgando ${apuesta}`);
      }
    }
  }
});

test("la proyección y su inversa coinciden, también al otro lado del Pacífico", () => {
  const { ancho, lat_max: latMax } = JSON.parse(readFileSync(new URL("../app/data/mapa.json", import.meta.url), "utf8"));
  for (const [lon, lat] of [[2.17, 41.39], [-74.0, 40.7], [151.2, -33.86], [-175.07, -19.75], [0, 0]]) {
    const { x, y } = proyectar(lon, lat, ancho, latMax);
    assert.ok(x >= 0 && x <= ancho && y >= 0 && y <= ancho);
    const vuelta = desproyectar(x, y, ancho, latMax);
    assert.ok(Math.abs(vuelta.lon - lon) < 1e-9 && Math.abs(vuelta.lat - lat) < 1e-9, `${lon}, ${lat}`);
    // El mapa se dibuja dos veces seguidas: un toque en la segunda copia es el mismo punto.
    const copia = desproyectar(x + ancho, y, ancho, latMax);
    assert.ok(Math.abs(copia.lon - lon) < 1e-9);
  }
  assert.equal(proyectar(0, 0, ancho, latMax).y, ancho / 2, "el ecuador, en el centro");
});

// Partida de dos en la que a Ana le toca una pregunta de mapa (se fuerza la categoría del anuncio).
function turnoDeMapa({ apuesta = 5, ctx = contexto() } = {}) {
  let p = M.nuevaPartida({ id: "m1", jugadores: JUGADORES.slice(0, 2), metaId: "corta" }, ctx).partida;
  p = structuredClone(p);
  p.turno.categoria = MAPA.id;
  p.turno.subtema = MAPA.subtemas[0].id;
  p = M.empezarLectura(M.apostar(p, apuesta, ctx).partida).partida;
  return { p, ctx, q: p.turno.preguntaDatos };
}

// Un punto a `km` al norte o al sur del correcto, por el mismo meridiano.
const aDistancia = (q, km) => ({ lat: q.lat + (q.lat > 0 ? -1 : 1) * (km / 111.195), lon: q.lon });

test("turno de mapa: se señala en vez de ver la respuesta, y se avanza lo que se puntúa", () => {
  const { p, ctx, q } = turnoDeMapa({ apuesta: 5 });
  assert.equal(q.tipo, "mapa");
  assert.ok(Number.isFinite(q.lat) && Number.isFinite(q.distancia_max_km), "el turno copia el punto y la distancia");
  assert.throws(() => M.revelar(p), /mapa/);
  assert.throws(() => M.senalar(p, { lat: 95, lon: 0 }, ctx), /mapa/);

  const D = q.distancia_max_km;
  const R = D * FRACCION; // la zona de acierto; arriesgando 5, cada paso es R / 5
  const casos = [
    [0, 5, true],
    [0.26 * R, 4, true], // algo más de un paso: pierde uno
    [0.7 * R, 2, true],
    [1.2 * R, 0, false], // fuera de la zona de acierto: no avanza nada
    [3 * D, 0, false],
  ];
  for (const [km, puntos, acierto] of casos) {
    const r = M.senalar(p, aDistancia(q, km), ctx).partida;
    assert.equal(r.turno.fase, M.FASE.RESULTADO);
    assert.equal(r.turno.mapa.puntos, puntos, `a ${km} km`);
    assert.equal(r.turno.acierto, acierto, `a ${km} km`);
    assert.equal(r.jugadores[0].pos, puntos);
    assert.equal(r.jugadores[0][acierto ? "aciertos" : "fallos"], 1);
    assert.ok(Math.abs(r.turno.mapa.distancia_km - km) <= 1);
    const reg = M.cerrarTurno(r, ctx).registros[0];
    assert.equal(reg.tipo, "respuesta");
    assert.deepEqual([reg.puntos, reg.acierto, reg.distancia_max_km], [puntos, acierto, D]);
    assert.ok(Number.isFinite(reg.lat_senalada) && Number.isFinite(reg.lon_senalada) && Number.isFinite(reg.distancia_km));
  }
  assert.equal(p.jugadores[0].pos, 0, "la partida original no cambia");
});

test("una pregunta normal no se puede señalar, y su registro no lleva campos de mapa", () => {
  const ctx = contexto();
  let p = M.nuevaPartida({ id: "m2", jugadores: JUGADORES.slice(0, 2), metaId: "corta" }, ctx).partida;
  p = structuredClone(p);
  p.turno.categoria = "ciencias";
  p.turno.subtema = "fisica";
  p = M.empezarLectura(M.apostar(p, 3, ctx).partida).partida;
  assert.throws(() => M.senalar(p, { lat: 0, lon: 0 }, ctx), /mapa/);
  const reg = M.cerrarTurno(M.juzgar(M.revelar(p).partida, true).partida, ctx).registros[0];
  assert.equal("puntos" in reg, false);
});

test("una final de mapa (sin finales propias) se gana si cuenta como acierto", () => {
  const ctx = contexto();
  let p = M.nuevaPartida({ id: "m3", jugadores: JUGADORES.slice(0, 2), metaId: "corta" }, ctx).partida;
  p.jugadores[0].pos = 25;
  p.jugadores[1].pos = 25;
  // Ana tenía preparado un turno normal (se ha puesto en la meta después): lo falla con una de ciencias.
  p.turno.categoria = "ciencias";
  p.turno.subtema = "fisica";
  p = M.cerrarTurno(M.juzgar(M.revelar(M.empezarLectura(M.apostar(p, 3, ctx).partida).partida).partida, false).partida, ctx).partida;
  // Luis está en la meta: le toca la final, de una categoría al azar; se fuerza la de mapa.
  p = structuredClone(p);
  assert.equal(p.turno.esFinal, true);
  p.turno.categoria = MAPA.id;
  p.turno.subtema = MAPA.subtemas[0].id;
  p = M.empezarLectura(M.apostar(p, p.turno.nivelFinal, ctx).partida).partida;
  const q = p.turno.preguntaDatos;
  assert.equal(q.tipo, "mapa");
  const lejos = M.senalar(p, aDistancia(q, 1.2 * FRACCION * q.distancia_max_km), ctx).partida;
  assert.equal(lejos.ganador, null);
  assert.equal(lejos.turno.mapa.puntos, null, "en la final no se suman puntos");
  assert.equal(lejos.jugadores[1].finalesFalladas, 1);
  const cerca = M.senalar(p, aDistancia(q, 0.8 * FRACCION * q.distancia_max_km), ctx).partida;
  assert.deepEqual(cerca.acertantes, [JUGADORES[1].clave]);
  assert.equal(M.cerrarTurno(cerca, ctx).partida.ganador, JUGADORES[1].clave, "Ana, que va antes, no juega otra vez: gana Luis");
});
