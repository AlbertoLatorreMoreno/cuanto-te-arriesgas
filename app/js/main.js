// Arranque de la app: carga datos, crea el almacén y enruta entre pantallas.

import { PREFIJO, crearAlmacen, pedirAlmacenamientoPersistente } from "./almacen.js";
import { rngReal } from "./azar.js";
import { crearIndice } from "./banco.js";
import { aviso, h, montar } from "./dom.js";
import { construirExportacion, exportarArchivo, nombreArchivo } from "./exportar.js";
import { ErrorJuego, clavesEnPartida, partidaReanudable } from "./motor.js";
import { Sesion } from "./sesion.js";
import { versionBanco } from "./util.js";
import { pantallaDatos } from "./pantallas/datos.js";
import { pantallaInicio } from "./pantallas/inicio.js";
import { pantallaJuego } from "./pantallas/juego.js";
import { pantallaNueva } from "./pantallas/nueva.js";
import { pantallaReglas } from "./pantallas/reglas.js";
import { pantallaRevision } from "./pantallas/revision.js";

const VERSION = "0.1.0";

async function cargarJSON(ruta) {
  const r = await fetch(ruta, { cache: "no-cache" }).catch(() => {
    throw new Error(`No se ha podido descargar ${ruta}.`);
  });
  if (!r.ok) throw new Error(`No se ha podido descargar ${ruta} (error ${r.status}).`);
  return r.json();
}

// ---------------------------------------------------------------- pantalla encendida

let bloqueoPantalla = null;
async function mantenerPantalla(activar) {
  try {
    if (activar && !bloqueoPantalla && "wakeLock" in navigator && document.visibilityState === "visible") {
      bloqueoPantalla = await navigator.wakeLock.request("screen");
      bloqueoPantalla.addEventListener("release", () => (bloqueoPantalla = null));
    } else if (!activar && bloqueoPantalla) {
      await bloqueoPantalla.release();
      bloqueoPantalla = null;
    }
  } catch {
    // No es imprescindible: algunos navegadores no lo permiten.
  }
}

// ---------------------------------------------------------------- app

async function arrancar() {
  const config = await cargarJSON("data/config.json");
  const archivos = await Promise.all(config.categorias.map((c) => cargarJSON(c.archivo)));
  const preguntas = archivos.flatMap((a) => a.preguntas);
  const ajustes = await cargarJSON("data/ajustes.json").catch(() => null);
  // Sin el archivo de rondas se juega igual, solo con preguntas.
  const rondas = config.rondas ? await cargarJSON(config.rondas.archivo).then((d) => (Array.isArray(d.rondas) ? d.rondas : [])).catch(() => []) : [];
  // Sin el de finales propias, la final es una pregunta difícil del banco, como antes.
  const finales = config.final.archivo ? await cargarJSON(config.final.archivo).then((d) => (Array.isArray(d.finales) ? d.finales : [])).catch(() => []) : [];
  const almacen = await crearAlmacen();
  pedirAlmacenamientoPersistente();
  // Los nombres que llevan mucho sin jugar se olvidan solos (nunca sus respuestas registradas).
  almacen.olvidarInactivos({ ahora: new Date(), dias: config.jugadores.olvidar_tras_dias, protegidos: clavesEnPartida(almacen.cargarPartida()?.partida) });

  const categorias = new Map(config.categorias.map((c) => [c.id, c]));

  const app = {
    version: VERSION,
    config,
    preguntas,
    ajustes,
    rondas,
    finales,
    indice: crearIndice(preguntas, config, ajustes),
    almacen,
    versiones: { banco: versionBanco(preguntas), ajustes: ajustes?.version ?? "ninguno" },
    sesion: null,
    pantalla: "inicio",

    nombreCategoria: (id) => categorias.get(id)?.nombre ?? id,
    colorCategoria: (id) => categorias.get(id)?.color ?? "#888",
    nombreSubtema: (cat, sub) => categorias.get(cat)?.subtemas.find((s) => s.id === sub)?.nombre ?? sub,

    ctxMotor() {
      return { config, indice: app.indice, rondas, finales, rng: rngReal(), ahora: () => new Date().toISOString() };
    },

    // Cada navegación tiene un número; las pantallas que cargan datos de forma
    // asíncrona comprueban con `vigente()` que nadie ha navegado a otra mientras.
    navegacion: 0,
    vigente() {
      const n = app.navegacion;
      return () => n === app.navegacion;
    },

    ir(pantalla, params = {}) {
      app.navegacion++;
      app.pantalla = pantalla;
      mantenerPantalla(pantalla === "juego");
      if (pantalla === "juego" && history.state?.pantalla !== "juego") history.pushState({ pantalla: "juego" }, "");
      const pantallas = {
        inicio: () => pantallaInicio(app),
        nueva: () => pantallaNueva(app, params),
        juego: () => pantallaJuego(app),
        revision: () => pantallaRevision(app),
        datos: () => pantallaDatos(app, params),
        reglas: () => pantallaReglas(app, params),
      };
      // Red de seguridad: si una pantalla falla al pintarse, se avisa y se vuelve al inicio
      // en vez de dejar la app colgada en una pantalla a medio dibujar.
      const fallo = (e) => {
        console.error(e);
        aviso(`Algo ha fallado al mostrar la pantalla: ${e.message}`, { error: true });
        if (pantalla !== "inicio") app.ir("inicio");
      };
      try {
        const r = pantallas[pantalla]();
        if (r && typeof r.catch === "function") r.catch(fallo);
        return r;
      } catch (e) {
        fallo(e);
      }
    },

    iniciarPartida({ jugadores, metaId, narrador = null, cronometro = false, rondas: conRondas = false }) {
      app.sesion = Sesion.nueva({ ctx: app.ctxMotor(), almacen, dispositivo: almacen.dispositivo, versiones: app.versiones, jugadores, metaId, narrador, cronometro, rondas: conRondas });
      almacen.recordarJugadores(narrador ? [...jugadores, narrador] : jugadores, new Date().toISOString());
      app.ir("juego");
    },

    reanudar() {
      const guardada = almacen.cargarPartida();
      if (!partidaReanudable(guardada?.partida)) {
        almacen.borrarPartida();
        aviso("La partida guardada no se puede continuar (era de una versión anterior). Las respuestas ya jugadas siguen guardadas.", { error: true, ms: 6000 });
        return app.ir("inicio");
      }
      app.sesion = new Sesion({ ctx: app.ctxMotor(), almacen, dispositivo: almacen.dispositivo, versiones: app.versiones, partida: guardada.partida, pila: guardada.pila ?? [] });
      app.ir("juego");
    },

    terminarPartida() {
      almacen.borrarPartida();
      app.sesion = null;
      app.ir("inicio");
    },

    async accion(nombre, ...args) {
      try {
        await app.sesion.ejecutar(nombre, ...args);
      } catch (e) {
        aviso(e instanceof ErrorJuego ? e.message : `Algo ha fallado: ${e.message}`, { error: true });
        if (!(e instanceof ErrorJuego)) console.error(e);
      }
      if (app.sesion?.guardadoOk === false && !app.avisoSinGuardar) {
        app.avisoSinGuardar = true;
        aviso("El navegador no deja guardar la partida (¿almacenamiento lleno?). Puedes seguir jugando, pero si se cierra la app se perderá.", { error: true, ms: 7000 });
      }
      if (app.sesion?.registrosOk === false && !app.avisoSinRegistros) {
        app.avisoSinRegistros = true;
        aviso("El navegador no deja guardar las respuestas (¿almacenamiento lleno?). La partida sigue, pero estas respuestas no servirán para calibrar.", { error: true, ms: 7000 });
      }
      if (app.pantalla === "juego") app.ir("juego");
    },

    async deshacer() {
      try {
        await app.sesion.deshacer();
      } catch (e) {
        aviso(`No se pudo deshacer del todo: ${e.message}`, { error: true });
      }
      app.ir("juego");
    },

    async exportar() {
      try {
        const registros = await almacen.todosLosRegistros();
        if (!registros.length) return aviso("Todavía no hay datos que exportar.");
        const datos = construirExportacion({ registros, dispositivo: almacen.dispositivo, versiones: app.versiones });
        const resultado = await exportarArchivo(datos, nombreArchivo(almacen.dispositivo));
        if (resultado === "cancelado") return;
        almacen.guardarPreferencia("ultimaExportacion", datos.exportado);
        aviso(resultado === "compartido" ? `Compartidos ${registros.length} registros.` : `Descargados ${registros.length} registros.`);
      } catch (e) {
        aviso(`No se pudo exportar: ${e.message}`, { error: true });
      }
    },
  };

  // Botón «atrás» del móvil durante la partida: vuelve al inicio sin perder nada.
  window.addEventListener("popstate", () => {
    if (app.pantalla === "juego") {
      aviso("Partida guardada. Puedes continuarla desde el inicio.");
      app.ir("inicio");
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && app.pantalla === "juego") mantenerPantalla(true);
  });
  // La app abierta dos veces (en dos pestañas, o instalada y en el navegador): si la otra cambia la
  // partida guardada, esta deja de jugarla para no pisarla, y «Continuar» carga lo último.
  window.addEventListener("storage", (e) => {
    if ((e.key === null || e.key === PREFIJO + "partida") && app.pantalla === "juego") {
      app.sesion = null;
      aviso("La partida ha cambiado en otra ventana de la app. Pulsa «Continuar» para seguir con lo último.", { error: true, ms: 7000 });
      app.ir("inicio");
    }
  });
  // Un error que se escapa (un botón que falla, una promesa sin capturar) se avisa, en vez de que
  // parezca que el toque no ha hecho nada.
  const avisarError = (e) => {
    if (!e) return;
    if (!(e instanceof ErrorJuego)) console.error(e);
    aviso(e instanceof ErrorJuego ? e.message : `Algo ha fallado: ${e.message ?? e}`, { error: true });
  };
  window.addEventListener("error", (e) => avisarError(e.error)); // sin `error` (avisos del navegador, extensiones): nada
  window.addEventListener("unhandledrejection", (e) => avisarError(e.reason));

  globalThis.__app = app; // para depurar desde la consola
  app.ir("inicio");
}

arrancar().catch((e) => {
  console.error(e);
  montar(
    h(
      "section",
      { class: "pantalla-pasar" },
      h("h2", {}, "No se ha podido cargar el juego"),
      h("p", { class: "texto-suave" }, String(e.message ?? e)),
      h("p", { class: "texto-suave pequeno" }, "Comprueba la conexión y vuelve a intentarlo. La primera vez hace falta conexión; después se puede jugar sin ella."),
      h("button", { class: "boton boton-primario boton-ancho", onClick: () => location.reload() }, "Recargar"),
    ),
  );
});

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
