// Modo revisión: valorar preguntas fuera de partida para acumular etiquetas rápido.

import { barajar, rngReal, uuid } from "../azar.js";
import { aviso, cabecera, h, montar } from "../dom.js";
import { revisionesSinDecidir } from "../envio.js";
import { alternarHorquilla, normalizarNombre, textoHorquilla } from "../util.js";
import { MAX_CHIPS_JUGADORES, enviarAhora, estiloCat, etiquetaCat, preguntarEnvio } from "./comun.js";

// Al volver al inicio: si hay valoraciones por las que aún no se ha preguntado, ¿se envían a la hoja del grupo?
async function salir(app) {
  const nuevas = app.urlEnvio() ? revisionesSinDecidir(await app.almacen.todosLosRegistros(), app.almacen.decisionesRevisiones()) : [];
  if (nuevas.length) {
    const si = await preguntarEnvio(
      nuevas.length === 1 ? "¿Enviamos esta valoración?" : `¿Enviamos estas ${nuevas.length} valoraciones?`,
      "Sirven para ajustar el nivel de las preguntas. Se envía lo que habéis valorado, con el nombre de quien revisa, a la hoja de cálculo del grupo. Nada más.",
    );
    if (si !== undefined) app.almacen.decidirRevisiones(nuevas.map((r) => r.id), si);
    app.ir("inicio");
    if (si) enviarAhora(app);
    return;
  }
  app.ir("inicio");
}

export function pantallaRevision(app) {
  const conocidos = app.almacen.jugadoresConocidos();
  const estado = {
    evaluador: app.almacen.preferencia("evaluador", null),
    nombreNuevo: "",
    categoria: "",
    nivel: "",
    cola: [],
    actual: null,
    valoracion: null,
    horquilla: null, // [desde, hasta]: niveles que le pondría quien revisa
    mala: null,
    hechas: 0,
    guardando: null, // pregunta cuya valoración se está guardando
  };

  function elegirEvaluador() {
    const opciones = conocidos.slice(0, MAX_CHIPS_JUGADORES);
    if (estado.evaluador && !opciones.some((j) => j.clave === estado.evaluador.clave)) opciones.unshift(estado.evaluador);
    montar(
      cabecera("Revisar preguntas", () => salir(app)),
      h(
        "p",
        { class: "texto-suave" },
        "Valora si cada pregunta encaja con su nivel, o di qué nivel le pondrías. Estas valoraciones entrenan el modelo igual que las partidas, pero mucho más rápido.",
      ),
      h("p", { class: "nota" }, "Las preguntas que revises ya no te saldrán en partida mientras queden otras sin ver."),
      h("p", { class: "titulo-seccion" }, "¿Quién revisa?"),
      opciones.length
        ? h(
            "div",
            { class: "chips" },
            opciones.map((j) =>
              h(
                "button",
                {
                  class: "chip chip-jugador",
                  "aria-pressed": String(estado.evaluador?.clave === j.clave),
                  onClick: () => {
                    estado.evaluador = { clave: j.clave, nombre: j.nombre };
                    estado.nombreNuevo = "";
                    elegirEvaluador();
                  },
                },
                j.nombre,
              ),
            ),
          )
        : null,
      h(
        "div",
        { class: "campo" },
        h("input", {
          type: "text",
          placeholder: opciones.length ? "U otro nombre" : "Tu nombre",
          maxlength: "20",
          value: estado.nombreNuevo,
          "aria-label": "Nombre de quien revisa",
          onInput: (e) => {
            estado.nombreNuevo = e.target.value;
          },
        }),
      ),
      h("p", { class: "titulo-seccion" }, "¿Qué preguntas?"),
      h(
        "select",
        { "aria-label": "Categoría", onChange: (e) => (estado.categoria = e.target.value) },
        h("option", { value: "" }, "Todas las categorías"),
        app.config.categorias.map((c) => h("option", { value: c.id, selected: estado.categoria === c.id }, c.nombre)),
      ),
      h(
        "select",
        { "aria-label": "Nivel", onChange: (e) => (estado.nivel = e.target.value) },
        h("option", { value: "" }, "Todos los niveles"),
        Array.from({ length: 10 }, (_, i) => h("option", { value: String(i + 1), selected: estado.nivel === String(i + 1) }, `Nivel ${i + 1}`)),
      ),
      h("button", { class: "boton boton-primario boton-grande boton-ancho empuja", onClick: empezar }, "Empezar a revisar"),
    );
  }

  function empezar() {
    const nombre = estado.nombreNuevo.trim().replace(/\s+/g, " ");
    if (normalizarNombre(nombre)) estado.evaluador = { clave: normalizarNombre(nombre), nombre };
    if (!estado.evaluador) return aviso("Elige quién revisa.", { error: true });
    app.almacen.guardarPreferencia("evaluador", estado.evaluador);
    app.almacen.recordarJugadores([estado.evaluador], new Date().toISOString());

    const revisadas = app.almacen.revisadasDe(estado.evaluador.clave);
    const candidatas = [...app.indice.porId.values()].filter(
      (q) => (!estado.categoria || q.categoria === estado.categoria) && (!estado.nivel || q.nivelEfectivo === Number(estado.nivel)) && !(q.id in revisadas),
    );
    estado.cola = barajar(candidatas, rngReal());
    siguiente();
  }

  function siguiente() {
    estado.actual = estado.cola.shift() ?? null;
    estado.valoracion = null;
    estado.horquilla = null;
    estado.mala = null;
    pintarPregunta();
  }

  function pintarPregunta() {
    const q = estado.actual;
    if (!q) {
      return montar(
        cabecera("Revisar preguntas", () => salir(app)),
        h(
          "section",
          { class: "pantalla-pasar" },
          h("div", { class: "icono-pasar", "aria-hidden": "true" }, "✅"),
          h("h2", {}, estado.hechas ? `¡${estado.hechas} ${estado.hechas === 1 ? "revisada" : "revisadas"}!` : "No quedan preguntas"),
          h("p", { class: "texto-suave" }, "No quedan preguntas sin revisar con estos filtros."),
          h("button", { class: "boton boton-primario boton-ancho", onClick: elegirEvaluador }, "Cambiar filtros"),
        ),
      );
    }
    const nivel = q.nivelEfectivo;
    // «Es más fácil / Sí / Es más difícil» y la horquilla son dos formas de valorar: elegir una quita la otra.
    const opcion = (valor, texto) =>
      h(
        "button",
        {
          class: "boton",
          "aria-pressed": String(estado.valoracion === valor),
          onClick: () => {
            estado.valoracion = estado.valoracion === valor ? null : valor;
            estado.horquilla = null;
            pintarPregunta();
          },
        },
        texto,
      );
    const [desde, hasta] = estado.horquilla ?? [0, -1];
    const botonNivel = (n) =>
      h(
        "button",
        {
          class: n === nivel ? "boton actual" : "boton",
          "aria-pressed": String(n >= desde && n <= hasta),
          "aria-label": n === nivel ? `Nivel ${n}, el que tiene` : `Nivel ${n}`,
          onClick: () => {
            estado.horquilla = alternarHorquilla(estado.horquilla, n);
            if (estado.horquilla) estado.valoracion = null;
            pintarPregunta();
          },
        },
        String(n),
      );
    montar(
      cabecera(`Revisando: ${estado.evaluador.nombre}`, elegirEvaluador),
      h("p", { class: "texto-suave pequeno" }, `${estado.hechas} ${estado.hechas === 1 ? "revisada" : "revisadas"} · ${estado.cola.length ? `quedan ${estado.cola.length + 1}` : "queda 1"}`),
      h(
        "div",
        { class: "dos-columnas" },
        h(
          "div",
          { class: "columna" },
          h(
            "div",
            { class: "meta-linea" },
            etiquetaCat(app, q.categoria, q.subtema),
            h("span", { class: "nivel-chip", style: estiloCat(app, q.categoria) }, String(nivel)),
          ),
          h(
            "section",
            { class: "tarjeta tarjeta-cat", style: estiloCat(app, q.categoria) },
            h("p", { class: "texto-pregunta" }, q.pregunta),
            h(
              "div",
              { class: "respuesta" },
              h("p", { class: "texto-suave pequeno" }, "Respuesta"),
              h("p", { class: "valor" }, q.respuesta),
              q.tambien_vale?.length ? h("p", { class: "detalle" }, `También vale: ${q.tambien_vale.join(" · ")}`) : null,
              q.criterio ? h("p", { class: "detalle" }, `Criterio: ${q.criterio}`) : null,
            ),
            q.explicacion ? h("p", { class: "texto-suave pequeno", style: { "margin-top": "10px" } }, q.explicacion) : null,
          ),
        ),
        h(
          "div",
          { class: "columna panel-valorar" },
          h("p", { class: "titulo-seccion" }, `Para tu grupo, ¿encaja con un nivel ${nivel}?`),
          h("div", { class: "grupo-opciones" }, opcion("facil", "Es más fácil"), opcion("justa", "Sí"), opcion("dificil", "Es más difícil")),
          h("p", { class: "texto-suave pequeno" }, "O afina: ¿qué nivel le pondrías? Toca uno, o dos para dar una horquilla."),
          h(
            "div",
            { class: "rejilla-horquilla", role: "group", "aria-label": "Nivel que le pondrías" },
            Array.from({ length: app.config.niveles.max - app.config.niveles.min + 1 }, (_, i) => botonNivel(app.config.niveles.min + i)),
          ),
          h("p", { class: "texto-horquilla", "aria-live": "polite" }, estado.horquilla ? textoHorquilla(estado.horquilla, nivel) : ""),
          h("p", { class: "titulo-seccion" }, "¿Pregunta mala?"),
          h(
            "div",
            { class: "chips" },
            app.config.motivos_mala.map((m) =>
              h(
                "button",
                {
                  class: "chip",
                  "aria-pressed": String(estado.mala === m.id),
                  onClick: () => {
                    estado.mala = estado.mala === m.id ? null : m.id;
                    pintarPregunta();
                  },
                },
                `⚑ ${m.nombre}`,
              ),
            ),
          ),
          h(
            "div",
            { class: "fila-botones acciones-fijas" },
            h("button", { class: "boton", onClick: siguiente }, "Saltar"),
            h(
              "button",
              { class: "boton boton-primario", disabled: !estado.valoracion && !estado.horquilla && !estado.mala, onClick: guardar },
              "Guardar y seguir",
            ),
          ),
        ),
      ),
    );
  }

  async function guardar() {
    const q = estado.actual;
    // Un doble toque en «Guardar y seguir» no debe guardar dos veces la misma valoración: R la contaría doble.
    if (!q || estado.guardando === q) return;
    estado.guardando = q;
    const ts = new Date().toISOString();
    const registro = {
      id: uuid(),
      tipo: "revision",
      ts,
      dispositivo: app.almacen.dispositivo,
      version_banco: app.versiones.banco,
      version_ajustes: app.versiones.ajustes,
      evaluador: estado.evaluador.clave,
      pregunta: q.id,
      v: q.v,
      categoria: q.categoria,
      subtema: q.subtema,
      nivel_inicial: q.nivel,
      nivel_mostrado: q.nivelEfectivo,
      valoracion: estado.horquilla ? "horquilla" : estado.valoracion,
      nivel_desde: estado.horquilla?.[0] ?? null,
      nivel_hasta: estado.horquilla?.[1] ?? null,
      mala: estado.mala,
    };
    try {
      await app.almacen.guardarRegistro(registro);
    } catch (e) {
      estado.guardando = null;
      return aviso(`No se pudo guardar: ${e.message}`, { error: true });
    }
    app.almacen.marcarVistas([[estado.evaluador.clave, q.id]], ts);
    app.almacen.marcarRevisada(estado.evaluador.clave, q.id, ts);
    estado.hechas++;
    if (estado.actual === q) siguiente(); // si mientras se guardaba se tocó «Saltar», ya se ha pasado de pregunta
  }

  elegirEvaluador();
}
