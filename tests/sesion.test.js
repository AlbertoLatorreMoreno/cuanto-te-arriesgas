import { test } from "node:test";
import assert from "node:assert/strict";
import { FASE } from "../app/js/motor.js";
import { Sesion, almacenEnMemoria } from "../app/js/sesion.js";
import { JUGADORES, contexto, responderSesion } from "./ayudas.js";

function sesionNueva() {
  const almacen = almacenEnMemoria();
  const s = Sesion.nueva({
    ctx: contexto(),
    almacen,
    dispositivo: "disp-1",
    versiones: { banco: "abc123", ajustes: "inicial" },
    id: "p1",
    jugadores: JUGADORES,
    metaId: "corta",
  });
  return { s, almacen };
}

async function turno(s, { apuesta = 4, acierto = true } = {}) {
  await s.ejecutar("apostar", s.turno.esFinal ? s.turno.nivelFinal : apuesta);
  await s.ejecutar("empezarLectura");
  await responderSesion(s, acierto);
  await s.ejecutar("cerrarTurno");
}

test("los registros se guardan completos con id, dispositivo y versiones", async () => {
  const { s, almacen } = sesionNueva();
  await turno(s);
  const regs = await almacen.todosLosRegistros();
  assert.equal(regs.length, 1);
  assert.match(regs[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(regs[0].dispositivo, "disp-1");
  assert.equal(regs[0].version_banco, "abc123");
  assert.equal(regs[0].version_ajustes, "inicial");
});

test("la partida se guarda tras cada acción y las vistas se marcan al leer", async () => {
  const { s, almacen } = sesionNueva();
  await s.ejecutar("apostar", 5);
  assert.equal(almacen.estado.guardada.partida.turno.fase, FASE.PASAR);
  assert.deepEqual(almacen.vistasDe("ana"), {});
  await s.ejecutar("empezarLectura");
  const id = s.turno.pregunta;
  assert.ok(almacen.vistasDe("ana")[id]);
  assert.ok(almacen.vistasDe("luis")[id]);
});

test("deshacer un turno cerrado restaura la partida y borra su registro", async () => {
  const { s, almacen } = sesionNueva();
  await turno(s, { apuesta: 7, acierto: true });
  assert.equal(s.partida.jugadores[0].pos, 7);
  assert.equal((await almacen.todosLosRegistros()).length, 1);

  await s.deshacer(); // deshace el cierre
  assert.equal(s.turno.fase, FASE.RESULTADO);
  assert.equal((await almacen.todosLosRegistros()).length, 0);
  await s.deshacer(); // deshace el juicio
  assert.equal(s.turno.fase, FASE.RESPUESTA);
  assert.equal(s.partida.jugadores[0].pos, 0);

  await s.ejecutar("juzgar", false);
  await s.ejecutar("cerrarTurno");
  const regs = await almacen.todosLosRegistros();
  assert.equal(regs.length, 1);
  assert.equal(regs[0].acierto, false);
});

test("deshacer «otra pregunta» borra la anulación y recupera la pregunta anterior", async () => {
  const { s, almacen } = sesionNueva();
  await s.ejecutar("apostar", 2);
  await s.ejecutar("empezarLectura");
  const primera = s.turno.pregunta;
  await s.ejecutar("otraPregunta", "ambigua");
  assert.equal((await almacen.todosLosRegistros())[0].tipo, "anulacion");
  await s.deshacer();
  assert.equal(s.turno.pregunta, primera);
  assert.equal((await almacen.todosLosRegistros()).length, 0);
});

test("la pila de deshacer tiene un límite y deshacer sin pila no hace nada", async () => {
  const { s } = sesionNueva();
  assert.equal(s.puedeDeshacer(), false);
  const antes = s.partida;
  assert.equal(await s.deshacer(), antes);
  for (let i = 0; i < 12; i++) await turno(s, { acierto: false });
  assert.equal(s.pila.length, 30);
});

test("una sesión se puede reanudar desde lo guardado", async () => {
  const { s, almacen } = sesionNueva();
  await turno(s, { apuesta: 3 });
  await s.ejecutar("apostar", 6);
  const { partida, pila } = almacen.cargarPartida();
  const s2 = new Sesion({ ctx: contexto(), almacen, dispositivo: "disp-1", versiones: s.versiones, partida, pila });
  assert.equal(s2.turno.fase, FASE.PASAR);
  assert.equal(s2.turno.apuesta, 6);
  await s2.deshacer();
  assert.equal(s2.turno.fase, FASE.ANUNCIO);
});

test("la sesión sabe si el navegador no dejó guardar la partida", async () => {
  const { s, almacen } = sesionNueva();
  assert.equal(s.guardadoOk, true);
  almacen.guardarPartida = () => false; // almacenamiento lleno
  await s.ejecutar("apostar", 3);
  assert.equal(s.guardadoOk, false);
  almacen.guardarPartida = () => true;
  await s.ejecutar("empezarLectura");
  assert.equal(s.guardadoOk, true);
});

test("si no se puede guardar un registro, la partida sigue y la sesión lo sabe", async () => {
  const { s, almacen } = sesionNueva();
  const guardar = almacen.guardarRegistro;
  almacen.guardarRegistro = async () => {
    throw new Error("QuotaExceededError");
  };
  await turno(s, { apuesta: 3 });
  assert.equal(s.registrosOk, false);
  assert.equal(s.partida.jugadores[0].pos, 3, "la partida avanza igual");
  assert.equal(s.turno.fase, FASE.ANUNCIO);
  almacen.guardarRegistro = guardar;
  await s.ejecutar("apostar", 2);
  assert.equal(s.registrosOk, false, "las acciones sin registro no cambian el estado");
  await s.ejecutar("empezarLectura");
  await responderSesion(s, false);
  await s.ejecutar("cerrarTurno");
  assert.equal(s.registrosOk, true);
  assert.equal((await almacen.todosLosRegistros()).length, 1);
});

test("acciones desconocidas o fuera de fase fallan sin estropear la partida", async () => {
  const { s } = sesionNueva();
  await assert.rejects(() => s.ejecutar("trampa"));
  await assert.rejects(() => s.ejecutar("revelar"));
  assert.equal(s.turno.fase, FASE.ANUNCIO);
  assert.equal(s.puedeDeshacer(), false);
});

test("una partida guardada se puede terminar aunque su pregunta ya no esté en el banco", async () => {
  const { s, almacen } = sesionNueva();
  await s.ejecutar("apostar", 5);
  await s.ejecutar("empezarLectura");
  const id = s.turno.pregunta;
  const { partida, pila } = almacen.cargarPartida();
  // El banco cambia entre sesiones: la pregunta del turno se retira.
  const ctx = contexto({ ajustes: { niveles: {}, retiradas: { [id]: "erronea" } } });
  assert.equal(ctx.indice.porId.has(id), false);
  const s2 = new Sesion({ ctx, almacen, dispositivo: "disp-1", versiones: s.versiones, partida, pila });
  await s2.ejecutar("revelar");
  await s2.ejecutar("juzgar", true);
  await s2.ejecutar("cerrarTurno");
  const reg = (await almacen.todosLosRegistros()).find((r) => r.tipo === "respuesta");
  assert.equal(reg.pregunta, id);
  assert.equal(reg.nivel_mostrado, 5);
});
