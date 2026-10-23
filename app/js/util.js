// Utilidades sin dependencias del navegador (se usan también en los tests).

// «  Ana  Pérez » → "ana perez". Es la clave del jugador en todos los móviles.
// Quita también los caracteres invisibles (marcas de dirección, espacios de ancho cero…) que se cuelan
// al copiar un nombre de otra app: sin esto, «Ana» y «Ana» con una marca invisible eran dos jugadores.
export function normalizarNombre(nombre) {
  return String(nombre)
    .replace(/\p{Cf}/gu, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Hash FNV-1a de 32 bits en hexadecimal: identifica la versión del banco.
export function fnv1a(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function versionBanco(preguntas) {
  const claves = preguntas.map((p) => `${p.id}:${p.v}`).sort();
  return fnv1a(claves.join("|"));
}

// Letras de las fichas de una partida: la inicial; dos letras si otro jugador empieza por la misma
// (sin contar tildes: «Ana» y «Álex» → «An» y «Ál»); y la inicial con su número de orden si aun así
// coinciden («Ana» y «Anabel» → «A1» y «A2»).
export function letrasFichas(nombres) {
  const letras = nombres.map((n) => [...String(n).trim().replace(/\s+/g, "")]);
  const clave = (l, k) => normalizarNombre(l.slice(0, k).join(""));
  const unica = (i, k) => letras.filter((l) => clave(l, k) === clave(letras[i], k)).length === 1;
  return letras.map((l, i) => {
    const inicial = (l[0] ?? "?").toUpperCase();
    if (unica(i, 1)) return inicial;
    if (l.length > 1 && unica(i, 2)) return inicial + l[1].toLowerCase();
    return inicial + (i + 1);
  });
}

// ["Ana", "Luis", "Inés"] → "Ana, Luis e Inés" (la «y» pasa a «e» ante el sonido «i»).
export function unirNombres(nombres) {
  if (nombres.length < 2) return nombres.join("");
  const ultimo = nombres[nombres.length - 1];
  const y = /^h?[ií](?![aeiouáéíóú])/i.test(ultimo.trim()) ? "e" : "y";
  return `${nombres.slice(0, -1).join(", ")} ${y} ${ultimo}`;
}

// Segundos de cronómetro para una pregunta, o null si su categoría no lleva (config.cronometro).
export function segundosCronometro(config, categoria, nivel) {
  const c = config.cronometro;
  if (!c?.categorias?.includes(categoria)) return null;
  const s = c.segundos_por_nivel?.[nivel - config.niveles.min];
  return Number.isFinite(s) && s > 0 ? s : null;
}

// 30 → «30 s»; 90 → «1 min 30 s»; 120 → «2 min».
export function duracionLegible(segundos) {
  const min = Math.floor(segundos / 60);
  const s = segundos % 60;
  if (!min) return `${s} s`;
  return s ? `${min} min ${s} s` : `${min} min`;
}

// «De 45 s (nivel 1) a 1 min 30 s (nivel 10)», para explicar el cronómetro.
export function rangoCronometro(config) {
  const tiempos = config.cronometro?.segundos_por_nivel ?? [];
  if (!tiempos.length) return "";
  return `de ${duracionLegible(tiempos[0])} (nivel ${config.niveles.min}) a ${duracionLegible(tiempos[tiempos.length - 1])} (nivel ${config.niveles.max})`;
}

// 75 → «1:15»; 45 → «0:45».
export function formatoTiempo(segundos) {
  const s = Math.max(0, Math.ceil(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function clonar(x) {
  return typeof structuredClone === "function" ? structuredClone(x) : JSON.parse(JSON.stringify(x));
}

// Horquilla de niveles del modo revisión. Un toque elige un nivel; tocar otro la extiende hasta él;
// tocar el único elegido la quita, y tocar con una horquilla ya hecha empieza otra.
export function alternarHorquilla(actual, n) {
  if (!actual || actual[0] !== actual[1]) return [n, n];
  if (actual[0] === n) return null;
  return [Math.min(actual[0], n), Math.max(actual[0], n)];
}

// [4, 5] con nivel 6 → «Le pondrías entre un 4 y un 5: más fácil que el 6 que tiene.»
export function textoHorquilla([a, b], nivel) {
  const cuanto = a === b ? `un ${a}` : `entre un ${a} y un ${b}`;
  let relacion;
  if (b < nivel) relacion = `más fácil que el ${nivel} que tiene`;
  else if (a > nivel) relacion = `más difícil que el ${nivel} que tiene`;
  else if (a === b) relacion = "justo el nivel que tiene";
  else relacion = `el ${nivel} que tiene entra en la horquilla`;
  return `Le pondrías ${cuanto}: ${relacion}.`;
}
