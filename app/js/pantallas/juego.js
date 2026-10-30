// Pantalla de partida: una vista por cada fase del turno.

import { FASE, falloAlOrdenar, quienSigue } from "../motor.js";
import { confirmar, dialogo, h, montarPantalla } from "../dom.js";
import {
  bloqueRespuesta,
  etiquetaCat,
  estiloCat,
  formatoKm,
  mapaRespondido,
  marcador,
  nombreJugador,
  radioAciertoKm,
  tablero,
  textoAlternativa,
  vistaInicialMapa,
} from "./comun.js";
import { pantallaFin } from "./fin.js";
import { duracionLegible, formatoTiempo, rangoCronometro, segundosCronometro, unirNombres } from "../util.js";
import { pasoKm } from "../geo.js";
import { crearMapa } from "../mapa.js";

export function pantallaJuego(app) {
  const p = app.sesion.partida;
  const t = p.turno;
  if (t.fase === FASE.FIN) return pantallaFin(app);

  // El cronómetro solo vive mientras se lee la pregunta (o se juega la ronda): al salir de esa fase (o deshacer) se olvida.
  if (t.fase !== FASE.LECTURA) reloj = null;
  const vistas = t.ronda
    ? { [FASE.ANUNCIO]: vistaAnuncioRonda, [FASE.PASAR]: vistaPasar, [FASE.LECTURA]: vistaLecturaRonda, [FASE.RESULTADO]: vistaResultadoRonda }
    : {
        [FASE.ANUNCIO]: t.esFinal ? vistaAnuncioFinal : vistaAnuncio,
        [FASE.PASAR]: vistaPasar,
        [FASE.LECTURA]: t.reto ? vistaLecturaReto : t.preguntaDatos?.tipo === "mapa" ? vistaLecturaMapa : vistaLectura,
        [FASE.RESPUESTA]: vistaRespuesta,
        [FASE.RESULTADO]: t.reto ? vistaResultadoReto : vistaResultado,
      };
  // Mientras se marca una lista, es la misma pantalla aunque cambie el contador: ni se bloquean los
  // toques ni se sube la página. En una ráfaga (o un reto final, o una de ordenar), cada descripción
  // nueva sí cuenta como pantalla nueva, para que un doble toque en «Acertó» no marque también la siguiente.
  const clave =
    t.fase !== FASE.LECTURA
      ? null
      : t.ronda
        ? `ronda|${p.id}|${p.n}|${t.ronda}|${t.rondaDatos.tipo === "lista" ? "" : t.indice}`
        : t.reto
          ? `reto|${p.id}|${p.n}|${t.final}|${t.indice}`
          : null;
  montarPantalla(clave, barraJuego(app), vistas[t.fase](app, p, t));
  // Con el marcador en una fila deslizable, se centra en quien tiene el turno. Solo se mueve la fila:
  // con scrollIntoView, un marcador por debajo del borde (en el resultado con mapa) bajaba toda la página.
  const activo = document.querySelector(".marcador .activo");
  if (activo) activo.parentElement.scrollLeft = activo.offsetLeft - activo.parentElement.offsetLeft - (activo.parentElement.clientWidth - activo.offsetWidth) / 2;
}

function barraJuego(app) {
  return h(
    "header",
    { class: "acciones-pie" },
    h("button", { class: "boton-texto", onClick: () => menuPartida(app) }, "☰ Menú"),
    h(
      "button",
      { class: "boton-texto", disabled: !app.sesion.puedeDeshacer(), onClick: () => app.deshacer(), "aria-label": "Deshacer el último paso" },
      "↶ Deshacer",
    ),
  );
}

async function menuPartida(app) {
  const opcion = await dialogo("Partida", (cerrar) =>
    h(
      "div",
      { class: "columna" },
      h("button", { class: "boton boton-ancho", onClick: () => cerrar("reglas") }, "Cómo se juega"),
      h("button", { class: "boton boton-ancho", onClick: () => cerrar("salir") }, "Salir al inicio (se guarda)"),
      h("button", { class: "boton boton-ancho boton-mal", onClick: () => cerrar("terminar") }, "Terminar esta partida"),
      h("button", { class: "boton-texto", onClick: () => cerrar() }, "Cancelar"),
    ),
  );
  if (opcion === "reglas") app.ir("reglas", { volverA: "juego" });
  if (opcion === "salir") app.ir("inicio");
  if (opcion === "terminar") {
    const ok = await confirmar("¿Terminar la partida?", "Se perderá la partida en curso. Las respuestas ya jugadas siguen registradas.", { si: "Terminar", peligro: true });
    if (ok) app.terminarPartida();
  }
}

// ---------------------------------------------------------------- anuncio

function vistaAnuncio(app, p, t) {
  const jugador = nombreJugador(p, t.jugador);
  const pos = p.jugadores[p.idx].pos;
  return [
    marcador(p),
    tablero(app, p),
    h(
      "section",
      { class: "tarjeta tarjeta-cat", style: estiloCat(app, t.categoria) },
      h(
        "div",
        { class: "meta-linea" },
        etiquetaCat(app, t.categoria),
        t.tema
          ? h("span", { class: "etiqueta-tema" }, "🎯 Tu tema")
          : t.salida
            ? h("span", { class: "texto-suave pequeno" }, "Salida: categoría al azar")
            : null,
      ),
      h("div", { class: "subtema" }, app.nombreSubtema(t.categoria, t.subtema)),
      h("p", { class: "pregunta-apuesta" }, t.tema ? `${jugador}, te toca tu tema: ¿hasta cuánto te arriesgas?` : `${jugador}, ¿hasta cuánto te arriesgas?`),
      h(
        "div",
        { class: "rejilla-niveles", role: "group", "aria-label": "Elige la dificultad" },
        Array.from({ length: 10 }, (_, i) => i + 1).map((n) =>
          h("button", { class: "boton", style: estiloCat(app, t.categoria), onClick: () => app.accion("apostar", n), "aria-label": `Arriesgar ${n}` }, String(n)),
        ),
      ),
      h(
        "p",
        { class: "texto-suave pequeno", style: { "margin-top": "12px" } },
        app.config.categorias.find((c) => c.id === t.categoria)?.tipo === "mapa"
          ? `Vas por ${pos} de ${p.meta}. Es de mapa: sumas lo que arriesgues menos un punto por cada tramo de distancia, más corto cuanto más arriesgas; fuera de la zona de acierto, nada.`
          : `Vas por ${pos} de ${p.meta}. Si aciertas, sumas lo que arriesgues; si fallas, nada.`,
      ),
      p.cronometro && segundosCronometro(app.config, t.categoria, app.config.niveles.min)
        ? h("p", { class: "texto-suave pequeno", style: { "margin-top": "4px" } }, `⏱ Con cronómetro: ${rangoCronometro(app.config)}.`)
        : null,
    ),
  ];
}

function vistaAnuncioFinal(app, p, t) {
  const jugador = nombreJugador(p, t.jugador);
  const lector = nombreJugador(p, t.lector);
  const { nivel_base, nivel_max } = app.config.final;
  const otros = p.jugadores.filter((_, i) => i !== p.idx);
  const minimo = Math.min(...otros.map((j) => j.pos));
  const ultimos = otros.filter((j) => j.pos === minimo).map((j) => j.nombre);
  const tope = nivel_base + Math.floor(t.ventaja / p.pasoFinal) > nivel_max ? ` (como mucho, ${nivel_max})` : "";
  const falladas = p.jugadores[p.idx].finalesFalladas ?? 0;
  const rebaja = t.rebajaFinal
    ? ` Baja ${t.rebajaFinal} por ${falladas === 1 ? "la final que ya ha fallado" : `las ${falladas} finales que ya ha fallado`}.`
    : "";
  const acertantes = p.acertantes ?? [];
  const explicacion = p.oro
    ? `Empate entre ${nombres(p, p.oro.vivos)}. Cada uno responde una final de nivel ${nivel_base}: si solo la acierta uno, gana; si la aciertan varios, siguen solo ellos, y si no la acierta nadie, otra ronda.`
    : (t.ventaja > 0
        ? `Le saca ${t.ventaja} puntos a ${unirNombres(ultimos)}, que ${ultimos.length > 1 ? "van" : "va"} en último lugar: ${nivel_base} + 1 por cada ${p.pasoFinal} puntos de ventaja${tope}.`
        : "No le saca ventaja al último: nivel base.") + rebaja;
  // Alguien ya ha acertado la final en esta ronda: quien juega lleva un turno menos y aún puede empatar.
  const empatar = !p.oro && acertantes.length
    ? `${nombres(p, acertantes)} ya ${acertantes.length > 1 ? "han" : "ha"} acertado la final, y ${jugador} lleva un turno menos: si acierta, empate.`
    : null;
  // Con finales propias aún no se sabe qué saldrá (se elige al pasar el móvil): de tema libre, pregunta o reto.
  const tiempo = t.categoria
    ? p.cronometro && segundosCronometro(app.config, t.categoria, t.nivelFinal, t.subtema)
      ? `⏱ Tendrá ${duracionLegible(segundosCronometro(app.config, t.categoria, t.nivelFinal, t.subtema))} para responder.`
      : null
    : p.cronometro
      ? "⏱ Si es un reto o de cálculo, irá con tiempo."
      : "⏱ Si es un reto, irá con tiempo.";
  return [
    marcador(p),
    h(
      "section",
      { class: "tarjeta tarjeta-cat centrado", style: estiloCat(app, t.categoria) },
      h("p", { class: "texto-suave" }, p.oro ? `🥇 ${p.oro.ronda > 1 ? `${p.oro.ronda}.ª ronda` : "Ronda"} de oro` : "🏁 Pregunta final"),
      h(
        "h2",
        { style: { "font-size": "1.7rem", margin: "6px 0 14px" } },
        p.oro ? `${jugador}, a por el desempate` : empatar ? `${jugador}, si aciertas, empatas` : `${jugador}, si aciertas, ganas`,
      ),
      empatar ? h("p", { class: "nota" }, empatar) : null,
      t.categoria
        ? etiquetaCat(app, t.categoria, t.subtema)
        : h("p", { class: "texto-suave" }, "Tema libre: puede ser una pregunta difícil o un reto «acierta tantos de…»."),
      h("p", { style: { margin: "18px 0 6px" } }, "Nivel ", h("span", { class: "nivel-chip" }, String(t.nivelFinal))),
      h("p", { class: "texto-suave pequeno" }, explicacion),
      tiempo ? h("p", { class: "texto-suave pequeno", style: { "margin-top": "6px" } }, tiempo) : null,
    ),
    h(
      "div",
      { class: "acciones-fijas" },
      h(
        "button",
        { class: "boton boton-primario boton-grande boton-ancho", onClick: () => app.accion("apostar", t.nivelFinal) },
        p.narrador ? "Ver la pregunta final" : `Pasar el móvil a ${lector}`,
      ),
    ),
  ];
}

// ---------------------------------------------------------------- pasar

function vistaPasar(app, p, t) {
  const jugador = nombreJugador(p, t.jugador);
  const lector = nombreJugador(p, t.lector);
  if (t.ronda) {
    return h(
      "section",
      { class: "pantalla-pasar" },
      h("div", { class: "icono-pasar", "aria-hidden": "true" }, "📱"),
      h("h2", {}, `Pasa el móvil a ${lector}`),
      h("p", { class: "texto-suave" }, `${lector} leerá la ronda de ${jugador}, pondrá el tiempo (${duracionLegible(t.cronometro)}) e irá marcando los aciertos.`),
      h("span", { class: "etiqueta-ronda" }, `★ ${t.rondaDatos.titulo}`),
      h("button", { class: "boton boton-primario boton-grande boton-ancho", onClick: () => app.accion("empezarLectura") }, `Soy ${lector}: ver la ronda`),
    );
  }
  if (t.reto) {
    return h(
      "section",
      { class: "pantalla-pasar" },
      h("div", { class: "icono-pasar", "aria-hidden": "true" }, "📱"),
      h("h2", {}, `Pasa el móvil a ${lector}`),
      h("p", { class: "texto-suave" }, `${lector} leerá el reto final de ${jugador}, pondrá el tiempo (${duracionLegible(t.cronometro)}) e irá marcando los aciertos.`),
      h("span", { class: "etiqueta-final" }, `🏁 ${t.finalDatos.titulo}`),
      h("button", { class: "boton boton-primario boton-grande boton-ancho", onClick: () => app.accion("empezarLectura") }, `Soy ${lector}: ver el reto`),
    );
  }
  return h(
    "section",
    { class: "pantalla-pasar" },
    h("div", { class: "icono-pasar", "aria-hidden": "true" }, "📱"),
    h("h2", {}, `Pasa el móvil a ${lector}`),
    h(
      "p",
      { class: "texto-suave" },
      t.esFinal ? `${lector} leerá la pregunta final de ${jugador}.` : `${lector} leerá en voz alta la pregunta de ${jugador}, que se juega ${t.apuesta}.`,
    ),
    t.preguntaDatos?.tipo === "mapa" ? h("p", { class: "texto-suave pequeno" }, `🗺 Es de mapa: después le devolverá el móvil a ${jugador} para que la señale.`) : null,
    t.cronometro ? h("p", { class: "texto-suave pequeno" }, `⏱ Lleva cronómetro: ${duracionLegible(t.cronometro)} desde que termine de leerla.`) : null,
    etiquetaCat(app, t.categoria, t.subtema),
    h("button", { class: "boton boton-primario boton-grande boton-ancho", onClick: () => app.accion("empezarLectura") }, `Soy ${lector}: ver la pregunta`),
  );
}

// ---------------------------------------------------------------- lectura

function cabeceraPregunta(app, t) {
  const q = t.preguntaDatos;
  return h(
    "div",
    { class: "meta-linea" },
    etiquetaCat(app, q.categoria, q.subtema),
    h("span", { class: "nivel-chip", style: estiloCat(app, q.categoria), title: "Nivel" }, String(q.nivelEfectivo)),
  );
}

function notaAlternativa(app, t) {
  const texto = textoAlternativa(app, t);
  return texto ? h("p", { class: "nota" }, texto) : null;
}

function vistaLectura(app, p, t) {
  const jugador = nombreJugador(p, t.jugador);
  return [
    cabeceraPregunta(app, t),
    notaAlternativa(app, t),
    h(
      "section",
      { class: "tarjeta tarjeta-cat", style: estiloCat(app, t.preguntaDatos.categoria) },
      h("p", { class: "texto-suave pequeno" }, t.cronometro ? `Lee en voz alta para ${jugador} y, al terminar, pon el tiempo:` : `Lee en voz alta para ${jugador}:`),
      h("p", { class: "texto-pregunta" }, t.preguntaDatos.pregunta),
    ),
    h("p", { class: "texto-suave pequeno centrado" }, `Cuando ${jugador} conteste, mira la respuesta.`),
    h(
      "div",
      { class: "columna acciones-fijas" },
      t.cronometro ? bloqueReloj(app, p, t) : null,
      h(
        "button",
        { class: "boton boton-primario boton-grande boton-ancho", onClick: () => app.accion("revelar", { tiempoAgotado: tiempoAgotado(p, t) }) },
        "Ver respuesta",
      ),
      h("button", { class: "boton-texto", onClick: () => pedirOtraPregunta(app) }, "Cambiar pregunta"),
    ),
  ];
}

// ---------------------------------------------------------------- preguntas de mapa
// Quien lee la lee en voz alta y devuelve el móvil; quien juega toca el mapa y confirma. Lo que se
// mueve y se toca en el mapa vive fuera de la partida (como el cronómetro): se conserva al repintar.

let mapaTurno = null; // { clave, punto, vb }
let mapaResultado = null; // { clave, punto, vb }

function reglaMapa(app, t) {
  const q = t.preguntaDatos;
  const radio = radioAciertoKm(app, q);
  if (t.esFinal) return `Acierta la final si queda a menos de ${formatoKm(radio)} del sitio.`;
  const paso = pasoKm(q.distancia_max_km, t.apuesta, app.config.mapa.acierto_fraccion ?? 0.75);
  return `Se juega ${t.apuesta}: −1 punto por cada ${formatoKm(paso)} de error; a más de ${formatoKm(radio)}, nada.`;
}

function vistaLecturaMapa(app, p, t) {
  const jugador = nombreJugador(p, t.jugador);
  const q = t.preguntaDatos;
  const clave = `${p.id}|${p.n}|${t.pregunta}`;
  if (mapaTurno?.clave !== clave) mapaTurno = { clave, punto: null, vb: null };
  const estado = mapaTurno;
  const confirmar = h(
    "button",
    { class: "boton boton-primario boton-grande boton-ancho", disabled: !estado.punto, onClick: () => estado.punto && app.accion("senalar", estado.punto) },
    estado.punto ? "📍 Es aquí" : "Toca el mapa para señalar",
  );
  const mapa = crearMapa({
    ruta: app.config.mapa.archivo,
    vista: vistaInicialMapa(app, q),
    estado,
    alTocar: () => {
      confirmar.disabled = false;
      confirmar.textContent = "📍 Es aquí";
    },
  });
  mapa.classList.add("mapa-juego");
  return [
    cabeceraPregunta(app, t),
    notaAlternativa(app, t),
    h(
      "section",
      { class: "tarjeta tarjeta-cat", style: estiloCat(app, q.categoria) },
      h("p", { class: "texto-suave pequeno" }, p.narrador ? `Lee en voz alta para ${jugador} y deja que lo señale en el mapa:` : `Lee en voz alta y devuelve el móvil a ${jugador} para que lo señale:`),
      h("p", { class: "texto-pregunta reducido" }, q.pregunta),
      h("p", { class: "texto-suave pequeno", style: { "margin-top": "8px" } }, `${reglaMapa(app, t)} Mueve el mapa, acércate y toca para señalar.`),
      // Fuera de la barra fija, para que el mapa quepa en pantallas bajas.
      h("button", { class: "boton-texto", onClick: () => pedirOtraPregunta(app) }, "Cambiar pregunta"),
    ),
    mapa,
    h("div", { class: "columna acciones-fijas" }, confirmar),
  ];
}

// En el resultado: el punto señalado, el correcto y la zona de acierto, encuadrados juntos.
function mapaDelResultado(app, p, t) {
  const q = t.preguntaDatos;
  const clave = `${p.id}|${p.n}|${t.pregunta}|resultado`;
  if (mapaResultado?.clave !== clave) mapaResultado = { clave, punto: { lat: t.mapa.lat, lon: t.mapa.lon }, vb: null };
  return mapaRespondido(app, q, mapaResultado);
}

// ---------------------------------------------------------------- cronómetro
// Vive fuera de la partida para no guardarla cada segundo: si se cierra la app mientras corre,
// al volver se puede poner otra vez. Lo que queda registrado es si se agotó al ver la respuesta.

let reloj = null; // { clave, fin (ms) o null si aún no se ha puesto, avisado }
let audio = null;

const claveReloj = (p, t) => `${p.id}|${p.n}|${t.ronda ?? t.final ?? t.pregunta}`;

function tiempoAgotado(p, t) {
  return Boolean(t.cronometro && reloj?.clave === claveReloj(p, t) && reloj.fin && Date.now() >= reloj.fin);
}

// El sonido tiene que prepararse con un toque (los navegadores no dejan sonar sin uno).
function prepararSonido() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume?.();
  } catch {
    audio = null;
  }
}

function sonarFin() {
  // Sin un toque previo en la página, el navegador no deja vibrar (y lo apunta como error).
  if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.([250, 120, 250]);
  if (!audio) return;
  try {
    const t0 = audio.currentTime;
    for (const inicio of [0, 0.35]) {
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      osc.frequency.value = 880;
      osc.connect(vol);
      vol.connect(audio.destination);
      vol.gain.setValueAtTime(0.0001, t0 + inicio);
      vol.gain.exponentialRampToValueAtTime(0.3, t0 + inicio + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, t0 + inicio + 0.25);
      osc.start(t0 + inicio);
      osc.stop(t0 + inicio + 0.3);
    }
  } catch {
    // Sin sonido: queda el aviso en pantalla.
  }
}

const relojPuesto = (p, t) => reloj?.clave === claveReloj(p, t) && reloj.fin != null;

function bloqueReloj(app, p, t, { alAcabar = "¡Tiempo! Que responda ya." } = {}) {
  const clave = claveReloj(p, t);
  if (reloj?.clave !== clave) reloj = { clave, fin: null, avisado: false };
  const total = t.cronometro;
  if (reloj.fin == null) {
    return h(
      "button",
      {
        class: "boton boton-ancho boton-reloj",
        onClick: () => {
          prepararSonido();
          reloj.fin = Date.now() + total * 1000;
          app.ir("juego");
        },
      },
      `⏱ Empezar el tiempo · ${duracionLegible(total)}`,
    );
  }
  const cifra = h("span", { class: "reloj-cifra" });
  const relleno = h("span");
  const aviso = h("span", { class: "reloj-aviso", "aria-live": "assertive" });
  const caja = h("div", { class: "reloj", role: "timer" }, cifra, h("span", { class: "reloj-barra" }, relleno), aviso);
  const pintar = () => {
    const queda = (reloj.fin - Date.now()) / 1000;
    cifra.textContent = formatoTiempo(queda);
    relleno.style.width = `${Math.max(0, Math.min(1, queda / total)) * 100}%`;
    if (queda > 0) return true;
    caja.classList.add("agotado");
    aviso.textContent = alAcabar;
    if (!reloj.avisado) {
      reloj.avisado = true;
      sonarFin();
    }
    return false;
  };
  if (pintar()) {
    const id = setInterval(() => {
      if (!caja.isConnected || !pintar()) clearInterval(id);
    }, 250);
  }
  return caja;
}

async function pedirOtraPregunta(app) {
  const reto = app.sesion.turno.reto;
  const motivo = await dialogo(reto ? "¿Por qué lo cambias?" : "¿Por qué la cambias?", (cerrar) =>
    h(
      "div",
      { class: "columna" },
      app.config.motivos_anulacion.map((m) => h("button", { class: "boton boton-ancho", onClick: () => cerrar(m.id) }, m.nombre)),
      h(
        "p",
        { class: "texto-suave pequeno" },
        reto
          ? "El reto anulado no cuenta, y lo que hayáis marcado en él se pierde. Saldrá otra final del mismo nivel."
          : "La pregunta anulada no cuenta. Si es errónea, ambigua o está mal redactada, servirá para mejorar el banco.",
      ),
      h("button", { class: "boton-texto", onClick: () => cerrar() }, "Cancelar"),
    ),
  );
  if (motivo) app.accion("otraPregunta", motivo);
}

// ---------------------------------------------------------------- respuesta

function vistaRespuesta(app, p, t) {
  const jugador = nombreJugador(p, t.jugador);
  const q = t.preguntaDatos;
  return [
    cabeceraPregunta(app, t),
    t.tiempoAgotado ? h("p", { class: "nota" }, "⏱ Se acabó el tiempo antes de ver la respuesta.") : null,
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
      h("p", { class: "centrado", style: { "font-weight": "700" } }, `¿Ha acertado ${jugador}?`),
      h(
        "div",
        { class: "fila-botones" },
        h("button", { class: "boton boton-mal boton-grande", onClick: () => app.accion("juzgar", false) }, "✗ Falló"),
        h("button", { class: "boton boton-ok boton-grande", onClick: () => app.accion("juzgar", true) }, "✓ Acertó"),
      ),
      h("button", { class: "boton-texto", onClick: () => pedirOtraPregunta(app) }, "La pregunta está mal: cambiarla"),
    ),
  ];
}

// ---------------------------------------------------------------- resultado

// ---------------------------------------------------------------- final: empate y ronda de oro

const nombres = (p, claves) => unirNombres(claves.map((c) => nombreJugador(p, c)));

// Quienes van detrás en el orden y ya están en la meta: si alguien acierta la final, aún pueden empatar.
const puedenEmpatar = (p) => p.jugadores.filter((j, i) => i > p.idx && j.pos >= p.meta).map((j) => j.clave);

// Título y consecuencia del resultado de una final ya juzgada (pregunta, reto o de mapa): si gana, si
// aún pueden empatar otros, si hay empate o cómo sigue la ronda de oro. `detalle` puede quedar vacío
// (quien gana sin más): cada vista antepone lo que ha pasado (la distancia, los aciertos del reto…).
function desenlaceFinal(app, p, t, fallada = "Final fallada") {
  const jugador = nombreJugador(p, t.jugador);
  const sigue = quienSigue(p);
  const bien = t.acierto ? "¡Acierto!" : fallada;
  if (p.oro) {
    const { aciertos } = p.oro;
    if (!sigue) {
      return aciertos[0] === t.jugador
        ? { titulo: `¡${jugador} gana!`, detalle: "Nadie más la ha acertado en esta ronda de oro." }
        : { titulo: fallada, detalle: `${nombreJugador(p, aciertos[0])} gana la ronda de oro.` };
    }
    if (sigue.vivos) {
      return aciertos.length
        ? { titulo: bien, detalle: `La han acertado ${nombres(p, aciertos)}: otra ronda de oro, solo entre ${aciertos.length === 2 ? "los dos" : "ellos"}.` }
        : { titulo: fallada, detalle: "No la ha acertado nadie: otra ronda de oro." };
    }
    if (!aciertos.length) return { titulo: fallada, detalle: "De momento no la ha acertado nadie en esta ronda." };
    return { titulo: bien, detalle: aciertos.length === 1 ? `Si los demás fallan, gana ${nombres(p, aciertos)}.` : `De momento la han acertado ${nombres(p, aciertos)}.` };
  }
  const acertantes = p.acertantes ?? [];
  if (!acertantes.length) {
    const rebaja = t.nivelFinal > app.config.final.nivel_base ? ", con una final un escalón más fácil" : "";
    return { titulo: fallada, detalle: `${jugador} sigue en la meta y lo volverá a intentar en su próximo turno${rebaja}.` };
  }
  if (sigue) {
    const quedan = puedenEmpatar(p);
    const varios = quedan.length > 1;
    if (!t.acierto) return { titulo: fallada, detalle: `${jugador} no consigue empatar. Aún ${varios ? "pueden" : "puede"} hacerlo ${nombres(p, quedan)}.` };
    return acertantes.length === 1
      ? {
          titulo: `¡${jugador} acierta la final!`,
          detalle: `Pero ${nombres(p, quedan)} ${varios ? "llevan" : "lleva"} un turno menos y ya ${varios ? "están" : "está"} en la meta: si ${varios ? "aciertan" : "acierta"} su final, empate.`,
        }
      : { titulo: `¡${jugador} empata!`, detalle: `Aún ${varios ? "pueden" : "puede"} empatar ${nombres(p, quedan)}.` };
  }
  if (acertantes.length === 1) {
    return acertantes[0] === t.jugador
      ? { titulo: `¡${jugador} gana!`, detalle: "" }
      : { titulo: fallada, detalle: `${jugador} no consigue empatar: gana ${nombreJugador(p, acertantes[0])}.` };
  }
  return { titulo: t.acierto ? `¡${jugador} empata!` : fallada, detalle: `Empate entre ${nombres(p, acertantes)}.` };
}

// Cierra el turno: «Siguiente turno: …» o, si la partida se decide en este, «Ver resultados».
function botonCerrarTurno(app, p) {
  const sigue = quienSigue(p);
  return h(
    "div",
    { class: "acciones-fijas" },
    h(
      "button",
      { class: "boton boton-primario boton-grande boton-ancho", onClick: () => app.accion("cerrarTurno") },
      sigue ? `Siguiente turno: ${p.jugadores[sigue.idx].nombre}` : "Ver resultados",
    ),
  );
}

function vistaResultado(app, p, t) {
  const jugador = nombreJugador(p, t.jugador);
  const q = t.preguntaDatos;

  let titulo;
  let detalle;
  const esMapa = q.tipo === "mapa" && t.mapa;
  const radioMapa = esMapa ? radioAciertoKm(app, q) : 0;
  if (t.esFinal) {
    const d = desenlaceFinal(app, p, t);
    const distancia = !esMapa
      ? null
      : t.acierto
        ? `Ha señalado a ${formatoKm(t.mapa.distancia_km)} del sitio, dentro de los ${formatoKm(radioMapa)} que hacían falta.`
        : `Ha señalado a ${formatoKm(t.mapa.distancia_km)} y hacía falta quedar a menos de ${formatoKm(radioMapa)}.`;
    titulo = d.titulo;
    detalle = [distancia, d.detalle || (distancia ? "" : "Ha acertado la pregunta final.")].filter(Boolean).join(" ");
  } else if (esMapa) {
    const n = t.mapa.puntos;
    titulo = n ? (n === t.apuesta ? `¡Clavado! +${n}` : `+${n} de ${t.apuesta}`) : "Demasiado lejos";
    const avance = !n
      ? `${jugador} se queda en ${t.posAntes}.`
      : t.posDespues >= p.meta
        ? `${jugador} llega a la meta. En su próximo turno, la pregunta final.`
        : `${jugador} avanza de ${t.posAntes} a ${t.posDespues}.`;
    detalle = `A ${formatoKm(t.mapa.distancia_km)} del sitio. ${avance}`;
  } else if (t.acierto) {
    titulo = "¡Acierto!";
    detalle = t.posDespues >= p.meta ? `${jugador} llega a la meta. En su próximo turno, la pregunta final.` : `${jugador} avanza de ${t.posAntes} a ${t.posDespues}.`;
  } else {
    titulo = "Fallo";
    detalle = `${jugador} se queda en ${t.posAntes}.`;
  }

  const opcion = (valor, texto) =>
    h(
      "button",
      { class: "boton", "aria-pressed": String(t.valoracion === valor), onClick: () => app.accion("valorar", t.valoracion === valor ? null : valor) },
      texto,
    );

  const bien = esMapa && !t.esFinal ? t.mapa.puntos > 0 : t.acierto;
  return [
    h("section", { class: `resultado ${bien ? "acierto" : "fallo"}` }, h("h2", {}, titulo), h("p", {}, detalle)),
    esMapa ? mapaDelResultado(app, p, t) : null,
    esMapa
      ? h("p", { class: "mapa-leyenda texto-suave pequeno" }, h("span", {}, "Señalado"), h("span", { class: "correcta" }, `${q.respuesta} · zona de acierto: ${formatoKm(radioMapa)}`))
      : null,
    esMapa && q.explicacion ? h("p", { class: "texto-suave pequeno" }, q.explicacion) : null,
    h(
      "section",
      { class: "tarjeta columna" },
      h("p", { class: "titulo-seccion" }, `¿Encajaba con un nivel ${q.nivelEfectivo}? `, h("span", { class: "texto-suave pequeno" }, "(opcional)")),
      h("div", { class: "grupo-opciones" }, opcion("facil", "Era más fácil"), opcion("justa", "Sí"), opcion("dificil", "Era más difícil")),
      h("p", { class: "titulo-seccion", style: { "margin-top": "6px" } }, "¿Pregunta mala?"),
      h(
        "div",
        { class: "chips" },
        app.config.motivos_mala.map((m) =>
          h(
            "button",
            { class: "chip", "aria-pressed": String(t.mala === m.id), onClick: () => app.accion("marcarMala", t.mala === m.id ? null : m.id) },
            `⚑ ${m.nombre}`,
          ),
        ),
      ),
    ),
    marcador(p),
    botonCerrarTurno(app, p),
  ];
}

// ---------------------------------------------------------------- rondas divertidas
// Quien lee ve la ronda entera: pone el tiempo y va marcando lo que se acierta. No hay apuesta:
// se avanza una casilla por acierto.

const cuenta = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const aciertosRonda = (t) => t.marcados.length + (t.extra ?? 0);

function vistaAnuncioRonda(app, p, t) {
  const r = t.rondaDatos;
  const jugador = nombreJugador(p, t.jugador);
  const lector = nombreJugador(p, t.lector);
  const pos = p.jugadores[p.idx].pos;
  const cuantos =
    r.tipo === "rafaga"
      ? ` Son ${r.elementos.length} descripciones.`
      : r.tipo === "ordenar"
        ? ` Hay ${r.elementos.length - 1} para colocar.`
        : r.cerrada
          ? ` Hay ${r.elementos.length}.`
          : "";
  const reto = {
    lista: `${jugador}, di todos los que puedas en ${duracionLegible(r.segundos)}.`,
    rafaga: `${jugador}, acierta todas las que puedas en ${duracionLegible(r.segundos)}.`,
    ordenar: `${jugador}, coloca en su sitio todos los que puedas en ${duracionLegible(r.segundos)}. Al primer fallo, se acaba.`,
  }[r.tipo];
  return [
    marcador(p),
    tablero(app, p),
    h(
      "section",
      { class: "tarjeta tarjeta-ronda centrado" },
      h("p", { class: "texto-suave" }, "★ Ronda divertida"),
      h("h2", { class: "titulo-ronda" }, r.titulo),
      h("p", {}, reto),
      h("p", { class: "texto-suave pequeno" }, `Sin apuesta: avanzas una casilla por cada acierto.${cuantos} Vas por ${pos} de ${p.meta}.`),
      t.alternativa === "repetida" ? h("p", { class: "nota" }, `Ya no quedaban rondas nuevas para ${jugador}: esta ya la ha visto.`) : null,
    ),
    h(
      "div",
      { class: "acciones-fijas" },
      h(
        "button",
        { class: "boton boton-primario boton-grande boton-ancho", onClick: () => app.accion("empezarRonda") },
        p.narrador ? "Empezar la ronda" : `Pasar el móvil a ${lector}`,
      ),
    ),
  ];
}

function vistaLecturaRonda(app, p, t) {
  const r = t.rondaDatos;
  const jugador = nombreJugador(p, t.jugador);
  const aciertos = aciertosRonda(t);
  const puesto = relojPuesto(p, t);
  return [
    h(
      "div",
      { class: "meta-linea" },
      h("span", { class: "etiqueta-ronda" }, `★ ${r.titulo}`),
      h("strong", { class: "contador-ronda", "aria-live": "polite" }, cuenta(aciertos, "acierto", "aciertos")),
    ),
    // El enunciado se lee una vez: con el tiempo en marcha se quita, para dejar sitio a la lista.
    puesto
      ? null
      : h(
          "section",
          { class: "tarjeta tarjeta-ronda" },
          h("p", { class: "texto-suave pequeno" }, `Lee en voz alta para ${jugador} y, al terminar, pon el tiempo:`),
          h("p", { class: "texto-pregunta reducido" }, r.enunciado),
          r.nota ? h("p", { class: "texto-suave pequeno", style: { "margin-top": "8px" } }, r.nota) : null,
          h("button", { class: "boton-texto", onClick: () => pedirOtraRonda(app) }, "Cambiar ronda"),
        ),
    r.tipo === "lista" ? cuerpoLista(app, t) : r.tipo === "ordenar" ? cuerpoOrdenar(app, p, t) : cuerpoRafaga(app, p, t),
    puesto ? h("button", { class: "boton-texto", onClick: () => pedirOtraRonda(app) }, "Cambiar ronda") : null,
    h(
      "div",
      { class: "columna acciones-fijas" },
      bloqueReloj(app, p, t, {
        alAcabar: { lista: "¡Tiempo! Ya no vale decir más.", rafaga: "¡Tiempo! Marca la última y termina.", ordenar: "¡Tiempo! Marca el que estaba colocando y termina." }[r.tipo],
      }),
      h(
        "button",
        { class: "boton boton-primario boton-ancho", onClick: () => app.accion("terminarRonda", { tiempoAgotado: tiempoAgotado(p, t) }) },
        `Terminar la ronda · ${cuenta(aciertos, "acierto", "aciertos")}`,
      ),
    ),
  ];
}

function cuerpoLista(app, t) {
  const r = t.rondaDatos;
  return h(
    "div",
    { class: "columna" },
    h(
      "p",
      { class: "texto-suave pequeno" },
      r.cerrada ? "Toca cada uno que diga (otra vez, para quitarlo)." : "Toca los que diga. Si dice otro que el grupo da por bueno, súmalo abajo.",
    ),
    h(
      "div",
      { class: "rejilla-elementos", role: "group", "aria-label": "Lo que ha dicho" },
      r.elementos.map((e, i) =>
        h(
          "button",
          { class: "elemento", "aria-pressed": String(t.marcados.includes(i)), onClick: () => app.accion("marcarElemento", i) },
          e.texto,
          e.tambien_vale?.length ? h("small", {}, e.tambien_vale.join(" · ")) : null,
        ),
      ),
    ),
    r.cerrada
      ? null
      : h(
          "div",
          { class: "fila-otros" },
          h("button", { class: "boton", disabled: !t.extra, "aria-label": "Quitar uno de fuera de la lista", onClick: () => app.accion("contarOtro", -1) }, "−"),
          h("span", {}, `Otros que valen: ${t.extra}`),
          h("button", { class: "boton", "aria-label": "Sumar uno de fuera de la lista", onClick: () => app.accion("contarOtro", 1) }, "+1"),
        ),
  );
}

// `r`: la ronda o el reto final; `cerrado`: un aviso que sustituye a la siguiente descripción
// (en el reto, cuando ya se ha ganado o ya no se puede).
function cuerpoRafaga(app, p, t, r = t.rondaDatos, { termina = "termina la ronda", cerrado = null } = {}) {
  const n = r.elementos.length;
  if (!relojPuesto(p, t) && t.indice === 0) return h("p", { class: "texto-suave pequeno centrado" }, "Al poner el tiempo verás la primera descripción.");
  if (cerrado) return h("p", { class: "nota" }, cerrado);
  if (t.indice >= n) return h("p", { class: "nota" }, `No quedan más descripciones: ${termina}.`);
  // La que se estaba contestando cuando sonó se puede marcar (sus botones siguen ahí hasta entonces);
  // después ya no sale otra.
  if (tiempoAgotado(p, t)) return h("p", { class: "nota" }, `Se acabó el tiempo: ${termina}.`);
  const e = r.elementos[t.indice];
  return h(
    "section",
    { class: "tarjeta columna" },
    h("p", { class: "texto-suave pequeno" }, `Descripción ${t.indice + 1} de ${n}. Léela:`),
    h("p", { class: "texto-pregunta pista-rafaga" }, e.pista),
    h(
      "div",
      { class: "respuesta" },
      h("p", { class: "texto-suave pequeno" }, "Respuesta"),
      h("p", { class: "valor" }, e.respuesta),
      e.tambien_vale?.length ? h("p", { class: "detalle" }, `También vale: ${e.tambien_vale.join(" · ")}`) : null,
    ),
    h(
      "div",
      { class: "fila-botones" },
      h("button", { class: "boton boton-grande", onClick: () => app.accion("marcarRafaga", false) }, "Pasa"),
      h("button", { class: "boton boton-ok boton-grande", onClick: () => app.accion("marcarRafaga", true) }, "✓ Acertó"),
    ),
  );
}

// De ordenar: la fila, de arriba abajo, en el orden de la ronda (de menor a mayor o al revés).
const enOrden = (r, elementos) => [...elementos].sort((a, b) => (r.orden === "desc" ? b.valor - a.valor : a.valor - b.valor));

// Dónde va `e` entre los ya colocados: lo que quien lee tiene que oír para darlo por bueno.
function dondeVa(r, colocados, e) {
  const fila = enOrden(r, colocados);
  const i = enOrden(r, [...colocados, e]).indexOf(e);
  if (i === 0) return `arriba del todo, antes de ${fila[0].texto}`;
  if (i === fila.length) return `abajo del todo, después de ${fila[fila.length - 1].texto}`;
  return `entre ${fila[i - 1].texto} y ${fila[i].texto}`;
}

const filaOrden = (r, elementos) =>
  h(
    "ol",
    { class: "fila-orden" },
    enOrden(r, elementos).map((e) => h("li", {}, h("span", {}, e.texto), h("small", {}, e.etiqueta))),
  );

// Quien lee ve lo ya colocado (con sus valores) y el que toca, con dónde va. Al primer fallo, se acaba.
function cuerpoOrdenar(app, p, t) {
  const r = t.rondaDatos;
  const n = r.elementos.length;
  if (!relojPuesto(p, t) && t.indice === 1) return h("p", { class: "texto-suave pequeno centrado" }, "Al poner el tiempo verás el primero que hay que colocar.");
  const colocados = r.elementos.filter((_, i) => i === 0 || t.marcados.includes(i));
  const fila = h("section", { class: "tarjeta columna" }, h("p", { class: "texto-suave pequeno" }, "Ya colocados"), filaOrden(r, colocados));
  const bloque = (...hijos) => h("div", { class: "columna" }, ...hijos);
  if (falloAlOrdenar(t)) {
    const e = r.elementos[t.indice - 1];
    return bloque(h("p", { class: "nota" }, `${e.texto} (${e.etiqueta}) iba ${dondeVa(r, colocados, e)}. Al primer fallo se acaba: termina la ronda.`), fila);
  }
  if (t.indice >= n) return bloque(h("p", { class: "nota" }, "¡Están todos colocados! Termina la ronda."), fila);
  if (tiempoAgotado(p, t)) return bloque(h("p", { class: "nota" }, "Se acabó el tiempo: termina la ronda."), fila);
  const e = r.elementos[t.indice];
  return bloque(
    h(
      "section",
      { class: "tarjeta columna" },
      h("p", { class: "texto-suave pequeno" }, `Para colocar: ${t.indice} de ${n - 1}. Dile:`),
      h("p", { class: "texto-pregunta pista-rafaga" }, e.texto),
      h(
        "div",
        { class: "respuesta" },
        h("p", { class: "texto-suave pequeno" }, `Va ${dondeVa(r, colocados, e)}`),
        h("p", { class: "valor" }, e.etiqueta),
      ),
      h(
        "div",
        { class: "fila-botones" },
        h("button", { class: "boton boton-grande", onClick: () => app.accion("marcarRafaga", false) }, "Mal colocado"),
        h("button", { class: "boton boton-ok boton-grande", onClick: () => app.accion("marcarRafaga", true) }, "✓ Bien"),
      ),
    ),
    fila,
  );
}

// El resultado de una de ordenar: la fila completa de lo que se llegó a ver, y dónde iba el fallado.
function resultadoOrdenar(app, p, t, n, detalle) {
  const r = t.rondaDatos;
  const vistos = r.elementos.slice(0, t.indice);
  const colocados = r.elementos.filter((_, i) => i === 0 || t.marcados.includes(i));
  const fallado = falloAlOrdenar(t) ? r.elementos[t.indice - 1] : null;
  const sinVer = r.elementos.length - t.indice;
  return [
    h("section", { class: `resultado ${n ? "acierto" : "fallo"}` }, h("h2", {}, n ? `¡${cuenta(n, "acierto", "aciertos")}!` : "Ningún acierto"), h("p", {}, detalle)),
    h(
      "section",
      { class: "tarjeta columna" },
      fallado ? h("p", { class: "texto-suave pequeno" }, `${fallado.texto} (${fallado.etiqueta}) iba ${dondeVa(r, colocados, fallado)}.`) : null,
      sinVer ? h("p", { class: "texto-suave pequeno" }, `Quedaron ${sinVer} por colocar.`) : null,
      h("p", { class: "texto-suave pequeno" }, "El orden:"),
      filaOrden(r, vistos),
      h("p", { class: "titulo-seccion", style: { "margin-top": "6px" } }, "¿Ronda mala?"),
      h(
        "div",
        { class: "chips" },
        app.config.motivos_mala.map((m) =>
          h("button", { class: "chip", "aria-pressed": String(t.mala === m.id), onClick: () => app.accion("marcarMala", t.mala === m.id ? null : m.id) }, `⚑ ${m.nombre}`),
        ),
      ),
    ),
    marcador(p),
    botonCerrarTurno(app, p),
  ];
}

async function pedirOtraRonda(app) {
  const motivo = await dialogo("¿Por qué la cambias?", (cerrar) =>
    h(
      "div",
      { class: "columna" },
      app.config.motivos_anulacion.map((m) => h("button", { class: "boton boton-ancho", onClick: () => cerrar(m.id) }, m.nombre)),
      h("p", { class: "texto-suave pequeno" }, "La ronda anulada no cuenta, y lo que hayáis marcado en ella se pierde."),
      h("button", { class: "boton-texto", onClick: () => cerrar() }, "Cancelar"),
    ),
  );
  if (motivo) app.accion("cambiarRonda", motivo);
}

function vistaResultadoRonda(app, p, t) {
  const r = t.rondaDatos;
  const jugador = nombreJugador(p, t.jugador);
  const n = t.aciertos;
  const detalle = !n
    ? `${jugador} se queda en ${t.posAntes}.`
    : t.posDespues >= p.meta
      ? `${jugador} llega a la meta. En su próximo turno, la pregunta final.`
      : `${jugador} avanza de ${t.posAntes} a ${t.posDespues}.`;
  if (r.tipo === "ordenar") return resultadoOrdenar(app, p, t, n, detalle);
  const nombre = (e) => (r.tipo === "lista" ? e.texto : e.respuesta);
  // Lo que no se dijo: en una lista, todo lo no marcado; en una ráfaga, las leídas y pasadas.
  const faltan = r.elementos.filter((_, i) => !t.marcados.includes(i) && (r.tipo === "lista" || i < t.indice));
  const sinLeer = r.tipo === "rafaga" ? r.elementos.length - t.indice : 0;
  // En una lista abierta no «falta» nada: se enseñan unos cuantos más de la lista, como ejemplo.
  const abierta = r.tipo === "lista" && !r.cerrada;
  const titulo = r.tipo === "lista" ? (r.cerrada ? "Faltaron" : "Otros que valían") : "Pasadas";
  const mostrar = abierta && faltan.length > 6 ? [...faltan.slice(0, 6).map(nombre), "…"] : faltan.map(nombre);
  return [
    h("section", { class: `resultado ${n ? "acierto" : "fallo"}` }, h("h2", {}, n ? `¡${cuenta(n, "acierto", "aciertos")}!` : "Ningún acierto"), h("p", {}, detalle)),
    h(
      "section",
      { class: "tarjeta columna" },
      faltan.length
        ? h("p", { class: "texto-suave pequeno" }, `${titulo}: ${mostrar.join(" · ")}${abierta && faltan.length > 6 ? "" : "."}`)
        : h("p", { class: "texto-suave pequeno" }, r.tipo === "lista" ? "¡Estaban todos los de la lista!" : "No pasó ninguna."),
      sinLeer ? h("p", { class: "texto-suave pequeno" }, `No dio tiempo a ${cuenta(sinLeer, "descripción", "descripciones")}.`) : null,
      h("p", { class: "titulo-seccion", style: { "margin-top": "6px" } }, "¿Ronda mala?"),
      h(
        "div",
        { class: "chips" },
        app.config.motivos_mala.map((m) =>
          h("button", { class: "chip", "aria-pressed": String(t.mala === m.id), onClick: () => app.accion("marcarMala", t.mala === m.id ? null : m.id) }, `⚑ ${m.nombre}`),
        ),
      ),
    ),
    marcador(p),
    botonCerrarTurno(app, p),
  ];
}

// ---------------------------------------------------------------- reto final
// «Acierta al menos k de n»: se juega como una ráfaga, y llegar al mínimo es acertar la final.

function vistaLecturaReto(app, p, t) {
  const f = t.finalDatos;
  const jugador = nombreJugador(p, t.jugador);
  const aciertos = t.marcados.length;
  const pasadas = t.indice - aciertos;
  const puesto = relojPuesto(p, t);
  const cerrado =
    aciertos >= f.minimo
      ? `¡Ya tiene ${f.minimo}! Termina el reto: ${jugador} lo ha superado.`
      : pasadas > f.elementos.length - f.minimo
        ? `Ya no puede llegar a ${f.minimo}: termina el reto.`
        : null;
  return [
    h(
      "div",
      { class: "meta-linea" },
      h("span", { class: "etiqueta-final" }, `🏁 ${f.titulo}`),
      h("strong", { class: "contador-ronda", "aria-live": "polite" }, `Lleva ${aciertos} de ${f.minimo}`),
    ),
    notaAlternativa(app, t),
    puesto
      ? null
      : h(
          "section",
          { class: "tarjeta tarjeta-final" },
          h("p", { class: "texto-suave pequeno" }, `Lee en voz alta para ${jugador} y, al terminar, pon el tiempo:`),
          h("p", { class: "texto-pregunta reducido" }, f.enunciado),
          f.nota ? h("p", { class: "texto-suave pequeno", style: { "margin-top": "8px" } }, f.nota) : null,
          h("button", { class: "boton-texto", onClick: () => pedirOtraPregunta(app) }, "Cambiar reto"),
        ),
    cuerpoRafaga(app, p, t, f, { termina: "termina el reto", cerrado }),
    puesto ? h("button", { class: "boton-texto", onClick: () => pedirOtraPregunta(app) }, "Cambiar reto") : null,
    h(
      "div",
      { class: "columna acciones-fijas" },
      bloqueReloj(app, p, t, { alAcabar: "¡Tiempo! Marca la última y termina." }),
      h(
        "button",
        { class: "boton boton-primario boton-ancho", onClick: () => app.accion("terminarReto", { tiempoAgotado: tiempoAgotado(p, t) }) },
        `Terminar el reto · ${aciertos} de ${f.minimo}`,
      ),
    ),
  ];
}

function vistaResultadoReto(app, p, t) {
  const f = t.finalDatos;
  const pasadas = f.elementos.filter((_, i) => !t.marcados.includes(i) && i < t.indice).map((e) => e.respuesta);
  const sinLeer = f.elementos.length - t.indice;
  const d = desenlaceFinal(app, p, t, "Reto fallado");
  const cuantas = t.acierto
    ? `Ha acertado ${t.aciertos} de ${f.elementos.length} (necesitaba ${f.minimo}).`
    : `Ha acertado ${t.aciertos} de ${f.elementos.length} y necesitaba ${f.minimo}.`;
  return [
    h("section", { class: `resultado ${t.acierto ? "acierto" : "fallo"}` }, h("h2", {}, d.titulo), h("p", {}, [cuantas, d.detalle].filter(Boolean).join(" "))),
    h(
      "section",
      { class: "tarjeta columna" },
      pasadas.length ? h("p", { class: "texto-suave pequeno" }, `Pasadas: ${pasadas.join(" · ")}.`) : null,
      // Si se terminó antes (ya ganado, o ya imposible), no es que no diera tiempo.
      sinLeer
        ? h("p", { class: "texto-suave pequeno" }, t.tiempoAgotado ? `No dio tiempo a ${cuenta(sinLeer, "descripción", "descripciones")}.` : `Sin leer: ${cuenta(sinLeer, "descripción", "descripciones")}.`)
        : null,
      h("p", { class: "titulo-seccion", style: { "margin-top": "6px" } }, "¿Reto malo?"),
      h(
        "div",
        { class: "chips" },
        app.config.motivos_mala.map((m) =>
          h("button", { class: "chip", "aria-pressed": String(t.mala === m.id), onClick: () => app.accion("marcarMala", t.mala === m.id ? null : m.id) }, `⚑ ${m.nombre}`),
        ),
      ),
    ),
    marcador(p),
    botonCerrarTurno(app, p),
  ];
}
