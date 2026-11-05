import { test } from "node:test";
import assert from "node:assert/strict";
import { rngConSemilla } from "../app/js/azar.js";
import { crearIndice } from "../app/js/banco.js";
import { enviarRegistros, soloSinDecidir } from "../app/js/envio.js";
import * as S from "../app/js/solo.js";
import { bancoSintetico, config } from "./ayudas.js";

const preguntas = bancoSintetico(2);
const indice = crearIndice(preguntas, config);
const opciones = new Map(
  preguntas.filter((q) => q.tipo !== "mapa").map((q) => [q.id, { v: q.v, incorrectas: Array.from({ length: 7 }, (_, k) => `Mal ${k} de ${q.id}`) }]),
);
const deNivel = (cat, nivel, k = 0) => preguntas.filter((q) => q.categoria === cat && q.nivel === nivel)[k].id;
const jugador = { clave: "ana", nombre: "Ana" };

test("el multiplicador baja en línea recta de ×2 a ×1 y los puntos son 10 × nivel × multiplicador", () => {
  assert.equal(S.multiplicador(0, 30), 2);
  assert.equal(S.multiplicador(15000, 30), 1.5);
  assert.equal(S.multiplicador(30000, 30), 1);
  assert.equal(S.multiplicador(99000, 30), 1, "pasado el tiempo no baja de ×1");
  assert.equal(S.multiplicador(7000, 20), 1.65);
  assert.equal(S.puntosAcierto(config, 7, 1.6), 112);
  assert.equal(S.puntosAcierto(config, 1, 2), 20);
});

test("el día del reto es el de España, aunque el móvil esté en otra zona", () => {
  // 23:30 en UTC del 5 de noviembre son las 0:30 del 6 en Madrid (UTC+1 en invierno).
  assert.equal(S.fechaLocal(new Date("2026-11-05T23:30:00Z"), "Europe/Madrid"), "2026-11-06");
  assert.equal(S.fechaLocal(new Date("2026-07-05T21:59:00Z"), "Europe/Madrid"), "2026-07-05", "en verano, UTC+2");
  assert.equal(S.fechaLegible("2026-11-06", { conDia: true }), "viernes 6 de noviembre");
});

test("las opciones solo valen para su versión de la pregunta, y el orden del reto es el mismo para todos", () => {
  const q = indice.porId.get(deNivel("ciencias", 3));
  assert.ok(S.opcionesDe(q, opciones));
  assert.equal(S.opcionesDe({ ...q, v: 2 }, opciones), null, "reescrita: sin opciones");
  assert.equal(S.jugable({ ...q, v: 2 }, opciones), false);
  const mapa = indice.porId.get(deNivel("geohistoria", 3));
  assert.equal(S.jugable(mapa, opciones), true, "las de mapa se juegan en el mapa");
  const a = S.ordenOpciones(q, opciones, rngConSemilla(S.semilla(`2026-11-06|${q.id}`)));
  const b = S.ordenOpciones(q, opciones, rngConSemilla(S.semilla(`2026-11-06|${q.id}`)));
  assert.deepEqual(a, b);
  assert.equal(a.length, 8);
  assert.ok(a.includes(q.respuesta));
  // Con «correcta», el botón bueno dice eso en vez de la respuesta.
  const conCorrecta = new Map([[q.id, { v: 1, correcta: "Corta", incorrectas: ["x", "y", "z", "w", "v", "u", "t"] }]]);
  assert.ok(S.ordenOpciones(q, conCorrecta, rngConSemilla(1)).includes("Corta"));
});

function calendario() {
  const cats = ["ciencias", "historia", "entretenimiento", "mates", "geohistoria", "ciencias", "historia", "entretenimiento", "mates", "ciencias"];
  return {
    dias: [
      { fecha: "2026-11-05", tema: null, titulo: null, categorias: cats, preguntas: cats.map((c, i) => deNivel(c, i + 1, 1)) },
      { fecha: "2026-11-06", tema: null, titulo: null, categorias: cats, preguntas: cats.map((c, i) => deNivel(c, i + 1)) },
    ],
  };
}

test("el reto del día sale del calendario y es igual en todos los móviles", () => {
  const r = S.retoDelDia("2026-11-06", { calendario: calendario(), indice, opciones, config });
  assert.equal(r.origen, "calendario");
  assert.deepEqual(r.preguntas, calendario().dias[1].preguntas);
  assert.deepEqual(S.retoDelDia("2026-11-06", { calendario: calendario(), indice, opciones, config }), r);
});

test("una pregunta del calendario retirada se sustituye por otra de su categoría y nivel, igual para todos", () => {
  const cal = calendario();
  const retirada = cal.dias[1].preguntas[6];
  const sin = crearIndice(preguntas, config, { retiradas: { [retirada]: "erronea" } });
  const r1 = S.retoDelDia("2026-11-06", { calendario: cal, indice: sin, opciones, config });
  const r2 = S.retoDelDia("2026-11-06", { calendario: cal, indice: sin, opciones, config });
  assert.notEqual(r1.preguntas[6], retirada);
  assert.deepEqual(r1, r2);
  const q = sin.porId.get(r1.preguntas[6]);
  assert.equal(q.categoria, cal.dias[1].categorias[6]);
  assert.equal(q.nivelEfectivo, 7);
  assert.ok(!cal.dias.some((d) => d.preguntas.includes(q.id)), "mejor una que no esté en el calendario");
});

test("sin calendario para ese día, el reto se arma con la fecha como semilla: 10 escalones del 1 al 10", () => {
  const r = S.retoDelDia("2027-03-02", { calendario: calendario(), indice, opciones, config }); // martes: mezcla
  assert.equal(r.origen, "semilla");
  assert.equal(r.tema, null);
  assert.equal(r.preguntas.length, 10);
  assert.deepEqual(r.preguntas.map((id) => indice.porId.get(id).nivelEfectivo), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(new Set(r.preguntas).size, 10);
  assert.deepEqual(S.retoDelDia("2027-03-02", { calendario: calendario(), indice, opciones, config }), r);
  const cats = r.preguntas.map((id) => indice.porId.get(id).categoria);
  assert.equal(cats.filter((c) => c === "geohistoria").length, 1, "una de Localízalo");
  const miercoles = S.retoDelDia("2027-03-03", { calendario: null, indice, opciones, config });
  assert.ok(miercoles.tema, "los miércoles son temáticos");
  assert.ok(miercoles.preguntas.every((id) => indice.porId.get(id).categoria === miercoles.tema));
});

test("la práctica nunca usa preguntas reservadas para los retos de hoy en adelante y prefiere las no vistas", () => {
  const cal = calendario();
  const reserva = S.reservadas(cal, "2026-11-06");
  assert.ok(reserva.has(cal.dias[1].preguntas[0]));
  assert.ok(!reserva.has(cal.dias[0].preguntas[0]), "el reto de ayer ya se puede practicar");
  const vistas = Object.fromEntries(preguntas.filter((q) => q.categoria === "mates" && q.id.endsWith("-1")).map((q) => [q.id, "2026-11-01T10:00:00Z"]));
  for (let s = 1; s < 30; s++) {
    const ids = S.escaleraPractica({ indice, opciones, config, categoria: "mates", vistas, reservadas: reserva, rng: rngConSemilla(s) });
    assert.equal(ids.length, 10);
    assert.ok(ids.every((id) => !reserva.has(id)));
    assert.ok(ids.every((id) => indice.porId.get(id).categoria === "mates"));
    assert.deepEqual(ids.map((id) => indice.porId.get(id).nivelEfectivo), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.ok(ids.every((id) => !(id in vistas)), "con preguntas sin ver, ninguna vista");
  }
  const todas = S.escaleraPractica({ indice, opciones, config, rng: rngConSemilla(3) });
  assert.ok(todas.every((id) => config.categorias.some((c) => c.id === indice.porId.get(id).categoria)), "sin categoría: las del tablero, sin temas");
});

const foto = (id) => S.fotoPregunta(indice.porId.get(id), opciones);

function jugar(respuestas, { ids = calendario().dias[1].preguntas } = {}) {
  let e = S.nuevaEscalera({ id: "esc-1", modo: "reto", fecha: "2026-11-06", origen: "calendario", preguntas: ids, jugador, ahora: "2026-11-06T10:00:00Z" });
  let t = 1_000_000;
  for (const [acierto, ms] of respuestas) {
    e = S.empezarPregunta(e, { ahoraMs: t, foto: foto(ids[e.paso]), orden: null });
    t += ms;
    e = S.responderPregunta(e, { config, acierto, ms: S.transcurrido(e, t), ts: `2026-11-06T10:00:0${e.paso}.000Z` });
    e = S.seguir(e, { ts: "2026-11-06T10:01:00.000Z" });
    if (e.fase === "fin") return e;
  }
  return e;
}

test("la escalera: cada acierto suma al bote, plantarse se lo queda y fallar lo pierde", () => {
  let e = jugar([[true, 0], [true, 10000]]);
  // Nivel 1 al instante: 10 × 2 = 20. Nivel 2 (20 s) a los 10 s: 20 × 1,5 = 30.
  assert.equal(e.bote, 50);
  assert.equal(e.fase, "decidir");
  assert.equal(e.paso, 2);
  assert.throws(() => S.plantarse({ ...e, paso: 0 }), /plantar/);
  const plantada = S.plantarse(e, { ts: "x" });
  assert.equal(plantada.final, "plantado");
  assert.equal(plantada.bote, 50);
  assert.equal(plantada.terminada, "x");

  e = jugar([[true, 0], [true, 0], [false, 1000]]);
  assert.equal(e.final, "fallo");
  assert.equal(e.fase, "fin");
  assert.equal(e.bote, 0);
  assert.equal(e.paso, 3);

  e = jugar([[true, 0], [true, 999999]]);
  assert.equal(e.final, "tiempo", "acertar fuera de tiempo es fallo");
  assert.equal(e.bote, 0);

  e = jugar(Array.from({ length: 10 }, () => [true, 0]));
  assert.equal(e.final, "completo");
  assert.equal(e.bote, 1100);
  assert.equal(S.emojis(e), "⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡🏆");
});

test("cada paso solo vale en su fase: un doble toque no responde, sigue ni se planta dos veces", () => {
  const ids = calendario().dias[1].preguntas;
  const e = S.nuevaEscalera({ id: "x", modo: "practica", fecha: "2026-11-06", preguntas: ids, jugador, ahora: "" });
  assert.throws(() => S.responderPregunta(e, { config, acierto: true, ms: 0, ts: "" }));
  assert.throws(() => S.seguir(e));
  const empezada = S.empezarPregunta(e, { ahoraMs: 0, foto: foto(ids[0]), orden: null });
  assert.throws(() => S.empezarPregunta(empezada, { ahoraMs: 0, foto: foto(ids[0]), orden: null }));
  const respondida = S.responderPregunta(empezada, { config, acierto: true, ms: 0, ts: "" });
  assert.throws(() => S.responderPregunta(respondida, { config, acierto: true, ms: 0, ts: "" }));
  const seguida = S.seguir(respondida);
  assert.throws(() => S.seguir(seguida), "seguir dos veces");
  const plantada = S.plantarse(seguida);
  assert.throws(() => S.plantarse(plantada));
});

test("si se vuelve a la app con la pregunta en pantalla, el tiempo ha seguido corriendo, y atrasar el reloj no lo devuelve", () => {
  const ids = calendario().dias[1].preguntas;
  let e = S.nuevaEscalera({ id: "x", modo: "reto", fecha: "2026-11-06", preguntas: ids, jugador, ahora: "" });
  e = S.empezarPregunta(e, { ahoraMs: 100_000, foto: foto(ids[0]), orden: null });
  const seg = S.segundosPregunta(config, e.actual, 1);
  assert.equal(S.tiempoAgotado(e, config, 100_000 + seg * 1000 - 1), false);
  assert.equal(S.tiempoAgotado(e, config, 100_000 + seg * 1000), true);
  // Con 8 s ya consumidos, atrasar el reloj del móvil 60 s no devuelve el tiempo.
  const consumida = { ...e, consumido: 8000 };
  assert.equal(S.transcurrido(consumida, 100_000 - 60_000), 8000);
  assert.equal(S.transcurrido(consumida, 100_000 + 9000), 9000);
  assert.equal(S.transcurrido(consumida, 100_000, 12_000), 12_000, "el reloj monotónico de la sesión manda si dice más");
});

test("la pregunta en pantalla y las respondidas se guardan con la escalera: un banco nuevo no cambia lo que se vio", () => {
  const ids = calendario().dias[1].preguntas;
  let e = S.nuevaEscalera({ id: "x", modo: "reto", fecha: "2026-11-06", preguntas: ids, jugador, ahora: "" });
  e = S.empezarPregunta(e, { ahoraMs: 0, foto: foto(ids[0]), orden: ["a"] });
  assert.equal(e.actual.id, ids[0]);
  assert.equal(e.actual.correcta, indice.porId.get(ids[0]).respuesta);
  assert.equal(typeof e.actual.huella, "string");
  e = S.responderPregunta(e, { config, acierto: true, ms: 1000, ts: "t" });
  assert.equal(e.resultados[0].q.id, ids[0]);
  const mapa = indice.porId.get(deNivel("geohistoria", 4));
  const f = S.fotoPregunta(mapa, opciones);
  assert.deepEqual([f.lat, f.lon, f.distancia_max_km, f.correcta], [mapa.lat, mapa.lon, mapa.distancia_max_km, undefined]);
});

test("las opciones tienen que estar completas: 7 incorrectas de texto", () => {
  const q = indice.porId.get(deNivel("ciencias", 3));
  const con = (o) => new Map([[q.id, { v: 1, ...o }]]);
  assert.equal(S.opcionesDe(q, con({ incorrectas: ["a", "b"] })), null, "con 2 saldrían 3 botones");
  assert.equal(S.opcionesDe(q, con({ incorrectas: ["a", "b", "c", "d", "e", "f", ""] })), null);
  assert.equal(S.opcionesDe(q, con({ incorrectas: ["a", "b", "c", "d", "e", "f", "g"], correcta: "" })), null);
  assert.ok(S.opcionesDe(q, con({ incorrectas: ["a", "b", "c", "d", "e", "f", "g"] })));
});

test("tiempos: Mates con los de su cronómetro, mapa y texto con los de config.solo", () => {
  const mates = indice.porId.get(deNivel("mates", 9));
  assert.equal(S.segundosPregunta(config, mates, 9), 60);
  assert.equal(S.segundosPregunta(config, { ...mates, subtema: "series_num" }, 9), 75);
  assert.equal(S.segundosPregunta(config, indice.porId.get(deNivel("geohistoria", 2)), 2), config.solo.segundos_mapa[1]);
  assert.equal(S.segundosPregunta(config, indice.porId.get(deNivel("ciencias", 10)), 10), config.solo.segundos[9]);
});

test("el texto para compartir lleva la fecha, el tema, los emojis y los puntos, sin respuestas", () => {
  const e = { ...jugar([[true, 0], [true, 15000], [false, 0]]), titulo: "Día de las mates 🧮" };
  const texto = S.textoCompartir(e, { nombreApp: "¿Cuánto te arriesgas?", url: "https://ejemplo.github.io/app/" });
  assert.equal(texto, "¿Cuánto te arriesgas? · Reto del 6 de noviembre\nDía de las mates 🧮\n⚡🟩🟥\nCaí en el escalón 3: 0 puntos\nhttps://ejemplo.github.io/app/");
  const guardado = { modo: "reto", fecha: "2026-11-06", titulo: null, emojis: "⚡🟩✋", final: "plantado", bote: 45, paso: 2 };
  assert.match(S.textoCompartir(guardado, { nombreApp: "X" }), /⚡🟩✋\nMe planté con 45 puntos \(2 de 10\)$/);
});

test("los registros tienen id fijo (guardarlos otra vez no duplica), no llevan partida y van al final, en tandas aparte", async () => {
  const ctx = { dispositivo: "d", versiones: { banco: "b", ajustes: "a" } };
  const e = jugar([[true, 3000], [true, 2000]]);
  const regs = S.registrosEscalera(e, ctx);
  assert.deepEqual(regs.map((r) => r.id), ["esc-1-r1", "esc-1-r2"], "sin terminar, sin registro final");
  assert.deepEqual(S.registrosEscalera(e, ctx), regs, "siempre los mismos");
  const [r] = regs;
  assert.equal(r.tipo, "solo");
  assert.equal(r.partida, undefined);
  assert.equal(r.escalera, "esc-1");
  assert.equal(r.reto, "2026-11-06");
  assert.equal(r.reto_origen, "calendario");
  assert.equal(r.turno, 1);
  assert.equal(r.acierto, true);
  assert.equal(r.ms, 3000);
  assert.equal(r.ts, "2026-11-06T10:00:00.000Z");
  assert.equal(typeof r.opciones, "string");
  const plantada = S.plantarse(e, { ts: "2026-11-06T10:05:00.000Z" });
  const todos = S.registrosEscalera(plantada, ctx);
  const fin = todos[todos.length - 1];
  assert.deepEqual([fin.id, fin.tipo, fin.pasos, fin.final, fin.bote, fin.ts], ["esc-1-fin", "solo_fin", 2, "plantado", e.bote, "2026-11-06T10:05:00.000Z"]);
  assert.ok(todos.every((x) => /^[A-Za-z0-9][\w.-]{0,99}$/.test(x.id)), "ids que acepta la hoja");

  const otros = [{ id: "a", tipo: "respuesta", ts: "2026-11-06T11:00:00.000Z", partida: "p" }];
  assert.deepEqual(soloSinDecidir([...otros, ...todos], { "esc-1-r1": true }).map((x) => x.id), ["esc-1-r2", "esc-1-fin"]);

  const tandas = [];
  const fetch = async (_url, { body }) => {
    tandas.push(JSON.parse(body).exportacion.registros.map((x) => x.tipo));
    return { ok: true, json: async () => ({ ok: true, nuevos: 1 }) };
  };
  const res = await enviarRegistros([...todos, ...otros], { url: "https://script.google.com/macros/s/x/exec", dispositivo: "d", versiones: { banco: "b", ajustes: "a" }, fetch });
  assert.equal(res.ok, true);
  assert.deepEqual(tandas, [["respuesta"], ["solo", "solo", "solo_fin"]], "los de la partida, primero y aparte");
});

test("ampliar el calendario no cambia la sustituta de un día ya publicado", () => {
  const cal = calendario();
  const retirada = cal.dias[1].preguntas[3];
  const sin = crearIndice(preguntas, config, { retiradas: { [retirada]: "erronea" } });
  const antes = S.retoDelDia("2026-11-06", { calendario: cal, indice: sin, opciones, config });
  const sustituta = antes.preguntas[3];
  // Un día nuevo que usa justo la sustituta: el reto del 6 no cambia.
  const ampliado = { dias: [...cal.dias, { fecha: "2026-11-07", tema: null, titulo: null, categorias: cal.dias[1].categorias, preguntas: [sustituta, ...cal.dias[1].preguntas.slice(1)] }] };
  assert.deepEqual(S.retoDelDia("2026-11-06", { calendario: ampliado, indice: sin, opciones, config }), antes);
});

test("la práctica tampoco usa las preguntas del reto de hoy tal como se juega (con sus sustitutas)", () => {
  const extra = ["ciencias-biologia-5-1"];
  const reserva = S.reservadas({ dias: [] }, "2026-11-06", extra);
  assert.ok(reserva.has("ciencias-biologia-5-1"));
});

test("las reglas de una pregunta se congelan al empezarla: cambiar la configuración no la agota ni cambia su premio", () => {
  const ids = calendario().dias[1].preguntas;
  let e = S.nuevaEscalera({ id: "x", modo: "reto", fecha: "2026-11-06", preguntas: ids, jugador, ahora: "", versiones: { banco: "viejo", ajustes: "viejos" } });
  e = S.empezarPregunta(e, { ahoraMs: 0, foto: S.fotoPregunta(indice.porId.get(ids[0]), opciones, config, 1), orden: null });
  assert.deepEqual(e.actual.reglas, { segundos: S.segundosPregunta(config, indice.porId.get(ids[0]), 1), puntos: 10, multiplicador_max: 2 });
  const otra = { ...config, solo: { ...config.solo, puntos: config.solo.puntos.map((p) => p * 100), multiplicador_max: 3 }, cronometro: { ...config.cronometro, categorias: [] } };
  const seg = e.actual.reglas.segundos;
  assert.equal(S.tiempoAgotado(e, { ...otra, solo: { ...otra.solo, segundos: Array(10).fill(1), segundos_mapa: Array(10).fill(1) } }, seg * 1000 - 1), false);
  const r = S.responderPregunta(e, { config: otra, acierto: true, ms: 0, ts: "t" });
  assert.equal(r.bote, 20, "10 puntos × 2, los de cuando empezó");
  // Los registros llevan las versiones de cuando empezó la escalera, aunque la app se haya actualizado.
  const [reg] = S.registrosEscalera(r, { dispositivo: "d", versiones: { banco: "nuevo", ajustes: "nuevos" } });
  assert.deepEqual([reg.version_banco, reg.version_ajustes], ["viejo", "viejos"]);
});

test("un día temático armado por semilla nunca mezcla otras categorías: si a un tema le faltan niveles, otro tema", () => {
  // Harry Potter sin preguntas de nivel 7: no puede ser el tema de un día (sería una escalera con un hueco).
  const sinNivel7 = crearIndice(preguntas.filter((q) => !(q.categoria === "harry_potter" && q.nivel === 7)), config);
  for (const fecha of ["2027-03-03", "2027-03-07", "2027-03-10", "2027-03-14", "2027-03-17", "2027-03-21"]) {
    const r = S.retoDelDia(fecha, { calendario: null, indice: sinNivel7, opciones, config });
    assert.ok(r.tema, `${fecha} es temático`);
    assert.notEqual(r.tema, "harry_potter");
    assert.ok(r.preguntas.every((id) => sinNivel7.porId.get(id).categoria === r.tema), fecha);
  }
});

test("la práctica tampoco usa las sustitutas de los retos de los días siguientes", () => {
  const cal = calendario();
  const futuro = { fecha: "2026-11-07", tema: null, titulo: null, categorias: cal.dias[1].categorias, preguntas: [...cal.dias[1].preguntas] };
  futuro.preguntas = cal.dias[1].categorias.map((c, i) => deNivel(c, i + 1, 1));
  const conFuturo = { dias: [cal.dias[1], futuro] };
  const retirada = futuro.preguntas[4];
  const sin = crearIndice(preguntas, config, { retiradas: { [retirada]: "erronea" } });
  const ctx = { calendario: conFuturo, indice: sin, opciones, config };
  const sustituta = S.retoDelDia("2026-11-07", ctx).preguntas[4];
  assert.notEqual(sustituta, retirada);
  assert.ok(S.reservadasParaPractica("2026-11-06", ctx).has(sustituta));
});

test("una pregunta que ya salió como sustituta en un día anterior se sustituye también cuando llega su día", () => {
  const cal = calendario();
  const retirada = cal.dias[0].preguntas[2]; // la del escalón 3 del día 5
  const sin = crearIndice(preguntas, config, { retiradas: { [retirada]: "erronea" } });
  const ctx = { calendario: cal, indice: sin, opciones, config };
  const sustituta = S.retoDelDia("2026-11-05", ctx).preguntas[2];
  // El día 6 lleva justo esa pregunta en su calendario: como ya salió el 5, el 6 la cambia por otra.
  const cal2 = { dias: [cal.dias[0], { ...cal.dias[1], preguntas: cal.dias[1].preguntas.map((id, i) => (i === 2 ? sustituta : id)) }] };
  const ctx2 = { ...ctx, calendario: cal2 };
  assert.equal(S.retoDelDia("2026-11-05", ctx2).preguntas[2], sustituta, "el 5 no cambia");
  const dia6 = S.retoDelDia("2026-11-06", ctx2).preguntas;
  assert.notEqual(dia6[2], sustituta);
  assert.equal(new Set([...S.retoDelDia("2026-11-05", ctx2).preguntas, ...dia6]).size, 20, "ninguna repetida entre los dos días");
});

test("cada respuesta lleva las versiones con las que se vio su pregunta", () => {
  const ids = calendario().dias[1].preguntas;
  let e = S.nuevaEscalera({ id: "v", modo: "practica", fecha: "2026-11-06", preguntas: ids, jugador, ahora: "", versiones: { banco: "A", ajustes: "a" } });
  e = S.empezarPregunta(e, { ahoraMs: 0, foto: { ...foto(ids[0]), versiones: { banco: "A", ajustes: "a" } }, orden: null });
  e = S.seguir(S.responderPregunta(e, { config, acierto: true, ms: 0, ts: "t1" }));
  // Se cerró la app y se abrió con el banco B antes de la segunda pregunta.
  e = S.empezarPregunta(e, { ahoraMs: 0, foto: { ...foto(ids[1]), versiones: { banco: "B", ajustes: "b" } }, orden: null });
  e = S.responderPregunta(e, { config, acierto: true, ms: 0, ts: "t2" });
  const [r1, r2] = S.registrosEscalera(e, { dispositivo: "d", versiones: { banco: "C", ajustes: "c" } });
  assert.deepEqual([r1.version_banco, r2.version_banco], ["A", "B"]);
});
