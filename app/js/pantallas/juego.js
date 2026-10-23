// Pantalla de partida: una vista por cada fase del turno.

import { FASE } from "../motor.js";
import { confirmar, dialogo, h, montarPantalla } from "../dom.js";
import { etiquetaCat, estiloCat, marcador, nombreJugador, tablero, textoAlternativa } from "./comun.js";
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
  // toques ni se sube la página. En una ráfaga (o un reto final), cada descripción nueva sí cuenta
  // como pantalla nueva, para que un doble toque en «Acertó» no marque también la siguiente.
  const clave =
    t.fase !== FASE.LECTURA
      ? null
      : t.ronda
        ? `ronda|${p.id}|${p.n}|${t.ronda}|${t.rondaDatos.tipo === "rafaga" ? t.indice : ""}`
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
      h("div", { class: "meta-linea" }, etiquetaCat(app, t.categoria), t.salida ? h("span", { class: "texto-suave pequeno" }, "Salida: categoría al azar") : null),
      h("div", { class: "subtema" }, app.nombreSubtema(t.categoria, t.subtema)),
      h("p", { class: "pregunta-apuesta" }, `${jugador}, ¿hasta cuánto te arriesgas?`),
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
  const explicacion =
    (t.ventaja > 0
      ? `Le saca ${t.ventaja} puntos a ${unirNombres(ultimos)}, que ${ultimos.length > 1 ? "van" : "va"} en último lugar: ${nivel_base} + 1 por cada ${p.pasoFinal} puntos de ventaja${tope}.`
      : "No le saca ventaja al último: nivel base.") + rebaja;
  // Con finales propias aún no se sabe qué saldrá (se elige al pasar el móvil): de tema libre, pregunta o reto.
  const tiempo = t.categoria
    ? p.cronometro && segundosCronometro(app.config, t.categoria, t.nivelFinal)
      ? `⏱ Tendrá ${duracionLegible(segundosCronometro(app.config, t.categoria, t.nivelFinal))} para responder.`
      : null
    : p.cronometro
      ? "⏱ Si es un reto o de cálculo, irá con tiempo."
      : "⏱ Si es un reto, irá con tiempo.";
  return [
    marcador(p),
    h(
      "section",
      { class: "tarjeta tarjeta-cat centrado", style: estiloCat(app, t.categoria) },
      h("p", { class: "texto-suave" }, "🏁 Pregunta final"),
      h("h2", { style: { "font-size": "1.7rem", margin: "6px 0 14px" } }, `${jugador}, si aciertas, ganas`),
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

const formatoKm = (km) => `${new Intl.NumberFormat("es-ES").format(Math.round(km))} km`;

function vistaInicial(app, q) {
  const cat = app.config.categorias.find((c) => c.id === q.categoria);
  const nombre = q.vista ?? cat?.subtemas.find((s) => s.id === q.subtema)?.vista ?? "mundo";
  return app.config.mapa.vistas[nombre] ?? app.config.mapa.vistas.mundo;
}

function reglaMapa(app, t) {
  const q = t.preguntaDatos;
  const radio = q.distancia_max_km * (app.config.mapa.acierto_fraccion ?? 0.5);
  if (t.esFinal) return `Gana si queda a menos de ${formatoKm(radio)} del sitio.`;
  const paso = pasoKm(q.distancia_max_km, t.apuesta, app.config.mapa.acierto_fraccion ?? 0.5);
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
    vista: vistaInicial(app, q),
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
  const radioKm = q.distancia_max_km * (app.config.mapa.acierto_fraccion ?? 0.5);
  // Encuadre: los dos puntos y la zona de acierto, con margen. La longitud del punto señalado se
  // acerca a la correcta por el camino corto (por si están a los dos lados del Pacífico).
  let lon2 = t.mapa.lon;
  if (lon2 - q.lon > 180) lon2 -= 360;
  if (q.lon - lon2 > 180) lon2 += 360;
  const margenLat = radioKm / 111;
  const margenLon = margenLat / Math.max(0.2, Math.cos((q.lat * Math.PI) / 180));
  const oeste = Math.min(q.lon - margenLon, lon2) - 2;
  const este = Math.max(q.lon + margenLon, lon2) + 2;
  const sur = Math.max(-80, Math.min(q.lat - margenLat, t.mapa.lat) - 2);
  const norte = Math.min(80, Math.max(q.lat + margenLat, t.mapa.lat) + 2);
  const desplazar = oeste < -180 ? 360 : 0; // el mapa empieza en −180: se usa la segunda copia
  return crearMapa({
    ruta: app.config.mapa.archivo,
    vista: [oeste + desplazar, sur, este + desplazar, norte],
    estado: mapaResultado,
    correcta: { lat: q.lat, lon: q.lon, radioKm },
  });
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

function bloqueRespuesta(q) {
  return h(
    "div",
    { class: "respuesta" },
    h("p", { class: "texto-suave pequeno" }, "Respuesta"),
    h("p", { class: "valor" }, q.respuesta),
    q.tambien_vale?.length ? h("p", { class: "detalle" }, `También vale: ${q.tambien_vale.join(" · ")}`) : null,
    q.criterio ? h("p", { class: "detalle" }, `Criterio: ${q.criterio}`) : null,
  );
}

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

function vistaResultado(app, p, t) {
  const jugador = nombreJugador(p, t.jugador);
  const siguiente = p.jugadores[(p.idx + 1) % p.jugadores.length].nombre;
  const q = t.preguntaDatos;

  let titulo;
  let detalle;
  const esMapa = q.tipo === "mapa" && t.mapa;
  const radioMapa = esMapa ? q.distancia_max_km * (app.config.mapa.acierto_fraccion ?? 0.5) : 0;
  if (esMapa && p.ganador) {
    titulo = `¡${jugador} gana!`;
    detalle = `Ha señalado a ${formatoKm(t.mapa.distancia_km)} del sitio, dentro de los ${formatoKm(radioMapa)} que hacían falta.`;
  } else if (esMapa && t.esFinal) {
    titulo = "Final fallada";
    detalle = `Ha señalado a ${formatoKm(t.mapa.distancia_km)} y hacía falta quedar a menos de ${formatoKm(radioMapa)}. Lo volverá a intentar en su próximo turno${t.nivelFinal > app.config.final.nivel_base ? ", con una final un escalón más fácil" : ""}.`;
  } else if (esMapa) {
    const n = t.mapa.puntos;
    titulo = n ? (n === t.apuesta ? `¡Clavado! +${n}` : `+${n} de ${t.apuesta}`) : "Demasiado lejos";
    const avance = !n
      ? `${jugador} se queda en ${t.posAntes}.`
      : t.posDespues >= p.meta
        ? `${jugador} llega a la meta. En su próximo turno, la pregunta final.`
        : `${jugador} avanza de ${t.posAntes} a ${t.posDespues}.`;
    detalle = `A ${formatoKm(t.mapa.distancia_km)} del sitio. ${avance}`;
  } else if (p.ganador) {
    titulo = `¡${jugador} gana!`;
    detalle = "Ha acertado la pregunta final.";
  } else if (t.esFinal) {
    titulo = "Final fallada";
    detalle = `${jugador} sigue en la meta y lo volverá a intentar en su próximo turno${t.nivelFinal > app.config.final.nivel_base ? ", con una final un escalón más fácil" : ""}.`;
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
    h(
      "div",
      { class: "acciones-fijas" },
      h(
        "button",
        { class: "boton boton-primario boton-grande boton-ancho", onClick: () => app.accion("cerrarTurno") },
        p.ganador ? "Ver resultados" : `Siguiente turno: ${siguiente}`,
      ),
    ),
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
  const cuantos = r.tipo === "rafaga" ? ` Son ${r.elementos.length} descripciones.` : r.cerrada ? ` Hay ${r.elementos.length}.` : "";
  return [
    marcador(p),
    tablero(app, p),
    h(
      "section",
      { class: "tarjeta tarjeta-ronda centrado" },
      h("p", { class: "texto-suave" }, "★ Ronda divertida"),
      h("h2", { class: "titulo-ronda" }, r.titulo),
      h(
        "p",
        {},
        r.tipo === "lista"
          ? `${jugador}, di todos los que puedas en ${duracionLegible(r.segundos)}.`
          : `${jugador}, acierta todas las que puedas en ${duracionLegible(r.segundos)}.`,
      ),
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
    r.tipo === "lista" ? cuerpoLista(app, t) : cuerpoRafaga(app, p, t),
    puesto ? h("button", { class: "boton-texto", onClick: () => pedirOtraRonda(app) }, "Cambiar ronda") : null,
    h(
      "div",
      { class: "columna acciones-fijas" },
      bloqueReloj(app, p, t, { alAcabar: r.tipo === "lista" ? "¡Tiempo! Ya no vale decir más." : "¡Tiempo! Marca la última y termina." }),
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
  const siguiente = p.jugadores[(p.idx + 1) % p.jugadores.length].nombre;
  const n = t.aciertos;
  const detalle = !n
    ? `${jugador} se queda en ${t.posAntes}.`
    : t.posDespues >= p.meta
      ? `${jugador} llega a la meta. En su próximo turno, la pregunta final.`
      : `${jugador} avanza de ${t.posAntes} a ${t.posDespues}.`;
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
    h(
      "div",
      { class: "acciones-fijas" },
      h("button", { class: "boton boton-primario boton-grande boton-ancho", onClick: () => app.accion("cerrarTurno") }, `Siguiente turno: ${siguiente}`),
    ),
  ];
}

// ---------------------------------------------------------------- reto final
// «Acierta al menos k de n»: se juega como una ráfaga, pero quien lo consigue gana la partida.

function vistaLecturaReto(app, p, t) {
  const f = t.finalDatos;
  const jugador = nombreJugador(p, t.jugador);
  const aciertos = t.marcados.length;
  const pasadas = t.indice - aciertos;
  const puesto = relojPuesto(p, t);
  const cerrado =
    aciertos >= f.minimo
      ? `¡Ya tiene ${f.minimo}! Termina el reto: ${jugador} gana.`
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
  const jugador = nombreJugador(p, t.jugador);
  const siguiente = p.jugadores[(p.idx + 1) % p.jugadores.length].nombre;
  const pasadas = f.elementos.filter((_, i) => !t.marcados.includes(i) && i < t.indice).map((e) => e.respuesta);
  const sinLeer = f.elementos.length - t.indice;
  return [
    h(
      "section",
      { class: `resultado ${t.acierto ? "acierto" : "fallo"}` },
      h("h2", {}, t.acierto ? `¡${jugador} gana!` : "Reto fallado"),
      h(
        "p",
        {},
        t.acierto
          ? `Ha acertado ${t.aciertos} de ${f.elementos.length} (necesitaba ${f.minimo}).`
          : `Ha acertado ${t.aciertos} de ${f.elementos.length} y necesitaba ${f.minimo}. Sigue en la meta y lo volverá a intentar en su próximo turno${t.nivelFinal > app.config.final.nivel_base ? ", con una final un escalón más fácil" : ""}.`,
      ),
    ),
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
    h(
      "div",
      { class: "acciones-fijas" },
      h(
        "button",
        { class: "boton boton-primario boton-grande boton-ancho", onClick: () => app.accion("cerrarTurno") },
        p.ganador ? "Ver resultados" : `Siguiente turno: ${siguiente}`,
      ),
    ),
  ];
}
