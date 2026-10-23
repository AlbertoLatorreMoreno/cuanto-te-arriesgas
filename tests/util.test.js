import { test } from "node:test";
import assert from "node:assert/strict";
import { alternarHorquilla, duracionLegible, formatoTiempo, letrasFichas, normalizarNombre, rangoCronometro, segundosCronometro, textoHorquilla, unirNombres } from "../app/js/util.js";
import { config } from "./ayudas.js";

test("normalizarNombre ignora mayúsculas, tildes y espacios", () => {
  assert.equal(normalizarNombre("  Ana   Pérez "), "ana perez");
  assert.equal(normalizarNombre("ÍÑIGO"), normalizarNombre("iñigo"));
});

test("normalizarNombre ignora los caracteres invisibles que se cuelan al copiar y pegar", () => {
  // Marcas de dirección (U+200E, U+202A…U+202C), espacio de ancho cero (U+200B), unión de palabras (U+2060) y BOM.
  for (const raro of ["Ana‎", "​Ana", "A⁠na", "‪Ana‬", "﻿Ana", "Ana "]) {
    assert.equal(normalizarNombre(raro), "ana", JSON.stringify(raro));
  }
  // Un nombre hecho solo de invisibles o de tildes sueltas no es un nombre.
  assert.equal(normalizarNombre("​‎"), "");
  assert.equal(normalizarNombre("́"), "");
  assert.equal(normalizarNombre("😀"), "😀", "un emoji sí vale");
});

test("unirNombres usa «e» ante el sonido «i»", () => {
  assert.equal(unirNombres([]), "");
  assert.equal(unirNombres(["Ana"]), "Ana");
  assert.equal(unirNombres(["Ana", "Luis"]), "Ana y Luis");
  assert.equal(unirNombres(["Ana", "Luis", "Eva"]), "Ana, Luis y Eva");
  assert.equal(unirNombres(["Ana", "Inés"]), "Ana e Inés");
  assert.equal(unirNombres(["Ana", "Hilario"]), "Ana e Hilario");
  assert.equal(unirNombres(["Ana", "Íker"]), "Ana e Íker");
  assert.equal(unirNombres(["Ana", "Ian"]), "Ana y Ian"); // «ia» suena a diptongo
  assert.equal(unirNombres(["Ana", "Hierro"]), "Ana y Hierro");
});

test("las fichas llevan letras distintas aunque varios nombres empiecen igual", () => {
  assert.deepEqual(letrasFichas(["Ana", "Luis", "Marta"]), ["A", "L", "M"]);
  assert.deepEqual(letrasFichas(["Ana", "Alba", "Luis"]), ["An", "Al", "L"]);
  assert.deepEqual(letrasFichas(["ana", "Álex"]), ["An", "Ál"], "las tildes no distinguen");
  assert.deepEqual(letrasFichas(["Ana", "Anabel", "Alba"]), ["A1", "A2", "Al"]);
  assert.deepEqual(letrasFichas(["A", "Ana"]), ["A1", "An"]);
  assert.deepEqual(letrasFichas(["Ana María", "Andrés"]), ["A1", "A2"]);
  const seis = letrasFichas(["Ana", "Alba", "Álex", "Andrés", "Amaia", "Aitor"]);
  assert.equal(new Set(seis).size, 6);
  assert.ok(seis.every((x) => [...x].length <= 2));
});

test("la tabla objetivo respalda lo que dice «Cómo se juega»", () => {
  // La pantalla dice que las apuestas de 5 o 6 son las que más puntos dan de media.
  const esperado = config.objetivo_acierto.map((p, i) => (i + 1) * p);
  const mejores = esperado.map((e, i) => [e, i + 1]).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([, n]) => n).sort();
  assert.deepEqual(mejores, [5, 6]);
});

test("la horquilla de niveles: un toque elige, el segundo extiende, y se puede quitar o rehacer", () => {
  let h = alternarHorquilla(null, 5);
  assert.deepEqual(h, [5, 5]);
  h = alternarHorquilla(h, 3);
  assert.deepEqual(h, [3, 5], "el segundo toque extiende hacia cualquier lado");
  assert.deepEqual(alternarHorquilla(h, 8), [8, 8], "con una horquilla hecha, se empieza otra");
  assert.equal(alternarHorquilla([5, 5], 5), null, "tocar el único elegido lo quita");
  assert.equal(textoHorquilla([4, 5], 6), "Le pondrías entre un 4 y un 5: más fácil que el 6 que tiene.");
  assert.equal(textoHorquilla([8, 8], 6), "Le pondrías un 8: más difícil que el 6 que tiene.");
  assert.equal(textoHorquilla([6, 6], 6), "Le pondrías un 6: justo el nivel que tiene.");
  assert.equal(textoHorquilla([5, 7], 6), "Le pondrías entre un 5 y un 7: el 6 que tiene entra en la horquilla.");
});

test("tiempo del cronómetro por categoría y nivel, y su formato", () => {
  // Decidido el 19 de octubre: 45 s en los niveles 1–3 (las fáciles necesitan su tiempo), 1 min en los 4–7 y 1,5 min en los 8–10.
  assert.deepEqual(config.cronometro.segundos_por_nivel, [45, 45, 45, 60, 60, 60, 60, 90, 90, 90]);
  assert.equal(segundosCronometro(config, "mates", 1), config.cronometro.segundos_por_nivel[0]);
  assert.equal(segundosCronometro(config, "mates", 10), config.cronometro.segundos_por_nivel[9]);
  assert.equal(segundosCronometro(config, "historia", 5), null);
  assert.equal(segundosCronometro({ ...config, cronometro: undefined }, "mates", 5), null);
  assert.equal(formatoTiempo(75), "1:15");
  assert.equal(formatoTiempo(44.2), "0:45", "redondea hacia arriba: no marca 0:00 hasta que se acaba");
  assert.equal(formatoTiempo(-3), "0:00");
});

test("duración del cronómetro en palabras", () => {
  assert.equal(duracionLegible(30), "30 s");
  assert.equal(duracionLegible(60), "1 min");
  assert.equal(duracionLegible(90), "1 min 30 s");
  assert.equal(rangoCronometro(config), `de ${duracionLegible(config.cronometro.segundos_por_nivel[0])} (nivel 1) a ${duracionLegible(config.cronometro.segundos_por_nivel[9])} (nivel 10)`);
});
