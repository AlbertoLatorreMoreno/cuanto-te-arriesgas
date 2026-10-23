import { readFileSync } from "node:fs";
import { rngConSemilla } from "../app/js/azar.js";
import { crearIndice } from "../app/js/banco.js";
import * as M from "../app/js/motor.js";

export const config = JSON.parse(readFileSync(new URL("../app/data/config.json", import.meta.url), "utf8"));

// Banco sintético: `porCelda` preguntas en cada (categoría, subtema, nivel).
export function bancoSintetico(porCelda = 2, cfg = config) {
  const preguntas = [];
  for (const c of cfg.categorias) {
    for (const s of c.subtemas) {
      for (let nivel = cfg.niveles.min; nivel <= cfg.niveles.max; nivel++) {
        for (let k = 0; k < porCelda; k++) {
          preguntas.push({
            id: `${c.id}-${s.id}-${nivel}-${k}`,
            v: 1,
            categoria: c.id,
            subtema: s.id,
            nivel,
            pregunta: `¿Pregunta ${k} de ${s.nombre}, nivel ${nivel}?`,
            // Respuesta única: si todas fueran iguales, cada pregunta «delataría» a las demás
            // (banco.js evita sacarlas) y las pruebas no pasarían por la selección normal.
            respuesta: `Respuesta ${c.id} ${s.id} ${nivel} ${k}`,
            tambien_vale: [],
            origen: "semilla",
            // En una categoría de mapa, cada pregunta tiene su punto (todos distintos) y su distancia.
            ...(c.tipo === "mapa"
              ? { tipo: "mapa", lat: nivel * 7 - 35 + k, lon: k * 25 - 120 + nivel, distancia_max_km: cfg.mapa.distancias_km[1] }
              : {}),
          });
        }
      }
    }
  }
  return preguntas;
}

// Un punto para responder una pregunta de mapa: el exacto (acierto, con todos los puntos) o sus
// antípodas (fallo, sin ninguno).
export function puntoMapa(q, acierto) {
  return acierto ? { lat: q.lat, lon: q.lon } : { lat: -q.lat, lon: q.lon > 0 ? q.lon - 180 : q.lon + 180 };
}

// Responde la pregunta del turno, que está en lectura: si es de mapa se señala; si no, se ve la
// respuesta y se juzga.
export function responder(p, ctx, acierto) {
  const q = p.turno.preguntaDatos;
  if (q?.tipo === "mapa") return M.senalar(p, puntoMapa(q, acierto), ctx).partida;
  return M.juzgar(M.revelar(p).partida, acierto).partida;
}

// Lo mismo, con una sesión.
export async function responderSesion(s, acierto) {
  const q = s.turno.preguntaDatos;
  if (q?.tipo === "mapa") return s.ejecutar("senalar", puntoMapa(q, acierto));
  await s.ejecutar("revelar");
  return s.ejecutar("juzgar", acierto);
}

// Fuerza que el turno (aún en el anuncio) sea de una categoría que no es de mapa, para las pruebas
// que necesitan ver la respuesta antes de juzgar.
export function sinMapa(p) {
  const q = structuredClone(p);
  const cat = config.categorias.find((c) => c.tipo !== "mapa");
  if (config.categorias.find((c) => c.id === q.turno.categoria)?.tipo === "mapa") {
    q.turno.categoria = cat.id;
    q.turno.subtema = cat.subtemas[0].id;
  }
  return q;
}

// Rondas sintéticas: listas cerradas y abiertas y ráfagas, de 6 a 10 elementos.
export function rondasSinteticas(n = 12) {
  return Array.from({ length: n }, (_, k) => {
    const tipo = k % 3 === 2 ? "rafaga" : "lista";
    const elementos = Array.from({ length: 6 + (k % 5) }, (_, i) =>
      tipo === "lista" ? { texto: `Elemento ${k}-${i}`, tambien_vale: [] } : { pista: `Pista ${k}-${i}`, respuesta: `Respuesta ${k}-${i}`, tambien_vale: [] },
    );
    return { id: `ron-prueba-${k}`, v: 1, tipo, titulo: `Ronda ${k}`, enunciado: `Enunciado ${k}`, segundos: 30, cerrada: tipo === "lista" && k % 4 !== 3, nota: null, elementos, fuente: "prueba" };
  });
}

// Finales propias sintéticas: `porNivel` en cada nivel de la final (8, 9 y 10); una de cada tres, un reto «3 de 5».
export function finalesSinteticas(porNivel = 6) {
  const salida = [];
  for (let nivel = config.final.nivel_base; nivel <= config.final.nivel_max; nivel++) {
    for (let k = 0; k < porNivel; k++) {
      const id = `fin-${nivel}${String(k).padStart(2, "0")}`;
      salida.push(k % 3 === 2
        ? { id, v: 1, nivel, tipo: "reto", titulo: `Reto ${id}`, enunciado: `Acierta al menos 3 de estas 5 (${id}).`, minimo: 3, segundos: 45, nota: null,
            elementos: Array.from({ length: 5 }, (_, i) => ({ pista: `Pista ${id}-${i}`, respuesta: `Respuesta ${id}-${i}`, tambien_vale: [] })) }
        : { id, v: 1, nivel, tipo: "pregunta", pregunta: `¿Pregunta final ${id}?`, respuesta: `Respuesta ${id}`, tambien_vale: [], criterio: null,
            explicacion: null, segundos: k % 3 === 1 ? 60 : null });
    }
  }
  return salida;
}

export function contexto({ semilla = 1, preguntas = bancoSintetico(), ajustes = null, vistas = {}, rondas = [], finales = [] } = {}) {
  let reloj = 0;
  return {
    config,
    indice: crearIndice(preguntas, config, ajustes),
    rondas,
    finales,
    rng: rngConSemilla(semilla),
    vistasDe: (clave) => vistas[clave] ?? {},
    ahora: () => new Date(Date.UTC(2026, 9, 17, 18, 0, reloj++)).toISOString(),
  };
}

export const JUGADORES = [
  { clave: "ana", nombre: "Ana" },
  { clave: "luis", nombre: "Luis" },
  { clave: "marta", nombre: "Marta" },
];
