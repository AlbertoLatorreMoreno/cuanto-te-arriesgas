// Datos: contadores, estado del banco, versiones, exportación y jugadores recordados.

import { estaRetirada, resumenBanco } from "../banco.js";
import { cabecera, confirmar, h, haceCuanto, montar, aviso } from "../dom.js";
import { porEnviar } from "../envio.js";
import { clavesEnPartida, partidaAMedias } from "../motor.js";
import { enviarAhora } from "./comun.js";

// Envío a la hoja del grupo: solo lo que el grupo aceptó enviar al acabar cada partida o al salir de
// «Revisar preguntas». Sin la dirección del script en config.json, no hay nada que enseñar.
function seccionEnvio(app, registros) {
  if (!app.urlEnvio()) return null;
  const ultimo = app.almacen.preferencia("ultimoEnvio", null);
  const decisiones = { enviados: app.almacen.idsEnviados(), partidas: app.almacen.decisionesPartidas(), revisiones: app.almacen.decisionesRevisiones() };
  const guardada = app.almacen.cargarPartida()?.partida;
  const pendientes = porEnviar(registros, decisiones, partidaAMedias(guardada) ? guardada.id : null).length;
  const enviados = registros.filter((r) => decisiones.enviados.has(r.id)).length;
  const reintentar = async (e) => {
    e.currentTarget.disabled = true;
    await enviarAhora(app);
    if (app.pantalla === "datos") app.ir("datos");
  };
  return h(
    "section",
    { class: "tarjeta columna" },
    h("p", { class: "titulo-seccion" }, "Envío a la hoja del grupo"),
    h(
      "p",
      { class: "texto-suave pequeno" },
      "Al acabar cada partida, y al salir de «Revisar preguntas», la app pregunta si enviáis los datos. Solo se envía lo que aceptáis.",
    ),
    h("p", { class: "texto-suave pequeno" }, `Enviados desde este móvil: ${enviados}. Aceptados y aún por enviar: ${pendientes}.`),
    ultimo && !ultimo.ok && pendientes ? h("p", { class: "nota", role: "alert" }, `El último intento (${haceCuanto(ultimo.ts)}) ha fallado. ${ultimo.error}`) : null,
    pendientes ? h("button", { class: "boton boton-ancho", onClick: reintentar }, "Reintentar ahora") : null,
  );
}

// Nombres que recuerda este móvil (para sugerirlos y no repetirles preguntas), con un botón para olvidar
// a cada uno. Olvidar borra el nombre y sus preguntas vistas en este móvil, nunca sus registros.
function seccionJugadores(app, { abierta }) {
  const conocidos = app.almacen.jugadoresConocidos();
  if (!conocidos.length) return null;
  const enPartida = clavesEnPartida(app.almacen.cargarPartida()?.partida);
  const dias = app.config.jugadores.olvidar_tras_dias;
  const plazo = dias % 30 === 0 ? `${dias / 30} meses` : `${dias} días`;
  const vistasTexto = (n) => (n === 0 ? "ninguna pregunta vista" : n === 1 ? "1 pregunta vista" : `${n} preguntas vistas`);

  async function olvidar(j) {
    const n = Object.keys(app.almacen.vistasDe(j.clave)).length;
    const cuales = n === 1 ? "la pregunta que ha visto" : `las ${n} preguntas que ha visto`;
    const ok = await confirmar(
      `¿Olvidar a ${j.nombre}?`,
      `Dejará de salir en las sugerencias${n ? ` y este móvil olvidará ${cuales}: si vuelve a jugar, le pueden salir otra vez` : ""}. ` +
        "Sus respuestas y valoraciones no se borran: siguen guardadas y se exportan igual.",
      { si: "Olvidar", peligro: true },
    );
    if (!ok) return;
    app.almacen.olvidarJugador(j.clave);
    aviso(`Hecho: este móvil ya no recuerda a ${j.nombre}.`);
    // Se vuelve a pintar todo (la tabla de preguntas sin ver también cambia), con la lista abierta y en el mismo sitio.
    app.ir("datos", { jugadoresAbierta: true, scroll: window.scrollY });
  }

  return h(
    "details",
    { class: "tarjeta jugadores-recordados", open: abierta },
    h("summary", { class: "titulo-seccion" }, `Jugadores recordados (${conocidos.length})`),
    h(
      "p",
      { class: "texto-suave pequeno" },
      `Este móvil recuerda cada nombre para sugerirlo y para no repetirle preguntas. Quien lleva más de ${plazo} sin jugar se olvida solo. ` +
        "Olvidar a alguien no borra sus respuestas ni sus valoraciones.",
    ),
    h(
      "ul",
      { class: "lista-jugadores" },
      conocidos.map((j) =>
        h(
          "li",
          {},
          h(
            "div",
            {},
            h("strong", {}, j.nombre),
            h("span", { class: "texto-suave pequeno" }, `Última vez ${haceCuanto(j.ultima)} · ${vistasTexto(Object.keys(app.almacen.vistasDe(j.clave)).length)}`),
          ),
          enPartida.has(j.clave)
            ? h("span", { class: "texto-suave pequeno" }, "En la partida a medias")
            : h("button", { class: "boton boton-pequeno", "aria-label": `Olvidar a ${j.nombre}`, onClick: () => olvidar(j) }, "Olvidar"),
        ),
      ),
    ),
  );
}

export async function pantallaDatos(app, params = {}) {
  const vigente = app.vigente();
  const registros = await app.almacen.todosLosRegistros();
  if (!vigente()) return;
  const respuestas = registros.filter((r) => r.tipo === "respuesta");
  const finales = registros.filter((r) => r.tipo === "final");
  const revisiones = registros.filter((r) => r.tipo === "revision");
  // Las finales propias tienen sus propios registros: también son preguntas jugadas (o cambiadas).
  const anulaciones = registros.filter((r) => r.tipo === "anulacion" || r.tipo === "final_anulada");
  const motivosCalidad = new Set(app.config.motivos_anulacion.filter((m) => m.calidad).map((m) => m.id));
  const contadores = [
    ["Partidas", new Set(registros.filter((r) => r.partida).map((r) => r.partida)).size],
    ["Preguntas jugadas", respuestas.length + finales.length],
    ["Valoraciones de nivel", [...respuestas, ...revisiones].filter((r) => r.valoracion).length],
    ["Marcadas como malas", [...respuestas, ...finales, ...revisiones].filter((r) => r.mala).length + anulaciones.filter((r) => motivosCalidad.has(r.motivo)).length],
    ["Revisiones", revisiones.length],
    ["Preguntas cambiadas", anulaciones.length],
  ];
  const ultima = app.almacen.preferencia("ultimaExportacion", null);
  const resumen = resumenBanco(app.indice, app.almacen.vistoPorAlguien());
  const retiradas = app.preguntas.filter((p) => estaRetirada(p, app.ajustes)).length;

  montar(
    cabecera("Datos", () => app.ir("inicio")),
    h(
      "div",
      { class: "dos-columnas" },
      h(
        "div",
        { class: "columna" },
        h(
          "div",
          { class: "contadores" },
          contadores.map(([texto, n]) => h("div", { class: "contador" }, h("strong", {}, String(n)), h("span", {}, texto))),
        ),
        h(
          "section",
          { class: "tarjeta columna" },
          h("p", { class: "titulo-seccion" }, "Exportar"),
          h(
            "p",
            { class: "texto-suave pequeno" },
            `Genera un archivo con todas las respuestas y valoraciones de este móvil. Cópialo en la carpeta analisis/datos del proyecto para calibrar. Última exportación: ${haceCuanto(ultima)}.`,
          ),
          h("button", { class: "boton boton-primario boton-ancho", disabled: registros.length === 0, onClick: () => app.exportar().then(() => app.pantalla === "datos" && app.ir("datos")) }, "Exportar datos"),
          h("p", { class: "texto-suave pequeno" }, "El archivo incluye los nombres de los jugadores. Si vais a compartirlo, usad apodos."),
        ),
        seccionEnvio(app, registros),
      ),
      h(
        "div",
        { class: "columna" },
        h(
          "section",
          { class: "tarjeta columna" },
          h("p", { class: "titulo-seccion" }, "Preguntas que nadie ha visto en este móvil"),
          h(
            "div",
            { style: { "overflow-x": "auto" } },
            h(
              "table",
              { class: "tabla tabla-banco" },
              h("thead", {}, h("tr", {}, h("th", {}, "Nivel"), Array.from({ length: 10 }, (_, i) => h("th", {}, String(i + 1))))),
              h(
                "tbody",
                {},
                resumen.map((fila) =>
                  h(
                    "tr",
                    {},
                    h("td", { style: { "text-align": "left" } }, app.nombreCategoria(fila.categoria).split(" ")[0]),
                    fila.porNivel.map((c) =>
                      h("td", { class: c.total === 0 ? "vacia" : c.sinVer <= 1 ? "escasa" : "", title: `${c.sinVer} sin ver de ${c.total}` }, String(c.sinVer)),
                    ),
                  ),
                ),
              ),
            ),
          ),
          h("p", { class: "texto-suave pequeno" }, `En rojo, niveles sin ninguna pregunta; en ámbar, casi agotados. ${app.indice.porId.size} preguntas activas, ${retiradas} retiradas por la calibración.`),
        ),
        h(
          "section",
          { class: "tarjeta columna" },
          h("p", { class: "titulo-seccion" }, "Versiones"),
          h(
            "p",
            { class: "texto-suave pequeno" },
            `App ${app.version} · banco ${app.versiones.banco} · ajustes ${app.versiones.ajustes}` +
              (app.ajustes?.n_respuestas ? ` (calibrados con ${app.ajustes.n_respuestas} respuestas y ${app.ajustes.n_valoraciones} valoraciones)` : ""),
          ),
          h("p", { class: "texto-suave pequeno" }, `Dispositivo ${app.almacen.dispositivo.slice(0, 8)}`),
        ),
        seccionJugadores(app, { abierta: Boolean(params.jugadoresAbierta) }),
        h(
          "button",
          {
            class: "boton-texto",
            onClick: async () => {
              const ok = await confirmar(
                "¿Olvidar las preguntas vistas?",
                "Todas las preguntas volverán a contar como nuevas para todos los jugadores. Útil si juega un grupo distinto. No borra los datos registrados.",
                { si: "Olvidar", peligro: true },
              );
              if (ok) {
                app.almacen.olvidarVistas();
                aviso("Hecho: todas las preguntas cuentan como nuevas.");
                app.ir("datos");
              }
            },
          },
          "Olvidar las preguntas vistas",
        ),
      ),
    ),
  );
  if (params.scroll) window.scrollTo(0, params.scroll);
}
