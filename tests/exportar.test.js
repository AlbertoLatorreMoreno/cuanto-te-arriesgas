import { test } from "node:test";
import assert from "node:assert/strict";
import { construirExportacion, nombreArchivo } from "../app/js/exportar.js";

test("la exportación ordena por fecha y lleva formato, dispositivo y versiones", () => {
  const registros = [
    { id: "b", tipo: "respuesta", ts: "2026-10-17T20:00:00.000Z" },
    { id: "a", tipo: "revision", ts: "2026-10-17T19:00:00.000Z" },
  ];
  const d = construirExportacion({ registros, dispositivo: "abcdef123456", versiones: { banco: "x1", ajustes: "inicial" }, ahora: "2026-10-18T00:00:00.000Z" });
  assert.equal(d.formato, 1);
  assert.equal(d.app, "cuanto-te-arriesgas");
  assert.equal(d.dispositivo, "abcdef123456");
  assert.equal(d.version_banco, "x1");
  assert.deepEqual(d.registros.map((r) => r.id), ["a", "b"]);
  assert.equal(registros[0].id, "b", "no modifica la lista original");
});

test("el nombre del archivo lleva el dispositivo corto y la fecha", () => {
  assert.equal(nombreArchivo("abcdef123456", new Date(2026, 9, 17, 9, 5)), "arriesga-abcdef12-20261017-0905.json");
});
