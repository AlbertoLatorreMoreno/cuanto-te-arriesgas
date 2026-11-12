// Pantalla de inicio.

import { partidaAMedias } from "../motor.js";
import { h, haceCuanto, montar } from "../dom.js";
import { partidasSinDecidir, revisionesSinDecidir } from "../envio.js";
import { enviarAhora, preguntarEnvio } from "./comun.js";

export async function pantallaInicio(app) {
  const vigente = app.vigente();
  const guardada = app.almacen.cargarPartida();
  const hayPartida = partidaAMedias(guardada?.partida);
  const escalera = app.almacen.escaleraSolo();
  const ultimaExportacion = app.almacen.preferencia("ultimaExportacion", null);
  const registros = await app.almacen.todosLosRegistros();
  // Los que ya están en la hoja del grupo tampoco están solo en el móvil.
  const enviados = app.almacen.idsEnviados();
  const sinExportar = registros.filter((r) => (!ultimaExportacion || r.ts > ultimaExportacion) && !enviados.has(r.id)).length;
  const ultimoEnvio = app.almacen.preferencia("ultimoEnvio", null);
  const envioFallido = Boolean(app.urlEnvio() && ultimoEnvio && !ultimoEnvio.ok);
  // Datos por los que no se llegó a preguntar: una partida cuya pantalla final se cerró sin contestar, o
  // valoraciones de «Revisar preguntas» de quien cerró la app sin volver atrás. Aquí se puede decidir.
  const sinPreguntar = app.urlEnvio()
    ? {
        partidas: partidasSinDecidir(registros, app.almacen.decisionesPartidas(), hayPartida ? guardada.partida.id : null),
        revisiones: app.almacen.preferencia("envioRevisiones", null) === true ? [] : revisionesSinDecidir(registros, app.almacen.decisionesRevisiones()).map((r) => r.id),
      }
    : { partidas: [], revisiones: [] };
  const cuantos = (n, uno, varios) => (n === 1 ? `1 ${uno}` : `${n} ${varios}`);
  const textoSinPreguntar = [
    sinPreguntar.partidas.length ? cuantos(sinPreguntar.partidas.length, "partida", "partidas") : null,
    sinPreguntar.revisiones.length ? cuantos(sinPreguntar.revisiones.length, "valoración", "valoraciones") : null,
  ]
    .filter(Boolean)
    .join(" y ");
  async function decidirSinPreguntar() {
    const si = await preguntarEnvio(
      "¿Enviamos estos datos?",
      `Hay ${textoSinPreguntar} de antes por los que no se llegó a preguntar. Sirven para ajustar el nivel de las preguntas. Se envían las respuestas y ` +
        "las valoraciones, con los nombres de los jugadores, a la hoja de cálculo del grupo. Nada más.",
    );
    if (si === undefined) return;
    for (const id of sinPreguntar.partidas) app.almacen.decidirPartida(id, si);
    if (sinPreguntar.revisiones.length) app.almacen.decidirRevisiones(sinPreguntar.revisiones, si);
    if (si) await enviarAhora(app);
    if (app.pantalla === "inicio") app.ir("inicio");
  }
  if (!vigente()) return;

  montar(
    h(
      "section",
      { class: "portada" },
      h(
        "div",
        { class: "logo", "aria-hidden": "true" },
        app.config.categorias.slice(0, 4).map((c) => h("span", { style: { background: c.color } })),
      ),
      h("h1", {}, app.config.nombre),
      h("p", {}, "Tú eliges la dificultad. Si aciertas, sumas lo que arriesgaste."),
    ),
    !app.almacen.persistente
      ? h("p", { class: "nota" }, "Este navegador no deja guardar datos de forma permanente (¿modo privado?). Puedes jugar, pero la partida y las respuestas se perderán al cerrar.")
      : null,
    h(
      "div",
      { class: "columna" },
      hayPartida
        ? h(
            "button",
            { class: "boton boton-primario boton-grande boton-ancho", onClick: () => app.reanudar() },
            `Continuar partida (${guardada.partida.jugadores.map((j) => j.nombre).join(", ")})`,
          )
        : null,
      h("button", { class: `boton boton-grande boton-ancho ${hayPartida ? "" : "boton-primario"}`, onClick: () => app.ir("nueva") }, "Nueva partida"),
      h(
        "button",
        { class: "boton boton-grande boton-ancho", onClick: () => app.ir("solo") },
        escalera ? `Continuar escalera (${escalera.jugador.nombre})` : "Jugar solo · reto del día",
      ),
      h("button", { class: "boton boton-ancho", onClick: () => app.ir("revision") }, "Revisar preguntas"),
      h("button", { class: "boton boton-ancho", onClick: () => app.ir("datos") }, "Datos y exportación"),
      h("button", { class: "boton-texto", onClick: () => app.ir("reglas", { volverA: "inicio" }) }, "Cómo se juega"),
    ),
    textoSinPreguntar
      ? h(
          "div",
          { class: "nota columna" },
          h("p", {}, `Hay ${textoSinPreguntar} sin enviar: no se llegó a preguntar si se enviaban.`),
          h("button", { class: "boton boton-ancho", onClick: decidirSinPreguntar }, "Decidir ahora"),
        )
      : null,
    // Los datos solo están en este móvil y el navegador puede borrarlos (Safari, tras 7 días sin abrir
    // una web no instalada): se avisa ya tras una partida, para que se exporten al acabar la quedada.
    envioFallido
      ? h("p", { class: "nota" }, `No se han podido enviar los datos que aceptasteis enviar. ${ultimoEnvio.error} Se volverá a intentar solo; también desde «Datos y exportación».`)
      : sinExportar >= 20
        ? h(
            "p",
            { class: "nota" },
            `Tienes ${sinExportar} respuestas y valoraciones sin exportar (última exportación: ${haceCuanto(ultimaExportacion)}). Solo están en este móvil: expórtalas en «Datos y exportación».`,
          )
        : null,
    h("p", { class: "pie-version empuja" }, `${app.indice.porId.size} preguntas · banco ${app.versiones.banco} · ajustes ${app.versiones.ajustes} · v${app.version}`),
  );
  // Lo aceptado que falte, a la hoja del grupo. Se repinta si cambia el aviso: si se ha enviado algo, o
  // si falla y aún no se avisaba (si ya se avisaba, no: se volvería a intentar sin parar).
  app.sincronizar().then((r) => {
    if (vigente() && (r?.enviados.length || (r && !r.ok && !envioFallido))) app.ir("inicio");
  });
}
