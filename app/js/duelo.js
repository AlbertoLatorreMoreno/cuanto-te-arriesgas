// Duelo en un móvil: dos jugadores, cuatro vueltas y preguntas fáciles del rival y difíciles del tema propio.
// Funciones puras: el llamador guarda cada estado antes de enseñarlo y marca las vistas de quien responde.

import { elegir } from "./azar.js";
import { jugable, multiplicador, transcurrido, valorarUltima as valorarEnSolo } from "./solo.js";

export { VALORACIONES } from "./solo.js";

// Los del duelo normal. Cada duelo lleva sus vueltas y sus huecos en su plan (el veloz tiene 2 y 8): usar vueltasDe y
// huecosDe.
export const VUELTAS = 4;
export const HUECOS = 16;

// Los modos (config.duelo): «normal», 4 vueltas (niveles 1-4 y 7-10); «veloz», 2 (1 y 3, 8 y 10). Una configuración
// antigua, con `facil` y `dificil` sueltos, es el modo normal.
export const MODOS = ["normal", "veloz"];
export function nivelesDuelo(config, modo = "normal") {
  const c = config.duelo ?? {};
  const niveles = c[modo] ?? (modo === "normal" && Array.isArray(c.facil) ? c : null);
  if (!niveles || niveles.facil.length !== niveles.dificil.length || !niveles.facil.length) throw new Error(`Modo de duelo desconocido: ${modo}.`);
  return niveles;
}
export const huecosDe = (d) => d.plan.length;
export const vueltasDe = (d) => d.plan.length / 4;

export const ordenJugadores = (vuelta) => vuelta % 2 === 1 ? [0, 1] : [1, 0];

const nivelDe = (q) => q.nivelEfectivo ?? q.nivel;
const porId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

// Las reservas y las repeticiones se excluyen siempre. El resto son preferencias, en el orden de la especificación:
// nivel, antigüedad de lo visto, ausencia de fugas y variedad. Una fuga no obliga a cambiar de nivel ni a repetir vistas.
export function planDuelo({ indice, opciones, config, jugadores, vistas = [{}, {}], reservadas = new Set(), rng, modo = "normal" }) {
  if (jugadores.length !== 2) throw new Error("El duelo necesita dos jugadores.");
  const niveles = nivelesDuelo(config, modo);
  const posibles = new Map();
  for (const { tema } of jugadores) {
    if (posibles.has(tema)) continue;
    const preguntas = [...indice.porId.values()]
      .filter((q) => q.categoria === tema && !reservadas.has(q.id) && jugable(q, opciones))
      .sort(porId);
    if (!preguntas.length) return null;
    posibles.set(tema, preguntas);
  }
  const usadas = new Set();
  const reveladas = new Set();
  const revela = indice.revela;
  const subtemas = Array.from({ length: 2 }, () => ({ rival: new Set(), propio: new Set() }));
  const min = indice.min ?? config.niveles.min;
  const max = indice.max ?? config.niveles.max;
  const plan = [];

  const sinFuga = (q) => !reveladas.has(q.id)
    && ![...(revela?.get(q.id) ?? [])].some((id) => usadas.has(id));

  function buscar(tema, nivel, jugador, papel) {
    const vistasJugador = vistas?.[jugador] ?? {};
    for (let distancia = 0; distancia <= max - min; distancia++) {
      for (const otroNivel of distancia ? [nivel - distancia, nivel + distancia] : [nivel]) {
        let grupo = posibles.get(tema).filter((q) => nivelDe(q) === otroNivel && !usadas.has(q.id));
        if (!grupo.length) continue;
        const nuevas = grupo.filter((q) => !(q.id in vistasJugador));
        if (nuevas.length) {
          grupo = nuevas;
        } else {
          const antigua = grupo.map((q) => vistasJugador[q.id]).sort()[0];
          grupo = grupo.filter((q) => vistasJugador[q.id] === antigua);
        }
        const sinRevelar = grupo.filter(sinFuga);
        if (sinRevelar.length) grupo = sinRevelar;
        const variados = grupo.filter((q) => !subtemas[jugador][papel].has(q.subtema));
        return elegir(variados.length ? variados : grupo, rng);
      }
    }
    return null;
  }

  for (let vuelta = 1; vuelta <= niveles.facil.length; vuelta++) {
    for (const jugador of ordenJugadores(vuelta)) {
      for (const papel of ["rival", "propio"]) {
        const tema = jugadores[papel === "propio" ? jugador : 1 - jugador].tema;
        const nivel = niveles[papel === "propio" ? "dificil" : "facil"][vuelta - 1];
        const q = buscar(tema, nivel, jugador, papel);
        // Tener preguntas no basta: también tienen que alcanzar sin repetir ninguna de las ya elegidas.
        if (!q) return null;
        plan.push({ jugador, vuelta, papel, tema, nivel, pregunta: q.id });
        usadas.add(q.id);
        subtemas[jugador][papel].add(q.subtema);
        for (const id of revela?.get(q.id) ?? []) reveladas.add(id);
      }
    }
  }
  return plan;
}

// Cambia únicamente el hueco que aún no se ha mostrado. Las otras quince preguntas siguen reservadas para
// este duelo, incluidas las futuras. También se conservan las fotos y los resultados ya guardados.
export function sustituirHueco(d, { indice, opciones, config, vistas = [{}, {}], reservadas = new Set(), rng }) {
  if (d.fase !== "preparar" || !huecoActual(d)) throw new Error("Solo se puede sustituir una pregunta antes de mostrarla.");
  const hueco = huecoActual(d);
  const otros = d.plan.filter((_, i) => i !== d.paso);
  const usadas = new Set([...otros.map((h) => h.pregunta), ...d.resultados.map((r) => r.pregunta)]);
  const excluidas = new Set([...usadas, hueco.pregunta]);
  const revela = indice.revela;
  const reveladas = new Set();
  for (const id of usadas) for (const revelada of revela?.get(id) ?? []) reveladas.add(revelada);
  const subtemas = new Set();
  for (const h of otros) {
    if (h.jugador !== hueco.jugador || h.papel !== hueco.papel) continue;
    const q = indice.porId.get(h.pregunta) ?? d.resultados.find((r) => r.pregunta === h.pregunta)?.q;
    if (q) subtemas.add(q.subtema);
  }
  for (const r of d.resultados) {
    if (r.jugador === hueco.jugador && r.papel === hueco.papel) subtemas.add(r.q.subtema);
  }
  const posibles = [...indice.porId.values()]
    .filter((q) => q.categoria === hueco.tema && !excluidas.has(q.id) && !reservadas.has(q.id) && jugable(q, opciones))
    .sort(porId);
  const vistasJugador = vistas?.[hueco.jugador] ?? {};
  const min = indice.min ?? config.niveles.min;
  const max = indice.max ?? config.niveles.max;
  for (let distancia = 0; distancia <= max - min; distancia++) {
    for (const nivel of distancia ? [hueco.nivel - distancia, hueco.nivel + distancia] : [hueco.nivel]) {
      let grupo = posibles.filter((q) => nivelDe(q) === nivel);
      if (!grupo.length) continue;
      const nuevas = grupo.filter((q) => !(q.id in vistasJugador));
      if (nuevas.length) {
        grupo = nuevas;
      } else {
        const antigua = grupo.map((q) => vistasJugador[q.id]).sort()[0];
        grupo = grupo.filter((q) => vistasJugador[q.id] === antigua);
      }
      const sinFuga = grupo.filter((q) => !reveladas.has(q.id) && ![...(revela?.get(q.id) ?? [])].some((id) => usadas.has(id)));
      if (sinFuga.length) grupo = sinFuga;
      const variados = grupo.filter((q) => !subtemas.has(q.subtema));
      const q = elegir(variados.length ? variados : grupo, rng);
      return { ...d, plan: d.plan.map((h, i) => i === d.paso ? { ...h, pregunta: q.id } : h) };
    }
  }
  return null;
}

// Se copian los datos de preparación: cambiar después un formulario no debe cambiar un duelo ya creado.
export function nuevoDuelo({ id, jugadores, plan, ahora, versiones = null, modo = "normal" }) {
  // Cada vuelta son cuatro huecos: la fácil y la difícil de cada jugador.
  if (jugadores.length !== 2 || !plan.length || plan.length % 4) throw new Error("El duelo necesita dos jugadores y cuatro huecos por vuelta.");
  return {
    id,
    modo,
    creado: ahora,
    terminado: null,
    versiones: versiones ? { ...versiones } : null,
    jugadores: jugadores.map((j) => ({ ...j })),
    plan: plan.map((h) => ({ ...h })),
    paso: 0,
    fase: "preparar",
    inicio: null,
    consumido: 0,
    actual: null,
    orden: null,
    resultados: [],
    final: null,
  };
}

export const huecoActual = (d) => d.fase === "fin" ? null : d.plan[d.paso] ?? null;

export function cambioDeJugador(d) {
  const hueco = huecoActual(d);
  return Boolean(hueco && (d.paso === 0 || hueco.jugador !== d.plan[d.paso - 1].jugador));
}

// La foto se prepara con S.fotoPregunta(q, opciones, config, hueco.nivel). Sus reglas no dependen de futuras actualizaciones.
export function empezarPregunta(d, { ahoraMs, foto, orden = null }) {
  if (d.fase !== "preparar" || !huecoActual(d)) throw new Error("No toca empezar una pregunta.");
  if (!foto || foto.id !== huecoActual(d).pregunta || !foto.reglas) {
    throw new Error("La foto debe corresponder al hueco y guardar sus reglas.");
  }
  const actual = {
    ...foto,
    reglas: { ...foto.reglas },
    ...(foto.versiones ? { versiones: { ...foto.versiones } } : {}),
  };
  return { ...d, fase: "pregunta", inicio: ahoraMs, consumido: 0, actual, orden: orden == null ? null : [...orden] };
}

export function responderPregunta(d, { acierto, ms, ts, elegida = null, mapa = null }) {
  if (d.fase !== "pregunta") throw new Error("No hay ninguna pregunta en pantalla.");
  if (!Number.isFinite(ms)) throw new Error("El tiempo debe ser un número finito.");
  const hueco = huecoActual(d);
  const q = d.actual;
  const reglas = q.reglas;
  // Igual que con el reloj de sesión: lo ya consumido no se recupera. Los registros guardan milisegundos enteros.
  const tiempo = Math.round(Math.max(0, ms, d.consumido ?? 0));
  const agotado = tiempo >= reglas.segundos * 1000;
  const bien = Boolean(acierto) && !agotado;
  const mult = bien ? multiplicador(tiempo, reglas.segundos, reglas.multiplicador_max) : 0;
  const resultado = {
    paso: d.paso,
    jugador: hueco.jugador,
    vuelta: hueco.vuelta,
    papel: hueco.papel,
    nivel: hueco.nivel,
    pregunta: q.id,
    q,
    ts,
    acierto: bien,
    agotado,
    // Sin tiempo, se apunta el que había: con la app cerrada horas, `ms` llegaba a millones y descargar.py tira los
    // registros con un entero de 10^6 o más.
    ms: agotado ? reglas.segundos * 1000 : tiempo,
    segundos: reglas.segundos,
    multiplicador: mult,
    puntos: bien ? Math.round(reglas.puntos * mult) : 0,
    elegida,
    ...(mapa ? { mapa: { ...mapa } } : {}),
  };
  // Ni el fallo termina el duelo ni borra los puntos. La última opinión también espera a que se deje su resultado.
  // El final, en cuanto se sabe (al responder la pregunta 16), sin esperar a que se toque «Seguir»: quien cierra la app
  // en esa pantalla también deja el resultado del duelo (como en el modo solo desde el 12-11-2026).
  const completo = d.paso + 1 === huecosDe(d);
  return {
    ...d,
    fase: "resultado",
    paso: d.paso + 1,
    consumido: tiempo,
    resultados: [...d.resultados, resultado],
    final: completo ? "completo" : null,
    terminado: completo ? ts : null,
  };
}

export function valorarUltima(d, valoracion) {
  return valorarEnSolo(d, valoracion);
}

export function marcarMala(d, motivo) {
  if (d.fase !== "resultado") throw new Error("No hay ningún resultado que marcar.");
  // La pantalla ofrece los ids de config.motivos_mala; aquí solo se exige un id escalar, no una configuración global.
  if (motivo !== null && (typeof motivo !== "string" || !motivo.trim() || motivo.length >= 200)) {
    throw new Error("El motivo debe ser un id de texto o null.");
  }
  const ultimo = d.resultados.length - 1;
  return { ...d, resultados: d.resultados.map((r, i) => i === ultimo ? { ...r, mala: motivo } : r) };
}

export function seguir(d) {
  if (d.fase !== "resultado") throw new Error("No hay ningún resultado que dejar atrás.");
  return {
    ...d,
    fase: d.final ? "fin" : "preparar",
    inicio: null,
    consumido: 0,
    actual: null,
    orden: null,
  };
}

export function abandonar(d, { ts } = {}) {
  if (!["preparar", "pregunta", "resultado"].includes(d.fase)) throw new Error("El duelo ya ha terminado.");
  // Con la pregunta 16 ya respondida, el duelo está completo: salir no lo convierte en abandonado.
  if (d.final) return seguir(d);
  // La pregunta que aún no se ha respondido no genera resultado ni cuenta como vista por este módulo.
  return { ...d, fase: "fin", final: "abandonado", terminado: ts, inicio: null, consumido: 0, actual: null, orden: null };
}

export function tiempoAgotado(d, ahoraMs, extra = 0) {
  return d.fase === "pregunta" && transcurrido(d, ahoraMs, extra) >= d.actual.reglas.segundos * 1000;
}

export function puntos(d) {
  return d.resultados.reduce((totales, r) => {
    totales[r.jugador] += r.puntos;
    return totales;
  }, [0, 0]);
}

export function aciertos(d) {
  return d.resultados.reduce((totales, r) => {
    if (r.acierto) totales[r.jugador]++;
    return totales;
  }, [0, 0]);
}

export function ganador(d) {
  const p = puntos(d);
  const a = aciertos(d);
  const diferencia = p[0] - p[1] || a[0] - a[1];
  return diferencia === 0 ? null : diferencia > 0 ? 0 : 1;
}

export function emojisJugador(d, jugador) {
  return d.resultados.filter((r) => r.jugador === jugador)
    .map((r) => r.acierto ? (r.multiplicador >= 1.5 ? "⚡" : "🟩") : r.agotado ? "⏰" : "🟥")
    .join("");
}

export function textoCompartir(d, { nombreApp, nombreTema = (tema) => tema, url = null }) {
  const [a, b] = d.jugadores;
  const p = puntos(d);
  const quien = ganador(d);
  const numero = (n) => new Intl.NumberFormat("es-ES").format(n);
  return [
    `${nombreApp} · Duelo${d.modo === "veloz" ? " veloz" : ""}`,
    `${a.nombre} (${nombreTema(a.tema)}) ${numero(p[0])} – ${numero(p[1])} ${b.nombre} (${nombreTema(b.tema)})`,
    `${a.nombre}: ${emojisJugador(d, 0)}`,
    `${b.nombre}: ${emojisJugador(d, 1)}`,
    quien === null ? "Empate" : `Gana ${d.jugadores[quien].nombre} 🏆`,
    url,
  ].filter(Boolean).join("\n");
}

export function resumenDuelo(d) {
  // Solo los completos entran en el historial de victorias; null evita apuntar por accidente un abandono.
  if (d.final !== "completo") return null;
  const p = puntos(d);
  const a = aciertos(d);
  const quien = ganador(d);
  return {
    id: d.id,
    modo: d.modo ?? "normal",
    ts: d.terminado,
    jugadores: d.jugadores.map((j, i) => ({ clave: j.clave, nombre: j.nombre, tema: j.tema, puntos: p[i], aciertos: a[i] })),
    ganador: quien === null ? null : d.jugadores[quien].clave,
  };
}

export function caraACara(historial, claveA, claveB) {
  const cuenta = { a: 0, b: 0, empates: 0 };
  if (claveA === claveB) return cuenta;
  for (const duelo of historial ?? []) {
    if (duelo.final && duelo.final !== "completo") continue;
    const pareja = duelo.jugadores;
    if (pareja?.length !== 2 || !pareja.some((j) => j.clave === claveA) || !pareja.some((j) => j.clave === claveB)) continue;
    if (duelo.ganador === claveA) cuenta.a++;
    else if (duelo.ganador === claveB) cuenta.b++;
    else if (duelo.ganador === null) cuenta.empates++;
  }
  return cuenta;
}

// Los ids dependen del duelo y del paso, no del momento de guardado: retomar y volver a guardar no duplica registros.
function comunes(d, ctx, q = null) {
  const versiones = q?.versiones ?? d.versiones ?? ctx.versiones ?? {};
  return {
    dispositivo: ctx.dispositivo ?? null,
    version_banco: versiones.banco ?? null,
    version_ajustes: versiones.ajustes ?? null,
    duelo: d.id,
    // Un duelo de antes de que hubiera modos es normal.
    modo_duelo: d.modo ?? "normal",
  };
}

const datosPregunta = (q) => ({
  pregunta: q.id,
  v: q.v,
  categoria: q.categoria,
  subtema: q.subtema,
  nivel_inicial: q.nivel,
  nivel_mostrado: q.nivelEfectivo ?? q.nivel,
});

export function registrosDuelo(d, ctx) {
  const acumulados = [0, 0];
  const registros = d.resultados.map((r) => {
    const jugador = d.jugadores[r.jugador];
    const rival = d.jugadores[1 - r.jugador];
    acumulados[r.jugador] += r.puntos;
    return {
      id: `${d.id}-r${r.paso + 1}`,
      tipo: "duelo",
      ts: r.ts,
      ...comunes(d, ctx, r.q),
      jugador: jugador.clave,
      rival: rival.clave,
      tema_propio: jugador.tema,
      tema_rival: rival.tema,
      turno: r.paso + 1,
      vuelta: r.vuelta,
      papel: r.papel,
      nivel: r.nivel,
      ...datosPregunta(r.q),
      respuesta_dada: r.elegida == null ? null : String(r.elegida).slice(0, 200),
      opciones: r.q.huella ?? null,
      acierto: r.acierto,
      tiempo_agotado: r.agotado,
      ms: r.ms,
      segundos: r.segundos,
      multiplicador: r.multiplicador,
      puntos: r.puntos,
      total: acumulados[r.jugador],
      ...(r.mapa ? {
        lat_senalada: r.mapa.lat,
        lon_senalada: r.mapa.lon,
        distancia_km: r.mapa.distancia_km,
        distancia_max_km: r.q.distancia_max_km,
      } : {}),
    };
  });
  d.resultados.forEach((r, i) => {
    if ((!r.valoracion && !r.mala) || (d.fase === "resultado" && i === d.resultados.length - 1)) return;
    registros.push({
      id: `${d.id}-v${r.paso + 1}`,
      tipo: "revision",
      origen: "duelo",
      ts: r.ts,
      ...comunes(d, ctx, r.q),
      papel: r.papel,
      evaluador: d.jugadores[r.jugador].clave,
      ...datosPregunta(r.q),
      acierto: r.acierto,
      valoracion: r.valoracion ?? null,
      nivel_desde: null,
      nivel_hasta: null,
      mala: r.mala ?? null,
    });
  });
  // Un duelo abandonado antes de responder nada no deja finales: no dice nada y solo ensuciaría la hoja.
  if (d.final && d.resultados.length) {
    const p = puntos(d);
    const a = aciertos(d);
    const quien = ganador(d);
    d.jugadores.forEach((jugador, i) => {
      const rival = d.jugadores[1 - i];
      registros.push({
        id: `${d.id}-fin${i + 1}`,
        tipo: "duelo_fin",
        ts: d.terminado,
        ...comunes(d, ctx),
        jugador: jugador.clave,
        rival: rival.clave,
        tema_propio: jugador.tema,
        tema_rival: rival.tema,
        puntos: p[i],
        aciertos: a[i],
        puntos_rival: p[1 - i],
        aciertos_rival: a[1 - i],
        respondidas: d.resultados.filter((r) => r.jugador === i).length,
        resultado: d.final === "abandonado" ? "abandonado" : quien === null ? "empate" : quien === i ? "gana" : "pierde",
        final: d.final,
      });
    });
  }
  return registros;
}
