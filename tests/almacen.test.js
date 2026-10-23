// Jugadores recordados: olvidar a uno (a mano o por llevar mucho sin jugar) borra su nombre,
// sus preguntas vistas y revisadas y las preferencias que lo nombran, pero nunca sus registros.

import { test } from "node:test";
import assert from "node:assert/strict";
import { crearAlmacen, jugadoresInactivos } from "../app/js/almacen.js";
import { config } from "./ayudas.js";

// localStorage mínimo en memoria (en Node no hay; sin IndexedDB, el almacén guarda los registros en memoria).
function localStorageFalso() {
  const datos = new Map();
  return {
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => datos.set(k, String(v)),
    removeItem: (k) => datos.delete(k),
    claves: () => [...datos.keys()],
  };
}

async function almacenDePrueba() {
  Object.defineProperty(globalThis, "localStorage", { value: localStorageFalso(), configurable: true, writable: true });
  return crearAlmacen();
}

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date("2026-10-18T12:00:00Z");
const haceDias = (n) => new Date(AHORA.getTime() - n * DIA).toISOString();

test("el plazo para olvidar está en la configuración", () => {
  assert.equal(config.jugadores.olvidar_tras_dias, 180);
});

test("jugadoresInactivos: más del plazo sin jugar, salvo los de la partida a medias y las fechas raras", () => {
  const lista = [
    { clave: "ana", ultima: haceDias(10) },
    { clave: "luis", ultima: haceDias(181) },
    { clave: "marta", ultima: haceDias(400) },
    { clave: "rara", ultima: "no es una fecha" },
    { clave: "sin fecha" },
    { clave: "justo", ultima: haceDias(180) },
  ];
  const claves = (xs) => xs.map((j) => j.clave);
  assert.deepEqual(claves(jugadoresInactivos(lista, { ahora: AHORA, dias: 180 })), ["luis", "marta"]);
  assert.deepEqual(claves(jugadoresInactivos(lista, { ahora: AHORA, dias: 180, protegidos: new Set(["marta"]) })), ["luis"]);
  assert.deepEqual(jugadoresInactivos(lista, { ahora: AHORA, dias: 0 }), [], "con plazo 0 (o sin plazo) no se olvida a nadie");
  assert.deepEqual(jugadoresInactivos(lista, { ahora: AHORA, dias: undefined }), []);
});

test("olvidar a un jugador borra su nombre, sus vistas, sus revisadas y sus preferencias, y nada más", async () => {
  const almacen = await almacenDePrueba();
  almacen.recordarJugadores([{ clave: "ana", nombre: "Ana" }, { clave: "jose", nombre: "José" }], haceDias(1));
  almacen.marcarVistas([["ana", "q1"], ["ana", "q2"], ["jose", "q1"]], haceDias(1));
  almacen.marcarRevisada("ana", "q3", haceDias(1));
  almacen.marcarRevisada("jose", "q4", haceDias(1));
  almacen.guardarPreferencia("evaluador", { clave: "jose", nombre: "José" });
  almacen.guardarPreferencia("narrador", "  JOSÉ ");
  almacen.guardarPreferencia("metaId", "media");
  const registro = { id: "r1", tipo: "respuesta", jugador: "jose", lector: "ana", pregunta: "q1" };
  await almacen.guardarRegistro(registro);
  await almacen.guardarRegistro({ id: "r2", tipo: "revision", evaluador: "jose", pregunta: "q4" });

  almacen.olvidarJugador("jose");

  assert.deepEqual(almacen.jugadoresConocidos().map((j) => j.clave), ["ana"]);
  assert.deepEqual(almacen.vistasDe("jose"), {});
  assert.deepEqual(Object.keys(almacen.vistasDe("ana")), ["q1", "q2"]);
  assert.deepEqual(almacen.revisadasDe("jose"), {});
  assert.deepEqual(Object.keys(almacen.revisadasDe("ana")), ["q3"]);
  assert.equal(almacen.preferencia("evaluador", null), null, "no vuelve a salir como quien revisa");
  assert.equal(almacen.preferencia("narrador", null), null, "no vuelve a salir como narrador");
  assert.equal(almacen.preferencia("metaId", null), "media");
  assert.deepEqual((await almacen.todosLosRegistros()).map((r) => r.id).sort(), ["r1", "r2"], "los registros siguen para R");

  // Las preferencias de otra persona no se tocan.
  almacen.guardarPreferencia("evaluador", { clave: "ana", nombre: "Ana" });
  almacen.olvidarJugador("nadie");
  assert.equal(almacen.preferencia("evaluador", null).clave, "ana");
  assert.equal(almacen.jugadoresConocidos().length, 1);

  // Lo olvidado no reaparece al crear de nuevo el almacén (se ha guardado, no solo en memoria).
  const otra = await crearAlmacen();
  assert.deepEqual(otra.vistasDe("jose"), {});
  assert.deepEqual(otra.jugadoresConocidos().map((j) => j.clave), ["ana"]);
});

test("olvidarInactivos olvida a los que llevan más del plazo sin jugar, salvo los protegidos", async () => {
  const almacen = await almacenDePrueba();
  almacen.recordarJugadores([{ clave: "ana", nombre: "Ana" }], haceDias(3));
  almacen.recordarJugadores([{ clave: "yo", nombre: "yo" }, { clave: "tu", nombre: "tú" }], haceDias(200));
  almacen.recordarJugadores([{ clave: "luis", nombre: "Luis" }], haceDias(365));
  almacen.marcarVistas([["yo", "q1"], ["luis", "q2"], ["ana", "q3"]], haceDias(200));
  await almacen.guardarRegistro({ id: "r1", tipo: "respuesta", jugador: "yo", pregunta: "q1" });

  const olvidados = almacen.olvidarInactivos({ ahora: AHORA, dias: 180, protegidos: new Set(["luis"]) });

  assert.deepEqual(olvidados.map((j) => j.clave).sort(), ["tu", "yo"]);
  assert.deepEqual(almacen.jugadoresConocidos().map((j) => j.clave), ["ana", "luis"]);
  assert.deepEqual(almacen.vistasDe("yo"), {});
  assert.deepEqual(Object.keys(almacen.vistasDe("luis")), ["q2"], "quien está en la partida a medias se queda");
  assert.equal((await almacen.todosLosRegistros()).length, 1);
  assert.deepEqual(almacen.olvidarInactivos({ ahora: AHORA, dias: 180 }).map((j) => j.clave), ["luis"], "sin protección, también se olvida");
});

test("datos estropeados en localStorage no impiden arrancar ni jugar", async () => {
  await almacenDePrueba();
  localStorage.setItem("cta.jugadores", JSON.stringify({ ana: 1 })); // un objeto en vez de una lista
  localStorage.setItem("cta.vistas", JSON.stringify([1, 2]));
  localStorage.setItem("cta.revisadas", JSON.stringify("texto"));
  let almacen = await crearAlmacen();
  assert.deepEqual(almacen.jugadoresConocidos(), []);
  assert.deepEqual(almacen.olvidarInactivos({ ahora: AHORA, dias: 180 }), []);
  assert.deepEqual(almacen.vistasDe("ana"), {});
  assert.deepEqual(almacen.revisadasDe("ana"), {});
  almacen.recordarJugadores([{ clave: "ana", nombre: "Ana" }], haceDias(1));
  almacen.marcarVistas([["ana", "q1"]], haceDias(1));
  almacen.marcarRevisada("ana", "q2", haceDias(1));
  almacen = await crearAlmacen();
  assert.deepEqual(almacen.jugadoresConocidos().map((j) => j.clave), ["ana"]);
  assert.deepEqual(Object.keys(almacen.vistasDe("ana")), ["q1"], "las vistas se guardan aunque lo anterior estuviera roto");
  assert.deepEqual(Object.keys(almacen.revisadasDe("ana")), ["q2"]);

  // Entradas sin clave (o que no son objetos) se ignoran.
  localStorage.setItem("cta.jugadores", JSON.stringify([null, 3, { nombre: "Sin clave" }, { clave: "luis", nombre: "Luis", ultima: haceDias(2) }]));
  assert.deepEqual(almacen.jugadoresConocidos().map((j) => j.clave), ["luis"]);
});

test("los jugadores de una misma partida salen en su orden y los más recientes primero", async () => {
  const almacen = await almacenDePrueba();
  almacen.recordarJugadores([{ clave: "viejo", nombre: "Viejo" }], haceDias(9));
  almacen.recordarJugadores(["ana", "luis", "marta", "ines", "pepe"].map((clave) => ({ clave, nombre: clave })), haceDias(1));
  assert.deepEqual(almacen.jugadoresConocidos().map((j) => j.clave), ["ana", "luis", "marta", "ines", "pepe", "viejo"]);
});

test("dos pestañas abiertas no se borran las preguntas vistas la una a la otra", async () => {
  await almacenDePrueba();
  const pestanaA = await crearAlmacen();
  const pestanaB = await crearAlmacen(); // abierta a la vez: su copia en memoria no sabe lo que hace la otra
  pestanaA.marcarVistas([["ana", "q1"]], haceDias(0));
  pestanaB.marcarVistas([["luis", "q2"]], haceDias(0));
  const despues = await crearAlmacen();
  assert.deepEqual(Object.keys(despues.vistasDe("ana")), ["q1"], "lo que vio Ana en la pestaña A sigue ahí");
  assert.deepEqual(Object.keys(despues.vistasDe("luis")), ["q2"]);
  pestanaB.olvidarJugador("luis");
  assert.deepEqual(Object.keys((await crearAlmacen()).vistasDe("ana")), ["q1"], "olvidar en una pestaña no borra lo de la otra");
});

test("volver a jugar renueva la fecha: quien juega no se olvida", async () => {
  const almacen = await almacenDePrueba();
  almacen.recordarJugadores([{ clave: "ana", nombre: "Ana" }], haceDias(300));
  almacen.recordarJugadores([{ clave: "ana", nombre: "Ana" }], haceDias(2));
  assert.deepEqual(almacen.olvidarInactivos({ ahora: AHORA, dias: 180 }), []);
  assert.equal(almacen.jugadoresConocidos().length, 1);
});
