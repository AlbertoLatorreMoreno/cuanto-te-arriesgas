import { test } from "node:test";
import assert from "node:assert/strict";
import { rngConSemilla } from "../app/js/azar.js";
import { clavesRespuesta, crearIndice, elegirPregunta, elegirSubtema, estaRetirada, nivelEfectivo, resumenBanco } from "../app/js/banco.js";
import { readFileSync } from "node:fs";
import { bancoSintetico, config } from "./ayudas.js";

const rng = () => rngConSemilla(7);

test("los ajustes cambian el nivel efectivo y las retiradas desaparecen", () => {
  const preguntas = bancoSintetico(1);
  const ajustes = { niveles: { "ciencias-fisica-3-0": 8, "ciencias-fisica-4-0": 99 }, retiradas: { "mates-logica-5-0": "erronea" } };
  const indice = crearIndice(preguntas, config, ajustes);
  assert.equal(indice.porId.get("ciencias-fisica-3-0").nivelEfectivo, 8);
  assert.equal(indice.porId.get("ciencias-fisica-3-0").nivel, 3, "el nivel inicial no se toca");
  assert.equal(indice.porId.get("ciencias-fisica-4-0").nivelEfectivo, 10, "se recorta al máximo");
  assert.equal(indice.porId.has("mates-logica-5-0"), false);
  assert.equal(nivelEfectivo({ id: "x", nivel: 4 }, null), 4);
});

test("un ajuste calculado para otra versión de la pregunta no se aplica", () => {
  // La calibración se hizo con la v1; si la pregunta se reescribe (v2), vuelve a su nivel inicial
  // y deja de estar retirada, aunque todavía no se haya vuelto a calibrar.
  const preguntas = bancoSintetico(1).map((p) => (p.id === "ciencias-fisica-3-0" || p.id === "mates-logica-5-0" ? { ...p, v: 2 } : p));
  const ajustes = {
    niveles: { "ciencias-fisica-3-0": 8, "ciencias-fisica-4-0": 7 },
    retiradas: { "mates-logica-5-0": "erronea", "mates-logica-6-0": "ambigua" },
    versiones: { "ciencias-fisica-3-0": 1, "ciencias-fisica-4-0": 1, "mates-logica-5-0": 1, "mates-logica-6-0": 1 },
  };
  const indice = crearIndice(preguntas, config, ajustes);
  assert.equal(indice.porId.get("ciencias-fisica-3-0").nivelEfectivo, 3, "reescrita: nivel inicial");
  assert.equal(indice.porId.get("ciencias-fisica-4-0").nivelEfectivo, 7, "misma versión: se aplica");
  assert.equal(indice.porId.has("mates-logica-5-0"), true, "reescrita: vuelve a salir");
  assert.equal(indice.porId.has("mates-logica-6-0"), false, "misma versión: sigue retirada");
  assert.equal(estaRetirada(preguntas.find((p) => p.id === "mates-logica-6-0"), ajustes), true);
});

test("se ignoran preguntas con categoría o subtema que no están en la configuración", () => {
  const preguntas = [...bancoSintetico(1), { id: "raro", v: 1, categoria: "ciencias", subtema: "alquimia", nivel: 3 }];
  assert.equal(crearIndice(preguntas, config).porId.has("raro"), false);
});

test("el subtema anunciado es uno con preguntas sin ver en todos los niveles", () => {
  const indice = crearIndice(bancoSintetico(1), config);
  // Ana ya ha visto todas las de biología de nivel 5: biología pierde cobertura.
  const vistas = { "ciencias-biologia-5-0": "2026-01-01" };
  for (let i = 0; i < 50; i++) {
    const s = elegirSubtema(indice, "ciencias", { vistas, usadas: new Set(), rng: rngConSemilla(i) });
    assert.notEqual(s, "biologia");
  }
});

test("si ningún subtema tiene cobertura completa, se elige entre los de mayor cobertura", () => {
  const indice = crearIndice(bancoSintetico(1), config);
  const usadas = new Set(["ciencias-biologia-5-0", "ciencias-cuerpo-5-0", "ciencias-quimica-5-0", "ciencias-fisica-5-0", "ciencias-astronomia-5-0", "ciencias-astronomia-6-0"]);
  const s = elegirSubtema(indice, "ciencias", { vistas: {}, usadas, rng: rng() });
  assert.notEqual(s, "astronomia");
});

test("cadena de alternativas: exacta, otro subtema, nivel ±1, repetida, nivel lejano", () => {
  const preguntas = bancoSintetico(1);
  const indice = crearIndice(preguntas, config);
  const pedir = { categoria: "historia", subtema: "espana", nivel: 7 };
  const todasNivel = (n) => config.categorias[1].subtemas.map((s) => `historia-${s.id}-${n}-0`);

  // 1. Exacta.
  let r = elegirPregunta(indice, pedir, { vistas: {}, usadas: new Set(), rng: rng() });
  assert.equal(r.pregunta.id, "historia-espana-7-0");
  assert.equal(r.alternativa, null);

  // 2. La de España nivel 7 ya está vista → otro subtema del mismo nivel.
  r = elegirPregunta(indice, pedir, { vistas: { "historia-espana-7-0": "2026-01-01" }, usadas: new Set(), rng: rng() });
  assert.equal(r.pregunta.nivelEfectivo, 7);
  assert.equal(r.alternativa, "otro_subtema");

  // 3. Todas las de nivel 7 vistas → nivel 8 sin ver (antes que repetir).
  const vistas7 = Object.fromEntries(todasNivel(7).map((id, i) => [id, `2026-01-0${i + 1}`]));
  r = elegirPregunta(indice, pedir, { vistas: vistas7, usadas: new Set(), rng: rng() });
  assert.equal(r.pregunta.id, "historia-espana-8-0");
  assert.equal(r.alternativa, "otro_nivel");

  // 3b. Si el 8 también está visto, el 6.
  const vistas78 = { ...vistas7, ...Object.fromEntries(todasNivel(8).map((id) => [id, "2026-02-01"])) };
  r = elegirPregunta(indice, pedir, { vistas: vistas78, usadas: new Set(), rng: rng() });
  assert.equal(r.pregunta.id, "historia-espana-6-0");

  // 4. 6, 7 y 8 vistos → se repite la de nivel 7 vista hace más tiempo.
  const vistas678 = { ...vistas78, ...Object.fromEntries(todasNivel(6).map((id) => [id, "2026-02-01"])) };
  r = elegirPregunta(indice, pedir, { vistas: vistas678, usadas: new Set(), rng: rng() });
  assert.equal(r.pregunta.id, todasNivel(7)[0]);
  assert.equal(r.alternativa, "repetida");

  // 5. Todas las de nivel 7 usadas en la partida → nivel más cercano sin ver (9 antes que 5).
  r = elegirPregunta(indice, pedir, { vistas: vistas678, usadas: new Set(todasNivel(7)), rng: rng() });
  assert.equal(r.pregunta.nivelEfectivo, 9);
  assert.equal(r.alternativa, "otro_nivel");

  // 6. Si la de otro nivel también la había visto, queda como «repetida» (la calibración no la usa).
  const vistas6a9 = { ...vistas678, ...Object.fromEntries([9, 5].flatMap(todasNivel).map((id) => [id, "2026-03-01"])) };
  r = elegirPregunta(indice, pedir, { vistas: vistas6a9, usadas: new Set(todasNivel(7)), rng: rng() });
  assert.notEqual(r.pregunta.nivelEfectivo, 7);
  assert.equal(r.alternativa, "repetida");
});

test("en el nivel máximo, la alternativa cercana es el nivel inferior", () => {
  const preguntas = bancoSintetico(1).filter((p) => !(p.categoria === "mates" && p.nivel === 10));
  const indice = crearIndice(preguntas, config);
  const r = elegirPregunta(indice, { categoria: "mates", subtema: "logica", nivel: 10 }, { vistas: {}, usadas: new Set(), rng: rng() });
  assert.equal(r.pregunta.nivelEfectivo, 9);
  assert.equal(r.alternativa, "otro_nivel");
});

test("nunca repite una pregunta de la partida mientras quede alguna otra", () => {
  const preguntas = bancoSintetico(1);
  const indice = crearIndice(preguntas, config);
  const usadas = new Set();
  const total = preguntas.filter((p) => p.categoria === "entretenimiento").length;
  const r0 = rngConSemilla(3);
  for (let i = 0; i < total; i++) {
    const r = elegirPregunta(indice, { categoria: "entretenimiento", subtema: "cine", nivel: 1 + (i % 10) }, { vistas: {}, usadas, rng: r0 });
    assert.equal(usadas.has(r.pregunta.id), false, `repetida en la vuelta ${i}`);
    usadas.add(r.pregunta.id);
  }
  // Con todo usado, sigue devolviendo algo (último recurso).
  const r = elegirPregunta(indice, { categoria: "entretenimiento", subtema: "cine", nivel: 4 }, { vistas: {}, usadas, rng: r0 });
  assert.ok(r.pregunta);
  assert.equal(r.pregunta.nivelEfectivo, 4);
});

test("devuelve null si la categoría no tiene preguntas", () => {
  const indice = crearIndice(bancoSintetico(1).filter((p) => p.categoria !== "mates"), config);
  assert.equal(elegirPregunta(indice, { categoria: "mates", subtema: "calculo", nivel: 3 }, { vistas: {}, usadas: new Set(), rng: rng() }), null);
});

test("el resumen cuenta preguntas por nivel y las que no ha visto nadie", () => {
  const indice = crearIndice(bancoSintetico(2), config);
  const resumen = resumenBanco(indice, new Set(["ciencias-fisica-3-0"]));
  const ciencias = resumen.find((f) => f.categoria === "ciencias");
  assert.deepEqual(ciencias.porNivel[2], { nivel: 3, total: 10, sinVer: 9 });
});

test("claves de respuesta: sin artículos, sin números ni palabras genéricas", () => {
  assert.deepEqual(clavesRespuesta({ respuesta: "El Teide", tambien_vale: ["Teide", "3"] }), ["teide"]);
  assert.deepEqual(clavesRespuesta({ respuesta: "Seis", tambien_vale: ["6"] }), []);
  assert.deepEqual(clavesRespuesta({ respuesta: "Walter White", tambien_vale: ["Heisenberg"] }), ["walter white", "heisenberg"]);
});

test("claves de una pregunta de mapa: el nombre del sitio, no la descripción entera", () => {
  const mapa = (respuesta) => clavesRespuesta({ tipo: "mapa", respuesta, tambien_vale: [] });
  // Con la frase entera nunca coincidía: «Se libró en Santa Elena» no bloqueaba la pregunta.
  assert.deepEqual(mapa("Santa Elena (Jaén), junto a Despeñaperros"), ["santa elena"]);
  assert.deepEqual(mapa("Isla de Santa Elena, en el Atlántico Sur"), ["isla de santa elena"]);
  assert.deepEqual(mapa("El Bierzo (León)"), ["bierzo"]);
  // Una zona no es un nombre: no bloquea cada vez que alguien dice «Pacífico».
  assert.deepEqual(mapa("Pacífico, frente a Ecuador"), []);
  assert.deepEqual(mapa("Norte de China"), []);
  assert.deepEqual(mapa("Frontera entre Zambia y Zimbabue"), []);
});

test("una pregunta cuya respuesta ya ha aparecido en la partida no sale si hay otras", () => {
  const preguntas = bancoSintetico(1);
  const a = preguntas.find((p) => p.id === "ciencias-astronomia-3-0");
  a.respuesta = "Marte";
  const b = preguntas.find((p) => p.id === "ciencias-quimica-5-0");
  b.explicacion = "Su color recuerda al planeta Marte.";
  const indice = crearIndice(preguntas, config);
  assert.ok(indice.revela.get(b.id).has(a.id));
  const pedir = { categoria: "ciencias", subtema: "astronomia", nivel: 3 };
  // Sin haber usado B, sale A.
  let r = elegirPregunta(indice, pedir, { vistas: {}, usadas: new Set(), rng: rngConSemilla(1) });
  assert.equal(r.pregunta.id, a.id);
  // Usada B (que menciona «Marte»), A queda bloqueada y sale otra del mismo nivel.
  r = elegirPregunta(indice, pedir, { vistas: {}, usadas: new Set([b.id]), rng: rngConSemilla(1) });
  assert.notEqual(r.pregunta.id, a.id);
  assert.equal(r.pregunta.nivelEfectivo, 3);
  assert.equal(r.alternativa, "otro_subtema");
});

test("al tener que repetir, no elige una pregunta cuya respuesta ya ha salido en la partida", () => {
  const preguntas = bancoSintetico(1);
  const a = preguntas.find((p) => p.id === "ciencias-astronomia-3-0");
  a.respuesta = "Marte";
  const b = preguntas.find((p) => p.id === "ciencias-quimica-5-0");
  b.explicacion = "Su color recuerda al planeta Marte.";
  const indice = crearIndice(preguntas, config);
  // Quien responde ya ha visto todas las de nivel 2, 3 y 4 de ciencias menos A, y B ya ha salido.
  const vistas = Object.fromEntries(
    preguntas.filter((p) => p.categoria === "ciencias" && [2, 3, 4].includes(p.nivel) && p.id !== a.id).map((p) => [p.id, "2026-01-01"]),
  );
  const r = elegirPregunta(indice, { categoria: "ciencias", subtema: "astronomia", nivel: 3 }, { vistas, usadas: new Set([b.id]), rng: rngConSemilla(1) });
  assert.notEqual(r.pregunta.id, a.id, "A está delatada por B: mejor repetir una vista hace tiempo");
  assert.equal(r.pregunta.nivelEfectivo, 3);
  assert.equal(r.alternativa, "repetida");
});

test("en el banco real, las fugas que quedan las bloquea el motor", () => {
  const preguntas = config.categorias.flatMap((c) => JSON.parse(readFileSync(new URL(`../app/${c.archivo}`, import.meta.url), "utf8")).preguntas);
  const indice = crearIndice(preguntas, config);
  // La serie Breaking Bad acepta «Heisenberg», que es la respuesta de la pregunta de física.
  assert.ok(indice.revela.get("ent-ser-05")?.has("cie-fis-13"));
  // Pocas relaciones: el bloqueo no debe vaciar el banco. El tope crece con el banco
  // (con 409 preguntas eran menos de 120; con 800, 280).
  const total = [...indice.revela.values()].reduce((s, x) => s + x.size, 0);
  assert.ok(total < preguntas.length / 2, `demasiadas relaciones de fuga: ${total} para ${preguntas.length} preguntas`);
  // Y ninguna pregunta puede quedar bloqueada por demasiadas otras.
  const reveladaPor = new Map();
  for (const ids of indice.revela.values()) for (const id of ids) reveladaPor.set(id, (reveladaPor.get(id) ?? 0) + 1);
  const peor = Math.max(...reveladaPor.values());
  assert.ok(peor <= 15, `una pregunta la revelan ${peor} preguntas`);
});
