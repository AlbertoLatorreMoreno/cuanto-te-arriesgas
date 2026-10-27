// Cuentas de las preguntas de mapa: distancia sobre la Tierra, puntos y proyección del mapa.

const RADIO_TIERRA_KM = 6371;
const rad = (g) => (g * Math.PI) / 180;
const grados = (r) => (r * 180) / Math.PI;

// Distancia en kilómetros entre dos puntos { lat, lon } (fórmula del haversine).
export function distanciaKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Cada pregunta tiene una zona de acierto: un radio que es una fracción (tres cuartos) de su distancia
// máxima. Ese radio, repartido entre lo que se arriesga, da los kilómetros que cuesta cada punto:
// cuanto más arriesgas, más preciso hay que ser, y fuera de la zona no se suma nada.
export function pasoKm(distanciaMax, apuesta, fraccion = 0.75) {
  return (distanciaMax * fraccion) / apuesta;
}

// Lo arriesgado menos un punto por cada paso de distancia (nunca menos de 0). Antes los puntos
// llegaban hasta la distancia máxima, y quien no sabía dónde estaba el sitio sumaba igualmente varios
// puntos con las apuestas altas: arriesgar 10 en una de mapa rendía casi como un 5 normal.
export function puntosMapa(distancia, apuesta, distanciaMax, fraccion = 0.75) {
  // d · N / radio, y no d / (radio / N): así, justo en el borde de la zona sale N exacto (0 puntos).
  return Math.max(0, apuesta - Math.floor((distancia * apuesta) / (distanciaMax * fraccion)));
}

// Para el modelo de niveles (que solo entiende acierto o fallo) y para ganar la final: haber quedado
// dentro de la zona de acierto, que es lo mismo que sumar al menos un punto.
export function aciertoMapa(distancia, distanciaMax, fraccion = 0.75) {
  return distancia < distanciaMax * fraccion;
}

// Mercator, la misma que usa herramientas/generar_mapa.py: x de 0 a `ancho` (de 180° oeste a 180° este)
// e y de 0 a `ancho` (de latMax norte a latMax sur).
export function proyectar(lon, lat, ancho, latMax) {
  const limite = Math.log(Math.tan(Math.PI / 4 + rad(latMax) / 2));
  const l = Math.max(-latMax, Math.min(latMax, lat));
  const y = Math.log(Math.tan(Math.PI / 4 + rad(l) / 2));
  return { x: ((lon + 180) / 360) * ancho, y: ((limite - y) / (2 * limite)) * ancho };
}

export function desproyectar(x, y, ancho, latMax) {
  const limite = Math.log(Math.tan(Math.PI / 4 + rad(latMax) / 2));
  const m = limite - (y / ancho) * 2 * limite;
  const lat = grados(2 * Math.atan(Math.exp(m)) - Math.PI / 2);
  // El mapa se dibuja dos veces seguidas para poder cruzar el Pacífico: la longitud se reduce a ±180.
  let lon = (x / ancho) * 360 - 180;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat: Math.max(-latMax, Math.min(latMax, lat)), lon };
}
