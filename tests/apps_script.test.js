// El Apps Script que recibe los envíos (herramientas/apps_script.gs), ejecutado con una hoja de cálculo
// y unos servicios de Google simulados: envío abierto con límites, descarga con código, repetidos y tandas.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const FUENTE = readFileSync(new URL("../herramientas/apps_script.gs", import.meta.url), "utf8");
const CODIGO = "codigo-de-prueba";

// Hoja simulada: una matriz de celdas (fila 1 = cabecera), con lo que usa el script.
function hojaFalsa() {
  const celdas = [];
  const formatos = [];
  const rango = (fila, col, nf, nc) => ({
    getValues: () => Array.from({ length: nf }, (_, i) => Array.from({ length: nc }, (_, j) => celdas[fila - 1 + i]?.[col - 1 + j] ?? "")),
    setValues(valores) {
      assert.equal(valores.length, nf);
      valores.forEach((v, i) => {
        assert.equal(v.length, nc);
        celdas[fila - 1 + i] = [...v];
      });
    },
    setNumberFormat: (f) => formatos.push([fila, nf, f]),
  });
  return {
    celdas,
    formatos,
    appendRow: (fila) => celdas.push([...fila]),
    setFrozenRows() {},
    getLastRow: () => celdas.length,
    getRange: rango,
  };
}

function cargar({ codigo = CODIGO } = {}) {
  const libro = { hojas: new Map() };
  const servicios = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => libro.hojas.get(n) ?? null,
        insertSheet: (n) => {
          const nueva = hojaFalsa();
          libro.hojas.set(n, nueva);
          return nueva;
        },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (texto) => ({ texto, setMimeType() { return this; } }) },
  };
  const linea = /^const CODIGO_DESCARGA = "";$/m;
  assert.ok(linea.test(FUENTE), "el script ya no tiene la línea del código, vacía");
  const fuente = FUENTE.replace(linea, `const CODIGO_DESCARGA = ${JSON.stringify(codigo)};`);
  const script = vm.runInNewContext(`${fuente}\n;({ doGet, doPost })`, servicios);
  const post = (cuerpo) => JSON.parse(script.doPost({ postData: { contents: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) } }).texto);
  return { post, get: () => JSON.parse(script.doGet().texto), libro, hoja: () => libro.hojas.get("registros") };
}

const registro = (id, extra = {}) => ({ id, tipo: "respuesta", ts: "2026-10-26T10:00:00.000Z", dispositivo: "movil-prueba-1", jugador: "ana", acierto: true, ...extra });
const exportacion = (registros) => ({ formato: 1, app: "cuanto-te-arriesgas", exportado: "2026-10-26T10:00:00.000Z", dispositivo: "movil-prueba-1", registros });
const enviar = (s, registros) => s.post({ accion: "enviar", exportacion: exportacion(registros) });

test("enviar no pide código; guarda cada registro una sola vez aunque se reenvíe", () => {
  const s = cargar();
  assert.deepEqual(enviar(s, []), { ok: true, nuevos: 0, repetidos: 0 });
  assert.deepEqual(s.hoja().celdas, [["recibido", "id", "tipo", "ts", "dispositivo", "registro"]]);
  assert.deepEqual(enviar(s, [registro("a1"), registro("a2"), registro("a1")]), { ok: true, nuevos: 2, repetidos: 1 });
  assert.deepEqual(enviar(s, [registro("a2"), registro("a3", { tipo: "revision" })]), { ok: true, nuevos: 1, repetidos: 1 });
  assert.deepEqual(s.hoja().celdas.slice(1).map((f) => f.slice(1, 5)), [
    ["a1", "respuesta", "2026-10-26T10:00:00.000Z", "movil-prueba-1"],
    ["a2", "respuesta", "2026-10-26T10:00:00.000Z", "movil-prueba-1"],
    ["a3", "revision", "2026-10-26T10:00:00.000Z", "movil-prueba-1"],
  ]);
  assert.deepEqual(JSON.parse(s.hoja().celdas[1][5]), registro("a1"), "el registro entero, tal cual");
  assert.ok(s.hoja().formatos.every(([, , f]) => f === "@"), "las celdas nuevas, como texto");
  assert.deepEqual(s.get(), { ok: true, app: "cuanto-te-arriesgas", mensaje: "El script funciona. Los datos se envían desde la app." }, "abrir la dirección no enseña datos");
});

test("descargar sí pide el código, que tiene que estar puesto en el script", () => {
  const s = cargar();
  enviar(s, [registro("a1")]);
  assert.equal(s.post({ accion: "descargar" }).error, "codigo");
  assert.equal(s.post({ accion: "descargar", codigo: "otro-codigo" }).error, "codigo");
  assert.deepEqual(s.post({ accion: "descargar", codigo: CODIGO }).registros, [registro("a1")]);
  for (const codigo of ["", "corto"]) assert.equal(cargar({ codigo }).post({ accion: "descargar", codigo }).error, "sin_codigo");
  assert.equal(s.post("no es json").error, "formato");
  assert.equal(s.post({ accion: "borrar" }).error, "accion");
});

test("enviar está abierto, así que rechaza lo raro: otra app, tipos desconocidos, fórmulas y tamaños", () => {
  const s = cargar();
  assert.equal(s.post({ accion: "enviar", exportacion: { ...exportacion([]), app: "otra" } }).error, "formato");
  assert.equal(s.post({ accion: "enviar", exportacion: { ...exportacion([]), formato: 2 } }).error, "formato");
  assert.equal(enviar(s, [registro("=IMPORTXML(1)")]).error, "formato", "un id que la hoja tomaría por fórmula");
  assert.equal(enviar(s, [registro("b1", { tipo: "otra_cosa" })]).error, "formato");
  assert.equal(enviar(s, [registro("b1", { relleno: "x".repeat(25000) })]).error, "tamano");
  assert.equal(enviar(s, Array.from({ length: 501 }, (_, i) => registro(`c${i}`))).error, "tamano");
  assert.equal(s.libro.hojas.size, 0, "nada de eso llega a crear la hoja");
  // Una fecha o un dispositivo con forma rara no impiden guardar: esa celda se queda vacía (el registro va entero).
  assert.deepEqual(enviar(s, [registro("d1", { ts: "=AHORA()", dispositivo: "+34 600" })]), { ok: true, nuevos: 1, repetidos: 0 });
  assert.deepEqual(s.hoja().celdas[1].slice(1, 5), ["d1", "respuesta", "", ""]);
});

test("como mucho 3000 filas nuevas al día", () => {
  const s = cargar();
  enviar(s, [registro("primero")]);
  const hoy = s.hoja().celdas[1][0].slice(0, 10);
  for (let i = 0; i < 2998; i++) s.hoja().celdas.push([`${hoy}T08:00:00.000Z`, `relleno-${i}`, "respuesta", "", "", "{}"]);
  s.hoja().celdas.push(["2020-01-01T08:00:00.000Z", "de-otro-dia", "respuesta", "", "", "{}"]);
  assert.deepEqual(enviar(s, [registro("e1")]), { ok: true, nuevos: 1, repetidos: 0 }, "la 3000.ª de hoy aún cabe");
  assert.equal(enviar(s, [registro("e2")]).error, "cupo");
  assert.deepEqual(enviar(s, [registro("e1")]), { ok: true, nuevos: 0, repetidos: 1 }, "reenviar lo que ya está no gasta cupo");
});

test("descarga por tandas, y salta las celdas tocadas a mano", () => {
  const s = cargar();
  enviar(s, Array.from({ length: 5 }, (_, i) => registro(`e${i}`)));
  s.hoja().celdas[3][5] = "{roto";
  const r1 = s.post({ codigo: CODIGO, accion: "descargar", desde: 0, cuantos: 3 });
  assert.deepEqual([r1.ok, r1.total, r1.registros.map((r) => r.id), r1.ilegibles, r1.siguiente], [true, 5, ["e0", "e1"], 1, 3]);
  const r2 = s.post({ codigo: CODIGO, accion: "descargar", desde: r1.siguiente, cuantos: 3 });
  assert.deepEqual([r2.registros.map((r) => r.id), r2.siguiente], [["e3", "e4"], null]);
  assert.deepEqual(s.post({ codigo: CODIGO, accion: "descargar", desde: 9 }).registros, []);
  assert.equal(cargar().post({ codigo: CODIGO, accion: "descargar" }).total, 0, "sin hoja todavía, vacía");
});
