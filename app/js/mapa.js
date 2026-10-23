// Mapa para las preguntas de Geohistoria: el contorno de los países en SVG, que se mueve
// arrastrando, se acerca pellizcando, con la rueda o con los botones, y se toca para señalar.
// El mapa (data/mapa.json) lo genera herramientas/generar_mapa.py y se descarga una sola vez.

import { h, toquesBloqueados } from "./dom.js";
import { desproyectar, proyectar } from "./geo.js";

const NS = "http://www.w3.org/2000/svg";
const MOVIMIENTO_PX = 8; // lo que hay que mover el dedo para que deje de ser un toque
const RADIO_MARCA_PX = 9;

let datos = null;
let carga = null;
let contador = 0;

export function cargarMapa(ruta) {
  carga ??= fetch(ruta, { cache: "no-cache" })
    .then((r) => {
      if (!r.ok) throw new Error(`error ${r.status}`);
      return r.json();
    })
    .then((d) => (datos = d))
    .catch((e) => {
      carga = null; // que se pueda reintentar
      throw e;
    });
  return carga;
}

function svg(etiqueta, atributos = {}) {
  const el = document.createElementNS(NS, etiqueta);
  for (const [k, v] of Object.entries(atributos)) el.setAttribute(k, String(v));
  return el;
}

// opciones:
//   ruta: archivo del mapa;  vista: [lonOeste, latSur, lonEste, latNorte] del encuadre inicial
//   estado: objeto que guarda quien llama, para conservar el encuadre (`vb`) y el punto (`punto`)
//           entre repintados de la pantalla
//   alTocar(punto): si se da, tocar el mapa marca un punto { lat, lon } (sin ella, solo se mira)
//   correcta: { lat, lon, radioKm } para enseñar el punto correcto y la zona de acierto
export function crearMapa(opciones) {
  const caja = h("div", { class: "mapa" }, h("p", { class: "mapa-cargando texto-suave pequeno" }, "Cargando el mapa…"));
  const pintar = () => construir(caja, opciones);
  if (datos) {
    // Se construye cuando la caja ya está en la página: hace falta su tamaño.
    requestAnimationFrame(pintar);
  } else {
    cargarMapa(opciones.ruta)
      .then(() => caja.isConnected && pintar())
      .catch(() => {
        caja.replaceChildren(h("p", { class: "mapa-cargando nota" }, "No se ha podido cargar el mapa. Comprueba la conexión y vuelve a esta pantalla."));
      });
  }
  return caja;
}

function construir(caja, { vista, estado = {}, alTocar = null, correcta = null }) {
  if (!caja.isConnected) return;
  const W = datos.ancho;
  const latMax = datos.lat_max;
  const p = (lat, lon) => proyectar(lon, lat, W, latMax);

  // Encuadre inicial: la vista pedida, o el que se dejó la última vez.
  const inicial = () => {
    const [o, s, e, n] = vista;
    const a = proyectar(o, n, W, latMax);
    const b = proyectar(e, s, W, latMax);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  };
  let vb = estado.vb ? { ...estado.vb } : inicial();

  const id = `tierra-${++contador}`;
  const lienzo = svg("svg", { class: `mapa-svg${alTocar ? "" : " sin-toque"}`, role: "img", "aria-label": alTocar ? "Mapa: toca para señalar" : "Mapa con el resultado" });
  const defs = svg("defs");
  defs.append(svg("path", { id, d: datos.d, class: "mapa-tierra" }));
  lienzo.append(defs, svg("rect", { class: "mapa-mar", x: -W, y: -W, width: 4 * W, height: 3 * W }));
  // El mundo dos veces seguidas, para poder cruzar el Pacífico sin un corte.
  lienzo.append(svg("use", { href: `#${id}` }), svg("use", { href: `#${id}`, x: W }));
  const capa = svg("g");
  lienzo.append(capa);

  const escala = () => {
    const r = lienzo.getBoundingClientRect();
    return Math.min(r.width / vb.w, r.height / vb.h) || 1;
  };

  // Una copia de cada marca en cada mundo; la línea, por el camino corto.
  const pintarMarcas = () => {
    capa.replaceChildren();
    const rad = RADIO_MARCA_PX / escala();
    const marca = (punto, clase) => {
      const { x, y } = p(punto.lat, punto.lon);
      for (const dx of [0, W]) capa.append(svg("circle", { class: `mapa-marca ${clase}`, cx: x + dx, cy: y, r: rad }));
    };
    if (correcta) {
      const { x, y } = p(correcta.lat, correcta.lon);
      // Zona de acierto: en Mercator, un círculo de radio km mide km / cos(lat) en el mapa.
      const radio = ((correcta.radioKm / 40075) * W) / Math.cos((correcta.lat * Math.PI) / 180);
      for (const dx of [0, W]) capa.append(svg("circle", { class: "mapa-zona", cx: x + dx, cy: y, r: radio }));
      if (estado.punto) {
        const a = p(estado.punto.lat, estado.punto.lon);
        const bx = [x - W, x, x + W].reduce((m, v) => (Math.abs(v - a.x) < Math.abs(m - a.x) ? v : m));
        for (const dx of [0, W]) capa.append(svg("line", { class: "mapa-linea", x1: a.x + dx, y1: a.y, x2: bx + dx, y2: y }));
      }
      marca(correcta, "correcta");
    }
    if (estado.punto) marca(estado.punto, "jugador");
  };

  const aplicar = () => {
    // Límites: ni más cerca de unos 15 km de ancho ni más lejos que el mundo y medio.
    const minW = W / 2600;
    const maxW = 1.6 * W;
    if (vb.w < minW || vb.w > maxW) {
      const f = Math.min(maxW, Math.max(minW, vb.w)) / vb.w;
      const cx = vb.x + vb.w / 2;
      const cy = vb.y + vb.h / 2;
      vb = { w: vb.w * f, h: vb.h * f, x: cx - (vb.w * f) / 2, y: cy - (vb.h * f) / 2 };
    }
    vb.x = Math.min(2 * W - vb.w / 2, Math.max(-vb.w / 2, vb.x));
    vb.y = Math.min(W - vb.h / 2, Math.max(-vb.h / 2, vb.y));
    lienzo.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    estado.vb = { ...vb };
    pintarMarcas();
  };

  // Coordenadas del mapa bajo un punto de la pantalla.
  const enMapa = (clientX, clientY) => {
    const m = lienzo.getScreenCTM();
    if (!m) return null;
    const pt = lienzo.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(m.inverse());
  };

  const zoom = (factor, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2, base = vb) => {
    vb = { x: cx - (cx - base.x) * factor, y: cy - (cy - base.y) * factor, w: base.w * factor, h: base.h * factor };
    aplicar();
  };

  // ---- gestos
  const punteros = new Map();
  let gesto = null; // { x, y, vb, movido, multi } o, con dos dedos, { pellizco: { dist, vb, centro } }
  const distancia = () => {
    const [a, b] = [...punteros.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const medio = () => {
    const [a, b] = [...punteros.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  lienzo.addEventListener("pointerdown", (e) => {
    lienzo.setPointerCapture?.(e.pointerId);
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.size === 1) {
      gesto = { x: e.clientX, y: e.clientY, vb: { ...vb }, movido: false, multi: false };
    } else if (punteros.size === 2 && gesto) {
      gesto.multi = true;
      const c = medio();
      gesto.pellizco = { dist: distancia(), vb: { ...vb }, centro: enMapa(c.x, c.y) };
    }
  });

  lienzo.addEventListener("pointermove", (e) => {
    if (!punteros.has(e.pointerId) || !gesto) return;
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.size === 2 && gesto.pellizco) {
      const { dist, vb: base, centro } = gesto.pellizco;
      const d = distancia();
      if (d > 0 && centro) zoom(dist / d, centro.x, centro.y, base);
      return;
    }
    if (punteros.size !== 1 || gesto.multi) return;
    const dx = e.clientX - gesto.x;
    const dy = e.clientY - gesto.y;
    if (!gesto.movido && Math.hypot(dx, dy) < MOVIMIENTO_PX) return;
    gesto.movido = true;
    const s = escala();
    vb = { ...gesto.vb, x: gesto.vb.x - dx / s, y: gesto.vb.y - dy / s };
    aplicar();
  });

  const soltar = (e) => {
    const era = punteros.has(e.pointerId);
    punteros.delete(e.pointerId);
    if (!era || !gesto) return;
    if (e.type === "pointerup" && punteros.size === 0 && !gesto.multi && !gesto.movido && alTocar && !toquesBloqueados()) {
      const pt = enMapa(e.clientX, e.clientY);
      if (pt && pt.y >= 0 && pt.y <= W) {
        estado.punto = desproyectar(pt.x, pt.y, W, latMax);
        pintarMarcas();
        alTocar(estado.punto);
      }
    }
    if (punteros.size === 0) gesto = null;
  };
  lienzo.addEventListener("pointerup", soltar);
  lienzo.addEventListener("pointercancel", soltar);

  lienzo.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const pt = enMapa(e.clientX, e.clientY);
      zoom(e.deltaY > 0 ? 1.25 : 0.8, pt?.x, pt?.y);
    },
    { passive: false },
  );

  const boton = (texto, etiqueta, accion) =>
    h("button", { type: "button", "aria-label": etiqueta, title: etiqueta, onClick: accion }, texto);
  const botones = h(
    "div",
    { class: "mapa-botones" },
    boton("+", "Acercar", () => zoom(0.6)),
    boton("−", "Alejar", () => zoom(1 / 0.6)),
    boton("⤢", "Volver al encuadre inicial", () => {
      vb = inicial();
      aplicar();
    }),
  );

  caja.replaceChildren(lienzo, botones);
  aplicar();
}
