import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../app/js/duelo.js";

const config = {
  niveles: { min: 1, max: 10 },
  duelo: { facil: [2, 3, 4, 5], dificil: [7, 8, 9, 10] },
};
const jugadores = [
  { clave: "ana", nombre: "Ana", tema: "a" },
  { clave: "luis", nombre: "Luis", tema: "b" },
];
const pregunta = (id, cambios = {}) => ({ id, v: 1, tipo: "mapa", categoria: "b", nivel: 2, subtema: "nuevo", ...cambios });

function escenario(candidatas = []) {
  const plan = [];
  const preguntas = [];
  for (let vuelta = 1; vuelta <= 4; vuelta++) {
    for (const jugador of D.ordenJugadores(vuelta)) {
      for (const papel of ["rival", "propio"]) {
        const tema = jugadores[papel === "propio" ? jugador : 1 - jugador].tema;
        const nivel = config.duelo[papel === "propio" ? "dificil" : "facil"][vuelta - 1];
        const id = `usada-${plan.length}`;
        plan.push({ jugador, vuelta, papel, tema, nivel, pregunta: id });
        preguntas.push(pregunta(id, { categoria: tema, nivel, subtema: "repetido" }));
      }
    }
  }
  const d = D.nuevoDuelo({ id: "prueba", jugadores, plan, ahora: "2026-11-15T10:00:00.000Z" });
  const indice = { porId: new Map([...preguntas.slice(1), ...candidatas].map((q) => [q.id, q])) };
  const ctx = { indice, opciones: new Map(), config, rng: () => 0 };
  return { d, ctx };
}

const elegida = (d) => D.huecoActual(d).pregunta;

test("sustituye solo el hueco actual, sin mutar el duelo ni repetir preguntas futuras", () => {
  const { d, ctx } = escenario([pregunta("nueva")]);
  const antes = structuredClone(d);
  const siguiente = D.sustituirHueco(d, ctx);
  assert.equal(elegida(siguiente), "nueva");
  assert.deepEqual(d, antes);
  assert.deepEqual(siguiente.plan.slice(1), d.plan.slice(1));
  assert.deepEqual({ ...siguiente.plan[0], pregunta: d.plan[0].pregunta }, d.plan[0]);
  assert.equal(new Set(siguiente.plan.map((h) => h.pregunta)).size, 16);
  assert.deepEqual(siguiente.resultados, d.resultados);
});

test("excluye reservas, otros temas, preguntas sin opciones y todas las ya elegidas", () => {
  const { d, ctx } = escenario([
    pregunta("a-reservada"),
    pregunta("b-otro-tema", { categoria: "a" }),
    pregunta("c-sin-opciones", { tipo: "texto" }),
    pregunta("d-valida"),
  ]);
  assert.equal(elegida(D.sustituirHueco(d, { ...ctx, reservadas: new Set(["a-reservada"]) })), "d-valida");
  assert.equal(D.sustituirHueco(d, { ...ctx, reservadas: new Set(["a-reservada", "d-valida"]) }), null);
  assert.equal(D.sustituirHueco(...(() => {
    const vacio = escenario();
    return [vacio.d, vacio.ctx];
  })()), null);
});

test("el nivel manda sobre las vistas, y se usa el nivel efectivo", () => {
  const { d, ctx } = escenario([
    pregunta("a-cercana", { nivel: 1 }),
    pregunta("b-ajustada", { nivel: 8, nivelEfectivo: 2 }),
  ]);
  const siguiente = D.sustituirHueco(d, { ...ctx, vistas: [{ "b-ajustada": "2026-01-01" }, {}] });
  assert.equal(elegida(siguiente), "b-ajustada");
  assert.equal(siguiente.plan[0].nivel, 2);
});

test("prefiere lo no visto por quien responde; si todo está visto, lo más antiguo", () => {
  const { d, ctx } = escenario([pregunta("a"), pregunta("b"), pregunta("c")]);
  assert.equal(elegida(D.sustituirHueco(d, { ...ctx, vistas: [{ a: "2020", b: "2021" }, { c: "2019" }] })), "c");
  assert.equal(elegida(D.sustituirHueco(d, { ...ctx, vistas: [{ a: "2022", b: "2020", c: "2021" }, {}] })), "b");
});

test("busca el nivel cercano inferior antes que el superior", () => {
  const { d, ctx } = escenario([pregunta("a-superior", { nivel: 3 }), pregunta("b-inferior", { nivel: 1 })]);
  const siguiente = D.sustituirHueco(d, ctx);
  assert.equal(elegida(siguiente), "b-inferior");
  assert.equal(siguiente.plan[0].nivel, 2);
});

test("evita revelaciones en ambas direcciones antes de buscar variedad", () => {
  const { d, ctx } = escenario([
    pregunta("a-revelada"),
    pregunta("b-revela"),
    pregunta("c-segura", { subtema: "repetido" }),
  ]);
  ctx.indice.revela = new Map([
    [d.plan[1].pregunta, new Set(["a-revelada"])],
    ["b-revela", new Set([d.plan[2].pregunta])],
  ]);
  assert.equal(elegida(D.sustituirHueco(d, ctx)), "c-segura");
  ctx.indice.revela.set("c-segura", new Set([d.plan[3].pregunta]));
  assert.equal(elegida(D.sustituirHueco(d, ctx)), "a-revelada", "si todas revelan, sigue siendo una preferencia");
});

test("la variedad mira al jugador y al papel, y usa las fotos de preguntas retiradas", () => {
  const { d, ctx } = escenario([pregunta("a-repetida", { subtema: "repetido" }), pregunta("b-nueva")]);
  assert.equal(elegida(D.sustituirHueco(d, ctx)), "b-nueva");
  const h = d.plan[6];
  const q = ctx.indice.porId.get(h.pregunta);
  ctx.indice.porId.delete(h.pregunta);
  const conFoto = { ...d, resultados: [{ pregunta: q.id, jugador: h.jugador, papel: h.papel, q }] };
  assert.equal(elegida(D.sustituirHueco(conFoto, ctx)), "b-nueva");
});

test("desempata por azar sobre ids ordenados y exige la fase preparar", () => {
  const { d, ctx } = escenario([pregunta("a"), pregunta("b")]);
  assert.equal(elegida(D.sustituirHueco(d, ctx)), "a");
  assert.equal(elegida(D.sustituirHueco(d, { ...ctx, rng: () => 0.999 })), "b");
  const invertido = { ...ctx.indice, porId: new Map([...ctx.indice.porId].reverse()) };
  assert.deepEqual(D.sustituirHueco(d, ctx), D.sustituirHueco(d, { ...ctx, indice: invertido }));
  for (const fase of ["pregunta", "resultado", "fin"]) {
    assert.throws(() => D.sustituirHueco({ ...d, fase }, ctx));
  }
});
