// Jugar solo: el reto del día y la práctica (reglas y datos en docs/modo_solo.md; la lógica, en ../solo.js).

import { rngConSemilla, rngReal, uuid } from "../azar.js";
import { aviso, cabecera, dialogo, h, montar, montarPantalla } from "../dom.js";
import { soloSinDecidir } from "../envio.js";
import { aciertoMapa, distanciaKm } from "../geo.js";
import { crearMapa } from "../mapa.js";
import * as S from "../solo.js";
import { normalizarNombre } from "../util.js";
import { MAX_CHIPS_JUGADORES, estiloCat, etiquetaCat, formatoKm, mapaRespondido, preguntarEnvio, radioAciertoKm, vistaInicialMapa } from "./comun.js";

const formatoNum = (x) => new Intl.NumberFormat("es-ES").format(x);
const formatoMult = (m) => `×${m.toFixed(2).replace(".", ",")}`;

// ---------------------------------------------------------------- datos (se cargan la primera vez)

async function cargarJSON(ruta) {
  const r = await fetch(ruta, { cache: "no-cache" });
  if (!r.ok) throw new Error(`No se ha podido descargar ${ruta} (error ${r.status}).`);
  return r.json();
}

// Las opciones de las preguntas y el calendario de retos. Solo hacen falta aquí, así que no retrasan el arranque.
// Todo o nada: con un archivo a medias, el reto de hoy saldría distinto en este móvil. Si algo falla, no se
// guarda nada y se vuelve a intentar al volver a entrar.
export async function cargarSolo(app) {
  if (app.solo) return app.solo;
  const cfg = app.config.solo;
  const archivos = [...app.config.categorias.filter((c) => c.tipo !== "mapa"), ...(app.config.temas?.lista ?? [])].map((c) => cfg.opciones + c.archivo.split("/").pop());
  const [calendario, ...listas] = await Promise.all([cargarJSON(cfg.retos), ...archivos.map(cargarJSON)]);
  if (!Array.isArray(calendario.dias)) throw new Error("El calendario de retos no tiene el formato esperado.");
  const opciones = new Map(listas.flatMap((l) => Object.entries(l.opciones ?? {})));
  app.solo = { calendario, opciones };
  return app.solo;
}

const hoy = (app) => S.fechaLocal(new Date(), app.config.solo.zona_horaria);

// ---------------------------------------------------------------- resultados guardados

// Días seguidos con el reto jugado, hasta hoy (o hasta ayer, si hoy aún no se ha jugado).
function racha(retos, fecha) {
  let n = 0;
  const d = S.diaDe(fecha);
  if (!retos[fecha]?.final) d.setDate(d.getDate() - 1);
  while (retos[S.fechaLocal(d)]?.final) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

const resumenEscalera = (e) => ({ bote: e.bote, paso: e.paso, final: e.final, emojis: S.emojis(e), titulo: e.titulo, ts: e.terminada });

// ---------------------------------------------------------------- pantalla

export async function pantallaSolo(app, params = {}) {
  const vigente = app.vigente();
  if (!app.solo) {
    montar(cabecera("Jugar solo", () => app.ir("inicio")), h("p", { class: "cargando" }, "Cargando…"));
    try {
      await cargarSolo(app);
    } catch (e) {
      if (!vigente()) return;
      return montar(
        cabecera("Jugar solo", () => app.ir("inicio")),
        h(
          "section",
          { class: "pantalla-pasar" },
          h("h2", {}, "No se ha podido cargar el reto"),
          h("p", { class: "texto-suave" }, `${e.message} La primera vez hace falta conexión; después se puede jugar sin ella.`),
          h("button", { class: "boton boton-primario boton-ancho", onClick: () => app.ir("solo", params) }, "Reintentar"),
        ),
      );
    }
    if (!vigente()) return;
  }
  const enCurso = app.almacen.escaleraSolo();
  if (enCurso && !params.menu) return pantallaEscalera(app, enCurso);
  return pantallaMenu(app);
}

function pantallaMenu(app) {
  const conocidos = app.almacen.jugadoresConocidos();
  const estado = {
    jugador: app.almacen.preferencia("jugadorSolo", null) ?? (conocidos[0] ? { clave: conocidos[0].clave, nombre: conocidos[0].nombre } : null),
    nombreNuevo: "",
    categoria: app.almacen.preferencia("practicaSolo", ""),
  };
  const retoDe = (fecha) => S.retoDelDia(fecha, { calendario: app.solo.calendario, indice: app.indice, opciones: app.solo.opciones, config: app.config });

  // El nombre escrito, si lo hay, manda sobre el chip elegido.
  function jugador() {
    const nombre = estado.nombreNuevo.trim().replace(/\s+/g, " ");
    if (normalizarNombre(nombre)) return { clave: normalizarNombre(nombre), nombre };
    return estado.jugador;
  }

  function fijarJugador() {
    const j = jugador();
    if (!j) {
      aviso("Escribe tu nombre o elige quién juega.", { error: true });
      return null;
    }
    app.almacen.guardarPreferencia("jugadorSolo", j);
    app.almacen.recordarJugadores([j], new Date().toISOString());
    return j;
  }

  function empezar(modo) {
    const j = fijarJugador();
    if (!j) return;
    const otra = app.almacen.escaleraSolo();
    if (otra) return aviso(`Antes, termina la escalera de ${otra.jugador.nombre}.`, { error: true });
    // La fecha, ahora: con el menú abierto desde antes de medianoche, el reto ya es el del día nuevo.
    const fecha = hoy(app);
    const reto = retoDe(fecha);
    let preguntas;
    let datos;
    if (modo === "reto") {
      if (!reto) return aviso("No se ha podido preparar el reto de hoy.", { error: true });
      if (app.almacen.retosSoloDe(j.clave)[fecha]) return aviso("Ya has jugado el reto de hoy. ¡Mañana, otro!", { error: true });
      preguntas = reto.preguntas;
      datos = { fecha, titulo: reto.titulo, tema: reto.tema, origen: reto.origen };
    } else {
      app.almacen.guardarPreferencia("practicaSolo", estado.categoria);
      preguntas = S.escaleraPractica({
        indice: app.indice,
        opciones: app.solo.opciones,
        config: app.config,
        categoria: estado.categoria || null,
        vistas: app.almacen.vistasDe(j.clave),
        reservadas: S.reservadasParaPractica(fecha, { calendario: app.solo.calendario, indice: app.indice, opciones: app.solo.opciones, config: app.config }),
        rng: rngReal(),
      });
      if (!preguntas) return aviso("No hay preguntas suficientes para practicar con esta categoría.", { error: true });
      datos = { fecha, categoria: estado.categoria || null };
    }
    const e = S.nuevaEscalera({ id: uuid(), modo, preguntas, jugador: j, ahora: new Date().toISOString(), versiones: app.versiones, ...datos });
    app.almacen.guardarEscaleraSolo(e);
    pantallaEscalera(app, e);
  }

  // Lo que depende de quién juega: el reto de hoy (por jugar, o su resultado), la racha y las mejores marcas.
  function tarjetaReto() {
    const j = jugador();
    const fecha = hoy(app);
    const reto = retoDe(fecha);
    const retos = j ? app.almacen.retosSoloDe(j.clave) : {};
    const jugado = retos[fecha];
    const mejorReto = Math.max(0, ...Object.values(retos).map((r) => r.bote ?? 0));
    const n = racha(retos, fecha);
    return [
      h("p", { class: "titulo-seccion" }, `Reto del ${S.fechaLegible(fecha, { conDia: true })}`),
      reto?.titulo ? h("p", { class: "titulo-tematico" }, reto.titulo) : h("p", { class: "texto-suave pequeno" }, "Mezcla de categorías. Las mismas preguntas para todos los que jueguen hoy."),
      jugado?.final
        ? [
            h("p", { class: "emojis-reto", "aria-label": "Tu resultado" }, jugado.emojis),
            h("p", { class: "centrado" }, h("strong", {}, S.frasePuntos(jugado))),
            h("button", { class: "boton boton-ancho", onClick: () => compartir(app, { ...jugado, modo: "reto", fecha }) }, "Compartir resultado"),
            h("p", { class: "texto-suave pequeno centrado" }, "Mañana, otro reto."),
          ]
        : jugado
          ? h("p", { class: "texto-suave pequeno" }, "Ya lo has empezado: continúa tu escalera.")
          : h("button", { class: "boton boton-primario boton-grande boton-ancho", disabled: !reto, onClick: () => empezar("reto") }, "Jugar el reto de hoy"),
      j ? h("p", { class: "texto-suave pequeno" }, `Racha: ${n} ${n === 1 ? "día" : "días"} · Tu mejor reto: ${formatoNum(mejorReto)} puntos`) : null,
    ];
  }

  function pintar() {
    const j = jugador();
    const opciones = conocidos.slice(0, MAX_CHIPS_JUGADORES);
    if (estado.jugador && !opciones.some((x) => x.clave === estado.jugador.clave)) opciones.unshift(estado.jugador);
    const practica = j ? app.almacen.practicaSoloDe(j.clave) : {};
    const enCurso = app.almacen.escaleraSolo();
    const temas = (app.config.temas?.lista ?? []).filter((t) => [...app.indice.porId.values()].some((q) => q.categoria === t.id && S.jugable(q, app.solo.opciones)));
    const zonaReto = h("section", { class: "tarjeta columna tarjeta-reto" }, tarjetaReto());

    montarPantalla(
      `solo-menu|${j?.clave ?? ""}`,
      cabecera("Jugar solo", () => app.ir("inicio")),
      h(
        "p",
        { class: "texto-suave" },
        "Una escalera de 10 preguntas, del nivel 1 al 10, con 8 opciones. Cada acierto suma al bote 10 × su nivel, y hasta el doble si respondes rápido. Si fallas, lo pierdes todo: antes de cada pregunta puedes plantarte.",
      ),
      enCurso
        ? h(
            "section",
            { class: "nota columna" },
            h(
              "p",
              {},
              `${enCurso.jugador.nombre} tiene una escalera a medias (escalón ${enCurso.fase === "resultado" ? enCurso.paso : Math.min(enCurso.paso + 1, S.PASOS)}, bote ${formatoNum(enCurso.bote)}).`,
            ),
            h("button", { class: "boton boton-primario boton-ancho", onClick: () => app.ir("solo") }, "Continuarla"),
          )
        : null,
      h("p", { class: "titulo-seccion" }, "¿Quién juega?"),
      opciones.length
        ? h(
            "div",
            { class: "chips" },
            opciones.map((x) =>
              h(
                "button",
                {
                  class: "chip chip-jugador",
                  "aria-pressed": String(!estado.nombreNuevo.trim() && estado.jugador?.clave === x.clave),
                  onClick: () => {
                    estado.jugador = { clave: x.clave, nombre: x.nombre };
                    estado.nombreNuevo = "";
                    pintar();
                  },
                },
                x.nombre,
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
          "aria-label": "Nombre de quien juega",
          // Sin repintar al escribir ni al salir del campo: en el móvil, el toque en «Jugar» que cierra el
          // teclado se perdería con la pantalla nueva. El nombre escrito se usa al tocar el botón.
          onInput: (ev) => {
            estado.nombreNuevo = ev.target.value;
            zonaReto.replaceChildren(...tarjetaReto().flat().filter(Boolean));
          },
        }),
      ),
      zonaReto,
      h(
        "section",
        { class: "tarjeta columna" },
        h("p", { class: "titulo-seccion" }, "Práctica"),
        h("p", { class: "texto-suave pequeno" }, "Todas las escaleras que quieras, con preguntas al azar. Nunca te saldrán preguntas de los próximos retos."),
        h(
          "select",
          { "aria-label": "Categoría de la práctica", onChange: (ev) => (estado.categoria = ev.target.value) },
          h("option", { value: "" }, "Todas las categorías"),
          app.config.categorias.map((c) => h("option", { value: c.id, selected: estado.categoria === c.id }, c.nombre)),
          temas.length ? h("optgroup", { label: "Temas" }, temas.map((t) => h("option", { value: t.id, selected: estado.categoria === t.id }, t.nombre))) : null,
        ),
        h("button", { class: "boton boton-ancho", onClick: () => empezar("practica") }, "Practicar"),
        practica.mejor ? h("p", { class: "texto-suave pequeno" }, `Tu mejor práctica: ${formatoNum(practica.mejor)} puntos (${practica.escaleras} ${practica.escaleras === 1 ? "escalera" : "escaleras"})`) : null,
      ),
      h("button", { class: "boton-texto", onClick: () => app.ir("reglas", { volverA: "solo" }) }, "Cómo se juega"),
    );
  }
  pintar();
}

// ---------------------------------------------------------------- la escalera
// Cada cambio se guarda antes de enseñarlo. Los registros tienen id fijo (solo.js): se vuelven a guardar al
// retomar la escalera, por si el último no llegó a escribirse, sin duplicarse. La escalera terminada no se borra
// hasta que su registro final y su resumen están guardados.

// Reloj monotónico de la sesión para la pregunta en pantalla: si el reloj del móvil se atrasa, no regala tiempo.
let relojSesion = null; // { clave, perf }

function pantallaEscalera(app, inicial) {
  let e = inicial;
  const vigente = app.vigente(); // al navegar a otra pantalla, este controlador deja de pintar y de guardar
  const mapa = { punto: null, vb: null };
  let ocupado = false; // una acción a medias: los toques que lleguen mientras se ignoran
  let bloqueo = null; // el error de la última acción: hasta «Reintentar», nada se hace solo

  const ctxRegistros = () => ({ dispositivo: app.almacen.dispositivo, versiones: app.versiones });
  const claveReloj = () => `${e.id}|${e.paso}`;

  function guardar(nueva) {
    // Si otra pantalla (otra pestaña, o este mismo móvil tras volver al menú) ya tiene otra escalera, no se pisa.
    const guardada = app.almacen.escaleraSolo();
    if (guardada && guardada.id !== nueva.id) throw new Error("Hay otra escalera en marcha.");
    // Primero se guarda y solo después se enseña: si no se pudiera guardar, al volver se repetiría una pregunta ya vista.
    if (!app.almacen.guardarEscaleraSolo(nueva)) throw new Error("El navegador no deja guardar la escalera (¿almacenamiento lleno?).");
    e = nueva;
  }

  async function guardarRegistros() {
    try {
      for (const r of S.registrosEscalera(e, ctxRegistros())) await app.almacen.guardarRegistro(r);
      return true;
    } catch (err) {
      aviso(`No se han podido guardar las respuestas: ${err.message}`, { error: true });
      return false;
    }
  }

  // Envuelve cada toque: uno cada vez, y nada si esta pantalla ya no es la que se ve.
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
    if (vigente()) pintar();
  };

  const siguiente = () => app.indice.porId.get(e.preguntas[e.paso]);

  const empezarPregunta = accion(async () => {
    if (e.fase !== "decidir") return;
    const q = siguiente();
    if (!q || !S.jugable(q, app.solo.opciones)) {
      // El banco ha cambiado y esta pregunta ya no se puede jugar: la escalera acaba aquí, con lo que haya.
      aviso("Esta pregunta ya no se puede jugar (el banco se ha actualizado): la escalera termina aquí.", { error: true, ms: 6000 });
      guardar(e.paso ? S.plantarse(e, { ts: new Date().toISOString() }) : { ...e, fase: "fin", final: "fallo", terminada: new Date().toISOString() });
      return terminar();
    }
    const rng = e.modo === "reto" ? rngConSemilla(S.semilla(`${e.fecha}|${q.id}`)) : rngReal();
    const orden = q.tipo === "mapa" ? null : S.ordenOpciones(q, app.solo.opciones, rng);
    const foto = { ...S.fotoPregunta(q, app.solo.opciones, app.config, e.paso + 1), versiones: app.versiones };
    guardar(S.empezarPregunta(e, { ahoraMs: Date.now(), foto, orden }));
    // El reto cuenta como jugado desde que se ve su primera pregunta: cerrar la app no deja repetirlo.
    if (e.modo === "reto" && e.paso === 0) app.almacen.guardarRetoSolo(e.jugador.clave, e.fecha, { empezado: new Date().toISOString() });
    relojSesion = { clave: claveReloj(), perf: performance.now(), base: 0 };
    // Vista desde ya: no saldrá en una partida mientras queden otras.
    app.almacen.marcarVistas([[e.jugador.clave, q.id]], new Date().toISOString());
    mapa.punto = null;
    mapa.vb = null;
  });

  const msSesion = () => (relojSesion?.clave === claveReloj() ? relojSesion.base + performance.now() - relojSesion.perf : 0);

  const responder = accion(async ({ acierto, elegida = null, senal = null }) => {
    if (e.fase !== "pregunta") return;
    const ms = S.transcurrido(e, Date.now(), msSesion());
    guardar(S.responderPregunta(e, { config: app.config, acierto, ms, ts: new Date().toISOString(), elegida, mapa: senal }));
    await guardarRegistros();
    // Con la pregunta que acaba la escalera ya está guardado su final: si se aceptó enviar las partidas a solas,
    // sale ya, por si se cierra la app sin tocar «Ver el resultado».
    if (e.final) app.sincronizar();
  });

  // Opinión (opcional) sobre la dificultad de la pregunta cuyo resultado se está viendo; tocar la misma la quita.
  const valorar = accion(async (valor) => {
    if (e.fase !== "resultado") return;
    const actual = e.resultados[e.resultados.length - 1].valoracion ?? null;
    guardar(S.valorarUltima(e, actual === valor ? null : valor));
  });

  const plantarse = accion(async () => {
    if (e.fase !== "decidir" || !e.paso) return;
    guardar(S.plantarse(e, { ts: new Date().toISOString() }));
    await terminar();
  });

  const continuar = accion(async () => {
    if (e.fase !== "resultado") return;
    guardar(S.seguir(e, { ts: new Date().toISOString() }));
    if (e.fase === "fin") await terminar();
    // La opinión sobre la pregunta que se deja atrás ya no cambia: se guarda su registro.
    else if (e.resultados[e.resultados.length - 1]?.valoracion) await guardarRegistros();
  });

  // Registro final, resumen y, solo entonces, se borra la escalera. Se puede repetir sin duplicar nada: si se
  // cerró la app a medias, se completa al volver.
  async function terminar() {
    if (!(await guardarRegistros()) || !vigente()) return; // si ya no se ve, se completa al volver
    const clave = e.jugador.clave;
    if (e.modo === "reto") app.almacen.guardarRetoSolo(clave, e.fecha, resumenEscalera(e));
    else {
      // Las últimas escaleras contadas: una que se cierre dos veces cuenta una sola.
      const p = app.almacen.practicaSoloDe(clave);
      const cerradas = Array.isArray(p.cerradas) ? p.cerradas : [];
      if (!cerradas.includes(e.id)) {
        app.almacen.guardarPracticaSolo(clave, { mejor: Math.max(p.mejor ?? 0, e.bote), escaleras: (p.escaleras ?? 0) + 1, cerradas: [...cerradas, e.id].slice(-20) });
      }
    }
    if (app.almacen.escaleraSolo()?.id === e.id) app.almacen.guardarEscaleraSolo(null);
    decidirEnvio(app);
  }

  // ---------------------------------------------------------------- vistas

  function vistaBloqueo() {
    return h(
      "section",
      { class: "pantalla-pasar" },
      h("h2", {}, "Algo ha fallado"),
      h("p", { class: "texto-suave" }, bloqueo),
      h("p", { class: "texto-suave pequeno" }, "La escalera sigue guardada como estaba. Si el problema es el espacio del móvil, libera un poco y reintenta."),
      h(
        "button",
        {
          class: "boton boton-primario boton-ancho",
          onClick: () => {
            bloqueo = null;
            pintar();
          },
        },
        "Reintentar",
      ),
    );
  }

  function pintar() {
    if (!vigente()) return;
    const vista = bloqueo ? vistaBloqueo : { decidir: vistaDecidir, pregunta: vistaPregunta, resultado: vistaResultado, fin: vistaFin }[e.fase];
    montarPantalla(
      `solo|${e.id}|${e.paso}|${bloqueo ? "bloqueo" : e.fase}`,
      cabecera(e.modo === "reto" ? `Reto del ${S.fechaLegible(e.fecha)}` : "Práctica", () => app.ir("solo", { menu: true })),
      vista(),
    );
  }

  const peldanos = () =>
    h(
      "ol",
      { class: "escalera", "aria-label": `Escalón ${Math.min(e.paso + 1, S.PASOS)} de ${S.PASOS}` },
      Array.from({ length: S.PASOS }, (_, i) => {
        const r = e.resultados[i];
        const actual = !r && i === e.paso && !e.final;
        const clase = r ? (r.acierto ? "hecho" : "fallado") : actual ? "actual" : "";
        return h("li", { class: `peldano ${clase}`, title: r ? `Nivel ${i + 1}: ${r.acierto ? `+${r.puntos}` : "fallo"}` : `Nivel ${i + 1}` }, String(i + 1));
      }),
    );

  const bote = () => h("p", { class: "bote" }, h("span", {}, "Bote"), h("strong", {}, formatoNum(e.bote)));

  function vistaDecidir() {
    const q = siguiente();
    const nivel = e.paso + 1;
    const segundos = q ? S.segundosPregunta(app.config, q, nivel) : null;
    const maximo = S.puntosAcierto(app.config, nivel, app.config.solo.multiplicador_max);
    const minimo = S.puntosAcierto(app.config, nivel, 1);
    return [
      peldanos(),
      bote(),
      h(
        "section",
        { class: "tarjeta columna", style: q ? estiloCat(app, q.categoria) : null },
        h("p", { class: "titulo-seccion" }, `Escalón ${nivel}: pregunta de nivel ${nivel}`),
        q ? h("div", { class: "meta-linea" }, etiquetaCat(app, q.categoria, q.subtema), q.tipo === "mapa" ? h("span", { class: "texto-suave pequeno" }, "🗺 en el mapa") : null) : null,
        segundos ? h("p", { class: "texto-suave pequeno" }, `Tienes ${segundos} s. Vale entre ${formatoNum(minimo)} y ${formatoNum(maximo)} puntos: más cuanto antes respondas.`) : null,
        e.paso
          ? h("p", { class: "texto-suave pequeno" }, `Si fallas, pierdes los ${formatoNum(e.bote)} del bote. Si te plantas, te los quedas.`)
          : h("p", { class: "texto-suave pequeno" }, "El tiempo empieza al tocar el botón."),
      ),
      h(
        "div",
        { class: "columna acciones-fijas" },
        h("button", { class: "boton boton-primario boton-grande boton-ancho", onClick: () => empezarPregunta() }, e.paso ? "Seguir: ver la pregunta" : "Empezar"),
        e.paso ? h("button", { class: "boton boton-ok boton-ancho", onClick: () => plantarse() }, `Plantarme con ${formatoNum(e.bote)}`) : null,
      ),
    ];
  }

  // El tiempo: la barra, los segundos y el multiplicador, que bajan solos; al acabar, cuenta como fallo. Lo
  // consumido se guarda cada segundo: si el reloj del móvil se atrasa con la app cerrada, no se recupera.
  function bloqueTiempo() {
    const { segundos, multiplicador_max: maximo } = S.reglasDe(e, app.config);
    const cifra = h("span", { class: "reloj-cifra" });
    const mult = h("span", { class: "multiplicador" });
    const relleno = h("span");
    const caja = h("div", { class: "reloj", role: "timer" }, cifra, h("span", { class: "reloj-barra" }, relleno), mult);
    let ultimoGuardado = 0;
    const pintarTiempo = () => {
      const ms = S.transcurrido(e, Date.now(), msSesion());
      const queda = Math.max(0, segundos - ms / 1000);
      cifra.textContent = `${Math.ceil(queda)} s`;
      mult.textContent = formatoMult(S.multiplicador(ms, segundos, maximo));
      relleno.style.width = `${(queda / segundos) * 100}%`;
      if (ms - ultimoGuardado >= 1000 && e.fase === "pregunta" && vigente() && app.almacen.escaleraSolo()?.id === e.id) {
        ultimoGuardado = ms;
        const nueva = { ...e, consumido: ms };
        if (app.almacen.guardarEscaleraSolo(nueva)) e = nueva;
      }
      if (queda > 0) return true;
      caja.classList.add("agotado");
      responder({ acierto: false });
      return false;
    };
    if (pintarTiempo()) {
      const id = setInterval(() => {
        if (!caja.isConnected || e.fase !== "pregunta" || !pintarTiempo()) clearInterval(id);
      }, 100);
    }
    return caja;
  }

  function vistaPregunta() {
    const q = e.actual;
    // Se ha vuelto a la app después de agotarse el tiempo: es un fallo.
    if (S.tiempoAgotado(e, app.config, Date.now(), msSesion())) {
      queueMicrotask(() => responder({ acierto: false }));
      return h("p", { class: "cargando" }, "Se ha acabado el tiempo…");
    }
    const cabeza = [
      h("div", { class: "meta-linea" }, etiquetaCat(app, q.categoria, q.subtema), h("span", { class: "nivel-chip", style: estiloCat(app, q.categoria) }, String(e.paso + 1))),
      bloqueTiempo(),
    ];
    if (q.tipo === "mapa") {
      const confirmarBtn = h(
        "button",
        { class: "boton boton-primario boton-grande boton-ancho", disabled: !mapa.punto, onClick: () => mapa.punto && senalar(q) },
        mapa.punto ? "📍 Es aquí" : "Toca el mapa para señalar",
      );
      const m = crearMapa({
        ruta: app.config.mapa.archivo,
        vista: vistaInicialMapa(app, q),
        estado: mapa,
        alTocar: () => {
          confirmarBtn.disabled = false;
          confirmarBtn.textContent = "📍 Es aquí";
        },
      });
      m.classList.add("mapa-juego");
      return [
        ...cabeza,
        h(
          "section",
          { class: "tarjeta tarjeta-cat", style: estiloCat(app, q.categoria) },
          h("p", { class: "texto-pregunta reducido" }, q.pregunta),
          h("p", { class: "texto-suave pequeno" }, `Aciertas si señalas a menos de ${formatoKm(radioAciertoKm(app, q))} del sitio.`),
        ),
        m,
        h("div", { class: "columna acciones-fijas" }, confirmarBtn),
      ];
    }
    return [
      ...cabeza,
      h("section", { class: "tarjeta tarjeta-cat", style: estiloCat(app, q.categoria) }, h("p", { class: "texto-pregunta solo" }, q.pregunta)),
      h(
        "div",
        { class: "opciones-solo", role: "group", "aria-label": "Opciones" },
        e.orden.map((texto) => h("button", { class: "opcion", onClick: () => responder({ acierto: texto === q.correcta, elegida: texto }) }, texto)),
      ),
    ];
  }

  function senalar(q) {
    const { lat, lon } = mapa.punto;
    const distancia = distanciaKm({ lat, lon }, q);
    const redondear = (x) => Math.round(x * 10000) / 10000;
    const senal = { lat: redondear(lat), lon: redondear(lon), distancia_km: Math.round(distancia) };
    responder({ acierto: aciertoMapa(distancia, q.distancia_max_km, q.reglas?.acierto_fraccion ?? app.config.mapa.acierto_fraccion ?? 0.75), senal });
  }

  function titularResultado(r) {
    if (r.acierto) return [h("h2", {}, `+${formatoNum(r.puntos)} puntos`), h("p", {}, `${formatoMult(r.multiplicador)} por responder en ${(r.ms / 1000).toFixed(1).replace(".", ",")} s`)];
    if (r.agotado) return [h("h2", {}, "¡Se acabó el tiempo!"), h("p", {}, "Pierdes el bote.")];
    return [h("h2", {}, "Fallo"), h("p", {}, "Pierdes el bote.")];
  }

  function detalleRespuesta(r) {
    const q = r.q;
    if (q.tipo === "mapa") {
      const radio = radioAciertoKm(app, q);
      return [
        h("section", { class: "tarjeta tarjeta-cat", style: estiloCat(app, q.categoria) }, h("p", { class: "texto-pregunta reducido" }, q.pregunta), q.explicacion ? h("p", { class: "texto-suave pequeno" }, q.explicacion) : null),
        r.mapa ? mapaRespondido(app, q, { punto: { lat: r.mapa.lat, lon: r.mapa.lon }, vb: null }) : null,
        h(
          "p",
          { class: "mapa-leyenda texto-suave pequeno" },
          r.mapa ? h("span", {}, `Señalado: a ${formatoKm(r.mapa.distancia_km)}`) : null,
          h("span", { class: "correcta" }, `${q.respuesta} · zona de acierto: ${formatoKm(radio)}`),
        ),
      ];
    }
    // Las 8 opciones, como estaban: la correcta en verde y, si se eligió otra, esa en rojo.
    const clase = (texto) => (texto === q.correcta ? "opcion correcta" : texto === r.elegida ? "opcion elegida-mal" : "opcion");
    return [
      h(
        "section",
        { class: "tarjeta tarjeta-cat", style: estiloCat(app, q.categoria) },
        h("p", { class: "texto-pregunta reducido" }, q.pregunta),
        q.explicacion ? h("p", { class: "texto-suave pequeno", style: { "margin-top": "10px" } }, q.explicacion) : null,
      ),
      e.orden
        ? h(
            "div",
            { class: "opciones-solo resueltas", role: "list", "aria-label": "Opciones" },
            e.orden.map((texto) => h("div", { class: clase(texto), role: "listitem" }, texto === q.correcta ? "✓ " : texto === r.elegida ? "✗ " : "", texto)),
          )
        : h("p", { class: "respuesta-solo" }, "Respuesta: ", h("strong", {}, q.correcta)),
    ];
  }

  function vistaResultado() {
    const r = e.resultados[e.resultados.length - 1];
    return [
      peldanos(),
      h("section", { class: `resultado ${r.acierto ? "acierto" : "fallo"}`, role: "status" }, ...titularResultado(r)),
      bote(),
      ...detalleRespuesta(r),
      h(
        "section",
        { class: "valorar-solo" },
        h("p", { class: "texto-suave pequeno" }, `¿Te ha parecido de nivel ${r.nivel}? (opcional)`),
        h(
          "div",
          { class: "grupo-opciones", role: "group", "aria-label": "Dificultad de la pregunta" },
          [["facil", "Más fácil"], ["justa", "Sí"], ["dificil", "Más difícil"]].map(([valor, texto]) =>
            h("button", { class: "boton", "aria-pressed": String(r.valoracion === valor), onClick: () => valorar(valor) }, texto),
          ),
        ),
      ),
      h(
        "div",
        { class: "columna acciones-fijas" },
        h("button", { class: "boton boton-primario boton-grande boton-ancho", onClick: () => continuar() }, e.final ? "Ver el resultado" : "Continuar"),
      ),
    ];
  }

  function vistaFin() {
    const titulo = { completo: "¡Escalera completa! 🏆", plantado: "Te has plantado ✋", fallo: `Caíste en el escalón ${e.paso}`, tiempo: `Se acabó el tiempo en el escalón ${e.paso}` }[e.final];
    return [
      h(
        "section",
        { class: "pantalla-pasar" },
        h("h2", {}, titulo),
        h("p", { class: "bote-final" }, formatoNum(e.bote), h("span", {}, " puntos")),
        h("p", { class: "emojis-reto", "aria-label": "Resumen de la escalera" }, S.emojis(e)),
        e.titulo ? h("p", { class: "texto-suave" }, e.titulo) : null,
        e.modo === "reto"
          ? h("button", { class: "boton boton-primario boton-grande boton-ancho", onClick: () => compartir(app, e) }, "Compartir resultado")
          : h("button", { class: "boton boton-primario boton-grande boton-ancho", onClick: () => app.ir("solo", { menu: true }) }, "Otra escalera"),
        h("button", { class: "boton boton-ancho", onClick: () => app.ir("solo", { menu: true }) }, "Volver"),
      ),
    ];
  }

  // Al retomar: lo que no llegara a guardarse se guarda ahora (sin duplicar), y una escalera ya terminada se cierra.
  // Con una pregunta en pantalla, el reloj monotónico de esta sesión arranca desde lo que ya ha pasado.
  if (e.fase === "pregunta" && relojSesion?.clave !== claveReloj()) relojSesion = { clave: claveReloj(), perf: performance.now(), base: S.transcurrido(e, Date.now()) };
  if (e.fase === "fin") accion(terminar)();
  else {
    if (e.resultados.length) guardarRegistros().then(() => e.final && app.sincronizar());
    pintar();
  }
}

// ---------------------------------------------------------------- compartir y envío

async function compartir(app, e) {
  const url = /^https?:/.test(location.protocol) ? `${location.origin}${location.pathname}` : null;
  const texto = S.textoCompartir(e, { nombreApp: app.config.nombre, url });
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
    // Sin portapapeles: se enseña para copiarlo a mano.
    dialogo("Tu resultado", (cerrar) => [h("pre", { class: "texto-compartir" }, texto), h("button", { class: "boton boton-ancho", onClick: () => cerrar() }, "Cerrar")]);
  }
}

// Al acabar cada escalera: lo que haya sin decidir del modo solo se envía (o no) según la preferencia, que se
// pregunta una sola vez. Cerrar la pregunta sin contestar la deja para la siguiente escalera.
let preguntandoEnvio = false;
async function decidirEnvio(app) {
  if (!app.urlEnvio() || preguntandoEnvio) return;
  let si = app.almacen.preferencia("envioSolo", null);
  if (si === null) {
    preguntandoEnvio = true;
    si = await preguntarEnvio(
      "¿Enviamos tus partidas a solas?",
      "Sirven para ver cómo funcionan las preguntas con opciones. Se envían tus respuestas y tus puntos, con tu nombre, a la hoja de cálculo del grupo. Nada más. Se recordará para las siguientes (lo puedes cambiar en «Datos y exportación»).",
    ).finally(() => (preguntandoEnvio = false));
    if (si === undefined) return;
    app.almacen.guardarPreferencia("envioSolo", si);
  }
  const pendientes = soloSinDecidir(await app.almacen.todosLosRegistros(), app.almacen.decisionesRevisiones());
  if (pendientes.length) app.almacen.decidirRevisiones(pendientes.map((r) => r.id), si);
  if (si) app.sincronizar();
}
