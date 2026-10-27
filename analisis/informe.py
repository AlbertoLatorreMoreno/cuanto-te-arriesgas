"""Informe de calibración (analisis/salida/informe.md) y tabla de niveles (niveles.csv)."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from scipy.special import expit, logit
from scipy.stats import norm

from calibracion import Resultado, contar, suma_por


def celda(texto) -> str:
    """Un texto que viene de los datos (un nombre), seguro dentro de una tabla de Markdown: sin barras ni saltos de
    línea que la rompan y sin HTML. Los datos de la hoja del grupo los puede haber enviado cualquiera."""
    return (str(texto).replace("\\", "\\\\").replace("|", "\\|").replace("<", "&lt;").replace(">", "&gt;")
            .replace("\r", " ").replace("\n", " "))


def tabla_niveles(res: Resultado, previos: dict | None = None) -> list[dict]:
    b, d = res.banco, res.datos
    n = len(b)
    q_resp = [x["q"] for x in d.respuestas]
    n_resp = contar(q_resp, n)
    aciertos = suma_por(q_resp, [x["y"] for x in d.respuestas], n).astype(int)
    n_val = contar([x["q"] for x in d.valoraciones], n)
    actual = b.nivel.copy()
    previos = previos or {}
    for id_, nivel in (previos.get("niveles") or {}).items():
        i = b.posicion.get(id_)
        # Como en la app: un ajuste anterior no vale si la pregunta ha cambiado de versión desde entonces.
        v_previa = (previos.get("versiones") or {}).get(id_)
        if i is not None and (v_previa is None or int(v_previa) == b.v[i]):
            actual[i] = int(nivel)
    retiradas = res.ajustes["retiradas"]
    return [{"id": b.id[i], "categoria": b.categoria[i], "subtema": b.subtema[i], "nivel_inicial": int(b.nivel[i]),
             "nivel_anterior": int(actual[i]), "nivel_nuevo": int(res.nuevo[i]), "nivel_continuo": round(float(res.ajuste.nivel_continuo[i]), 2),
             "incertidumbre": None if math.isnan(res.ajuste.sd_nivel[i]) else round(float(res.ajuste.sd_nivel[i]), 2),
             "n_respuestas": int(n_resp[i]), "aciertos": int(aciertos[i]), "n_valoraciones": int(n_val[i]), "retirada": b.id[i] in retiradas}
            for i in range(n)]


def escribir_csv(tabla: list[dict], ruta: Path):
    """CSV con punto decimal, para que lo lean otros programas (el informe usa coma). Mismo formato que
    el `write.csv` de R: texto entre comillas, NA, TRUE y FALSE sin ellas."""
    def celda(x) -> str:
        if x is None:
            return "NA"
        if isinstance(x, bool):
            return "TRUE" if x else "FALSE"
        if isinstance(x, float):
            return f"{x:.15g}"
        if isinstance(x, str):
            return '"' + x.replace('"', '""') + '"'
        return str(x)

    lineas = [",".join(celda(k) for k in tabla[0])] if tabla else []
    lineas += [",".join(celda(x) for x in fila.values()) for fila in tabla]
    Path(ruta).write_text("\n".join(lineas) + "\n", encoding="utf-8")


# ------------------------------------------------------------------ formato

def pct(x) -> str:
    return "—" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{round(100 * x)} %"


def num(x, d: int = 2, signo: bool = False) -> str:
    """Números con coma decimal para el informe."""
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "—"
    return f"{x:{'+' if signo else ''}.{d}f}".replace(".", ",")


def plural(n: int, singular: str, plural_: str | None = None) -> str:
    return f"{n} {singular if n == 1 else (plural_ or singular + 's')}"


def nombre_categoria(cfg: dict, id_: str) -> str:
    return next((c["nombre"] for c in cfg["categorias"] if c["id"] == id_), id_)


def media(xs) -> float | None:
    xs = list(xs)
    return sum(xs) / len(xs) if xs else None


# ------------------------------------------------------------------ regresión de referencia

def glm_logistico(y: np.ndarray, X: np.ndarray, iteraciones: int = 50):
    """Regresión logística sin penalizar por IRLS (como `glm(family = binomial)`): estimaciones y errores típicos."""
    b = np.zeros(X.shape[1])
    for _ in range(iteraciones):
        p = expit(X @ b)
        w = np.maximum(p * (1 - p), 1e-10)
        info = X.T @ (X * w[:, None])
        paso = np.linalg.solve(info, X.T @ (y - p))
        b = b + paso
        if np.max(np.abs(paso)) < 1e-10:
            break
    p = expit(X @ b)
    info = X.T @ (X * (p * (1 - p))[:, None])
    return b, np.sqrt(np.diag(np.linalg.inv(info)))


def seccion_glm(res: Resultado) -> list[str]:
    d = res.datos
    y = np.array([x["y"] for x in d.respuestas], dtype=float)
    nivel = np.array([x["nivel"] for x in d.respuestas], dtype=float)
    cat = [res.banco.categoria[x["q"]] for x in d.respuestas]
    niveles_cat = sorted(set(cat))  # la primera es la de referencia, como los factores de R
    X = np.column_stack([np.ones(len(y)), nivel] + [np.array([c == k for c in cat], dtype=float) for k in niveles_cat[1:]])
    try:
        b, se = glm_logistico(y, X)
    except np.linalg.LinAlgError:
        return []
    nombres = ["(intercepto)", "nivel"] + [f"categoría: {nombre_categoria(res.config, k)}" for k in niveles_cat[1:]]
    L = ["## Regresión logística de referencia", "",
         f"Acierto según el nivel y la categoría (`glm(acierto ~ nivel + categoria, family = binomial)`), sin efectos por jugador ni por pregunta. "
         f"Categoría de referencia: {nombre_categoria(res.config, niveles_cat[0])}.", "",
         "| | Estimación | Error típico | z | p |", "|---|---|---|---|---|"]
    for nombre, est, e in zip(nombres, b, se):
        z = est / e
        L.append(f"| {nombre} | {num(est, 3)} | {num(e, 3)} | {num(z, 3)} | {num(2 * norm.sf(abs(z)), 3)} |")
    return L + [""]


# ------------------------------------------------------------------ informe

def escribir_informe(res: Resultado, ruta: Path, previos: dict | None = None):
    d, u, cfg = res.datos, res.ajuste.u, res.config
    tab = tabla_niveles(res, previos)
    obj = list(cfg["objetivo_acierto"])
    L: list[str] = []
    add = L.append

    add("# Informe de calibración")
    add("")
    add(f"Generado: {res.ajustes['version']}")
    add("")
    add("## Datos")
    add("")
    add("| | |")
    add("|---|---|")
    add(f"| Archivos de exportación | {res.exportaciones.n_archivos} |")
    add(f"| Registros (sin duplicados) | {d.n_registros} |")
    add(f"| Duplicados eliminados | {res.exportaciones.n_duplicados} |")
    add(f"| Preguntas jugadas | {len(d.respuestas)} |")
    add(f"| Valoraciones de nivel | {len(d.valoraciones)} |")
    n_horquilla = sum(1 for x in d.valoraciones if x["horquilla"])
    if n_horquilla:
        add(f"| … de ellas, con horquilla de niveles | {n_horquilla} |")
    add(f"| Marcas de calidad | {len(d.marcas)} |")
    add(f"| Descartados: pregunta que ya no existe | {d.descartes['pregunta_desconocida']} |")
    add(f"| Descartados: versión antigua de la pregunta | {d.descartes['version_antigua']} |")
    add(f"| Fuera del modelo: quien responde ya había visto la pregunta (lo marcó la app) | {d.descartes['repetida']} |")
    add(f"| Fuera del modelo: quien responde ya la había visto en un registro anterior (lo detecta la calibración) | {d.descartes['vista_antes']} |")
    add("")
    ign = res.exportaciones.ignorados
    if ign:
        lista = " · ".join(f"`{k}`: {v}" for k, v in ign.items())
        add(f"**Archivos ignorados** ({len(ign)}): {lista} Si es una exportación de la app que se cortó, vuelve a exportar desde el móvil: el archivo nuevo lo incluye todo.")
        add("")

    if d.respuestas:
        add("## Aciertos por nivel mostrado")
        add("")
        add("Si el banco está bien calibrado, el porcentaje observado se parece al objetivo.")
        add("")
        add("| Nivel | Preguntas | Aciertos | Objetivo |")
        add("|---|---|---|---|")
        for n in range(1, len(obj) + 1):
            ys = [x["y"] for x in d.respuestas if x["nivel"] == n]
            add(f"| {n} | {len(ys)} | {pct(media(ys))} | {pct(obj[n - 1])} |")
        add("")
        ap = [x["apuesta"] for x in d.respuestas if not x["es_final"]]
        if ap:
            add("## Apuestas (sin contar finales)")
            add("")
            add("| Nivel | " + " | ".join(str(n) for n in range(1, len(obj) + 1)) + " |")
            add("|---|" + "|".join(["---"] * len(obj)) + "|")
            add("| Veces | " + " | ".join(str(sum(1 for a in ap if a == n)) for n in range(1, len(obj) + 1)) + " |")
            add("")
            add("Si casi todo se concentra entre 4 y 7, plantead las cartas de apuesta que se gastan.")
            add("")
        con_reloj = [x for x in d.respuestas if x["cronometro"] is not None]
        if con_reloj:
            cats_reloj = list(dict.fromkeys(res.banco.categoria[x["q"]] for x in con_reloj))
            sin_reloj = [x for x in d.respuestas if x["cronometro"] is None and res.banco.categoria[x["q"]] in cats_reloj]
            nombres = ", ".join(nombre_categoria(cfg, c) for c in cats_reloj)
            add(f"## Cronómetro ({nombres})")
            add("")
            add("| | Respuestas | Aciertos | Se acabó el tiempo |")
            add("|---|---|---|---|")
            add(f"| Con cronómetro | {len(con_reloj)} | {pct(media(x['y'] for x in con_reloj))} | {sum(1 for x in con_reloj if x['tiempo_agotado'] is True)} |")
            add(f"| Sin cronómetro | {len(sin_reloj)} | {pct(media(x['y'] for x in sin_reloj))} | — |")
            add("")
            add(f"Los niveles se calibran con todas las respuestas juntas. Si alternáis partidas con y sin cronómetro, los de {nombres} quedan "
                "entre medias; si siempre jugáis igual, reflejan esa forma de jugar.")
            add("")

    add("## Parámetros del modelo")
    add("")
    add("Ajustes en niveles (positivo: más difícil de lo que decía el nivel inicial):")
    add("")
    add(f"- Global: {num(u['global'], signo=True)}")
    for i, c in enumerate(res.modelo.categorias):
        add(f"- {nombre_categoria(cfg, c)}: {num(float(u['cat'][i]), signo=True)}")
    if d.valoraciones:
        add("")
        add("Valoraciones:")
        add("")
        n_fallo = sum(x["fallo"] for x in d.valoraciones)
        n_rev = sum(x["rev"] for x in d.valoraciones)
        add(f"- Quien falla valora la pregunta {num(u['beta'], signo=True)} niveles respecto a quien acierta (positivo: la ve más difícil). "
            f"Sale de {plural(n_fallo, 'valoración', 'valoraciones')} tras fallar.")
        add(f"- En el modo revisión se valora {num(u['gamma'], signo=True)} niveles respecto a las partidas (negativo: se ven más fáciles). "
            f"Sale de {plural(n_rev, 'valoración', 'valoraciones')} en revisión.")
        if min(n_fallo, n_rev) < 20:
            add("- Un efecto que sale de menos de 20 valoraciones es poco fiable.")
        fija = (cfg["modelo"].get("sd_log_escala_valoracion") or 0) <= 0
        add(f"- Ruido de las valoraciones: {num(math.exp(u['ls']))} niveles{' (fijo: `modelo.escala_valoracion`)' if fija else ''}.")
    add("")
    if res.modelo.jugadores:
        add("### Jugadores")
        add("")
        add("| Jugador | Respuestas | Aciertos | Prob. de acertar un nivel 5 |")
        add("|---|---|---|---|")
        p5 = obj[4]
        for i, jg in enumerate(res.modelo.jugadores):
            ys = [x["y"] for x in d.respuestas if x["jugador"] == jg]
            add(f"| {celda(jg)} | {len(ys)} | {pct(media(ys))} | {pct(float(expit(u['theta'][i] + logit(p5))))} |")
        add("")

    movidas = [f for f in tab if f["nivel_nuevo"] != f["nivel_inicial"]]
    add(f"## Preguntas que cambian de nivel ({len(movidas)} de {len(tab)})")
    add("")
    add(f"Solo cambian las que tienen al menos {cfg['modelo']['min_datos_cambio']} datos (respuestas más valoraciones).")
    add("")
    if movidas:
        movidas.sort(key=lambda f: -abs(f["nivel_continuo"] - f["nivel_inicial"]))
        add("| Pregunta | Inicial | Nuevo | Continuo ± incert. | Respuestas | Aciertos | Valoraciones |")
        add("|---|---|---|---|---|---|---|")
        for f in movidas[:40]:
            inc = "" if f["incertidumbre"] is None else f" ± {num(f['incertidumbre'])}"
            add(f"| {f['id']} | {f['nivel_inicial']} | {f['nivel_nuevo']} | {num(f['nivel_continuo'])}{inc} | {f['n_respuestas']} | {f['aciertos']} | {f['n_valoraciones']} |")
        if len(movidas) > 40:
            add(f"(… y {len(movidas) - 40} más en niveles.csv)")
    else:
        add("Ninguna: todavía no hay datos suficientes para mover niveles.")
    add("")

    ret = res.ajustes["retiradas"]
    add(f"## Preguntas retiradas ({len(ret)})")
    add("")
    if ret:
        for id_, motivo in ret.items():
            add(f"- {id_}: {motivo}")
        add("")
        add("Revísalas a mano. Si alguna está bien, añade su id a `analisis/restaurar.txt` y vuelve a calibrar; si la arreglas, "
            "sube su `v` (en cuanto publiques el banco, la app la vuelve a sacar con su nivel inicial).")
    else:
        add("Ninguna.")
    add("")

    activas = [f for f in tab if not f["retirada"]]
    add("## Huecos en el banco tras la calibración")
    add("")
    huecos = []
    for cat in cfg["categorias"]:
        for sub in cat["subtemas"]:
            for n in range(1, len(obj) + 1):
                k = sum(1 for f in activas if f["categoria"] == cat["id"] and f["subtema"] == sub["id"] and f["nivel_nuevo"] == n)
                if k < 2:
                    # El generador no hace preguntas de mapa: esas se escriben a mano.
                    a_mano = " (de mapa: a mano)" if cat.get("tipo") == "mapa" else ""
                    huecos.append(f"- {cat['nombre']} / {sub['nombre']}, nivel {n}: {plural(k, 'pregunta')}{a_mano}")
    if huecos:
        add("Combinaciones con menos de 2 preguntas (el generador debería rellenarlas; las de mapa se escriben a mano):")
        add("")
        L += huecos
    else:
        add("Ninguno.")
    add("")

    if cfg.get("rondas"):
        ro = res.rondas
        add("## Rondas divertidas")
        add("")
        add("No entran en el cálculo de niveles. Cada acierto es una casilla que se avanza.")
        add("")
        if not ro["tabla"]:
            add("Todavía no se ha jugado ninguna.")
        else:
            aviso = cfg["rondas"].get("media_aviso") or {}
            minimo = aviso.get("minimo_jugadas", 3)
            add("| Ronda | Tipo | Veces | Aciertos de media | Máximo | De | Tiempo | Cambiada | Mala | |")
            add("|---|---|---|---|---|---|---|---|---|---|")
            for f in ro["tabla"]:
                tipo = "ráfaga" if f["tipo"] == "rafaga" else ("lista" if f["cerrada"] else "lista abierta")
                if f["veces"] < minimo:
                    nota = "pocos datos"
                elif aviso.get("alta") is not None and f["media"] > aviso["alta"]:
                    nota = "da muchas casillas: baja su tiempo"
                elif aviso.get("baja") is not None and f["media"] < aviso["baja"]:
                    nota = "da muy pocas: sube su tiempo"
                else:
                    nota = ""
                maximo = "—" if f["maximo"] is None else f"{f['maximo']:g}"
                de = "—" if tipo == "lista abierta" else f["total"]
                add(f"| {f['titulo']} | {tipo} | {f['veces']} | {num(f['media'], 1)} | {maximo} | {de} | {f['segundos']} s | {f['cambiada']} | {f['malas']} | {nota} |")
            add("")
            add(f"Media de referencia: una pregunta bien apostada da unos 2,8 puntos por turno. Avisa si una ronda da de media más de "
                f"{num(aviso.get('alta'), 0)} casillas o menos de {num(aviso.get('baja'), 0)} (con al menos {minimo} jugadas). "
                "Si cambias el tiempo o los elementos de una ronda, sube su `v`: sus datos anteriores dejan de contar aquí.")
            fuera = []
            if ro["repetidas"]:
                fuera.append(f"{plural(ro['repetidas'], 'jugada')} en que quien jugaba ya conocía la ronda")
            if ro["otra_version"]:
                fuera.append(f"{plural(ro['otra_version'], 'jugada')} de una versión anterior")
            if fuera:
                add("")
                add(f"Fuera de estas cuentas: {' y '.join(fuera)}.")
        add("")

    if cfg.get("final", {}).get("archivo"):
        fi = res.finales
        obj = fi["objetivos"]
        add("## Preguntas finales")
        add("")
        add("Tienen su propio archivo y no entran en el cálculo de niveles. Se buscaba acertarlas un "
            + ", ".join(f"{pct(x)} (nivel {n})" for n, x in sorted(obj.items())) + " de las veces.")
        add("")
        if not fi["tabla"]:
            add("Todavía no se ha jugado ninguna.")
        else:
            add("| Nivel | Jugadas | Acertadas | Acierto | Objetivo |")
            add("|---|---|---|---|---|")
            for f in fi["niveles"]:
                add(f"| {f['nivel']} | {f['jugadas']} | {f['acertadas']} | {pct(f['acierto'])} | {pct(f['objetivo'])} |")
            add("")
            add("| Final | Tipo | Nivel | Veces | Acertada | Aciertos de media | Más fácil / difícil | Cambiada | Mala | |")
            add("|---|---|---|---|---|---|---|---|---|---|")
            for f in fi["tabla"]:
                objetivo = obj.get(f["nivel"])
                if f["veces"] < 3:
                    nota = "pocos datos"
                elif objetivo is not None and f["acertada"] / f["veces"] > 2 * objetivo:
                    nota = "demasiado fácil: súbela de nivel" if f["nivel"] < max(obj, default=10) else "demasiado fácil: cámbiala por otra"
                else:
                    nota = ""
                tipo = f"reto ({f['minimo']} de {f['total']})" if f["tipo"] == "reto" else "pregunta"
                media_aciertos = "—" if f["media_aciertos"] is None else num(f["media_aciertos"], 1)
                valoracion = "—" if f["tipo"] == "reto" else f"{f['facil']} / {f['dificil']}"
                add(f"| {f['titulo']} | {tipo} | {f['nivel']} | {f['veces']} | {f['acertada']} | {media_aciertos} | {valoracion} | {f['cambiada']} | {f['malas']} | {nota} |")
            add("")
            add("Avisa si una final se acierta más del doble de lo buscado (con al menos 3 jugadas). "
                "Si cambias el texto, la respuesta, el tiempo o el mínimo de una final, sube su `v`: sus datos anteriores dejan de contar aquí.")
            fuera = []
            if fi["repetidas"]:
                fuera.append(f"{plural(fi['repetidas'], 'jugada')} en que quien jugaba ya conocía la final")
            if fi["otra_version"]:
                fuera.append(f"{plural(fi['otra_version'], 'jugada')} de una versión anterior")
            if fuera:
                add("")
                add(f"Fuera de estas cuentas: {' y '.join(fuera)}.")
        add("")

    if len(d.respuestas) >= 30 and len({x["y"] for x in d.respuestas}) == 2:
        L += seccion_glm(res)

    Path(ruta).write_text("\n".join(L) + "\n", encoding="utf-8")
