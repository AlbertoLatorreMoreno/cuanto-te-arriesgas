// Exportación de todos los registros a un archivo JSON (formato en docs/esquema_datos.md).

export function construirExportacion({ registros, dispositivo, versiones, ahora = new Date().toISOString() }) {
  return {
    formato: 1,
    app: "cuanto-te-arriesgas",
    exportado: ahora,
    dispositivo,
    version_banco: versiones.banco,
    version_ajustes: versiones.ajustes,
    registros: [...registros].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)),
  };
}

export function nombreArchivo(dispositivo, ahora = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const fecha = `${ahora.getFullYear()}${p(ahora.getMonth() + 1)}${p(ahora.getDate())}-${p(ahora.getHours())}${p(ahora.getMinutes())}`;
  return `arriesga-${dispositivo.slice(0, 8)}-${fecha}.json`;
}

// Devuelve "compartido", "descargado" o "cancelado".
export async function exportarArchivo(datos, nombre) {
  const texto = JSON.stringify(datos, null, 1);
  const blob = new Blob([texto], { type: "application/json" });
  const archivo = new File([blob], nombre, { type: "application/json" });
  if (navigator.canShare?.({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo], title: "Datos de ¿Cuánto te arriesgas?" });
      return "compartido";
    } catch (e) {
      if (e.name === "AbortError") return "cancelado";
      // Si compartir falla por otra razón, se descarga.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "descargado";
}
