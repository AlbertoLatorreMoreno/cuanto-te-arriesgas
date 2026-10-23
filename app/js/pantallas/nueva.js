// Nueva partida: jugadores, duración y orden.

import { barajar, rngReal } from "../azar.js";
import { cabecera, confirmar, h, montar } from "../dom.js";
import { partidaAMedias } from "../motor.js";
import { normalizarNombre, rangoCronometro, unirNombres } from "../util.js";
import { MAX_CHIPS_JUGADORES } from "./comun.js";

export function pantallaNueva(app, params = {}) {
  const { min, max } = app.config.jugadores;
  const estado = {
    nombres: params.jugadores?.length ? [...params.jugadores] : ["", ""],
    metaId: params.metaId ?? app.almacen.preferencia("metaId", app.config.metas[0].id),
    sortear: app.almacen.preferencia("sortear", true),
    // Con narrador: una persona que no juega lee todas las preguntas y el móvil no se pasa.
    conNarrador: params.jugadores?.length ? Boolean(params.narrador) : app.almacen.preferencia("conNarrador", false),
    narrador: params.narrador ?? app.almacen.preferencia("narrador", ""),
    cronometro: params.cronometro ?? app.almacen.preferencia("cronometro", true),
    rondas: params.rondas ?? app.almacen.preferencia("rondas", true),
    error: "",
  };
  const conocidos = app.almacen.jugadoresConocidos();

  function pintar(foco = null) {
    const usados = new Set([...estado.nombres, estado.conNarrador ? estado.narrador : ""].map(normalizarNombre).filter(Boolean));
    const sugeridos = conocidos.filter((j) => !usados.has(j.clave)).slice(0, MAX_CHIPS_JUGADORES);

    const filas = estado.nombres.map((nombre, i) =>
      h(
        "div",
        { class: "campo" },
        h("input", {
          type: "text",
          value: nombre,
          placeholder: `Jugador ${i + 1}`,
          maxlength: "20",
          autocomplete: "off",
          enterkeyhint: "next",
          "aria-label": `Nombre del jugador ${i + 1}`,
          onInput: (e) => {
            estado.nombres[i] = e.target.value;
          },
        }),
        estado.nombres.length > min
          ? h(
              "button",
              {
                class: "quitar",
                "aria-label": `Quitar jugador ${i + 1}`,
                onClick: () => {
                  estado.nombres.splice(i, 1);
                  pintar();
                },
              },
              "×",
            )
          : null,
      ),
    );

    montar(
      cabecera("Nueva partida", () => app.ir("inicio")),
      h(
        "div",
        { class: "dos-columnas" },
        h(
          "div",
          { class: "columna" },
          h("p", { class: "titulo-seccion" }, `Jugadores (${min} a ${max})`),
          h("div", { class: "columna" }, filas),
          estado.nombres.length < max
            ? h(
                "button",
                {
                  class: "boton boton-ancho",
                  onClick: () => {
                    estado.nombres.push("");
                    pintar(estado.nombres.length - 1);
                  },
                },
                "+ Añadir jugador",
              )
            : null,
          sugeridos.length
            ? h(
                "div",
                { class: "columna" },
                h("p", { class: "texto-suave pequeno" }, "Jugadores anteriores:"),
                h(
                  "div",
                  { class: "chips" },
                  sugeridos.map((j) =>
                    h(
                      "button",
                      {
                        class: "chip chip-jugador",
                        onClick: () => {
                          const vacio = estado.nombres.findIndex((n) => !n.trim());
                          if (vacio >= 0) estado.nombres[vacio] = j.nombre;
                          else if (estado.nombres.length < max) estado.nombres.push(j.nombre);
                          pintar();
                        },
                      },
                      `+ ${j.nombre}`,
                    ),
                  ),
                ),
              )
            : null,
        ),
        h(
          "div",
          { class: "columna panel-opciones" },
          h("p", { class: "titulo-seccion" }, "Cómo jugáis"),
          h(
            "div",
            { class: "segmentado", role: "group", "aria-label": "Cómo jugáis" },
            [
              [false, "Pasando el móvil", "Lee quien va después"],
              [true, "Con narrador", "Una persona lee y no juega"],
            ].map(([valor, texto, detalle]) =>
              h(
                "button",
                {
                  "aria-pressed": String(estado.conNarrador === valor),
                  onClick: () => {
                    estado.conNarrador = valor;
                    pintar(valor ? "narrador" : null);
                  },
                },
                texto,
                h("small", {}, detalle),
              ),
            ),
          ),
          estado.conNarrador
            ? h(
                "div",
                { class: "campo" },
                h("input", {
                  type: "text",
                  id: "nombre-narrador",
                  value: estado.narrador,
                  placeholder: "Nombre de quien narra",
                  maxlength: "20",
                  autocomplete: "off",
                  "aria-label": "Nombre de quien narra",
                  onInput: (e) => {
                    estado.narrador = e.target.value;
                  },
                }),
              )
            : null,
          h("p", { class: "titulo-seccion" }, "Duración"),
          h(
            "div",
            { class: "segmentado", role: "group", "aria-label": "Duración" },
            app.config.metas.map((m) =>
              h(
                "button",
                {
                  "aria-pressed": String(estado.metaId === m.id),
                  onClick: () => {
                    estado.metaId = m.id;
                    pintar();
                  },
                },
                `${m.nombre}: ${m.puntos} puntos`,
                h("small", {}, m.duracion),
              ),
            ),
          ),
          h(
            "label",
            { class: "campo", style: { gap: "10px" } },
            h("input", {
              type: "checkbox",
              checked: estado.sortear,
              style: { width: "22px", height: "22px" },
              onChange: (e) => {
                estado.sortear = e.target.checked;
              },
            }),
            "Sortear quién empieza y el orden",
          ),
          app.config.cronometro?.categorias?.length
            ? h(
                "label",
                { class: "campo", style: { gap: "10px" } },
                h("input", {
                  type: "checkbox",
                  checked: estado.cronometro,
                  style: { width: "22px", height: "22px", "flex-shrink": "0" },
                  onChange: (e) => {
                    estado.cronometro = e.target.checked;
                  },
                }),
                h(
                  "span",
                  {},
                  `Cronómetro en ${unirNombres(app.config.cronometro.categorias.map((c) => app.nombreCategoria(c)))}`,
                  h("small", { class: "texto-suave", style: { display: "block" } }, `${rangoCronometro(app.config)}, según el nivel`),
                ),
              )
            : null,
          app.rondas.length
            ? h(
                "label",
                { class: "campo", style: { gap: "10px" } },
                h("input", {
                  type: "checkbox",
                  checked: estado.rondas,
                  style: { width: "22px", height: "22px", "flex-shrink": "0" },
                  onChange: (e) => {
                    estado.rondas = e.target.checked;
                  },
                }),
                h(
                  "span",
                  {},
                  "Rondas divertidas en las casillas ★",
                  h("small", { class: "texto-suave", style: { display: "block" } }, "Listas y ráfagas: avanzas una casilla por acierto"),
                ),
              )
            : null,
          estado.error ? h("p", { class: "error", role: "alert" }, estado.error) : null,
          h("div", { class: "acciones-fijas" }, h("button", { class: "boton boton-primario boton-grande boton-ancho", onClick: empezar }, "Empezar")),
        ),
      ),
    );
    if (foco === "narrador") document.getElementById("nombre-narrador")?.focus();
    else if (foco != null) document.querySelectorAll(".campo input[type=text]:not(#nombre-narrador)")[foco]?.focus();
  }

  async function empezar() {
    // Un nombre sin nada visible (solo caracteres invisibles) cuenta como vacío.
    const nombres = estado.nombres.map((n) => n.trim().replace(/\s+/g, " ")).filter((n) => normalizarNombre(n));
    const claves = nombres.map(normalizarNombre);
    if (nombres.length < min) return fallar(`Hacen falta al menos ${min} jugadores.`);
    if (new Set(claves).size !== claves.length) return fallar("Hay dos jugadores con el mismo nombre. Usad apodos distintos.");
    const nombreNarrador = estado.narrador.trim().replace(/\s+/g, " ");
    const narrador = estado.conNarrador ? { clave: normalizarNombre(nombreNarrador), nombre: nombreNarrador } : null;
    if (narrador && !narrador.clave) return fallar("Escribe el nombre de quien narra.");
    if (narrador && claves.includes(narrador.clave)) return fallar(`${nombreNarrador} narra y no juega: quita su nombre de los jugadores o elige a otra persona para narrar.`);

    // Solo se avisa si la guardada se podía continuar (una de una versión anterior ya no).
    if (partidaAMedias(app.almacen.cargarPartida()?.partida)) {
      const ok = await confirmar("Hay una partida a medias", "Si empiezas otra, se perderá. Las respuestas ya jugadas siguen registradas.", { si: "Empezar otra", peligro: true });
      if (!ok) return;
    }

    let jugadores = nombres.map((nombre, i) => ({ clave: claves[i], nombre }));
    if (estado.sortear) jugadores = barajar(jugadores, rngReal());
    app.almacen.guardarPreferencia("metaId", estado.metaId);
    app.almacen.guardarPreferencia("sortear", estado.sortear);
    app.almacen.guardarPreferencia("conNarrador", estado.conNarrador);
    app.almacen.guardarPreferencia("cronometro", estado.cronometro);
    if (app.rondas.length) app.almacen.guardarPreferencia("rondas", estado.rondas);
    if (narrador) app.almacen.guardarPreferencia("narrador", narrador.nombre);
    app.iniciarPartida({ jugadores, metaId: estado.metaId, narrador, cronometro: estado.cronometro, rondas: estado.rondas && app.rondas.length > 0 });
  }

  function fallar(mensaje) {
    estado.error = mensaje;
    pintar();
  }

  pintar();
}
