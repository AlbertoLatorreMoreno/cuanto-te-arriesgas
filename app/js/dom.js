// Ayudas mínimas para construir la interfaz sin frameworks.

// h("button", { class: "boton", onClick: fn }, "Texto", otroNodo, [lista], null)
export function h(etiqueta, props = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props ?? {})) {
    if (valor == null || valor === false) continue;
    if (clave.startsWith("on") && typeof valor === "function") {
      el.addEventListener(clave.slice(2).toLowerCase(), valor);
    } else if (clave === "style" && typeof valor === "object") {
      for (const [k, v] of Object.entries(valor)) el.style.setProperty(k, v);
    } else if (clave === "class") {
      el.className = valor;
    } else if (clave in el && typeof valor !== "string") {
      el[clave] = valor;
    } else {
      el.setAttribute(clave, valor === true ? "" : String(valor));
    }
  }
  agregar(el, hijos);
  return el;
}

function agregar(el, hijos) {
  for (const hijo of hijos) {
    if (hijo == null || hijo === false || hijo === true) continue;
    if (Array.isArray(hijo)) agregar(el, hijo);
    else el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
}

// Protección contra toques fantasma: tras cambiar la pantalla se ignoran los toques durante
// un instante. Sin esto, un doble toque en un nivel podía caer en «Soy X: ver la pregunta»
// de la pantalla siguiente y enseñar la pregunta a quien tiene que responderla.
const PAUSA_TOQUES_MS = 350;
let toquesBloqueadosHasta = 0;
if (typeof document !== "undefined") {
  document.addEventListener(
    "click",
    (e) => {
      if (performance.now() < toquesBloqueadosHasta && !e.target.closest?.("dialog")) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
}

// Para quien gestiona sus propios toques (el mapa, con eventos de puntero): si aún no valen.
export const toquesBloqueados = () => typeof performance !== "undefined" && performance.now() < toquesBloqueadosHasta;

let textoAnterior = null;

export function montar(...nodos) {
  montarPantalla(null, ...nodos);
}

// Si cambia la pantalla, se bloquean los toques un instante y se sube arriba. Por defecto, la pantalla
// cambia si cambia su texto: repintar la misma (marcar una valoración) no bloquea nada. Con `clave`,
// decide la clave: así, al marcar nombres en una ronda, el contador cambia sin bloquear ni mover la página.
export function montarPantalla(clave, ...nodos) {
  const app = document.getElementById("app");
  app.replaceChildren(...nodos.flat().filter(Boolean));
  const actual = clave ?? app.textContent;
  if (actual !== textoAnterior) {
    toquesBloqueadosHasta = performance.now() + PAUSA_TOQUES_MS;
    window.scrollTo(0, 0);
  }
  textoAnterior = actual;
}

export function aviso(texto, { error = false, ms = 3200 } = {}) {
  const zona = document.getElementById("avisos");
  const el = h("div", { class: `aviso${error ? " error-aviso" : ""}`, role: error ? "alert" : "status" }, texto);
  zona.append(el);
  setTimeout(() => el.remove(), ms);
}

// Diálogo inferior. `contenido(cerrar)` devuelve los nodos; `cerrar(valor)` resuelve la promesa.
export function dialogo(titulo, contenido) {
  return new Promise((resolver) => {
    const d = h("dialog", { "aria-label": titulo });
    let terminado = false;
    const terminar = (v) => {
      if (terminado) return;
      terminado = true;
      d.remove();
      resolver(v);
    };
    // Se resuelve en cuanto se elige una opción, sin esperar al evento «close»: el navegador lo
    // dispara más tarde y, si la página no se está dibujando, puede no llegar a dispararlo.
    const cerrar = (v) => {
      if (d.open) d.close();
      terminar(v);
    };
    d.append(h("h2", {}, titulo), ...[contenido(cerrar)].flat());
    d.addEventListener("close", () => terminar(undefined)); // tecla Esc o botón «atrás»
    d.addEventListener("click", (e) => {
      // Solo cierra un toque en el fondo oscuro: el propio <dialog> también es el destino
      // de los toques en su relleno, así que se comprueba que caiga fuera de su caja.
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      const fuera = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (fuera) cerrar(undefined);
    });
    document.body.append(d);
    d.showModal();
  });
}

export function confirmar(titulo, texto, { si = "Sí", no = "Cancelar", peligro = false } = {}) {
  return dialogo(titulo, (cerrar) => [
    texto ? h("p", { class: "texto-suave", style: { "margin-bottom": "16px" } }, texto) : null,
    h(
      "div",
      { class: "columna" },
      h("button", { class: `boton boton-ancho ${peligro ? "boton-mal" : "boton-primario"}`, onClick: () => cerrar(true) }, si),
      h("button", { class: "boton boton-ancho", onClick: () => cerrar(false) }, no),
    ),
  ]).then(Boolean);
}

export function cabecera(titulo, alVolver) {
  return h(
    "header",
    { class: "cabecera" },
    alVolver ? h("button", { class: "volver", onClick: alVolver, "aria-label": "Volver" }, "← Volver") : null,
    h("h1", {}, titulo),
  );
}

export function haceCuanto(iso) {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "ayer" : `hace ${dias} días`;
}
