// Pantalla de inicio.

import { partidaAMedias } from "../motor.js";
import { h, haceCuanto, montar } from "../dom.js";

export async function pantallaInicio(app) {
  const vigente = app.vigente();
  const guardada = app.almacen.cargarPartida();
  const hayPartida = partidaAMedias(guardada?.partida);
  const ultimaExportacion = app.almacen.preferencia("ultimaExportacion", null);
  const registros = await app.almacen.todosLosRegistros();
  const sinExportar = registros.filter((r) => !ultimaExportacion || r.ts > ultimaExportacion).length;
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
      h("button", { class: "boton boton-ancho", onClick: () => app.ir("revision") }, "Revisar preguntas"),
      h("button", { class: "boton boton-ancho", onClick: () => app.ir("datos") }, "Datos y exportación"),
      h("button", { class: "boton-texto", onClick: () => app.ir("reglas", { volverA: "inicio" }) }, "Cómo se juega"),
    ),
    // Los datos solo están en este móvil y el navegador puede borrarlos (Safari, tras 7 días sin abrir
    // una web no instalada): se avisa ya tras una partida, para que se exporten al acabar la quedada.
    sinExportar >= 20
      ? h(
          "p",
          { class: "nota" },
          `Tienes ${sinExportar} respuestas y valoraciones sin exportar (última exportación: ${haceCuanto(ultimaExportacion)}). Solo están en este móvil: expórtalas en «Datos y exportación».`,
        )
      : null,
    h("p", { class: "pie-version empuja" }, `${app.indice.porId.size} preguntas · banco ${app.versiones.banco} · ajustes ${app.versiones.ajustes} · v${app.version}`),
  );
}
