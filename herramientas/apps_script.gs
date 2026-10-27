/**
 * «¿Cuánto te arriesgas?»: recibe los datos que envían los móviles (cuando el grupo acepta enviarlos al
 * acabar una partida) y los guarda en esta hoja de cálculo. Cómo instalarlo: README, «Envío de datos».
 * Lo que recibe y devuelve: docs/esquema_datos.md.
 *
 * Con la línea de abajo, Google solo le pide permiso para esta hoja (no para el resto de tu Drive):
 * @OnlyCurrentDoc
 */

// Pon aquí un código secreto (al menos 8 caracteres): hace falta para DESCARGAR los datos desde el
// ordenador (analisis/descargar.py). Para enviar no hace falta: la app lleva la dirección del script y
// la conoce cualquiera, así que enviar está abierto, con límites. Este código no va en la app ni en el repositorio.
const CODIGO_DESCARGA = "";

const HOJA = "registros";
const COLUMNAS = ["recibido", "id", "tipo", "ts", "dispositivo", "registro"];
const TIPOS = ["respuesta", "anulacion", "revision", "ronda", "ronda_anulada", "final", "final_anulada"];
const MAX_REGISTROS_POR_ENVIO = 500;
const MAX_CARACTERES_REGISTRO = 20000; // una celda admite 50 000
const MAX_FILAS_AL_DIA = 3000; // un grupo deja unos cientos en una quedada: más sería un abuso
const MAX_DESCARGA = 2000;

// Lo que se escribe en las columnas de texto: nada que la hoja pueda tomar por una fórmula.
const ID_VALIDO = /^[A-Za-z0-9][\w.-]{0,99}$/;
const TS_VALIDO = /^[0-9][0-9TZ:.+-]{0,39}$/;

// Abrir la dirección del script en el navegador sirve para comprobar que está publicado. No enseña datos.
function doGet() {
  return responder({ ok: true, app: "cuanto-te-arriesgas", mensaje: "El script funciona. Los datos se envían desde la app." });
}

function doPost(e) {
  let peticion;
  try {
    peticion = JSON.parse(e.postData.contents);
  } catch (err) {
    return responder({ ok: false, error: "formato", mensaje: "La petición no es JSON." });
  }
  if (!peticion || typeof peticion !== "object") return responder({ ok: false, error: "formato", mensaje: "La petición no es JSON." });
  if (peticion.accion === "enviar") return responder(guardar(peticion.exportacion));
  if (peticion.accion === "descargar") {
    if (!CODIGO_DESCARGA || CODIGO_DESCARGA.length < 8) return responder({ ok: false, error: "sin_codigo", mensaje: "Falta poner el código de descarga en el script." });
    if (peticion.codigo !== CODIGO_DESCARGA) return responder({ ok: false, error: "codigo", mensaje: "El código de descarga no coincide con el del script." });
    return responder(descargar(peticion.desde, peticion.cuantos));
  }
  return responder({ ok: false, error: "accion", mensaje: "Acción desconocida." });
}

// Guarda los registros que aún no estén en la hoja (por su id): reenviar no duplica nada.
function guardar(exp) {
  if (!exp || exp.app !== "cuanto-te-arriesgas" || exp.formato !== 1 || !Array.isArray(exp.registros)) {
    return { ok: false, error: "formato", mensaje: "No es una exportación de la app." };
  }
  if (exp.registros.length > MAX_REGISTROS_POR_ENVIO) {
    return { ok: false, error: "tamano", mensaje: `Como mucho ${MAX_REGISTROS_POR_ENVIO} registros por envío.` };
  }
  const recibido = new Date().toISOString();
  const filas = [];
  for (const r of exp.registros) {
    if (!r || typeof r !== "object" || !ID_VALIDO.test(String(r.id)) || !TIPOS.includes(r.tipo)) {
      return { ok: false, error: "formato", mensaje: "Hay un registro sin id o de un tipo desconocido." };
    }
    const texto = JSON.stringify(r);
    if (texto.length > MAX_CARACTERES_REGISTRO) return { ok: false, error: "tamano", mensaje: `El registro ${r.id} es demasiado grande.` };
    const ts = TS_VALIDO.test(String(r.ts)) ? String(r.ts) : "";
    const dispositivo = ID_VALIDO.test(String(r.dispositivo)) ? String(r.dispositivo) : "";
    filas.push([recibido, String(r.id), r.tipo, ts, dispositivo, texto]);
  }
  // Dos móviles enviando a la vez: uno espera al otro, para no comprobar los repetidos con la hoja a medias.
  const cerrojo = LockService.getScriptLock();
  cerrojo.waitLock(30000);
  try {
    const hoja = hojaDeRegistros();
    const guardadas = filasGuardadas(hoja);
    const ids = new Set(guardadas.map((f) => String(f[1])));
    // Las nuevas, sin repetir tampoco dentro del mismo envío.
    const nuevas = filas.filter((f) => !ids.has(f[1]) && ids.add(f[1]));
    const hoy = recibido.slice(0, 10);
    const deHoy = guardadas.filter((f) => String(f[0]).slice(0, 10) === hoy).length;
    if (deHoy + nuevas.length > MAX_FILAS_AL_DIA) return { ok: false, error: "cupo", mensaje: "La hoja ya ha recibido hoy todos los datos que admite." };
    if (nuevas.length) {
      const rango = hoja.getRange(hoja.getLastRow() + 1, 1, nuevas.length, COLUMNAS.length);
      rango.setNumberFormat("@"); // texto tal cual: que la hoja no convierta las fechas
      rango.setValues(nuevas);
    }
    return { ok: true, nuevos: nuevas.length, repetidos: filas.length - nuevas.length };
  } finally {
    cerrojo.releaseLock();
  }
}

// Los registros guardados, por tandas: `desde` (empezando en 0) y como mucho `cuantos`.
function descargar(desde, cuantos) {
  const inicio = Math.max(0, Math.floor(Number(desde) || 0));
  const n = Math.min(MAX_DESCARGA, Math.max(1, Math.floor(Number(cuantos) || MAX_DESCARGA)));
  const hoja = hojaDeRegistros();
  const total = Math.max(0, hoja.getLastRow() - 1);
  const filas = inicio < total ? hoja.getRange(2 + inicio, COLUMNAS.length, Math.min(n, total - inicio), 1).getValues() : [];
  const registros = [];
  let ilegibles = 0;
  for (const [texto] of filas) {
    try {
      registros.push(JSON.parse(texto));
    } catch (err) {
      ilegibles++; // una celda tocada a mano en la hoja
    }
  }
  const fin = inicio + filas.length;
  return { ok: true, total, registros, ilegibles, siguiente: fin < total ? fin : null };
}

function hojaDeRegistros() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = libro.getSheetByName(HOJA);
  if (!hoja) {
    hoja = libro.insertSheet(HOJA);
    hoja.appendRow(COLUMNAS);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

// Fecha de llegada e id de cada fila guardada.
function filasGuardadas(hoja) {
  const n = hoja.getLastRow() - 1;
  return n > 0 ? hoja.getRange(2, 1, n, 2).getValues() : [];
}

function responder(datos) {
  return ContentService.createTextOutput(JSON.stringify(datos)).setMimeType(ContentService.MimeType.JSON);
}
