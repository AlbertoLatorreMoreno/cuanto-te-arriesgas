// Modo revisión: valorar preguntas fuera de partida para acumular etiquetas rápido. Cada pregunta se
// juega como en una partida, a solas: primero se intenta (o se señala en el mapa) y luego se ve la
// respuesta, se dice si se ha acertado y se valora.

import { barajar, rngReal, uuid } from "../azar.js";
import { aviso, cabecera, h, montar, montarPantalla } from "../dom.js";
import { revisionesSinDecidir } from "../envio.js";
import { aciertoMapa, distanciaKm } from "../geo.js";
import { crearMapa } from "../mapa.js";
import { alternarHorquilla, normalizarNombre, textoHorquilla } from "../util.js";
import {
  MAX_CHIPS_JUGADORES,
  bloqueRespuesta,
  enviarAhora,
  estiloCat,
  etiquetaCat,
  formatoKm,
  mapaRespondido,
  preguntarEnvio,
  radioAciertoKm,
  vistaInicialMapa,
} from "./comun.js";

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
    fase: "pregunta", // "pregunta" (aún sin respuesta), "respuesta" (¿la has acertado?) o "valorar"
    acierto: null,
    mapa: null, // en las de mapa, { punto, vb }: lo que se mueve y se toca, que se conserva al repintar
    senal: null, // en las de mapa, ya señalado: { lat, lon, distancia_km }
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
        "Juega cada pregunta a solas, como en una partida: piensa la respuesta, mírala y di si la has acertado. Después, valora si encaja con su nivel o di qué nivel le pondrías. Estas valoraciones entrenan el modelo igual que las partidas, pero mucho más rápido.",
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
        // Los temas, aparte: sus niveles son para quien elige el tema, así que mejor que los valoren sus fans.
        app.temas.length
          ? h("optgroup", { label: "Temas que elige cada jugador" }, app.temas.map((t) => h("option", { value: t.id, selected: estado.categoria === t.id }, t.nombre)))
          : null,
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
    // «Todas las categorías» son las del tablero: un tema solo sale si se elige.
    const delTablero = new Set(app.config.categorias.map((c) => c.id));
    const candidatas = [...app.indice.porId.values()].filter(
      (q) =>
        (estado.categoria ? q.categoria === estado.categoria : delTablero.has(q.categoria)) &&
        (!estado.nivel || q.nivelEfectivo === Number(estado.nivel)) &&
        !(q.id in revisadas),
    );
    estado.cola = barajar(candidatas, rngReal());
    siguiente();
  }

  function siguiente() {
    estado.actual = estado.cola.shift() ?? null;
    estado.fase = "pregunta";
    estado.acierto = null;
    estado.mapa = { punto: null, vb: null };
    estado.senal = null;
    estado.valoracion = null;
    estado.horquilla = null;
    estado.mala = null;
    pintarPregunta();
  }

  // Quien ya ha visto la respuesta no debe encontrarse la pregunta en una partida, aunque la salte sin valorarla.
  function marcarVista(q) {
    app.almacen.marcarVistas([[estado.evaluador.clave, q.id]], new Date().toISOString());
  }

  function verRespuesta() {
    marcarVista(estado.actual);
    estado.fase = "respuesta";
    pintarPregunta();
  }

  function juzgar(acierto) {
    estado.acierto = acierto;
    estado.fase = "valorar";
    pintarPregunta();
  }

  // Pregunta de mapa: la app dice si se ha acertado, como en la partida (dentro de la zona de acierto).
  function senalar() {
    const q = estado.actual;
    const { lat, lon } = estado.mapa.punto;
    const distancia = distanciaKm({ lat, lon }, q);
    const redondear = (x) => Math.round(x * 10000) / 10000;
    estado.senal = { lat: redondear(lat), lon: redondear(lon), distancia_km: Math.round(distancia) };
    estado.acierto = aciertoMapa(distancia, q.distancia_max_km, app.config.mapa.acierto_fraccion ?? 0.75);
    estado.mapa = { punto: { lat: estado.senal.lat, lon: estado.senal.lon }, vb: null }; // ahora, el del resultado
    marcarVista(q);
    estado.fase = "valorar";
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
    const vista = { pregunta: q.tipo === "mapa" ? vistaMapa : vistaPregunta, respuesta: vistaRespuesta, valorar: vistaValorar }[estado.fase];
    // Cada fase de cada pregunta es una pantalla: al marcar una valoración se repinta la misma, sin subir la página.
    montarPantalla(
      `revision|${q.id}|${estado.fase}`,
      cabecera(`Revisando: ${estado.evaluador.nombre}`, elegirEvaluador),
      h("p", { class: "texto-suave pequeno" }, `${estado.hechas} ${estado.hechas === 1 ? "revisada" : "revisadas"} · ${estado.cola.length ? `quedan ${estado.cola.length + 1}` : "queda 1"}`),
      vista(q),
    );
  }

  const metaLinea = (q) =>
    h("div", { class: "meta-linea" }, etiquetaCat(app, q.categoria, q.subtema), h("span", { class: "nivel-chip", style: estiloCat(app, q.categoria) }, String(q.nivelEfectivo)));

  function vistaPregunta(q) {
    return [
      metaLinea(q),
      h("section", { class: "tarjeta tarjeta-cat", style: estiloCat(app, q.categoria) }, h("p", { class: "texto-pregunta" }, q.pregunta)),
      h("p", { class: "texto-suave pequeno centrado" }, "Piensa tu respuesta y, cuando la tengas, mírala."),
      h(
        "div",
        { class: "columna acciones-fijas" },
        h("button", { class: "boton boton-primario boton-grande boton-ancho", onClick: verRespuesta }, "Ver respuesta"),
        h("button", { class: "boton-texto", onClick: siguiente }, "Saltar"),
      ),
    ];
  }

  function vistaMapa(q) {
    const confirmar = h(
      "button",
      { class: "boton boton-primario boton-grande boton-ancho", disabled: !estado.mapa.punto, onClick: () => estado.mapa.punto && senalar() },
      estado.mapa.punto ? "📍 Es aquí" : "Toca el mapa para señalar",
    );
    const mapa = crearMapa({
      ruta: app.config.mapa.archivo,
      vista: vistaInicialMapa(app, q),
      estado: estado.mapa,
      alTocar: () => {
        confirmar.disabled = false;
        confirmar.textContent = "📍 Es aquí";
      },
    });
    mapa.classList.add("mapa-juego");
    return [
      metaLinea(q),
      h(
        "section",
        { class: "tarjeta tarjeta-cat", style: estiloCat(app, q.categoria) },
        h("p", { class: "texto-pregunta reducido" }, q.pregunta),
        h(
          "p",
          { class: "texto-suave pequeno", style: { "margin-top": "8px" } },
          `Aciertas si señalas a menos de ${formatoKm(radioAciertoKm(app, q))} del sitio. Mueve el mapa, acércate y toca para señalar.`,
        ),
        // Fuera de la barra fija, para que el mapa quepa en pantallas bajas.
        h("button", { class: "boton-texto", onClick: siguiente }, "Saltar"),
      ),
      mapa,
      h("div", { class: "columna acciones-fijas" }, confirmar),
    ];
  }

  function vistaRespuesta(q) {
    return [
      metaLinea(q),
      h(
        "section",
        { class: "tarjeta tarjeta-cat", style: estiloCat(app, q.categoria) },
        h("p", { class: "texto-pregunta reducido" }, q.pregunta),
        bloqueRespuesta(q),
        q.explicacion ? h("p", { class: "texto-suave pequeno", style: { "margin-top": "12px" } }, q.explicacion) : null,
      ),
      h(
        "div",
        { class: "columna acciones-fijas" },
        h("p", { class: "centrado", style: { "font-weight": "700" } }, "¿La has acertado?"),
        h(
          "div",
          { class: "fila-botones" },
          h("button", { class: "boton boton-mal boton-grande", onClick: () => juzgar(false) }, "✗ Fallé"),
          h("button", { class: "boton boton-ok boton-grande", onClick: () => juzgar(true) }, "✓ Acerté"),
        ),
      ),
    ];
  }

  function vistaValorar(q) {
    const nivel = q.nivelEfectivo;
    const esMapa = Boolean(estado.senal);
    const radio = esMapa ? radioAciertoKm(app, q) : 0;
    const titulo = estado.acierto ? "¡Acierto!" : esMapa ? "Demasiado lejos" : "Fallo";
    const detalle = esMapa
      ? `A ${formatoKm(estado.senal.distancia_km)} del sitio${estado.acierto ? "" : `: hacía falta menos de ${formatoKm(radio)}`}.`
      : null;
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
    return h(
      "div",
      { class: "dos-columnas" },
      h(
        "div",
        { class: "columna" },
        h("section", { class: `resultado ${estado.acierto ? "acierto" : "fallo"}` }, h("h2", {}, titulo), detalle ? h("p", {}, detalle) : null),
        metaLinea(q),
        h(
          "section",
          { class: "tarjeta tarjeta-cat", style: estiloCat(app, q.categoria) },
          h("p", { class: "texto-pregunta reducido" }, q.pregunta),
          esMapa ? null : bloqueRespuesta(q),
          q.explicacion ? h("p", { class: "texto-suave pequeno", style: { "margin-top": "10px" } }, q.explicacion) : null,
        ),
        esMapa ? mapaRespondido(app, q, estado.mapa) : null,
        esMapa
          ? h("p", { class: "mapa-leyenda texto-suave pequeno" }, h("span", {}, "Señalado"), h("span", { class: "correcta" }, `${q.respuesta} · zona de acierto: ${formatoKm(radio)}`))
          : h("button", { class: "boton-texto", onClick: () => juzgar(!estado.acierto) }, estado.acierto ? "Me he equivocado: la fallé" : "Me he equivocado: la acerté"),
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
      acierto: estado.acierto,
      valoracion: estado.horquilla ? "horquilla" : estado.valoracion,
      nivel_desde: estado.horquilla?.[0] ?? null,
      nivel_hasta: estado.horquilla?.[1] ?? null,
      mala: estado.mala,
      // Pregunta de mapa: el punto señalado, la distancia al correcto y la máxima, como en una respuesta.
      ...(estado.senal
        ? { lat_senalada: estado.senal.lat, lon_senalada: estado.senal.lon, distancia_km: estado.senal.distancia_km, distancia_max_km: q.distancia_max_km }
        : {}),
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
