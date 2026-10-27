// Envío de datos a la hoja del grupo (app/js/envio.js) con un `fetch` simulado, y lo que recuerda el
// almacén: qué partidas y valoraciones se aceptó enviar y qué se ha enviado ya.

import { test } from "node:test";
import assert from "node:assert/strict";
import { crearAlmacen } from "../app/js/almacen.js";
import { TANDA, enviarRegistros, errorDireccion, porEnviar, revisionesSinDecidir } from "../app/js/envio.js";

const URL_SCRIPT = "https://script.google.com/macros/s/AKfy-prueba/exec";
const VERSIONES = { banco: "b1", ajustes: "a1" };
const registro = (id, extra = {}) => ({ id, tipo: "respuesta", ts: "2026-10-26T10:00:00.000Z", partida: "p1", ...extra });
const revision = (id, extra = {}) => ({ id, tipo: "revision", ts: "2026-10-26T10:00:00.000Z", evaluador: "ana", ...extra });

// Un script simulado: guarda los ids que recibe y contesta como el de verdad (o como se le diga).
function scriptFalso({ responder = null } = {}) {
  const peticiones = [];
  const guardados = new Set();
  const fetch = async (url, opciones) => {
    const cuerpo = JSON.parse(opciones.body);
    peticiones.push({ url, opciones, cuerpo });
    const respuesta = responder?.(cuerpo, peticiones.length);
    if (respuesta) return respuesta;
    const ids = cuerpo.exportacion.registros.map((r) => r.id);
    const nuevos = ids.filter((id) => !guardados.has(id));
    for (const id of ids) guardados.add(id);
    return Response.json({ ok: true, nuevos: nuevos.length, repetidos: ids.length - nuevos.length });
  };
  return { fetch, peticiones, guardados };
}

const enviar = (registros, script) =>
  enviarRegistros(registros, { url: URL_SCRIPT, dispositivo: "dispo-1", versiones: VERSIONES, fetch: script.fetch, ahora: () => "2026-10-26T12:00:00.000Z" });

test("la dirección del script tiene que ser https (o el propio ordenador, para probar)", () => {
  assert.equal(errorDireccion(URL_SCRIPT), null);
  assert.equal(errorDireccion("http://127.0.0.1:8011/exec"), null);
  assert.match(errorDireccion("script.google.com/macros"), /no es válida/);
  assert.match(errorDireccion("http://script.google.com/macros/s/x/exec"), /https/);
  assert.match(errorDireccion(""), /no es válida/);
});

test("por enviar: solo lo que el grupo aceptó, sin lo ya enviado ni la partida a medias", () => {
  const registros = [
    registro("a1"), registro("a2"), // partida p1: aceptada
    registro("b1", { partida: "p2" }), // p2: rechazada
    registro("c1", { partida: "p3" }), // p3: sin contestar
    registro("d1", { partida: "p4" }), // p4: aceptada, pero sigue a medias (ronda de oro)
    revision("r1"), revision("r2"), revision("r3"), // r1 aceptada, r2 rechazada, r3 sin contestar
  ];
  const decisiones = { enviados: new Set(["a2"]), partidas: { p1: true, p2: false, p4: true }, revisiones: { r1: true, r2: false } };
  assert.deepEqual(porEnviar(registros, decisiones, "p4").map((r) => r.id), ["a1", "r1"]);
  assert.deepEqual(porEnviar(registros, decisiones).map((r) => r.id), ["a1", "d1", "r1"], "acabada la partida, también lo suyo");
  assert.deepEqual(revisionesSinDecidir(registros, decisiones.revisiones).map((r) => r.id), ["r3"]);
});

test("envía una exportación normal, como texto plano, sin código y sin cookies", async () => {
  const script = scriptFalso();
  const r = await enviar([registro("b", { ts: "2026-10-26T11:00:00.000Z" }), registro("a")], script);
  assert.deepEqual(r, { ok: true, enviados: ["a", "b"], nuevos: 2, error: null });
  const [{ url, opciones, cuerpo }] = script.peticiones;
  assert.equal(url, URL_SCRIPT);
  assert.equal(opciones.method, "POST");
  assert.equal(opciones.headers["Content-Type"], "text/plain;charset=utf-8", "petición simple: sin consulta previa de CORS");
  assert.equal(opciones.credentials, "omit");
  assert.deepEqual(Object.keys(cuerpo).sort(), ["accion", "exportacion"], "enviar no lleva código");
  assert.equal(cuerpo.accion, "enviar");
  assert.deepEqual(
    [cuerpo.exportacion.formato, cuerpo.exportacion.app, cuerpo.exportacion.dispositivo, cuerpo.exportacion.version_banco, cuerpo.exportacion.exportado],
    [1, "cuanto-te-arriesgas", "dispo-1", "b1", "2026-10-26T12:00:00.000Z"],
  );
  assert.deepEqual(cuerpo.exportacion.registros.map((x) => x.id), ["a", "b"], "de los más antiguos a los más nuevos");
  assert.deepEqual(await enviar([registro("a")], script), { ok: true, enviados: ["a"], nuevos: 0, error: null }, "reenviar no hace daño");
  assert.deepEqual(await enviar([], script), { ok: true, enviados: [], nuevos: 0, error: null });
  assert.equal(script.peticiones.length, 2, "sin nada que enviar no se conecta");
});

test("muchos registros van por tandas; si una falla, lo anterior queda enviado", async () => {
  const registros = Array.from({ length: TANDA * 2 + 3 }, (_, i) => registro(`r${String(i).padStart(4, "0")}`));
  const bien = scriptFalso();
  const r = await enviar(registros, bien);
  assert.deepEqual([r.ok, r.enviados.length, r.nuevos, bien.peticiones.length], [true, registros.length, registros.length, 3]);
  assert.ok(bien.peticiones.every((p) => p.cuerpo.exportacion.registros.length <= TANDA));

  const cortado = scriptFalso({ responder: (_, n) => (n === 2 ? new Response("Error", { status: 500 }) : null) });
  const r2 = await enviar(registros, cortado);
  assert.deepEqual([r2.ok, r2.enviados.length, cortado.peticiones.length], [false, TANDA, 2]);
  assert.match(r2.error, /error 500/);
});

test("los fallos se explican: sin conexión, respuesta que no es del script, cupo del día", async () => {
  const sinRed = await enviar([registro("a")], { fetch: async () => { throw new TypeError("Failed to fetch"); } });
  assert.deepEqual([sinRed.ok, sinRed.enviados, sinRed.error], [false, [], "No hay conexión con el script."]);
  const pagina = await enviar([registro("a")], { fetch: async () => new Response("<html>Iniciar sesión</html>") });
  assert.match(pagina.error, /config\.json/, "p. ej., la dirección de edición en vez de la de la aplicación web");
  const otraCosa = await enviar([registro("a")], { fetch: async () => Response.json({ hola: 1 }) });
  assert.match(otraCosa.error, /config\.json/);
  const cupo = await enviar([registro("a")], { fetch: async () => Response.json({ ok: false, error: "cupo", mensaje: "x" }) });
  assert.match(cupo.error, /más adelante/);
});

test("el almacén recuerda qué se aceptó enviar y qué se ha enviado", async () => {
  const datos = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => datos.set(k, String(v)), removeItem: (k) => datos.delete(k) },
    configurable: true,
    writable: true,
  });
  const almacen = await crearAlmacen();
  assert.deepEqual([[...almacen.idsEnviados()], almacen.decisionesPartidas(), almacen.decisionesRevisiones()], [[], {}, {}]);
  almacen.marcarEnviados(["a", "b"]);
  almacen.marcarEnviados(["b", "c"]);
  assert.deepEqual([...almacen.idsEnviados()].sort(), ["a", "b", "c"]);
  almacen.decidirPartida("p1", true);
  almacen.decidirPartida("p2", false);
  almacen.decidirRevisiones(["r1", "r2"], true);
  almacen.decidirRevisiones(["r3"], false);
  assert.deepEqual(almacen.decisionesPartidas(), { p1: true, p2: false });
  assert.deepEqual(almacen.decisionesRevisiones(), { r1: true, r2: true, r3: false });
  datos.set("cta.enviados", "{roto");
  assert.deepEqual([...almacen.idsEnviados()], [], "algo ilegible cuenta como nada enviado: se reenvía, y no se duplica");
});
