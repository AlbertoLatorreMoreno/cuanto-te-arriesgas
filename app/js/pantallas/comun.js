// Piezas de interfaz compartidas entre pantallas.

import { aviso, dialogo, h } from "../dom.js";
import { crearMapa } from "../mapa.js";
import { letrasFichas } from "../util.js";

// «¿Enviamos los datos?»: lo que se pregunta al acabar una partida y al salir de «Revisar preguntas».
// Devuelve true (sí), false (no) o undefined (se cerró sin contestar: se puede volver a preguntar).
export function preguntarEnvio(titulo, texto) {
  return dialogo(titulo, (cerrar) => [
    h("p", { class: "texto-suave", style: { "margin-bottom": "16px" } }, texto),
    h(
      "div",
      { class: "columna" },
      h("button", { class: "boton boton-ancho boton-primario", onClick: () => cerrar(true) }, "Sí, enviar"),
      h("button", { class: "boton boton-ancho", onClick: () => cerrar(false) }, "No"),
    ),
  ]);
}

// Envía en el momento lo aceptado y dice cómo ha ido. Si no se puede, se queda pendiente y se envía solo más adelante.
export async function enviarAhora(app) {
  const r = await app.sincronizar({ siempre: true });
  if (r && !r.ok) aviso(`Todavía no se han enviado. ${r.error} Se enviarán solos más adelante.`, { error: true, ms: 6000 });
  else aviso("Datos enviados. ¡Gracias!");
  return r;
}

// Colores de la paleta Okabe-Ito, pensada para distinguirse también con daltonismo.
// Entre estos seis, la distancia mínima de color con protanopía o deuteranopía simuladas es 34 (antes, 18).
// Cada uno lleva el color de letra con el que tiene un contraste de al menos 4,5.
const COLORES_FICHA = [
  { fondo: "#1d3557", texto: "#ffffff" }, // azul marino
  { fondo: "#d55e00", texto: "#1a1a1a" }, // bermellón
  { fondo: "#f0e442", texto: "#1a1a1a" }, // amarillo
  { fondo: "#009e73", texto: "#1a1a1a" }, // verde azulado
  { fondo: "#7b2cbf", texto: "#ffffff" }, // morado
  { fondo: "#56b4e9", texto: "#1a1a1a" }, // azul cielo
];

export function colorFicha(partida, clave) {
  const i = partida.jugadores.findIndex((j) => j.clave === clave);
  return COLORES_FICHA[i % COLORES_FICHA.length];
}

export function ficha(partida, jugador) {
  const i = partida.jugadores.findIndex((j) => j.clave === jugador.clave);
  const { fondo, texto } = colorFicha(partida, jugador.clave);
  const letras = letrasFichas(partida.jugadores.map((j) => j.nombre))[i] ?? "?";
  return h("span", { class: "ficha", style: { "--ficha": fondo, "--ficha-texto": texto }, "aria-hidden": "true" }, letras);
}

// Jugadores recordados que se sugieren como chips en «Nueva partida» y «Revisar preguntas»: los más recientes.
// La lista entera, con el botón para olvidar a cada uno, está en «Datos».
export const MAX_CHIPS_JUGADORES = 12;

// Sin categoría es una final propia (de tema libre): lleva su propio color.
export function estiloCat(app, categoria) {
  return { "--cat": categoria ? app.colorCategoria(categoria) : "var(--final)" };
}

export function etiquetaCat(app, categoria, subtema = null) {
  if (!categoria) return h("span", { class: "etiqueta-cat", style: estiloCat(app, null) }, "🏁 Pregunta final");
  const texto = subtema ? `${app.nombreCategoria(categoria)} · ${app.nombreSubtema(categoria, subtema)}` : app.nombreCategoria(categoria);
  return h("span", { class: "etiqueta-cat", style: estiloCat(app, categoria) }, texto);
}

export function marcador(partida) {
  const actual = partida.turno?.jugador;
  return h(
    "div",
    { class: "marcador", role: "list", "aria-label": "Marcador" },
    partida.jugadores.map((j) =>
      h(
        "div",
        { class: `jugador${j.clave === actual ? " activo" : ""}`, role: "listitem" },
        ficha(partida, j),
        h("span", {}, j.nombre),
        h("strong", {}, j.pos >= partida.meta ? "🏁" : `${j.pos}`),
      ),
    ),
  );
}

export function tablero(app, partida) {
  const casillas = [];
  for (let i = 0; i <= partida.meta; i++) {
    const enCasilla = partida.jugadores.filter((j) => j.pos === i);
    const esMeta = i === partida.meta;
    const cat = partida.tablero[i];
    const especial = partida.especiales?.includes(i);
    const clase = ["casilla", i === 0 ? "salida" : "", esMeta ? "meta" : "", especial ? "especial" : "", enCasilla.length ? "ocupada" : "", enCasilla.length > 4 ? "muchas" : ""].join(" ");
    const titulo = esMeta ? "Meta" : i === 0 ? "Salida" : especial ? `Casilla ${i}: ronda divertida` : `Casilla ${i}: ${app.nombreCategoria(cat)}`;
    // Una casilla libre lleva la inicial de su categoría, para no depender solo del color.
    const vacia = esMeta ? h("span", { class: "bandera" }, "🏁") : especial ? h("span", { class: "estrella" }, "★") : cat ? h("span", { class: "letra-cat" }, app.nombreCategoria(cat)[0]) : null;
    casillas.push(
      h(
        "div",
        { class: clase, style: cat ? { "--cat": app.colorCategoria(cat) } : null, title: titulo },
        enCasilla.length ? enCasilla.map((j) => ficha(partida, j)) : vacia,
      ),
    );
  }
  return h(
    "div",
    { class: "columna" },
    h("div", { class: "tablero", "aria-hidden": "true" }, casillas),
    h(
      "div",
      { class: "leyenda" },
      app.config.categorias.map((c) => h("span", { style: { "--cat": c.color } }, c.nombre)),
      partida.especiales?.length ? h("span", { class: "leyenda-ronda" }, "Ronda") : null,
    ),
  );
}

// La respuesta de una pregunta, con lo que también vale y el criterio (en la partida y en «Revisar preguntas»).
export function bloqueRespuesta(q) {
  return h(
    "div",
    { class: "respuesta" },
    h("p", { class: "texto-suave pequeno" }, "Respuesta"),
    h("p", { class: "valor" }, q.respuesta),
    q.tambien_vale?.length ? h("p", { class: "detalle" }, `También vale: ${q.tambien_vale.join(" · ")}`) : null,
    q.criterio ? h("p", { class: "detalle" }, `Criterio: ${q.criterio}`) : null,
  );
}

// ---------------------------------------------------------------- preguntas de mapa

export const formatoKm = (km) => `${new Intl.NumberFormat("es-ES").format(Math.round(km))} km`;

// El radio de la zona de acierto: una fracción (tres cuartos) de la distancia máxima de la pregunta.
export const radioAciertoKm = (app, q) => q.distancia_max_km * (app.config.mapa.acierto_fraccion ?? 0.75);

// El encuadre con el que se abre el mapa para señalar: el de la pregunta, el de su subtema o el mundo.
export function vistaInicialMapa(app, q) {
  const cat = app.config.categorias.find((c) => c.id === q.categoria);
  const nombre = q.vista ?? cat?.subtemas.find((s) => s.id === q.subtema)?.vista ?? "mundo";
  return app.config.mapa.vistas[nombre] ?? app.config.mapa.vistas.mundo;
}

// Una pregunta de mapa ya respondida: el punto señalado (`estado.punto`), el correcto y la zona de acierto,
// encuadrados juntos. `estado` ({ punto, vb }) lo guarda quien llama, para conservar el encuadre al repintar.
export function mapaRespondido(app, q, estado) {
  const radioKm = radioAciertoKm(app, q);
  const { lat, lon } = estado.punto;
  // Encuadre: los dos puntos y la zona de acierto, con margen. La longitud del punto señalado se
  // acerca a la correcta por el camino corto (por si están a los dos lados del Pacífico).
  let lon2 = lon;
  if (lon2 - q.lon > 180) lon2 -= 360;
  if (q.lon - lon2 > 180) lon2 += 360;
  const margenLat = radioKm / 111;
  const margenLon = margenLat / Math.max(0.2, Math.cos((q.lat * Math.PI) / 180));
  const oeste = Math.min(q.lon - margenLon, lon2) - 2;
  const este = Math.max(q.lon + margenLon, lon2) + 2;
  const sur = Math.max(-80, Math.min(q.lat - margenLat, lat) - 2);
  const norte = Math.min(80, Math.max(q.lat + margenLat, lat) + 2);
  const desplazar = oeste < -180 ? 360 : 0; // el mapa empieza en −180: se usa la segunda copia
  return crearMapa({
    ruta: app.config.mapa.archivo,
    vista: [oeste + desplazar, sur, este + desplazar, norte],
    estado,
    correcta: { lat: q.lat, lon: q.lon, radioKm },
  });
}

export function nombreJugador(partida, clave) {
  if (partida.narrador?.clave === clave) return partida.narrador.nombre;
  return partida.jugadores.find((j) => j.clave === clave)?.nombre ?? clave;
}

export function textoAlternativa(app, turno) {
  if (turno.final && turno.alternativa) {
    const que = turno.reto ? "este reto" : "esta";
    if (turno.alternativa === "otro_nivel") return `No quedaban finales nuevas de nivel ${turno.nivelFinal}; ${que} es de nivel ${turno.finalDatos.nivel}.`;
    if (turno.alternativa === "repetida") return `Ya no quedaban finales nuevas: ${que} ya salió hace tiempo.`;
  }
  const p = turno.preguntaDatos;
  if (!p || !turno.alternativa) return null;
  if (turno.alternativa === "otro_nivel") {
    const donde = turno.tema ? "en este tema" : "en esta categoría";
    return `No quedaban preguntas de nivel ${turno.apuesta} ${donde}; esta es de nivel ${p.nivelEfectivo}. Si se acierta, suma ${turno.apuesta} igualmente.`;
  }
  if (turno.alternativa === "otro_subtema") {
    return `No quedaban preguntas de ${app.nombreSubtema(turno.categoria, turno.subtema)} de este nivel; esta es de ${app.nombreSubtema(p.categoria, p.subtema)}.`;
  }
  if (turno.alternativa === "repetida") {
    return p.nivelEfectivo === turno.apuesta
      ? "Ya no quedaban preguntas nuevas de este nivel: esta salió hace tiempo."
      : `Ya no quedaban preguntas nuevas de nivel ${turno.apuesta}: esta es de nivel ${p.nivelEfectivo} y salió hace tiempo. Si se acierta, suma ${turno.apuesta} igualmente.`;
  }
  return null;
}
