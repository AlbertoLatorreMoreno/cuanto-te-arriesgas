// Banco de preguntas: índice por celda (categoría, subtema, nivel) y selección
// con cadena de alternativas. Funciones puras: no tocan el navegador.

import { elegir } from "./azar.js";

// Un ajuste vale para la versión de la pregunta con la que se calculó. Si después se reescribe
// (sube su `v`), vuelve a su nivel inicial y deja de estar retirada hasta la siguiente calibración.
function ajusteVigente(pregunta, ajustes) {
  const v = ajustes?.versiones?.[pregunta.id];
  return v === undefined || v === pregunta.v;
}

export function nivelEfectivo(pregunta, ajustes) {
  const n = ajustes?.niveles?.[pregunta.id];
  return Number.isInteger(n) && ajusteVigente(pregunta, ajustes) ? n : pregunta.nivel;
}

export function estaRetirada(pregunta, ajustes) {
  return Boolean(ajustes?.retiradas?.[pregunta.id]) && ajusteVigente(pregunta, ajustes);
}

const claveCelda = (cat, sub, nivel) => `${cat}|${sub}|${nivel}`;

// ---------------------------------------------------------------- fugas entre preguntas
// Una pregunta «revela» a otra si su texto (pregunta, respuestas, criterio o explicación)
// contiene la respuesta de la otra. Dentro de una partida se evita sacar una pregunta cuya
// respuesta ya ha aparecido en algo que se ha leído.

const PALABRAS_GENERICAS = new Set([
  "cero", "uno", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce",
  "medio", "tercio", "cuarto", "sexto", "todos", "todas", "ninguno", "igual", "primero", "segundo",
]);

export function normalizarTexto(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

// En una pregunta de mapa, la respuesta describe el sitio («Santa Elena (Jaén), junto a Despeñaperros»):
// la clave es su nombre, lo que va antes del paréntesis o de la coma. Con la frase entera (más de seis
// palabras) nunca coincidía, y una explicación que nombrara el sitio no la bloqueaba. Las que solo
// describen una zona («Norte de China», «Pacífico Sur», «Frontera entre…») no son un nombre: no cuentan.
const ZONA = /^(norte|sur|este|oeste|noreste|noroeste|sureste|suroeste|centro|frontera|junto|cerca|entre|frente|mar|oceano|pacifico|atlantico|indico|artico)\b/;
function nombreDelSitio(respuesta) {
  const nombre = String(respuesta).split(/[(,]/)[0];
  return ZONA.test(normalizarTexto(nombre)) ? "" : nombre;
}

export function clavesRespuesta(p) {
  const claves = new Set();
  const respuestas = [p.respuesta, ...(p.tambien_vale ?? [])];
  for (const r of p.tipo === "mapa" ? respuestas.map(nombreDelSitio) : respuestas) {
    const k = normalizarTexto(r).replace(/^(el|la|los|las|lo|un|una|en) /, "");
    if (k.length >= 4 && !/^[0-9 ]+$/.test(k) && !PALABRAS_GENERICAS.has(k)) claves.add(k);
  }
  return [...claves];
}

function gramas(texto, maximo = 6) {
  const palabras = normalizarTexto(texto).split(" ").filter(Boolean);
  const salida = new Set();
  for (let i = 0; i < palabras.length; i++) {
    for (let n = 1; n <= maximo && i + n <= palabras.length; n++) salida.add(palabras.slice(i, i + n).join(" "));
  }
  return salida;
}

function calcularRevelaciones(porId) {
  const claves = [...porId.values()].map((q) => [q.id, clavesRespuesta(q)]);
  const revela = new Map();
  for (const u of porId.values()) {
    const texto = [u.pregunta, u.respuesta, ...(u.tambien_vale ?? []), u.criterio, u.explicacion].filter(Boolean).join(" ");
    const g = gramas(texto);
    const reveladas = new Set();
    for (const [id, ks] of claves) if (id !== u.id && ks.some((k) => g.has(k))) reveladas.add(id);
    if (reveladas.size) revela.set(u.id, reveladas);
  }
  return revela;
}

export function crearIndice(preguntas, config, ajustes = null) {
  const { min, max } = config.niveles;
  const porId = new Map();
  const celdas = new Map();
  const subtemas = new Map(config.categorias.map((c) => [c.id, c.subtemas.map((s) => s.id)]));

  for (const p of preguntas) {
    if (estaRetirada(p, ajustes)) continue;
    if (!subtemas.get(p.categoria)?.includes(p.subtema)) continue;
    const nivel = Math.min(max, Math.max(min, nivelEfectivo(p, ajustes)));
    const q = { ...p, nivelEfectivo: nivel };
    porId.set(p.id, q);
    const k = claveCelda(p.categoria, p.subtema, nivel);
    if (!celdas.has(k)) celdas.set(k, []);
    celdas.get(k).push(p.id);
  }
  return { porId, celdas, subtemas, min, max, revela: calcularRevelaciones(porId) };
}

function celda(indice, cat, sub, nivel) {
  return indice.celdas.get(claveCelda(cat, sub, nivel)) ?? [];
}

// ctx: { vistas: {id: ts} del jugador que responde, usadas: Set de ids de esta partida, rng }
// «Libre» = ni usada en la partida, ni vista por quien responde, ni revelada por otra ya usada.
function filtros(indice, ctx) {
  const usadas = ctx.usadas ?? new Set();
  const vistas = ctx.vistas ?? {};
  const reveladas = new Set();
  for (const u of usadas) for (const id of indice.revela?.get(u) ?? []) reveladas.add(id);
  return {
    libre: (id) => !usadas.has(id) && !(id in vistas) && !reveladas.has(id),
    noUsada: (id) => !usadas.has(id),
    vista: (id) => id in vistas,
    vistaHace: (id) => vistas[id] ?? "",
    revelada: (id) => reveladas.has(id),
  };
}

// Subtema que se anuncia: entre los que tienen preguntas sin ver en más niveles.
export function elegirSubtema(indice, categoria, ctx) {
  const subs = indice.subtemas.get(categoria) ?? [];
  const { libre } = filtros(indice, ctx);
  let mejor = -1;
  let candidatos = [];
  for (const s of subs) {
    let cobertura = 0;
    for (let l = indice.min; l <= indice.max; l++) {
      if (celda(indice, categoria, s, l).some(libre)) cobertura++;
    }
    if (cobertura > mejor) {
      mejor = cobertura;
      candidatos = [s];
    } else if (cobertura === mejor) {
      candidatos.push(s);
    }
  }
  return elegir(candidatos, ctx.rng);
}

// Devuelve { pregunta, alternativa } o null si la categoría no tiene ninguna pregunta.
// alternativa: null | "otro_subtema" | "otro_nivel" | "repetida"
export function elegirPregunta(indice, { categoria, subtema, nivel }, ctx) {
  const subs = indice.subtemas.get(categoria) ?? [];
  const otros = subs.filter((s) => s !== subtema);
  const { libre, noUsada, vista, vistaHace, revelada } = filtros(indice, ctx);
  const deCeldas = (lista, l, f) => lista.flatMap((s) => celda(indice, categoria, s, l).filter(f));
  // Al repetir: la vista hace más tiempo, pero nunca antes que una cuya respuesta ya ha salido
  // en esta partida (una pregunta sin ver no tiene fecha y, si no, ganaría siempre).
  const orden = (id) => [revelada(id) ? 1 : 0, vistaHace(id)];
  const antes = (a, b) => {
    const [ra, va] = orden(a);
    const [rb, vb] = orden(b);
    return ra - rb || (va < vb ? -1 : va > vb ? 1 : 0);
  };
  const masAntigua = (ids) => ids.slice().sort(antes)[0];
  const enRango = (l) => l >= indice.min && l <= indice.max;

  // «repetida» manda sobre «otro_nivel»: la calibración deja fuera las repetidas, y una pregunta ya
  // vista de otro nivel quedaba marcada solo como «otro_nivel».
  const resultado = (id) => {
    const p = indice.porId.get(id);
    let alternativa = null;
    if (vista(id)) alternativa = "repetida";
    else if (p.nivelEfectivo !== nivel) alternativa = "otro_nivel";
    else if (p.subtema !== subtema) alternativa = "otro_subtema";
    return { pregunta: p, alternativa };
  };

  // 1. Nivel exacto, subtema anunciado, sin ver.
  let c = deCeldas([subtema], nivel, libre);
  if (c.length) return resultado(elegir(c, ctx.rng));
  // 2. Nivel exacto, otro subtema, sin ver.
  c = deCeldas(otros, nivel, libre);
  if (c.length) return resultado(elegir(c, ctx.rng));
  // 3. Nivel ±1 (primero el superior), sin ver.
  for (const l of [nivel + 1, nivel - 1].filter(enRango)) {
    c = deCeldas([subtema], l, libre);
    if (!c.length) c = deCeldas(otros, l, libre);
    if (c.length) return resultado(elegir(c, ctx.rng));
  }
  // 4. Nivel exacto, vista hace más tiempo (pero no en esta partida).
  c = deCeldas(subs, nivel, noUsada);
  if (c.length) return resultado(masAntigua(c));
  // 5. Nivel más cercano disponible (primero el superior), mejor sin ver.
  for (let d = 2; d <= indice.max - indice.min; d++) {
    for (const l of [nivel + d, nivel - d].filter(enRango)) {
      c = deCeldas(subs, l, libre);
      if (c.length) return resultado(elegir(c, ctx.rng));
      c = deCeldas(subs, l, noUsada);
      if (c.length) return resultado(masAntigua(c));
    }
  }
  // 6. Último recurso: cualquier pregunta de la categoría, aunque ya haya salido en la partida.
  const todas = [];
  for (let l = indice.min; l <= indice.max; l++) todas.push(...deCeldas(subs, l, () => true));
  if (!todas.length) return null;
  const cercanas = todas.filter((id) => indice.porId.get(id).nivelEfectivo === nivel);
  return resultado(masAntigua(cercanas.length ? cercanas : todas));
}

// ---------------------------------------------------------------- rondas divertidas
// Una ronda que quien juega no haya visto (ni leído) y que no haya salido en esta partida. Si no queda
// ninguna, la que vio hace más tiempo sin repetir en la partida y, como último recurso, cualquiera.
// `excluir`: rondas que no valen ahora (la que se acaba de cambiar).
export function elegirRonda(rondas, { vistas, usadas, rng }, excluir = new Set()) {
  const validas = rondas.filter((r) => !excluir.has(r.id));
  const sinUsar = validas.filter((r) => !usadas.has(r.id));
  const nuevas = sinUsar.filter((r) => !(r.id in vistas));
  if (nuevas.length) return { ronda: elegir(nuevas, rng), repetida: false };
  const candidatas = sinUsar.length ? sinUsar : validas;
  if (!candidatas.length) return null;
  const hace = (r) => vistas[r.id] ?? "";
  const ronda = candidatas.slice().sort((a, b) => (hace(a) < hace(b) ? -1 : hace(a) > hace(b) ? 1 : 0))[0];
  return { ronda, repetida: true };
}

// ---------------------------------------------------------------- preguntas finales propias
// Una final del nivel que toca que quien juega no haya visto y que no haya salido en la partida. Si no
// queda ninguna, nunca una más difícil mientras haya otra opción: primero una nueva de un nivel más
// fácil (la más cercana), después la del nivel pedido (o de uno más fácil) vista hace más tiempo, y
// solo entonces una de un nivel más difícil. Antes se buscaba la nueva más cercana y, a la misma
// distancia, la más difícil: al agotarse las de nivel 8 (unas cinco partidas del mismo grupo), la
// final que debía bajar un escalón por la rebaja salía de nivel 9 o 10 y la partida se atascaba.
// `excluir`: finales que no valen ahora (la que se acaba de cambiar).
export function elegirFinal(finales, nivel, { vistas, usadas, rng }, excluir = new Set()) {
  const validas = finales.filter((f) => !excluir.has(f.id));
  if (!validas.length) return null;
  const sinUsar = validas.filter((f) => !usadas.has(f.id));
  const nueva = (f) => !(f.id in vistas);
  const resultado = (final, repetida) => ({ final, alternativa: repetida ? "repetida" : final.nivel === nivel ? null : "otro_nivel" });
  const distancia = (f) => Math.abs(f.nivel - nivel);
  const hace = (f) => vistas[f.id] ?? "";
  // La más cercana al nivel pedido y, a la misma distancia, la vista hace más tiempo.
  const antes = (a, b) => distancia(a) - distancia(b) || (hace(a) < hace(b) ? -1 : hace(a) > hace(b) ? 1 : 0);
  for (const lado of [(f) => f.nivel <= nivel, (f) => f.nivel > nivel]) {
    const nuevas = sinUsar.filter((f) => lado(f) && nueva(f));
    if (nuevas.length) {
      const d = Math.min(...nuevas.map(distancia));
      return resultado(elegir(nuevas.filter((f) => distancia(f) === d), rng), false);
    }
    const vistasAntes = sinUsar.filter((f) => lado(f) && !nueva(f)).sort(antes);
    if (vistasAntes.length) return resultado(vistasAntes[0], true);
  }
  // Último recurso: una que ya ha salido en esta partida (mejor de su nivel o más fácil).
  const fueraDeNivel = (f) => (f.nivel > nivel ? 1 : 0);
  return resultado(validas.slice().sort((a, b) => fueraDeNivel(a) - fueraDeNivel(b) || antes(a, b))[0], true);
}

// Para la pantalla de datos: preguntas por categoría y nivel, y cuántas no ha visto nadie.
export function resumenBanco(indice, vistoPorAlguien = new Set()) {
  const filas = [];
  for (const [cat, subs] of indice.subtemas) {
    const porNivel = [];
    for (let l = indice.min; l <= indice.max; l++) {
      const ids = subs.flatMap((s) => celda(indice, cat, s, l));
      porNivel.push({ nivel: l, total: ids.length, sinVer: ids.filter((id) => !vistoPorAlguien.has(id)).length });
    }
    filas.push({ categoria: cat, porNivel });
  }
  return filas;
}
