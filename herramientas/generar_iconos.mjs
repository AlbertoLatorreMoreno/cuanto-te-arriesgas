// Genera los iconos PNG de la app sin dependencias: cuatro casillas con los
// colores de las categorías, giradas, sobre fondo oscuro.
// Uso: node herramientas/generar_iconos.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const raiz = new URL("../app/", import.meta.url);
const config = JSON.parse(readFileSync(new URL("data/config.json", raiz), "utf8"));
const colores = config.categorias.slice(0, 4).map((c) => c.color);
const FONDO = "#1c1a16";

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function chunk(tipo, datos) {
  const cab = Buffer.alloc(8);
  cab.writeUInt32BE(datos.length, 0);
  cab.write(tipo, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(tipo, "ascii"), datos])) >>> 0, 0);
  return Buffer.concat([cab, datos, crc]);
}

function png(lado, pixeles) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  const filas = Buffer.alloc((lado * 4 + 1) * lado);
  for (let y = 0; y < lado; y++) {
    filas[y * (lado * 4 + 1)] = 0;
    pixeles.copy(filas, y * (lado * 4 + 1) + 1, y * lado * 4, (y + 1) * lado * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(filas, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function dentroRectRedondeado(x, y, x0, y0, ancho, radio) {
  if (x < x0 || y < y0 || x > x0 + ancho || y > y0 + ancho) return false;
  const cx = Math.min(Math.max(x, x0 + radio), x0 + ancho - radio);
  const cy = Math.min(Math.max(y, y0 + radio), y0 + ancho - radio);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radio ** 2;
}

function dibujar(lado) {
  const pix = Buffer.alloc(lado * lado * 4);
  const fondo = rgb(FONDO);
  const cols = colores.map(rgb);
  const total = 0.58 * lado;
  const hueco = 0.035 * lado;
  const celda = (total - hueco) / 2;
  const radio = 0.18 * celda;
  const ang = (8 * Math.PI) / 180; // giro de las casillas
  const [cos, sin] = [Math.cos(ang), Math.sin(ang)];
  const S = 4; // supermuestreo para suavizar bordes

  for (let py = 0; py < lado; py++) {
    for (let px = 0; px < lado; px++) {
      const acum = [0, 0, 0];
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = px + (sx + 0.5) / S - lado / 2;
          const y = py + (sy + 0.5) / S - lado / 2;
          const rx = x * cos + y * sin + total / 2;
          const ry = -x * sin + y * cos + total / 2;
          let color = fondo;
          for (let i = 0; i < 4; i++) {
            const x0 = (i % 2) * (celda + hueco);
            const y0 = Math.floor(i / 2) * (celda + hueco);
            if (dentroRectRedondeado(rx, ry, x0, y0, celda, radio)) color = cols[i];
          }
          for (let c = 0; c < 3; c++) acum[c] += color[c];
        }
      }
      const o = (py * lado + px) * 4;
      for (let c = 0; c < 3; c++) pix[o + c] = Math.round(acum[c] / (S * S));
      pix[o + 3] = 255;
    }
  }
  return png(lado, pix);
}

mkdirSync(new URL("icons/", raiz), { recursive: true });
for (const lado of [180, 192, 512]) {
  writeFileSync(new URL(`icons/icono-${lado}.png`, raiz), dibujar(lado));
  console.log(`icons/icono-${lado}.png`);
}
