// Sesión de juego: une el motor con el almacenamiento.
// - Guarda la partida tras cada acción (para reanudar).
// - Mantiene una pila para deshacer; deshacer borra los registros que creó la acción.
// - Completa cada registro con id, dispositivo y versiones antes de guardarlo.

import * as M from "./motor.js";
import { uuid } from "./azar.js";

const ACCIONES = {
  apostar: (p, ctx, apuesta) => M.apostar(p, apuesta, ctx),
  empezarLectura: (p) => M.empezarLectura(p),
  revelar: (p, ctx, opciones) => M.revelar(p, opciones),
  otraPregunta: (p, ctx, motivo) => M.otraPregunta(p, motivo, ctx),
  juzgar: (p, ctx, acierto) => M.juzgar(p, acierto),
  senalar: (p, ctx, punto) => M.senalar(p, punto, ctx),
  valorar: (p, ctx, valoracion) => M.valorar(p, valoracion),
  marcarMala: (p, ctx, motivo) => M.marcarMala(p, motivo, ctx),
  cerrarTurno: (p, ctx) => M.cerrarTurno(p, ctx),
  // Rondas divertidas
  empezarRonda: (p) => M.empezarRonda(p),
  marcarElemento: (p, ctx, i) => M.marcarElemento(p, i),
  contarOtro: (p, ctx, delta) => M.contarOtro(p, delta),
  marcarRafaga: (p, ctx, acierto) => M.marcarRafaga(p, acierto),
  terminarRonda: (p, ctx, opciones) => M.terminarRonda(p, opciones),
  cambiarRonda: (p, ctx, motivo) => M.cambiarRonda(p, motivo, ctx),
  // Reto final («acierta k de n»): se marca con marcarRafaga y se cierra con terminarReto.
  terminarReto: (p, ctx, opciones) => M.terminarReto(p, opciones),
  // Desempate tras acabar en empate.
  rondaDeOro: (p, ctx) => M.rondaDeOro(p, ctx),
};

export class Sesion {
  // almacen: { guardarPartida({partida, pila}), borrarPartida(), vistasDe(clave), marcarVistas(pares, ts),
  //            guardarRegistro(reg) -> Promise, borrarRegistro(id) -> Promise }
  constructor({ ctx, almacen, dispositivo, versiones, partida, pila = [], maxDeshacer = 30 }) {
    this.ctx = { ...ctx, vistasDe: (clave) => almacen.vistasDe(clave) };
    this.almacen = almacen;
    this.dispositivo = dispositivo;
    this.versiones = versiones;
    this.partida = partida;
    this.pila = pila;
    this.maxDeshacer = maxDeshacer;
    this.guardadoOk = true;
    this.registrosOk = true;
  }

  static nueva({ ctx, almacen, dispositivo, versiones, id = uuid(), jugadores, metaId, narrador = null, cronometro = false, rondas = false }) {
    const s = new Sesion({ ctx, almacen, dispositivo, versiones, partida: null });
    s.partida = M.nuevaPartida({ id, jugadores, metaId, narrador, cronometro, rondas }, s.ctx).partida;
    s.#guardar();
    return s;
  }

  get turno() {
    return this.partida.turno;
  }

  puedeDeshacer() {
    return this.pila.length > 0;
  }

  async ejecutar(accion, ...args) {
    const fn = ACCIONES[accion];
    if (!fn) throw new Error(`Acción desconocida: ${accion}`);
    const r = fn(this.partida, this.ctx, ...args);
    const registros = r.registros.map((reg) => this.#completar(reg));
    this.pila.push({ partida: this.partida, registros: registros.map((x) => x.id) });
    if (this.pila.length > this.maxDeshacer) this.pila.shift();
    this.partida = r.partida;
    if (r.vistas.length) this.almacen.marcarVistas(r.vistas, this.ctx.ahora());
    this.#guardar();
    await this.#guardarRegistros(registros);
    return this.partida;
  }

  async deshacer() {
    const paso = this.pila.pop();
    if (!paso) return this.partida;
    this.partida = paso.partida;
    this.#guardar();
    for (const id of paso.registros) await this.almacen.borrarRegistro(id);
    return this.partida;
  }

  #completar(reg) {
    return {
      id: uuid(),
      ...reg,
      dispositivo: this.dispositivo,
      version_banco: this.versiones.banco,
      version_ajustes: this.versiones.ajustes,
    };
  }

  // Si el navegador no deja guardar un registro (almacenamiento lleno), la partida sigue:
  // solo se pierde ese dato para calibrar, y `registrosOk` lo indica para avisar.
  async #guardarRegistros(registros) {
    if (!registros.length) return;
    let ok = true;
    for (const reg of registros) {
      try {
        await this.almacen.guardarRegistro(reg);
      } catch {
        ok = false;
      }
    }
    this.registrosOk = ok;
  }

  #guardar() {
    // guardarPartida devuelve false si el navegador no deja escribir (almacenamiento lleno o bloqueado).
    this.guardadoOk = this.almacen.guardarPartida({ partida: this.partida, pila: this.pila }) !== false;
  }
}

// Almacén en memoria: para tests y como respaldo si el navegador no deja guardar.
export function almacenEnMemoria() {
  const estado = { guardada: null, vistas: {}, registros: new Map() };
  return {
    estado,
    guardarPartida(x) {
      estado.guardada = JSON.parse(JSON.stringify(x));
    },
    cargarPartida() {
      return estado.guardada;
    },
    borrarPartida() {
      estado.guardada = null;
    },
    vistasDe(clave) {
      return estado.vistas[clave] ?? {};
    },
    marcarVistas(pares, ts) {
      for (const [j, q] of pares) (estado.vistas[j] ??= {})[q] = ts;
    },
    async guardarRegistro(reg) {
      estado.registros.set(reg.id, reg);
    },
    async borrarRegistro(id) {
      estado.registros.delete(id);
    },
    async todosLosRegistros() {
      return [...estado.registros.values()];
    },
  };
}
