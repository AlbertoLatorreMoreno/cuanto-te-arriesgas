// Fin de partida: ganador (o empate, con la opción de la ronda de oro), clasificación y recordatorio de exportar.

import { h, montar } from "../dom.js";
import { unirNombres } from "../util.js";
import { enviarAhora, ficha, nombreJugador, preguntarEnvio } from "./comun.js";

// Partida por la que ya se ha preguntado si se envían los datos: si se cierra el diálogo sin contestar, no
// se insiste (queda el botón para enviarlos).
let preguntada = null;

async function pedirPermiso(app, p) {
  const si = await preguntarEnvio(
    "¿Enviamos los datos de esta partida?",
    "Sirven para ajustar el nivel de las preguntas. Se envían las respuestas (acierto o fallo), las valoraciones y las preguntas marcadas como malas, " +
      "con los nombres de los jugadores, a la hoja de cálculo del grupo. Nada más.",
  );
  if (si === undefined) return;
  app.almacen.decidirPartida(p.id, si);
  if (si) await enviarAhora(app);
  if (app.pantalla === "juego" && app.sesion?.partida.id === p.id) app.ir("juego"); // para ver cómo ha quedado
}

// Qué se ha decidido sobre los datos de la partida, con un botón para enviarlos si no se aceptó.
function estadoEnvio(app, p) {
  if (!app.urlEnvio()) {
    return h("p", { class: "nota" }, "Las respuestas y valoraciones de esta partida solo están en este móvil. Expórtalas al acabar la quedada: así no se pierden y sirven para calibrar las preguntas.");
  }
  if (app.almacen.decisionesPartidas()[p.id] === true) {
    return h("p", { class: "texto-suave pequeno" }, "✓ Aceptasteis enviar los datos de esta partida: se envían solos (en «Datos y exportación» se ve si queda algo por enviar).");
  }
  const enviar = async () => {
    app.almacen.decidirPartida(p.id, true);
    await enviarAhora(app);
    if (app.pantalla === "juego") app.ir("juego");
  };
  return h(
    "div",
    { class: "columna" },
    h("p", { class: "texto-suave pequeno" }, "Los datos de esta partida no se han enviado: solo están en este móvil."),
    h("button", { class: "boton boton-ancho", onClick: enviar }, "Enviar los datos de esta partida"),
  );
}

export function pantallaFin(app) {
  const p = app.sesion.partida;
  const ganador = p.jugadores.find((j) => j.clave === p.ganador);
  const empatados = p.empate ?? [];
  const nombres = (claves) => unirNombres(claves.map((c) => nombreJugador(p, c)));
  // Primero quien gana (o los empatados, en su orden de juego) y después los demás, por puntos.
  const puesto = (j) => (j.clave === p.ganador ? 0 : empatados.includes(j.clave) ? 1 : 2);
  const orden = [...p.jugadores].sort((a, b) => puesto(a) - puesto(b) || b.pos - a.pos);
  const conRondas = Boolean(p.especiales?.length);
  const media = (j) => {
    const n = j.nApuestas ?? j.aciertos + j.fallos; // partidas guardadas antes de existir nApuestas
    return n ? (j.sumaApuestas / n).toFixed(1).replace(".", ",") : "—";
  };
  // Ganado en la ronda de oro: «en la 2.ª ronda de oro, tras empatar con Luis».
  const desempate = ganador && p.oro
    ? `En la ${p.oro.ronda > 1 ? `${p.oro.ronda}.ª ` : ""}ronda de oro, tras empatar con ${nombres(empatados.filter((c) => c !== p.ganador))} · `
    : "";

  montar(
    ganador
      ? h(
          "section",
          { class: "podio" },
          h("div", { class: "trofeo", "aria-hidden": "true" }, "🏆"),
          h("h2", {}, `¡Gana ${ganador.nombre}!`),
          h("p", { class: "texto-suave" }, desempate ? `${desempate}${p.n} turnos` : `En ${p.n} turnos`),
        )
      : h(
          "section",
          { class: "podio" },
          h("div", { class: "trofeo", "aria-hidden": "true" }, "🤝"),
          h("h2", {}, "¡Empate!"),
          h("p", {}, `${nombres(empatados)} han acertado la final en la misma ronda: ninguno gana ni pierde.`),
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
    estadoEnvio(app, p),
    h(
      "div",
      { class: "columna acciones-fijas" },
      ganador
        ? null
        : h(
            "p",
            { class: "texto-suave pequeno centrado" },
            `¿Desempatáis? En la ronda de oro, ${nombres(empatados)} responden una final cada uno, ronda tras ronda, hasta que solo la acierte uno.`,
          ),
      ganador ? null : h("button", { class: "boton boton-primario boton-grande boton-ancho", onClick: () => app.accion("rondaDeOro") }, "🥇 Jugar la ronda de oro"),
      h(
        "button",
        { class: `boton boton-ancho${ganador ? " boton-primario boton-grande" : ""}`, onClick: () => app.ir("nueva", { jugadores: p.jugadores.map((j) => j.nombre), metaId: p.metaId, narrador: p.narrador?.nombre ?? null, cronometro: Boolean(p.cronometro), rondas: Boolean(p.rondas) }) },
        "Revancha con los mismos jugadores",
      ),
      h("button", { class: "boton boton-ancho", onClick: () => app.exportar() }, "Exportar datos"),
      h("button", { class: "boton-texto", onClick: () => app.terminarPartida() }, "Volver al inicio"),
    ),
  );
  // Al acabar, una sola vez por partida: ¿se envían sus datos?
  if (app.urlEnvio() && app.almacen.decisionesPartidas()[p.id] === undefined && preguntada !== p.id) {
    preguntada = p.id;
    pedirPermiso(app, p);
  }
}
