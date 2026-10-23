// Fin de partida: ganador, clasificación y recordatorio de exportar.

import { h, montar } from "../dom.js";
import { ficha } from "./comun.js";

export function pantallaFin(app) {
  const p = app.sesion.partida;
  const ganador = p.jugadores.find((j) => j.clave === p.ganador);
  const orden = [...p.jugadores].sort((a, b) => (a.clave === p.ganador ? -1 : b.clave === p.ganador ? 1 : b.pos - a.pos));
  const conRondas = Boolean(p.especiales?.length);
  const media = (j) => {
    const n = j.nApuestas ?? j.aciertos + j.fallos; // partidas guardadas antes de existir nApuestas
    return n ? (j.sumaApuestas / n).toFixed(1).replace(".", ",") : "—";
  };

  montar(
    h(
      "section",
      { class: "podio" },
      h("div", { class: "trofeo", "aria-hidden": "true" }, "🏆"),
      h("h2", {}, `¡Gana ${ganador.nombre}!`),
      h("p", { class: "texto-suave" }, `En ${p.n} turnos`),
    ),
    h(
      "div",
      { class: "tabla-desplazable" },
      h(
      "table",
      { class: "tabla tabla-fin" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", {}, "Jugador"),
          h("th", { title: "Puntos" }, "Pts."),
          h("th", {}, "Aciertos"),
          h("th", { title: "Apuesta media" }, "Media"),
          h("th", { title: "Mayor nivel acertado" }, "Máx."),
          conRondas ? h("th", { title: "Casillas ganadas en rondas" }, "★") : null,
        ),
      ),
      h(
        "tbody",
        {},
        orden.map((j) =>
          h(
            "tr",
            {},
            h("td", {}, h("span", { class: "celda-jugador" }, ficha(p, j), h("span", { class: "nombre-corto" }, j.nombre))),
            h("td", {}, String(j.pos)),
            h("td", {}, `${j.aciertos}/${j.aciertos + j.fallos}`),
            h("td", {}, media(j)),
            h("td", {}, j.mejorAcierto ? String(j.mejorAcierto) : "—"),
            conRondas ? h("td", {}, j.casillasRonda ? `+${j.casillasRonda}` : "—") : null,
          ),
        ),
      ),
      ),
    ),
    h(
      "p",
      { class: "texto-suave pequeno" },
      `Aciertos y media: solo preguntas (la media, sin la final). Máx.: mayor nivel acertado, también en la final.${conRondas ? " ★: casillas ganadas en las rondas." : ""}`,
    ),
    h("p", { class: "nota" }, "Las respuestas y valoraciones de esta partida solo están en este móvil. Expórtalas al acabar la quedada: así no se pierden y sirven para calibrar las preguntas."),
    h(
      "div",
      { class: "columna acciones-fijas" },
      h(
        "button",
        { class: "boton boton-primario boton-grande boton-ancho", onClick: () => app.ir("nueva", { jugadores: p.jugadores.map((j) => j.nombre), metaId: p.metaId, narrador: p.narrador?.nombre ?? null, cronometro: Boolean(p.cronometro), rondas: Boolean(p.rondas) }) },
        "Revancha con los mismos jugadores",
      ),
      h("button", { class: "boton boton-ancho", onClick: () => app.exportar() }, "Exportar datos"),
      h("button", { class: "boton-texto", onClick: () => app.terminarPartida() }, "Volver al inicio"),
    ),
  );
}
