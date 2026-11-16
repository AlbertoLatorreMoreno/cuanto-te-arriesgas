// Pantalla del duelo. Cada estado se guarda antes de enseñarlo.

import { rngReal, uuid } from "../azar.js";
import { aviso, cabecera, confirmar, dialogo, h, montar, montarPantalla } from "../dom.js";
import * as D from "../duelo.js";
import { dueloSinDecidir } from "../envio.js";
import { aciertoMapa, distanciaKm } from "../geo.js";
import { crearMapa } from "../mapa.js";
import * as S from "../solo.js";
import { normalizarNombre } from "../util.js";
import { MAX_CHIPS_JUGADORES, estiloCat, etiquetaCat, formatoKm, mapaRespondido, preguntarEnvio, radioAciertoKm, vistaInicialMapa } from "./comun.js";
import { cargarSolo } from "./solo.js";

const numero = (n) => new Intl.NumberFormat("es-ES").format(n);
const multiplicador = (n) => `×${n.toFixed(2).replace(".", ",")}`;
const ahora = () => new Date().toISOString();

function comprobarGuardado(ok, mensaje) {
  if (ok === false) throw new Error(mensaje);
}

function reservas(app) {
  const fecha = S.fechaLocal(new Date(), app.config.solo.zona_horaria);
  return S.reservadasParaPractica(fecha, {
    calendario: app.solo.calendario,
    indice: app.indice,
    opciones: app.solo.opciones,
    config: app.config,
  });
}

// Lo que ya se guardó tal cual en esta sesión (id → JSON): no se vuelve a escribir. Sin esto, cada respuesta
// reescribía todos los registros del duelo (hasta 34) antes de enseñar el resultado, y en el móvil se notaba.
const yaGuardados = new Map();

// El mismo guardado sirve para una respuesta, una recuperación y un cierre. Los ids son estables.
async function consolidarDuelo(app, d, vigente, cerrar = false) {
  const ctx = { dispositivo: app.almacen.dispositivo, versiones: app.versiones };
  for (const registro of D.registrosDuelo(d, ctx)) {
    if (!vigente()) return false;
    const texto = JSON.stringify(registro);
    if (yaGuardados.get(registro.id) === texto) continue;
    await app.almacen.guardarRegistro(registro);
    yaGuardados.set(registro.id, texto);
  }
  if (!vigente()) return false;
  if (d.final === "completo" && !app.almacen.historialDuelos().some((r) => r.id === d.id)) {
    comprobarGuardado(app.almacen.apuntarDuelo(D.resumenDuelo(d)), "No se ha podido guardar el historial del duelo.");
  }
  // La última respuesta conserva su pantalla y su opinión editable hasta que se deje atrás.
  if (cerrar && d.final && app.almacen.dueloEnCurso()?.id === d.id) {
    comprobarGuardado(app.almacen.guardarDuelo(null), "No se ha podido cerrar el duelo guardado.");
  }
  return true;
}

// Lo que se ve de cada modo en el menú: «4 por cabeza: 1 y 3 del rival, 8 y 10 del tuyo».
function textoModo(app, modo) {
  const n = D.nivelesDuelo(app.config, modo);
  const lista = (x) => x.join(", ").replace(/, (\d+)$/, " y $1");
  return `${n.facil.length * 2} preguntas cada uno: de nivel ${lista(n.facil)} del tema del rival, y de nivel ${lista(n.dificil)} del tuyo.`;
}

const tituloDuelo = (d) => (d?.modo === "veloz" ? "Duelo veloz" : "Duelo");

function crearDuelo(app, pareja, modo = "normal") {
  if (app.almacen.dueloEnCurso()) throw new Error("Antes, termina o abandona el duelo que está a medias.");
  const jugadores = pareja.map((j) => {
    const nombre = String(j?.nombre ?? "").trim().replace(/\s+/g, " ");
    return { clave: normalizarNombre(nombre), nombre, tema: j?.tema ?? "" };
  });
  if (jugadores.some((j) => !j.clave)) throw new Error("Escribe los dos nombres o elige quiénes juegan.");
  if (jugadores[0].clave === jugadores[1].clave) throw new Error("Elegid dos nombres distintos.");
  if (jugadores.some((j) => !j.tema)) throw new Error("Elegid un tema para cada jugador.");
  const plan = D.planDuelo({
    indice: app.indice,
    opciones: app.solo.opciones,
    config: app.config,
    jugadores,
    vistas: jugadores.map((j) => app.almacen.vistasDe(j.clave)),
    reservadas: reservas(app),
    rng: rngReal(),
    modo,
  });
  if (!plan) throw new Error("Uno de los temas no tiene preguntas suficientes. Elegid otro.");
  const ts = ahora();
  const d = D.nuevoDuelo({ id: uuid(), jugadores, plan, ahora: ts, versiones: app.versiones, modo });
  comprobarGuardado(app.almacen.guardarPreferencia("modoDuelo", modo), "No se ha podido recordar el modo del duelo.");
  app.almacen.recordarJugadores(jugadores, ts);
  comprobarGuardado(
    app.almacen.guardarPreferencia("dueloJugadores", jugadores.map(({ clave, nombre }) => ({ clave, nombre }))),
    "No se han podido recordar los jugadores.",
  );
  const temas = { ...app.almacen.preferencia("temasDuelo", {}) };
  for (const j of jugadores) temas[j.clave] = j.tema;
  comprobarGuardado(app.almacen.guardarPreferencia("temasDuelo", temas), "No se han podido recordar los temas.");
  comprobarGuardado(app.almacen.guardarDuelo(d), "El navegador no deja guardar el duelo (¿almacenamiento lleno?).");
  return d;
}

export async function pantallaDuelo(app, params = {}) {
  const vigente = app.vigente();
  if (!app.solo) {
    montar(cabecera("Duelo", () => app.ir("inicio")), h("p", { class: "cargando" }, "Cargando…"));
    try {
      await cargarSolo(app);
    } catch (err) {
      if (!vigente()) return;
      return montar(
        cabecera("Duelo", () => app.ir("inicio")),
        h(
          "section",
          { class: "pantalla-pasar" },
          h("h2", {}, "No se ha podido cargar el duelo"),
          h("p", { class: "texto-suave" }, `${err.message} La primera vez hace falta conexión; después se puede jugar sin ella.`),
          h("button", { class: "boton boton-primario boton-ancho", onClick: () => app.ir("duelo", params) }, "Reintentar"),
        ),
      );
    }
    if (!vigente()) return;
  }
  const d = app.almacen.dueloEnCurso();
  if (d && !params.menu) return pantallaPartida(app, d);
  return pantallaMenu(app);
}

// ---------------------------------------------------------------- menú

function pantallaMenu(app) {
  const vigente = app.vigente();
  const conocidos = app.almacen.jugadoresConocidos();
  const pareja = app.almacen.preferencia("dueloJugadores", null);
  const jugables = new Set([...app.indice.porId.values()].filter((q) => S.jugable(q, app.solo.opciones)).map((q) => q.categoria));
  const temas = (app.temas ?? []).filter((t) => jugables.has(t.id));
  const categorias = app.config.categorias.filter((c) => jugables.has(c.id));
  const disponibles = new Set([...temas, ...categorias].map((t) => t.id));
  const estado = [0, 1].map((i) => ({ jugador: pareja?.[i] ?? null, nombreNuevo: "", tema: "", claveTema: null }));
  const modos = D.MODOS.filter((m) => {
    try {
      return Boolean(D.nivelesDuelo(app.config, m));
    } catch {
      return false;
    }
  });
  let modo = modos.includes(app.almacen.preferencia("modoDuelo", "normal")) ? app.almacen.preferencia("modoDuelo", "normal") : modos[0];
  let ocupado = false;
  let zonaPareja;

  function jugador(i) {
    const escrito = estado[i].nombreNuevo.trim().replace(/\s+/g, " ");
    const nombre = normalizarNombre(escrito) ? escrito : estado[i].jugador?.nombre;
    return nombre ? { clave: normalizarNombre(nombre), nombre } : null;
  }

  function actualizarTema(i) {
    const e = estado[i];
    const clave = jugador(i)?.clave ?? "";
    if (e.claveTema === clave) return;
    e.claveTema = clave;
    const duelo = app.almacen.preferencia("temasDuelo", {});
    const grupo = app.almacen.preferencia("temas", {});
    const tema = duelo?.[clave] ?? grupo?.[clave] ?? "";
    e.tema = disponibles.has(tema) ? tema : "";
  }
  estado.forEach((_, i) => actualizarTema(i));

  function caraDePareja() {
    const a = jugador(0);
    const b = jugador(1);
    if (!a || !b || a.clave === b.clave) return [];
    const cuenta = D.caraACara(app.almacen.historialDuelos(), a.clave, b.clave);
    if (!cuenta.a && !cuenta.b && !cuenta.empates) return [];
    return [h("p", { class: "nota" }, `${a.nombre} ${cuenta.a} · ${b.nombre} ${cuenta.b} · ${cuenta.empates} ${cuenta.empates === 1 ? "empate" : "empates"}`)];
  }

  const accion = (fn) => async (...args) => {
    if (ocupado || !vigente()) return;
    ocupado = true;
    try {
      await fn(...args);
    } catch (err) {
      if (vigente()) aviso(err.message, { error: true, ms: 6000 });
    } finally {
      ocupado = false;
    }
    if (vigente()) pintar();
  };

  const empezar = accion(() => {
    const jugadores = estado.map((e, i) => ({ ...jugador(i), tema: e.tema }));
    crearDuelo(app, jugadores, modo);
    app.ir("duelo");
  });

  // Normal o veloz: dos botones, como los de los jugadores, y debajo lo que trae el elegido.
  function bloqueModo() {
    if (modos.length < 2) return null;
    return h(
      "section",
      { class: "tarjeta columna" },
      h("h2", { class: "titulo-seccion" }, "Modo"),
      h(
        "div",
        { class: "chips", role: "group", "aria-label": "Modo del duelo" },
        modos.map((m) =>
          h(
            "button",
            {
              class: "chip",
              "aria-pressed": String(modo === m),
              onClick: accion(() => {
                modo = m;
              }),
            },
            `${m === "veloz" ? "⚡ " : ""}${D.nivelesDuelo(app.config, m).nombre ?? m}`,
          ),
        ),
      ),
      h("p", { class: "texto-suave pequeno" }, textoModo(app, modo)),
    );
  }

  const abandonar = accion(async () => {
    const anterior = app.almacen.dueloEnCurso();
    if (!anterior) return;
    const completo = anterior.final === "completo";
    const si = await confirmar(
      completo ? "¿Cerrar el duelo?" : "¿Abandonar el duelo?",
      completo ? "El resultado ya cuenta. Se guardará la última opinión que hayáis marcado." : "Se guardan las respuestas, pero no cuenta para el historial de victorias.",
      { si: completo ? "Cerrar duelo" : "Abandonarlo", peligro: !completo },
    );
    if (!si || !vigente()) return;
    const actual = app.almacen.dueloEnCurso();
    if (JSON.stringify(actual) !== JSON.stringify(anterior)) throw new Error("El duelo ha cambiado. Vuelve a abrirlo para continuar.");
    const fin = actual.fase === "fin" ? actual : D.abandonar(actual, { ts: ahora() });
    comprobarGuardado(app.almacen.guardarDuelo(fin), "No se ha podido guardar el cierre del duelo.");
    if (await consolidarDuelo(app, fin, vigente, true)) await decidirEnvioDuelo(app);
  });

  function bloqueJugador(i) {
    const e = estado[i];
    const opciones = conocidos.slice(0, MAX_CHIPS_JUGADORES);
    if (e.jugador && !opciones.some((j) => j.clave === e.jugador.clave)) {
      opciones.unshift(e.jugador);
      opciones.splice(MAX_CHIPS_JUGADORES);
    }
    const select = h(
      "select",
      {
        "aria-label": `Tema del jugador ${i + 1}`,
        onChange: (ev) => {
          if (!ocupado && vigente()) e.tema = ev.target.value;
        },
      },
      h("option", { value: "", selected: !e.tema }, "Elige un tema"),
      temas.length ? h("optgroup", { label: "Temas" }, temas.map((t) => h("option", { value: t.id, selected: e.tema === t.id }, t.nombre))) : null,
      categorias.length ? h("optgroup", { label: "Categorías" }, categorias.map((c) => h("option", { value: c.id, selected: e.tema === c.id }, c.nombre))) : null,
    );
    const chips = opciones.map((j) => h(
      "button",
      {
        class: "chip chip-jugador",
        "aria-pressed": String(!e.nombreNuevo.trim() && e.jugador?.clave === j.clave),
        onClick: accion(() => {
          e.jugador = { clave: j.clave, nombre: j.nombre };
          e.nombreNuevo = "";
          actualizarTema(i);
        }),
      },
      j.nombre,
    ));
    return h(
      "section",
      { class: "tarjeta columna duelo-jugador-formulario" },
      h("h2", { class: "titulo-seccion" }, `Jugador ${i + 1}`),
      chips.length ? h("div", { class: "chips" }, chips) : null,
      h("div", { class: "campo" }, h("input", {
        type: "text",
        maxlength: "20",
        autocomplete: "off",
        placeholder: opciones.length ? "U otro nombre" : "Tu nombre",
        value: e.nombreNuevo,
        "aria-label": `Nombre del jugador ${i + 1}`,
        // No se remonta el formulario: el toque que cierra el teclado debe llegar al botón.
        onInput: (ev) => {
          if (ocupado || !vigente()) return;
          e.nombreNuevo = ev.target.value;
          actualizarTema(i);
          select.value = e.tema;
          chips.forEach((chip, k) => chip.setAttribute("aria-pressed", String(!e.nombreNuevo.trim() && e.jugador?.clave === opciones[k].clave)));
          zonaPareja.replaceChildren(...caraDePareja());
        },
      })),
      select,
    );
  }

  function pintar() {
    if (!vigente()) return;
    const enCurso = app.almacen.dueloEnCurso();
    const historial = app.almacen.historialDuelos().slice(-5).reverse();
    zonaPareja = h("section", { class: "columna", "aria-live": "polite" }, caraDePareja());
    montarPantalla(
      "duelo-menu",
      cabecera("Duelo", accion(() => app.ir("inicio"))),
      h("p", { class: "texto-suave" }, "Cada uno elige su tema: preguntas difíciles del tuyo y fáciles del rival. Gana quien sume más puntos."),
      enCurso ? h(
        "section",
        { class: "nota columna" },
        h("p", {}, `${enCurso.jugadores[0].nombre} contra ${enCurso.jugadores[1].nombre}: ${enCurso.final ? "duelo terminado, pendiente de cerrar" : `pregunta ${enCurso.fase === "resultado" ? enCurso.paso : Math.min(enCurso.paso + 1, D.huecosDe(enCurso))} de ${D.huecosDe(enCurso)}`}${enCurso.modo === "veloz" ? " (veloz)" : ""}.`),
        h("button", { class: "boton boton-primario boton-ancho", onClick: accion(() => app.ir("duelo")) }, "Continuarlo"),
        h("button", { class: "boton boton-ancho", onClick: abandonar }, enCurso.final ? "Cerrar duelo" : "Abandonarlo"),
      ) : null,
      bloqueModo(),
      bloqueJugador(0),
      bloqueJugador(1),
      zonaPareja,
      h("button", { class: "boton boton-primario boton-grande boton-ancho", onClick: empezar }, "Empezar el duelo"),
      historial.length ? h(
        "section",
        { class: "columna" },
        h("h2", { class: "titulo-seccion" }, "Últimos duelos"),
        h("ul", { class: "duelo-historial" }, historial.map((r) => {
          const [a, b] = r.jugadores;
          if (!a || !b) return null;
          return h("li", {}, `${r.modo === "veloz" ? "⚡ " : ""}${a.nombre} (${app.nombreCategoria(a.tema)}) ${numero(a.puntos)} – ${numero(b.puntos)} ${b.nombre} (${app.nombreCategoria(b.tema)})`);
        })),
      ) : null,
      h("button", { class: "boton-texto", onClick: accion(() => app.ir("reglas", { volverA: "duelo" })) }, "Cómo se juega"),
    );
  }
  pintar();
}

// ---------------------------------------------------------------- partida

let relojSesion = null; // { clave, perf, base }; se conserva al ir al menú y volver.

function pantallaPartida(app, inicial) {
  let d = inicial;
  const vigente = app.vigente();
  const mapa = { punto: null, vb: null };
  let mapaResultado = null;
  let ocupado = false;
  let bloqueo = null;
  let cerrado = false;
  let envioSolicitado = false;
  let pendiente = null; // una respuesta que no se pudo guardar: «Reintentar» la vuelve a intentar tal cual

  const claveReloj = () => `${d.id}|${d.paso}`;
  const msSesion = () => relojSesion?.clave === claveReloj() ? relojSesion.base + performance.now() - relojSesion.perf : 0;

  function guardar(nueva) {
    if (!vigente()) throw new Error("Esta pantalla ya no está activa.");
    if (app.almacen.dueloEnCurso()?.id !== nueva.id) throw new Error("El duelo guardado ha cambiado. Vuelve a abrirlo.");
    if (!app.almacen.guardarDuelo(nueva)) {
      // Una respuesta que no se pudo guardar no se pierde: se reintenta igual, con el tiempo con que se dio. Solo las
      // respuestas: empezar una pregunta se repite tocando otra vez el botón (con el tiempo desde ese momento), y lo
      // consumido se vuelve a apuntar solo.
      if (d.fase === "pregunta" && nueva.fase === "resultado") pendiente = nueva;
      throw new Error("El navegador no deja guardar el duelo (¿almacenamiento lleno?).");
    }
    pendiente = null;
    d = nueva;
  }

  // Lo visto por cada jugador, también al recuperar: si la app se cerró justo después de guardar la pregunta y antes de
  // marcarla, se marca ahora (sin cambiar la fecha de lo ya marcado).
  function marcarVistasPendientes() {
    const pares = [...d.resultados.map((r) => [r.jugador, r.pregunta]), ...(d.fase === "pregunta" ? [[D.huecoActual(d).jugador, d.actual.id]] : [])]
      .map(([i, id]) => [d.jugadores[i].clave, id])
      .filter(([clave, id]) => !(id in app.almacen.vistasDe(clave)));
    if (pares.length) app.almacen.marcarVistas(pares, ahora());
  }

  async function recuperar() {
    marcarVistasPendientes();
    if (!(await consolidarDuelo(app, d, vigente, d.fase === "fin"))) return;
    if (d.fase === "fin") cerrado = true;
    if (d.final) app.sincronizar();
  }

  function solicitarEnvio() {
    if (!cerrado || envioSolicitado || !vigente() || bloqueo) return;
    envioSolicitado = true;
    decidirEnvioDuelo(app).catch((err) => {
      envioSolicitado = false;
      if (!vigente()) return;
      bloqueo = err.message;
      pintar();
    });
  }

  // Un toque cada vez. Una escritura fallida bloquea el avance hasta recuperarla explícitamente.
  const accion = (fn) => async (...args) => {
    if (ocupado || bloqueo || !vigente()) return;
    ocupado = true;
    try {
      await fn(...args);
    } catch (err) {
      bloqueo = err.message;
    } finally {
      ocupado = false;
    }
    if (vigente()) {
      pintar();
      solicitarEnvio();
    }
  };

  // La flecha vuelve también con un error en pantalla: lo que falte por guardar se completa al reabrir el duelo,
  // porque el duelo guardado no se borra hasta tenerlo todo guardado. Una respuesta que no se pudo guardar, en cambio,
  // solo existe en esta pantalla: se intenta guardar antes de salir y, si no se puede, no se sale (se perdería).
  const volverAlMenu = () => {
    if (!vigente()) return;
    if (pendiente) {
      try {
        guardar(pendiente);
      } catch {
        aviso("Tu respuesta aún no se ha podido guardar. Libera espacio en el móvil y toca «Reintentar».", { error: true, ms: 6000 });
        return;
      }
    }
    app.ir("duelo", { menu: true });
  };

  const empezarPregunta = accion(async () => {
    if (d.fase !== "preparar") return;
    let preparada = d;
    let hueco = D.huecoActual(preparada);
    let q = app.indice.porId.get(hueco.pregunta);
    // Con el duelo a medias puede haber llegado otra versión del banco (pregunta retirada, sin opciones o cambiada de
    // tema) o del calendario (pregunta reservada para un reto): entonces se cambia por otra con los mismos criterios.
    const reservadas = reservas(app);
    if (!q || !S.jugable(q, app.solo.opciones) || q.categoria !== hueco.tema || reservadas.has(q.id)) {
      preparada = D.sustituirHueco(d, {
        indice: app.indice,
        opciones: app.solo.opciones,
        config: app.config,
        vistas: d.jugadores.map((j) => app.almacen.vistasDe(j.clave)),
        reservadas,
        rng: rngReal(),
      });
      if (!preparada) {
        guardar(D.abandonar(d, { ts: ahora() }));
        aviso("El banco ha cambiado y no queda una sustituta. El duelo se ha abandonado.", { error: true, ms: 7000 });
        await recuperar();
        return;
      }
      hueco = D.huecoActual(preparada);
      q = app.indice.porId.get(hueco.pregunta);
    }
    const foto = { ...S.fotoPregunta(q, app.solo.opciones, app.config, hueco.nivel), versiones: { ...app.versiones } };
    const orden = q.tipo === "mapa" ? null : S.ordenOpciones(q, app.solo.opciones, rngReal());
    guardar(D.empezarPregunta(preparada, { ahoraMs: Date.now(), foto, orden }));
    relojSesion = { clave: claveReloj(), perf: performance.now(), base: 0 };
    app.almacen.marcarVistas([[d.jugadores[hueco.jugador].clave, q.id]], ahora());
    mapa.punto = null;
    mapa.vb = null;
  });

  const responder = accion(async ({ acierto, elegida = null, senal = null }) => {
    if (d.fase !== "pregunta") return;
    const ms = S.transcurrido(d, Date.now(), msSesion());
    guardar(D.responderPregunta(d, { acierto, elegida, mapa: senal, ms, ts: ahora() }));
    await recuperar();
  });

  const continuar = accion(async (valor = null) => {
    if (d.fase !== "resultado") return;
    const valorada = valor === null ? d : D.valorarUltima(d, valor);
    guardar(D.seguir(valorada));
    await recuperar();
  });

  const avisarPregunta = accion(async () => {
    if (d.fase !== "resultado") return;
    const paso = d.paso;
    const ultimo = d.resultados[d.resultados.length - 1];
    const motivo = await dialogo("Avisar de un fallo", (cerrar) => [
      h("div", { class: "columna" },
        (app.config.motivos_mala ?? []).map((m) => h("button", {
          class: "boton boton-ancho",
          "aria-pressed": String(ultimo.mala === m.id),
          onClick: () => cerrar(m.id),
        }, m.nombre)),
        ultimo.mala ? h("button", { class: "boton boton-ancho", onClick: () => cerrar(null) }, "Quitar el aviso") : null,
        h("button", { class: "boton-texto", onClick: () => cerrar() }, "Cancelar"),
      ),
    ]);
    if (motivo === undefined || !vigente() || d.fase !== "resultado" || d.paso !== paso) return;
    guardar(D.marcarMala(d, motivo));
  });

  const revancha = accion(() => {
    if (d.fase !== "fin" || !cerrado) return;
    crearDuelo(app, [...d.jugadores].reverse(), d.modo ?? "normal");
    app.ir("duelo");
  });

  const compartirResultado = accion(() => compartir(app, d));

  function marcador(final = false) {
    const puntos = D.puntos(d);
    const aciertos = D.aciertos(d);
    const actual = d.fase === "resultado" ? d.resultados[d.resultados.length - 1]?.jugador : D.huecoActual(d)?.jugador;
    return h("div", {
      class: `marcador-duelo${d.fase === "pregunta" ? " compacto" : ""}${final ? " duelo-marcador-final" : ""}`,
      role: "list",
      "aria-label": "Marcador del duelo",
    }, d.jugadores.map((j, i) => h(
      "div",
      { class: `duelo-jugador${actual === i ? " activo" : ""}`, role: "listitem" },
      h("strong", { class: "duelo-nombre" }, actual === i ? "▶ " : "", j.nombre),
      h("span", { class: "duelo-tema" }, app.nombreCategoria(j.tema)),
      h("strong", { class: "duelo-puntos" }, `${numero(puntos[i])} puntos`),
      final ? h("span", { class: "texto-suave pequeno" }, `${aciertos[i]} de ${D.huecosDe(d) / 2} aciertos`) : null,
      h("span", { class: "duelo-emojis", "aria-label": `Respuestas de ${j.nombre}` }, D.emojisJugador(d, i) || "—"),
    )));
  }

  function vistaPreparar() {
    const hueco = D.huecoActual(d);
    const j = d.jugadores[hueco.jugador];
    const rival = d.jugadores[1 - hueco.jugador];
    const q = app.indice.porId.get(hueco.pregunta);
    const jugable = q && S.jugable(q, app.solo.opciones);
    const cambio = D.cambioDeJugador(d);
    const minimo = S.puntosAcierto(app.config, hueco.nivel, 1);
    const maximo = S.puntosAcierto(app.config, hueco.nivel, app.config.solo.multiplicador_max);
    return [
      cambio ? h("section", { class: "duelo-pasar centrado" }, h("h2", {}, `Pasa el móvil a ${j.nombre}`)) : null,
      h("section", { class: "tarjeta columna", style: estiloCat(app, hueco.tema) },
        h("p", { class: "titulo-seccion" }, `Vuelta ${hueco.vuelta} de ${D.vueltasDe(d)} · pregunta ${d.paso + 1} de ${D.huecosDe(d)}`),
        h("p", {}, `Turno de ${j.nombre}`),
        h("p", {}, hueco.papel === "rival" ? `Fácil, del tema de ${rival.nombre}` : "Difícil, de tu tema"),
        h("div", { class: "meta-linea duelo-meta" }, etiquetaCat(app, hueco.tema, q?.subtema), h("span", { class: "nivel-chip", style: estiloCat(app, hueco.tema) }, String(hueco.nivel))),
        jugable ? h("p", { class: "texto-suave pequeno" }, `Tienes ${S.segundosPregunta(app.config, q, hueco.nivel)} s. Vale entre ${numero(minimo)} y ${numero(maximo)} puntos.`) : h("p", { class: "nota" }, "El banco ha cambiado. Buscaremos una sustituta al empezar."),
        h("p", { class: "texto-suave pequeno" }, "El tiempo empieza al ver la pregunta. Fallar no resta puntos."),
      ),
      h("div", { class: "columna acciones-fijas" }, h("button", {
        class: "boton boton-primario boton-grande boton-ancho duelo-ver",
        onClick: empezarPregunta,
      }, cambio ? `Soy ${j.nombre}: ver la pregunta` : "Ver la pregunta")),
    ];
  }

  function bloqueTiempo() {
    const { segundos, multiplicador_max: maximo } = d.actual.reglas;
    const cifra = h("span", { class: "reloj-cifra" });
    const mult = h("span", { class: "multiplicador" });
    const relleno = h("span");
    const caja = h("div", { class: "reloj", role: "timer" }, cifra, h("span", { class: "reloj-barra" }, relleno), mult);
    let ultimoGuardado = d.consumido ?? 0;
    const pintarTiempo = () => {
      if (!vigente() || bloqueo || d.fase !== "pregunta") return false;
      const ms = S.transcurrido(d, Date.now(), msSesion());
      const queda = Math.max(0, segundos - ms / 1000);
      cifra.textContent = `${Math.ceil(queda)} s`;
      mult.textContent = multiplicador(S.multiplicador(ms, segundos, maximo));
      relleno.style.width = `${queda / segundos * 100}%`;
      if (!ocupado && ms - ultimoGuardado >= 1000) {
        try {
          guardar({ ...d, consumido: ms });
          ultimoGuardado = ms;
        } catch (err) {
          bloqueo = err.message;
          queueMicrotask(pintar);
          return false;
        }
      }
      if (queda > 0) return true;
      caja.classList.add("agotado");
      queueMicrotask(() => responder({ acierto: false }));
      return false;
    };
    if (pintarTiempo()) {
      const id = setInterval(() => {
        if (!caja.isConnected || !pintarTiempo()) clearInterval(id);
      }, 100);
    }
    return caja;
  }

  // Las reglas de la foto también mandan al dibujar la zona de acierto tras actualizar la configuración.
  function appDeFoto(q) {
    return {
      ...app,
      config: {
        ...app.config,
        mapa: { ...app.config.mapa, acierto_fraccion: q.reglas?.acierto_fraccion ?? app.config.mapa.acierto_fraccion ?? 0.75 },
      },
    };
  }

  function senalar(q) {
    if (!mapa.punto) return;
    const { lat, lon } = mapa.punto;
    const distancia = distanciaKm({ lat, lon }, q);
    const redondear = (n) => Math.round(n * 10000) / 10000;
    responder({
      acierto: aciertoMapa(distancia, q.distancia_max_km, q.reglas.acierto_fraccion),
      senal: { lat: redondear(lat), lon: redondear(lon), distancia_km: Math.round(distancia) },
    });
  }

  function vistaPregunta() {
    const q = d.actual;
    if (D.tiempoAgotado(d, Date.now(), msSesion())) {
      queueMicrotask(() => responder({ acierto: false }));
      return h("p", { class: "cargando" }, "Se ha acabado el tiempo…");
    }
    const hueco = D.huecoActual(d);
    const cabeza = [
      h("div", { class: "meta-linea duelo-meta" }, etiquetaCat(app, q.categoria, q.subtema), h("span", { class: "nivel-chip", style: estiloCat(app, q.categoria) }, String(hueco.nivel))),
      bloqueTiempo(),
    ];
    if (q.tipo === "mapa") {
      const boton = h("button", {
        class: "boton boton-primario boton-grande boton-ancho",
        disabled: !mapa.punto,
        onClick: () => senalar(q),
      }, mapa.punto ? "📍 Es aquí" : "Toca el mapa para señalar");
      const m = crearMapa({
        ruta: app.config.mapa.archivo,
        vista: vistaInicialMapa(app, q),
        estado: mapa,
        alTocar: () => {
          if (!vigente() || ocupado || bloqueo || d.fase !== "pregunta") return;
          boton.disabled = false;
          boton.textContent = "📍 Es aquí";
        },
      });
      m.classList.add("mapa-juego");
      return [
        ...cabeza,
        h("section", { class: "tarjeta tarjeta-cat", style: estiloCat(app, q.categoria) },
          h("p", { class: "texto-pregunta reducido" }, q.pregunta),
          h("p", { class: "texto-suave pequeno" }, `Aciertas si señalas a menos de ${formatoKm(radioAciertoKm(appDeFoto(q), q))} del sitio.`),
        ),
        m,
        h("div", { class: "columna acciones-fijas" }, boton),
      ];
    }
    return [
      ...cabeza,
      h("section", { class: "tarjeta tarjeta-cat", style: estiloCat(app, q.categoria) }, h("p", { class: "texto-pregunta solo" }, q.pregunta)),
      h("div", { class: "opciones-solo", role: "group", "aria-label": "Opciones" }, d.orden.map((texto) => h("button", {
        class: "opcion",
        onClick: () => responder({ acierto: texto === q.correcta, elegida: texto }),
      }, texto))),
    ];
  }

  function detalleRespuesta(r) {
    const q = r.q;
    const motivo = (app.config.motivos_mala ?? []).find((m) => m.id === r.mala)?.nombre ?? r.mala;
    // El aviso va en la tarjeta de la pregunta, no en el bloque fijo de abajo: así no tapa las opciones ni el mapa.
    const tarjeta = h("section", { class: "tarjeta tarjeta-cat columna", style: estiloCat(app, q.categoria) },
      h("p", { class: "texto-pregunta reducido" }, q.pregunta),
      q.explicacion ? h("p", { class: "texto-suave pequeno" }, q.explicacion) : null,
      h("button", { class: "boton-texto aviso-fallo", onClick: avisarPregunta }, r.mala ? `⚑ Avisado: ${motivo} · cambiar` : "⚑ Avisar de un fallo en la pregunta"),
    );
    if (q.tipo === "mapa") {
      const fotoApp = appDeFoto(q);
      const radio = radioAciertoKm(fotoApp, q);
      if (mapaResultado?.paso !== r.paso) {
        mapaResultado = { paso: r.paso, estado: { punto: r.mapa ? { lat: r.mapa.lat, lon: r.mapa.lon } : null, vb: null } };
      }
      const m = r.mapa ? mapaRespondido(fotoApp, q, mapaResultado.estado) : crearMapa({
        ruta: app.config.mapa.archivo,
        vista: vistaInicialMapa(app, q),
        estado: mapaResultado.estado,
        correcta: { lat: q.lat, lon: q.lon, radioKm: radio },
      });
      return [
        tarjeta,
        m,
        h("p", { class: "mapa-leyenda texto-suave pequeno" },
          r.mapa ? h("span", {}, `Señalado: a ${formatoKm(r.mapa.distancia_km)}`) : null,
          h("span", { class: "correcta" }, `${q.respuesta} · zona de acierto: ${formatoKm(radio)}`),
        ),
      ];
    }
    return [
      tarjeta,
      d.orden ? h("div", { class: "opciones-solo resueltas", role: "list", "aria-label": "Opciones" }, d.orden.map((texto) => h("div", {
        class: texto === q.correcta ? "opcion correcta" : texto === r.elegida ? "opcion elegida-mal" : "opcion",
        role: "listitem",
      }, texto === q.correcta ? "✓ " : texto === r.elegida ? "✗ " : "", texto))) : h("p", { class: "respuesta-solo" }, "Respuesta: ", h("strong", {}, q.correcta)),
    ];
  }

  function vistaResultado() {
    const r = d.resultados[d.resultados.length - 1];
    return [
      h("section", { class: `resultado ${r.acierto ? "acierto" : "fallo"}`, role: "status" },
        h("h2", {}, r.acierto ? `+${numero(r.puntos)} puntos` : r.agotado ? "¡Se acabó el tiempo!" : "Fallo"),
        h("p", {}, r.acierto ? `${multiplicador(r.multiplicador)} por responder en ${(r.ms / 1000).toFixed(1).replace(".", ",")} s` : "No sumas, pero no pierdes puntos."),
      ),
      ...detalleRespuesta(r),
      h("div", { class: "columna acciones-fijas valorar-solo" },
        h("p", { class: "titulo-valorar" }, `Para un nivel ${r.q.nivelEfectivo ?? r.q.nivel}, ¿qué te ha parecido?`),
        h("div", { class: "grupo-opciones", role: "group", "aria-label": "Dificultad de la pregunta" },
          [["facil", "Más fácil"], ["justa", "Bien así"], ["dificil", "Más difícil"]].map(([valor, texto]) => h("button", {
            class: "boton boton-primario",
            onClick: () => continuar(valor),
          }, texto)),
        ),
        h("button", { class: "boton-texto", onClick: () => continuar() }, d.final ? "Ver el resultado sin opinar" : "Seguir sin opinar"),
      ),
    ];
  }

  function vistaFin() {
    const ganador = D.ganador(d);
    const titulo = d.final === "abandonado" ? "Duelo abandonado" : ganador === null ? "¡Empate!" : `¡Gana ${d.jugadores[ganador].nombre}! 🏆`;
    return h("section", { class: "pantalla-pasar duelo-fin" },
      h("h2", {}, titulo),
      marcador(true),
      h("button", { class: "boton boton-primario boton-grande boton-ancho", onClick: compartirResultado }, "Compartir resultado"),
      h("button", { class: "boton boton-ancho", onClick: revancha }, "Revancha"),
      h("p", { class: "texto-suave pequeno" }, "Mismos temas; empieza el otro."),
      h("button", { class: "boton boton-ancho", onClick: volverAlMenu }, "Volver"),
    );
  }

  function vistaBloqueo() {
    return h("section", { class: "pantalla-pasar" },
      h("h2", {}, "Algo ha fallado"),
      h("p", { class: "texto-suave" }, bloqueo),
      h("p", { class: "texto-suave pequeno" }, "No avanzaremos sin guardar. Si falta espacio en el móvil, libera un poco y reintenta."),
      h("button", {
        class: "boton boton-primario boton-ancho",
        onClick: () => {
          if (ocupado || !vigente()) return;
          bloqueo = null;
          accion(async () => {
            if (pendiente) guardar(pendiente);
            await recuperar();
          })();
        },
      }, "Reintentar"),
    );
  }

  function pintar() {
    if (!vigente()) return;
    const vista = bloqueo ? vistaBloqueo : { preparar: vistaPreparar, pregunta: vistaPregunta, resultado: vistaResultado, fin: vistaFin }[d.fase];
    montarPantalla(
      `duelo|${d.id}|${d.paso}|${bloqueo ? "bloqueo" : d.fase}`,
      cabecera(tituloDuelo(d), volverAlMenu),
      d.fase !== "fin" ? marcador() : null,
      vista(),
    );
  }

  if (d.fase === "pregunta" && relojSesion?.clave !== claveReloj()) {
    relojSesion = { clave: claveReloj(), perf: performance.now(), base: S.transcurrido(d, Date.now()) };
  }
  // También recupera las respuestas y el historial si se cerró la app en el último resultado.
  pintar();
  accion(recuperar)();
}

// ---------------------------------------------------------------- compartir y envío

async function compartir(app, d) {
  const url = /^https?:/.test(location.protocol) ? `${location.origin}${location.pathname}` : null;
  let texto = D.textoCompartir(d, { nombreApp: app.config.nombre, nombreTema: (tema) => app.nombreCategoria(tema), url });
  if (d.final === "abandonado") {
    const lineas = texto.split("\n");
    lineas[lineas.length - (url ? 2 : 1)] = "Duelo abandonado";
    texto = lineas.join("\n");
  }
  try {
    if (navigator.share) {
      await navigator.share({ text: texto });
      return;
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(texto);
    aviso("Copiado: pégalo en el grupo.");
  } catch {
    await dialogo("Vuestro resultado", (cerrar) => [
      h("pre", { class: "texto-compartir" }, texto),
      h("button", { class: "boton boton-ancho", onClick: () => cerrar() }, "Cerrar"),
    ]);
  }
}

let preguntandoEnvio = false;

export async function decidirEnvioDuelo(app) {
  if (!app.urlEnvio() || preguntandoEnvio) return;
  preguntandoEnvio = true;
  try {
    let si = app.almacen.preferencia("envioDuelo", null);
    if (si === null) {
      si = await preguntarEnvio(
        "¿Enviamos vuestros duelos?",
        "Sirven para ajustar el nivel de las preguntas de cada tema, sobre todo vuestras opiniones. Se envían vuestras respuestas, vuestras opiniones y los puntos, con vuestros nombres, a la hoja de cálculo del grupo. Nada más. Se recordará para los siguientes (lo podéis cambiar en «Datos y exportación»).",
      );
      if (si === undefined) return;
      comprobarGuardado(app.almacen.guardarPreferencia("envioDuelo", si), "No se ha podido recordar la decisión de envío.");
    }
    const pendientes = dueloSinDecidir(await app.almacen.todosLosRegistros(), app.almacen.decisionesRevisiones());
    if (pendientes.length) {
      comprobarGuardado(app.almacen.decidirRevisiones(pendientes.map((r) => r.id), si), "No se ha podido guardar la decisión de envío.");
    }
    if (si) app.sincronizar();
  } finally {
    preguntandoEnvio = false;
  }
}
