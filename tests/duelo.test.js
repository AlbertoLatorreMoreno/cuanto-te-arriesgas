import { test } from "node:test";
import assert from "node:assert/strict";
import { rngConSemilla } from "../app/js/azar.js";
import { crearIndice } from "../app/js/banco.js";
import * as D from "../app/js/duelo.js";
import * as S from "../app/js/solo.js";
import { bancoSintetico, config } from "./ayudas.js";

const preguntas = bancoSintetico(2);
const indice = crearIndice(preguntas, config);
const opciones = new Map(
  preguntas.filter((q) => q.tipo !== "mapa").map((q) => [q.id, {
    v: q.v,
    incorrectas: Array.from({ length: 7 }, (_, k) => `Mal ${k} de ${q.id}`),
  }]),
);
const jugadores = [
  { clave: "ana", nombre: "Ana", tema: "harry_potter" },
  { clave: "luis", nombre: "Luis", tema: "star_wars" },
];
const AHORA = "2026-11-15T10:00:00.000Z";
const FIN = "2026-11-15T10:10:00.000Z";
const versiones = { banco: "banco-inicial", ajustes: "ajustes-iniciales" };
const ctx = { dispositivo: "movil-prueba", versiones: { banco: "banco-actual", ajustes: "ajustes-actuales" } };

function armar(cambios = {}) {
  return D.planDuelo({ indice, opciones, config, jugadores, rng: rngConSemilla(1), ...cambios });
}

const planBase = armar();

function nuevo(cambios = {}) {
  return D.nuevoDuelo({ id: "duelo-1", jugadores, plan: planBase, ahora: AHORA, versiones, ...cambios });
}

function fotoDe(d) {
  const hueco = D.huecoActual(d);
  return S.fotoPregunta(indice.porId.get(hueco.pregunta), opciones, config, hueco.nivel);
}

function empezar(d, { ahoraMs = 100_000, versionesFoto = null } = {}) {
  const foto = fotoDe(d);
  if (versionesFoto) foto.versiones = versionesFoto;
  const q = indice.porId.get(foto.id);
  return D.empezarPregunta(d, { ahoraMs, foto, orden: S.ordenOpciones(q, opciones, rngConSemilla(5)) });
}

function responder(d, datos = {}, inicio = {}) {
  return D.responderPregunta(empezar(d, inicio), { acierto: true, ms: 0, ts: AHORA, ...datos });
}

function jugar({ respuesta = () => ({ acierto: true, ms: 0 }), opinar = false, ultimoEnPantalla = false } = {}) {
  let d = nuevo();
  while (d.fase !== "fin") {
    const paso = d.paso;
    const datos = respuesta(D.huecoActual(d), paso);
    d = responder(d, { ...datos, ts: new Date(Date.parse(AHORA) + paso * 1000).toISOString() });
    if (opinar) d = D.marcarMala(D.valorarUltima(d, "justa"), "ambigua");
    if (ultimoEnPantalla && d.paso === D.HUECOS) return d;
    d = D.seguir(d, { ts: FIN });
  }
  return d;
}

function comprobarPlan(plan, estosJugadores = jugadores, esteIndice = indice) {
  assert.equal(plan.length, 16);
  assert.equal(new Set(plan.map((h) => h.pregunta)).size, 16);
  for (const h of plan) {
    const q = esteIndice.porId.get(h.pregunta);
    assert.equal(h.tema, estosJugadores[h.papel === "propio" ? h.jugador : 1 - h.jugador].tema);
    assert.equal(q.categoria, h.tema);
    assert.equal(h.nivel, config.duelo.normal[h.papel === "propio" ? "dificil" : "facil"][h.vuelta - 1]);
    assert.ok(S.jugable(q, opciones));
  }
}

function comprobarPlanos(registros) {
  for (const r of registros) {
    for (const [campo, valor] of Object.entries(r)) {
      assert.ok(valor === null || ["string", "number", "boolean"].includes(typeof valor), `${r.id}.${campo} debe ser escalar`);
      if (typeof valor === "number") assert.ok(Number.isFinite(valor), `${r.id}.${campo} debe ser finito`);
    }
  }
}

test("el plan tiene dieciséis huecos, los niveles de cada papel y las cuatro vueltas en serpiente", () => {
  assert.equal(D.VUELTAS, 4);
  assert.equal(D.HUECOS, 16);
  assert.deepEqual([1, 2, 3, 4].map(D.ordenJugadores), [[0, 1], [1, 0], [0, 1], [1, 0]]);
  comprobarPlan(planBase);
  assert.deepEqual(planBase.map((h) => h.jugador), [0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0]);
  assert.deepEqual(planBase.map((h) => h.nivel), [1, 7, 1, 7, 2, 8, 2, 8, 3, 9, 3, 9, 4, 10, 4, 10]);
  assert.deepEqual(planBase.map((h) => h.papel), Array.from({ length: 8 }, () => ["rival", "propio"]).flat());
  for (const jugador of [0, 1]) {
    for (const papel of ["rival", "propio"]) {
      const huecos = planBase.filter((h) => h.jugador === jugador && h.papel === papel);
      assert.equal(huecos.length, 4);
      assert.equal(new Set(huecos.map((h) => indice.porId.get(h.pregunta).subtema)).size, 4, "variedad por jugador y papel");
    }
  }
});

test("aunque ambos elijan el mismo tema, no se repite ninguna pregunta", () => {
  const iguales = jugadores.map((j) => ({ ...j, tema: "harry_potter" }));
  for (let semilla = 1; semilla <= 10; semilla++) {
    const plan = armar({ jugadores: iguales, rng: rngConSemilla(semilla) });
    comprobarPlan(plan, iguales);
    assert.ok(plan.every((h) => indice.porId.get(h.pregunta).nivelEfectivo === h.nivel));
  }
});

test("el azar es reproducible y no depende del orden de los archivos", () => {
  const invertido = { porId: new Map([...indice.porId].reverse()), revela: indice.revela };
  assert.deepEqual(armar(), planBase);
  assert.deepEqual(armar({ indice: invertido }), planBase);
  assert.notEqual(armar({ rng: () => 0 })[0].pregunta, armar({ rng: () => 0.999999 })[0].pregunta);
});

test("nunca usa reservas y prefiere las no vistas por quien responde, no las del rival", () => {
  const vistas = [0, 1].map((jugador) => Object.fromEntries(
    preguntas.filter((q) => q.id.endsWith(jugador === 0 ? "-1" : "-0")).map((q) => [q.id, AHORA]),
  ));
  const reservadas = new Set(preguntas.filter((q) => q.id.endsWith("-0") && ["libros", "original"].includes(q.subtema)).map((q) => q.id));
  for (let semilla = 1; semilla <= 10; semilla++) {
    const plan = armar({ vistas, reservadas, rng: rngConSemilla(semilla) });
    comprobarPlan(plan);
    for (const h of plan) {
      assert.ok(!reservadas.has(h.pregunta));
      assert.ok(!(h.pregunta in vistas[h.jugador]));
      assert.equal(indice.porId.get(h.pregunta).nivelEfectivo, h.nivel);
    }
  }
});

test("el nivel manda sobre las vistas; si todas están vistas, elige la más antigua", () => {
  const delNivel = preguntas.filter((q) => q.categoria === jugadores[1].tema && q.nivel === 1);
  const vistas = [Object.fromEntries(delNivel.map((q) => [q.id, AHORA])), {}];
  let plan = armar({ vistas });
  assert.equal(indice.porId.get(plan[0].pregunta).nivelEfectivo, 1, "no sube a una nueva de nivel 2");
  const antigua = delNivel[delNivel.length - 1].id;
  vistas[0][antigua] = "2020-01-01T00:00:00.000Z";
  plan = armar({ vistas });
  assert.equal(plan[0].pregunta, antigua);
});

test("si falta un nivel, busca el más cercano, primero el inferior", () => {
  // El hueco de nivel 2 de Ana (la segunda fácil, del tema de Luis).
  const hueco2 = (plan) => plan.find((h) => h.jugador === 0 && h.papel === "rival" && h.nivel === 2);
  const sinNivel = crearIndice(preguntas.filter((q) => !(q.categoria === jugadores[1].tema && q.nivel === 2)), config);
  const plan = armar({ indice: sinNivel });
  comprobarPlan(plan, jugadores, sinNivel);
  assert.ok(hueco2(plan), "el hueco conserva su nivel y su premio");
  assert.equal(sinNivel.porId.get(hueco2(plan).pregunta).nivelEfectivo, 1);
  const sinInferior = crearIndice(preguntas.filter((q) => !(q.categoria === jugadores[1].tema && q.nivel <= 2)), config);
  assert.equal(sinInferior.porId.get(hueco2(armar({ indice: sinInferior })).pregunta).nivelEfectivo, 3);
});

test("la selección usa el nivel efectivo, no el inicial", () => {
  const rival = jugadores[1].tema;
  const sustituta = preguntas.find((q) => q.categoria === rival && q.nivel === 2);
  const niveles = Object.fromEntries(preguntas.filter((q) => q.categoria === rival && q.nivel === 1).map((q) => [q.id, 6]));
  niveles[sustituta.id] = 1;
  const ajustado = crearIndice(preguntas, config, { niveles });
  const plan = armar({ indice: ajustado });
  assert.equal(plan[0].pregunta, sustituta.id);
  assert.equal(ajustado.porId.get(plan[0].pregunta).nivel, 2);
  assert.equal(ajustado.porId.get(plan[0].pregunta).nivelEfectivo, 1);
});

test("las revelaciones se evitan en las dos direcciones, antes de decidir la variedad", () => {
  const primero = armar({ rng: () => 0 })[0].pregunta;
  const siguientes = preguntas.filter((q) => q.categoria === jugadores[0].tema && q.nivel === 7)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const revela = new Map([
    [primero, new Set([siguientes[0].id])],
    [siguientes[1].id, new Set([primero])],
  ]);
  const plan = armar({ indice: { porId: indice.porId, revela }, rng: () => 0 });
  assert.equal(plan[0].pregunta, primero);
  assert.equal(plan[1].pregunta, siguientes[2].id);
  for (const a of plan) {
    for (const b of plan) {
      if (a !== b) assert.ok(!revela.get(a.pregunta)?.has(b.pregunta));
    }
  }
  assert.equal(armar({ indice: { porId: indice.porId } }).length, 16, "el índice puede no llevar revela");
});

test("evitar fugas es una preferencia posterior al nivel y a lo visto, no una reserva", () => {
  const primero = armar({ rng: () => 0 })[0].pregunta;
  const propias = preguntas.filter((q) => q.categoria === jugadores[0].tema && q.nivel === 7);
  const revela = new Map([[primero, new Set(propias.map((q) => q.id))]]);
  const plan = armar({ indice: { porId: indice.porId, revela }, rng: () => 0 });
  assert.equal(indice.porId.get(plan[1].pregunta).nivelEfectivo, 7);
  assert.ok(revela.get(primero).has(plan[1].pregunta), "si no hay otra empatada, conserva el nivel");
});

test("devuelve null sin jugables, sin suficientes preguntas o con todo reservado; las de mapa no necesitan opciones", () => {
  const sinOpcionesRival = new Map([...opciones].filter(([id]) => indice.porId.get(id).categoria !== jugadores[1].tema));
  assert.equal(armar({ opciones: sinOpcionesRival }), null);
  const sinTema = crearIndice(preguntas.filter((q) => q.categoria !== jugadores[1].tema), config);
  assert.equal(armar({ indice: sinTema }), null);
  assert.equal(armar({ reservadas: new Set(preguntas.map((q) => q.id)) }), null);
  const iguales = jugadores.map((j) => ({ ...j, tema: "harry_potter" }));
  const pocas = crearIndice(preguntas.filter((q) => q.categoria === "harry_potter").slice(0, 15), config);
  assert.equal(armar({ jugadores: iguales, indice: pocas }), null, "no rellena repitiendo preguntas");
  const mapa = jugadores.map((j) => ({ ...j, tema: "geohistoria" }));
  comprobarPlan(armar({ jugadores: mapa, opciones: new Map() }), mapa);
});

test("el ciclo entero conserva los estados anteriores, permite opinar y acaba al responder la pregunta dieciséis", () => {
  let d = nuevo();
  assert.deepEqual([d.creado, d.terminado, d.fase, d.paso, d.final], [AHORA, null, "preparar", 0, null]);
  assert.deepEqual(D.puntos(d), [0, 0]);
  assert.deepEqual(D.aciertos(d), [0, 0]);
  const cambios = [];
  for (let paso = 0; paso < 16; paso++) {
    const antes = structuredClone(d);
    if (D.cambioDeJugador(d)) cambios.push(paso);
    assert.deepEqual(D.huecoActual(d), planBase[paso]);
    let siguiente = empezar(d);
    assert.deepEqual(d, antes, "empezar no modifica el estado recibido");
    assert.equal(siguiente.fase, "pregunta");
    assert.equal(siguiente.orden.length, 8);
    assert.ok(siguiente.orden.includes(siguiente.actual.correcta));
    d = D.responderPregunta(siguiente, { acierto: paso % 3 !== 0, ms: 1000, ts: AHORA });
    assert.equal(siguiente.resultados.length, paso, "responder no añade al array anterior");
    assert.equal(d.fase, "resultado");
    assert.equal(d.paso, paso + 1);
    assert.equal(d.final, paso === 15 ? "completo" : null, "el final se sabe al responder la última, sin esperar a «Seguir»");
    assert.deepEqual(
      [d.resultados[paso].paso, d.resultados[paso].jugador, d.resultados[paso].vuelta, d.resultados[paso].papel],
      [paso, planBase[paso].jugador, planBase[paso].vuelta, planBase[paso].papel],
    );
    siguiente = D.valorarUltima(d, "facil");
    siguiente = D.valorarUltima(siguiente, "dificil");
    siguiente = D.marcarMala(siguiente, "erronea");
    assert.equal(d.resultados[paso].valoracion, undefined);
    assert.equal(d.resultados[paso].mala, undefined);
    assert.equal(siguiente.resultados[paso].valoracion, "dificil");
    assert.equal(siguiente.resultados[paso].mala, "erronea");
    d = D.seguir(siguiente, { ts: FIN });
    assert.equal(d.actual, null);
    assert.equal(d.orden, null);
    assert.equal(d.inicio, null);
    assert.equal(d.consumido, 0);
    assert.equal(d.fase, paso === 15 ? "fin" : "preparar");
  }
  assert.deepEqual(cambios, [0, 2, 6, 10, 14], "la primera entrega y cuatro cambios de manos");
  assert.equal(d.final, "completo");
  assert.equal(d.terminado, AHORA, "la hora de la última respuesta");
  assert.equal(d.resultados.length, 16);
  assert.equal(D.huecoActual(d), null);
  assert.equal(D.cambioDeJugador(d), false);
});

test("cada operación exige su fase y los dobles toques no responden ni siguen dos veces", () => {
  const d = nuevo();
  assert.throws(() => D.responderPregunta(d, { acierto: true, ms: 0, ts: AHORA }));
  assert.throws(() => D.seguir(d));
  assert.throws(() => D.valorarUltima(d, "facil"));
  assert.throws(() => D.marcarMala(d, "erronea"));
  assert.throws(() => D.empezarPregunta(d, { ahoraMs: 0, foto: { ...fotoDe(d), id: "otra" } }));
  assert.throws(() => D.empezarPregunta(d, { ahoraMs: 0, foto: { id: planBase[0].pregunta } }));
  const empezada = empezar(d);
  assert.throws(() => empezar(empezada));
  assert.throws(() => D.seguir(empezada));
  const respondida = D.responderPregunta(empezada, { acierto: true, ms: 0, ts: AHORA });
  assert.throws(() => D.responderPregunta(respondida, { acierto: true, ms: 0, ts: AHORA }));
  assert.throws(() => D.valorarUltima(respondida, "regular"));
  assert.throws(() => D.marcarMala(respondida, {}));
  assert.throws(() => D.marcarMala(respondida, ""));
  const seguida = D.seguir(respondida, { ts: AHORA });
  assert.throws(() => D.seguir(seguida));
  const fin = jugar();
  assert.throws(() => D.seguir(fin));
  assert.throws(() => empezar(fin));
  assert.throws(() => D.abandonar(fin, { ts: FIN }));
});

test("los puntos usan las reglas de la foto, el multiplicador y el nivel del hueco; fallar no resta", () => {
  const d = nuevo();
  const h = D.huecoActual(d);
  const q = indice.porId.get(h.pregunta);
  // Simula una sustituta de otro nivel: el premio y el tiempo siguen siendo los del hueco solicitado.
  const foto = S.fotoPregunta({ ...q, nivel: 1, nivelEfectivo: 1 }, opciones, config, h.nivel);
  const empezada = D.empezarPregunta(d, { ahoraMs: 0, foto, orden: [] });
  const mitad = foto.reglas.segundos * 500;
  let resultado = D.responderPregunta(empezada, { acierto: true, ms: mitad, ts: AHORA });
  assert.equal(resultado.resultados[0].multiplicador, 1.5);
  assert.equal(resultado.resultados[0].puntos, Math.round(config.solo.puntos[h.nivel - 1] * 1.5));
  assert.equal(resultado.resultados[0].q.nivelEfectivo, 1);
  const ganados = D.puntos(resultado)[0];
  resultado = responder(D.seguir(resultado), { acierto: false, ms: 100 });
  assert.deepEqual(D.puntos(resultado), [ganados, 0]);
  const instantanea = D.responderPregunta(empezada, { acierto: true, ms: 0, ts: AHORA });
  assert.equal(instantanea.resultados[0].multiplicador, config.solo.multiplicador_max);
  const personalizada = D.empezarPregunta(d, {
    ahoraMs: 0,
    foto: { ...foto, reglas: { segundos: 100, puntos: 123, multiplicador_max: 3 } },
    orden: [],
  });
  assert.equal(D.responderPregunta(personalizada, { acierto: true, ms: 50_000, ts: AHORA }).resultados[0].puntos, 246);
  assert.deepEqual(D.puntos(jugar()), [880, 880], "los dos tienen el mismo máximo");
});

test("agotar el tiempo cuenta como fallo incluso acertando; el límite es inclusivo", () => {
  const d = empezar(nuevo());
  const limite = d.actual.reglas.segundos * 1000;
  for (const ms of [limite, limite + 99_000]) {
    const respondida = D.responderPregunta(d, { acierto: true, ms, ts: AHORA });
    const r = respondida.resultados[0];
    assert.deepEqual([r.acierto, r.agotado, r.multiplicador, r.puntos], [false, true, 0, 0]);
    assert.equal(r.ms, limite, "sin tiempo se apunta el que había: horas con la app cerrada no dan un `ms` que la descarga tire");
    assert.equal(respondida.final, null, "el siguiente jugador también debe poder jugar");
  }
  const dentro = D.responderPregunta(d, { acierto: true, ms: limite - 1, ts: AHORA }).resultados[0];
  assert.equal(dentro.acierto, true);
  assert.equal(dentro.agotado, false);
  assert.equal(dentro.multiplicador, 1);
});

test("el tiempo sigue corriendo al volver, respeta lo consumido y el reloj monotónico", () => {
  const d = empezar(nuevo(), { ahoraMs: 100_000 });
  const limite = d.actual.reglas.segundos * 1000;
  assert.equal(D.tiempoAgotado(d, 100_000 + limite - 1), false);
  assert.equal(D.tiempoAgotado(d, 100_000 + limite), true);
  assert.equal(D.tiempoAgotado({ ...d, consumido: limite }, 0), true, "atrasar el reloj no devuelve tiempo");
  assert.equal(D.tiempoAgotado(d, 0, limite), true, "el reloj monotónico puede detectar el agotamiento");
  assert.equal(D.tiempoAgotado(nuevo(), 999_999), false);
  const respondida = D.responderPregunta({ ...d, consumido: limite }, { acierto: true, ms: 0, ts: AHORA });
  assert.equal(respondida.resultados[0].agotado, true);
});

test("el ganador se decide por puntos, después por aciertos y por último hay empate", () => {
  const ganaAna = jugar({ respuesta: (h) => ({ acierto: h.jugador === 0, ms: 0 }) });
  assert.deepEqual(D.puntos(ganaAna), [880, 0]);
  assert.deepEqual(D.aciertos(ganaAna), [8, 0]);
  assert.equal(D.ganador(ganaAna), 0);
  const ganaLuis = jugar({ respuesta: (h) => ({ acierto: h.jugador === 1, ms: 0 }) });
  assert.equal(D.ganador(ganaLuis), 1);
  const desempate = jugar({ respuesta: (h) => {
    const acierto = h.papel === "rival" && (h.jugador === 0 ? h.nivel === 4 : [1, 3].includes(h.nivel));
    const q = indice.porId.get(h.pregunta);
    return { acierto, ms: S.segundosPregunta(config, q, h.nivel) * 1000 - 1 };
  } });
  assert.deepEqual(D.puntos(desempate), [40, 40]);
  assert.deepEqual(D.aciertos(desempate), [1, 2]);
  assert.equal(D.ganador(desempate), 1);
  assert.equal(D.ganador(jugar()), null);
  assert.equal(D.ganador(jugar({ respuesta: () => ({ acierto: false, ms: 0 }) })), null);
});

test("se puede abandonar desde preparar, pregunta o resultado, sin contar una pregunta sin responder", () => {
  const preparando = D.seguir(responder(nuevo()), { ts: AHORA });
  const mostrando = empezar(preparando);
  const resultado = D.marcarMala(responder(preparando), "erronea");
  for (const d of [nuevo(), preparando, mostrando, resultado]) {
    const anterior = structuredClone(d);
    const fin = D.abandonar(d, { ts: FIN });
    assert.deepEqual(d, anterior);
    assert.equal(fin.fase, "fin");
    assert.equal(fin.final, "abandonado");
    assert.equal(fin.terminado, FIN);
    assert.equal(fin.resultados.length, d.resultados.length);
    assert.deepEqual(D.puntos(fin), D.puntos(d));
    assert.equal(fin.actual, null);
    assert.equal(D.huecoActual(fin), null);
    assert.equal(D.resumenDuelo(fin), null);
    const registros = D.registrosDuelo(fin, ctx);
    const finales = registros.filter((r) => r.tipo === "duelo_fin");
    if (!d.resultados.length) {
      assert.deepEqual(registros, [], "abandonado sin responder nada: ni finales");
      continue;
    }
    assert.equal(finales.length, 2);
    assert.ok(finales.every((r) => r.resultado === "abandonado" && r.ts === FIN));
    assert.equal(finales.reduce((total, r) => total + r.respondidas, 0), d.resultados.length);
    comprobarPlanos(registros);
  }
  assert.ok(D.registrosDuelo(D.abandonar(resultado, { ts: FIN }), ctx).some((r) => r.id === "duelo-1-v2"));
});

test("la opinión se puede cambiar o quitar y no sale hasta dejar atrás su resultado, incluida la última pregunta", () => {
  let d = responder(nuevo());
  d = D.valorarUltima(D.valorarUltima(d, "facil"), "dificil");
  d = D.marcarMala(D.marcarMala(d, "erronea"), "ambigua");
  assert.deepEqual(D.registrosDuelo(d, ctx).map((r) => r.id), ["duelo-1-r1"]);
  const seguida = D.seguir(d, { ts: AHORA });
  const opinion = D.registrosDuelo(seguida, ctx).find((r) => r.tipo === "revision");
  assert.deepEqual(
    [opinion.id, opinion.origen, opinion.evaluador, opinion.papel, opinion.valoracion, opinion.mala],
    ["duelo-1-v1", "duelo", "ana", "rival", "dificil", "ambigua"],
  );
  assert.equal(opinion.nivel_desde, null);
  assert.equal(opinion.nivel_hasta, null);
  const sinValoracion = D.seguir(D.valorarUltima(d, null));
  assert.equal(D.registrosDuelo(sinValoracion, ctx).find((r) => r.tipo === "revision").valoracion, null, "el motivo basta");
  const sinMotivo = D.seguir(D.marcarMala(d, null));
  assert.equal(D.registrosDuelo(sinMotivo, ctx).find((r) => r.tipo === "revision").mala, null, "la valoración basta");
  const sinOpinion = D.seguir(D.marcarMala(D.valorarUltima(d, null), null));
  assert.ok(!D.registrosDuelo(sinOpinion, ctx).some((r) => r.tipo === "revision"));
  const ultima = jugar({ opinar: true, ultimoEnPantalla: true });
  const antes = D.registrosDuelo(ultima, ctx);
  assert.equal(antes.filter((r) => r.tipo === "revision").length, 15);
  assert.ok(!antes.some((r) => r.id === "duelo-1-v16"));
  assert.equal(antes.filter((r) => r.tipo === "duelo_fin").length, 2, "el final se guarda al responder la última: quien cierra la app ahí deja su resultado");
  const despues = D.registrosDuelo(D.seguir(ultima, { ts: FIN }), ctx);
  assert.equal(despues.filter((r) => r.tipo === "revision").length, 16);
  assert.equal(despues.filter((r) => r.tipo === "duelo_fin").length, 2);
});

test("los registros tienen ids fijos, totales por jugador y dos finales con el resultado de cada uno", () => {
  const d = jugar({ respuesta: (h) => ({ acierto: h.jugador === 0, ms: 0, elegida: "x".repeat(250) }), opinar: true });
  const registros = D.registrosDuelo(d, ctx);
  assert.deepEqual(D.registrosDuelo(d, ctx), registros);
  assert.equal(new Set(registros.map((r) => r.id)).size, registros.length);
  assert.equal(registros.length, 34);
  assert.deepEqual(registros.slice(0, 16).map((r) => r.id), Array.from({ length: 16 }, (_, i) => `duelo-1-r${i + 1}`));
  assert.deepEqual(registros.slice(16, 32).map((r) => r.id), Array.from({ length: 16 }, (_, i) => `duelo-1-v${i + 1}`));
  assert.ok(registros.every((r) => /^[A-Za-z0-9][\w.-]{0,99}$/.test(r.id)));
  const acumulados = [0, 0];
  registros.slice(0, 16).forEach((r, i) => {
    const h = d.plan[i];
    const q = indice.porId.get(h.pregunta);
    acumulados[h.jugador] += r.puntos;
    assert.equal(r.total, acumulados[h.jugador]);
    assert.equal(r.jugador, jugadores[h.jugador].clave);
    assert.equal(r.rival, jugadores[1 - h.jugador].clave);
    assert.equal(r.tema_propio, jugadores[h.jugador].tema);
    assert.equal(r.tema_rival, jugadores[1 - h.jugador].tema);
    assert.equal(r.turno, i + 1);
    assert.equal(r.vuelta, h.vuelta);
    assert.equal(r.nivel, h.nivel);
    assert.equal(r.nivel_inicial, q.nivel);
    assert.equal(r.nivel_mostrado, q.nivelEfectivo);
    assert.equal(r.respuesta_dada.length, 200);
    assert.equal(r.opciones, S.huellaOpciones(q, opciones));
    assert.equal(r.version_banco, versiones.banco);
    assert.equal(r.dispositivo, ctx.dispositivo);
    assert.equal(r.partida, undefined);
    for (const campo of ["turno", "vuelta", "nivel", "nivel_inicial", "nivel_mostrado", "ms", "puntos", "total"]) {
      assert.ok(Number.isInteger(r[campo]), `${campo} debe ser entero`);
    }
  });
  const [a, b] = registros.slice(-2);
  assert.deepEqual(
    [a.id, a.tipo, a.ts, a.jugador, a.rival, a.puntos, a.aciertos, a.puntos_rival, a.aciertos_rival, a.respondidas, a.resultado, a.final],
    ["duelo-1-fin1", "duelo_fin", "2026-11-15T10:00:15.000Z", "ana", "luis", 880, 8, 0, 0, 8, "gana", "completo"],
  );
  assert.deepEqual([b.id, b.jugador, b.rival, b.puntos, b.puntos_rival, b.respondidas, b.resultado],
    ["duelo-1-fin2", "luis", "ana", 0, 880, 8, "pierde"]);
  const empate = D.registrosDuelo(jugar(), ctx).filter((r) => r.tipo === "duelo_fin");
  assert.ok(empate.every((r) => r.resultado === "empate"));
  comprobarPlanos(registros);
  assert.deepEqual(JSON.parse(JSON.stringify(registros)), registros, "se pueden guardar como JSON sin perder campos");
});

test("las versiones de cada foto prevalecen sobre las del duelo, y estas sobre las del contexto", () => {
  let d = responder(nuevo(), {}, { versionesFoto: { banco: "foto", ajustes: "ajuste-foto" } });
  d = D.seguir(D.valorarUltima(d, "justa"));
  d = responder(d);
  const registros = D.registrosDuelo(d, ctx);
  assert.deepEqual(registros.slice(0, 2).map((r) => [r.version_banco, r.version_ajustes]),
    [["foto", "ajuste-foto"], [versiones.banco, versiones.ajustes]]);
  const revision = registros.find((r) => r.tipo === "revision");
  assert.deepEqual([revision.version_banco, revision.version_ajustes], ["foto", "ajuste-foto"]);
  const sinVersiones = D.registrosDuelo(responder(nuevo({ versiones: null })), ctx)[0];
  assert.deepEqual([sinVersiones.version_banco, sinVersiones.version_ajustes], [ctx.versiones.banco, ctx.versiones.ajustes]);
});

test("las preguntas de mapa conservan su foto y producen registros planos con coordenadas y distancia", () => {
  const pareja = [{ ...jugadores[0], tema: "geohistoria" }, { ...jugadores[1], tema: "ciencias" }];
  let d = nuevo({ jugadores: pareja, plan: armar({ jugadores: pareja }) });
  d = D.seguir(responder(d));
  const empezada = empezar(d);
  const q = empezada.actual;
  assert.equal(q.tipo, "mapa");
  assert.equal(empezada.orden, null);
  assert.equal(q.reglas.segundos, S.segundosPregunta(config, q, 7));
  assert.equal(q.reglas.acierto_fraccion, config.mapa.acierto_fraccion);
  d = D.responderPregunta(empezada, {
    acierto: true,
    ms: 100,
    ts: AHORA,
    mapa: { lat: q.lat, lon: q.lon, distancia_km: 0 },
  });
  const registros = D.registrosDuelo(D.seguir(D.marcarMala(d, "redaccion")), ctx);
  const mapa = registros.find((r) => r.id === "duelo-1-r2");
  assert.deepEqual([mapa.lat_senalada, mapa.lon_senalada, mapa.distancia_km, mapa.distancia_max_km],
    [q.lat, q.lon, 0, q.distancia_max_km]);
  assert.equal(mapa.opciones, null);
  assert.equal(mapa.respuesta_dada, null);
  assert.equal(mapa.mapa, undefined);
  comprobarPlanos(registros);
});

test("los emojis distinguen velocidad, acierto, fallo y tiempo agotado, en el orden de cada jugador", () => {
  let d = nuevo();
  const respuestas = [
    { acierto: true, fraccion: 0.5 },
    { acierto: true, fraccion: 0.75 },
    { acierto: false, fraccion: 0 },
    { acierto: true, fraccion: 1 },
  ];
  for (const datos of respuestas) {
    const segundos = fotoDe(d).reglas.segundos;
    d = D.seguir(responder(d, { acierto: datos.acierto, ms: segundos * 1000 * datos.fraccion }));
  }
  assert.equal(D.emojisJugador(d, 0), "⚡🟩");
  assert.equal(D.emojisJugador(d, 1), "🟥⏰");
});

test("el resumen solo corresponde a duelos completos y el cara a cara admite los dos órdenes y otras parejas", () => {
  assert.equal(D.resumenDuelo(nuevo()), null);
  const d = jugar({ respuesta: (h) => ({ acierto: h.jugador === 0, ms: 0 }) });
  const resumen = D.resumenDuelo(d);
  assert.deepEqual(resumen, {
    id: "duelo-1",
    modo: "normal",
    ts: "2026-11-15T10:00:15.000Z", // la hora de la última respuesta
    jugadores: [
      { ...jugadores[0], puntos: 880, aciertos: 8 },
      { ...jugadores[1], puntos: 0, aciertos: 0 },
    ],
    ganador: "ana",
  });
  const historial = [
    resumen,
    { ...resumen, id: "otro", jugadores: [...resumen.jugadores].reverse(), ganador: "luis" },
    { ...resumen, id: "empate", ganador: null },
    { ...resumen, id: "otra-pareja", jugadores: [resumen.jugadores[0], { clave: "marta" }], ganador: "ana" },
    { ...resumen, id: "abandonado-antiguo", final: "abandonado", ganador: "ana" },
  ];
  assert.deepEqual(D.caraACara(historial, "ana", "luis"), { a: 1, b: 1, empates: 1 });
  assert.deepEqual(D.caraACara([resumen], "luis", "ana"), { a: 0, b: 1, empates: 0 });
  assert.deepEqual(D.caraACara([], "ana", "luis"), { a: 0, b: 0, empates: 0 });
  assert.deepEqual(D.caraACara(historial, "ana", "ana"), { a: 0, b: 0, empates: 0 });
});

test("el texto para compartir incluye temas, puntos, emojis y ganador o empate, pero ninguna respuesta", () => {
  const d = jugar({ respuesta: (h) => ({ acierto: h.jugador === 0, ms: 0 }) });
  const nombreTema = (id) => ({ harry_potter: "Harry Potter", star_wars: "Star Wars" })[id];
  const texto = D.textoCompartir(d, { nombreApp: config.nombre, nombreTema, url: "https://ejemplo.es/app/" });
  assert.equal(texto, [
    "¿Cuánto te arriesgas? · Duelo",
    "Ana (Harry Potter) 880 – 0 Luis (Star Wars)",
    `Ana: ${"⚡".repeat(8)}`,
    `Luis: ${"🟥".repeat(8)}`,
    "Gana Ana 🏆",
    "https://ejemplo.es/app/",
  ].join("\n"));
  for (const r of d.resultados) {
    assert.ok(!texto.includes(r.q.respuesta));
    assert.ok(!texto.includes(r.q.correcta));
    assert.ok(!texto.includes(r.q.pregunta));
  }
  const empate = D.textoCompartir(jugar(), { nombreApp: "X", nombreTema });
  assert.ok(empate.endsWith("\nEmpate"));
  assert.equal(empate.split("\n").length, 5, "sin url no queda una línea vacía");
});

test("salir con la última respuesta en pantalla no convierte en abandonado un duelo completo", () => {
  let d = nuevo();
  while (d.paso < D.HUECOS - 1) d = D.seguir(responder(d));
  const ultima = responder(d, { ts: FIN });
  assert.equal(ultima.final, "completo");
  const fin = D.abandonar(D.valorarUltima(ultima, "justa"), { ts: "2026-11-15T11:00:00.000Z" });
  assert.deepEqual([fin.fase, fin.final, fin.terminado], ["fin", "completo", FIN]);
  assert.ok(D.resumenDuelo(fin));
  assert.ok(D.registrosDuelo(fin, ctx).some((r) => r.id === "duelo-1-v16"), "su opinión se guarda");
});

test("duelo veloz: 2 vueltas, 8 preguntas (1 y 3 del rival, 8 y 10 del propio), y acaba al responder la octava", () => {
  assert.deepEqual(D.nivelesDuelo(config, "veloz"), { nombre: "Veloz", facil: [1, 3], dificil: [8, 10] });
  assert.throws(() => D.nivelesDuelo(config, "otro"));
  const plan = armar({ modo: "veloz" });
  assert.equal(plan.length, 8);
  assert.deepEqual(plan.map((h) => `${h.vuelta}${h.jugador}${h.papel[0]}${h.nivel}`), ["10r1", "10p8", "11r1", "11p8", "21r3", "21p10", "20r3", "20p10"]);
  assert.equal(new Set(plan.map((h) => h.pregunta)).size, 8);
  let d = D.nuevoDuelo({ id: "veloz-1", jugadores, plan, ahora: AHORA, versiones, modo: "veloz" });
  assert.deepEqual([d.modo, D.huecosDe(d), D.vueltasDe(d)], ["veloz", 8, 2]);
  const cambios = [];
  while (d.paso < D.huecosDe(d)) {
    if (D.cambioDeJugador(d)) cambios.push(d.paso);
    d = responder(d);
    if (d.paso < D.huecosDe(d)) {
      assert.equal(d.final, null);
      d = D.seguir(d);
    }
  }
  assert.deepEqual(cambios, [0, 2, 6], "el móvil cambia de manos dos veces");
  assert.equal(d.final, "completo", "el final se sabe al responder la octava");
  assert.deepEqual(D.puntos(d), [440, 440]);
  const registros = D.registrosDuelo(D.seguir(d), ctx);
  assert.ok(registros.every((r) => r.modo_duelo === "veloz"));
  assert.equal(registros.filter((r) => r.tipo === "duelo_fin").length, 2);
  assert.equal(D.resumenDuelo(D.seguir(d)).modo, "veloz");
  assert.match(D.textoCompartir(d, { nombreApp: "App" }), /^App · Duelo veloz\n/);
  assert.throws(() => D.nuevoDuelo({ id: "x", jugadores, plan: plan.slice(0, 6), ahora: AHORA }), "cuatro huecos por vuelta");
});

test("un duelo guardado antes de que hubiera modos se sigue jugando como normal", () => {
  const { modo, ...antiguo } = nuevo();
  assert.equal(modo, "normal");
  const d = responder(antiguo);
  assert.equal(D.registrosDuelo(d, ctx)[0].modo_duelo, "normal");
  // Y una configuración con `facil` y `dificil` sueltos es el modo normal.
  assert.deepEqual(D.nivelesDuelo({ duelo: { facil: [2, 3, 4, 5], dificil: [7, 8, 9, 10] } }).dificil, [7, 8, 9, 10]);
});
