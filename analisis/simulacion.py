"""Simulador de partidas con «verdad» conocida, para probar la calibración sin datos reales.
Escribe una exportación con el mismo formato que la app."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from scipy.special import expit, logit

from calibracion import Banco, TablaObjetivo


def simular_exportacion(config: dict, banco: Banco, archivo: Path, semilla: int = 1, n_partidas: int = 30, n_jugadores: int = 5,
                        revisiones_por_jugador: int = 40, prob_valorar: float = 0.5, prob_horquilla: float = 0.3) -> dict:
    rng = np.random.default_rng(semilla)
    cats = [c["id"] for c in config["categorias"]]
    efecto = [0, 0.5, -0.7, 0.3] + [0] * max(0, len(cats) - 4)
    verdad_cat = dict(zip(cats, efecto))
    Q = len(banco)
    nivel_real = np.clip(banco.nivel + np.array([verdad_cat[c] for c in banco.categoria]) + rng.normal(0, 1.2, Q), 0.6, 10.4)
    jugadores = [f"jugador {k + 1}" for k in range(n_jugadores)]
    habilidad = rng.normal(0, 0.8, n_jugadores)
    habilidad -= habilidad.mean()
    sesgo = rng.normal(0, 0.3, n_jugadores)
    b_fallo, b_revision, escala = 0.6, -0.3, 0.8
    # Preguntas «malas» de niveles intermedios (las que más salen), para que se lleguen a jugar.
    intermedias = [banco.id[i] for i in range(Q) if 4 <= banco.nivel[i] <= 7]
    malas = [str(x) for x in rng.choice(intermedias, 6, replace=False)]
    erronea = malas[0]
    p_obj = TablaObjetivo(config).p
    rango = config["niveles"]
    pesos_apuesta = np.array([2, 3, 5, 7, 9, 9, 7, 5, 3, 2], dtype=float)
    pesos_apuesta /= pesos_apuesta.sum()

    def valorar(percibido, mostrado):
        return "facil" if percibido < mostrado - 0.5 else "dificil" if percibido > mostrado + 0.5 else "justa"

    def horquilla(percibido):
        # El nivel que se percibe o, la mitad de las veces, ese y el de al lado (al azar, para que cada
        # nivel de la horquilla tenga la misma probabilidad de ser el percibido).
        n = int(min(rango["max"], max(rango["min"], round(percibido))))
        if rng.random() < 0.5:
            return n, n
        return (max(rango["min"], n - 1), n) if rng.random() < 0.5 else (n, min(rango["max"], n + 1))

    reloj = [datetime(2026, 10, 1, 18, 0, 0, tzinfo=timezone.utc)]

    def marca_tiempo():
        reloj[0] += timedelta(seconds=40)
        return reloj[0].strftime("%Y-%m-%dT%H:%M:%S.000Z")

    registros = []
    k = 0
    # Como la app: a cada jugador le salen preguntas que no ha visto (respondiendo o leyendo); si no queda
    # ninguna de ese nivel, una ya vista, marcada como «repetida». Sin esto, el simulador repetía preguntas
    # entre partidas y la calibración (con razón) descartaba muchas respuestas.
    vistas: list[set[int]] = [set() for _ in range(n_jugadores)]
    for g in range(1, n_partidas + 1):
        partida = f"sim-partida-{g:03d}"
        usadas: set[int] = set()
        en_mesa = rng.choice(n_jugadores, int(rng.integers(3, min(5, n_jugadores) + 1)), replace=False)
        for t in range(1, int(rng.integers(40, 71)) + 1):
            j = int(en_mesa[(t - 1) % len(en_mesa)])
            lector = int(en_mesa[t % len(en_mesa)])
            apuesta = int(rng.choice(10, p=pesos_apuesta)) + 1
            candidatas = [i for i in range(Q) if banco.nivel[i] == apuesta and i not in usadas]
            if not candidatas:
                continue
            nuevas = [i for i in candidatas if i not in vistas[j]]
            q = int(rng.choice(nuevas or candidatas))
            alternativa = None if nuevas else "repetida"
            usadas.add(q)
            vistas[j].add(q)
            vistas[lector].add(q)
            acierto = bool(rng.random() < expit(habilidad[j] + logit(p_obj(np.array([nivel_real[q]]))[0])))
            valoracion = None
            if rng.random() < prob_valorar:
                valoracion = valorar(nivel_real[q] + sesgo[j] + b_fallo * (not acierto) + rng.logistic(0, escala), banco.nivel[q])
            mala = None
            if banco.id[q] == erronea:
                mala = "erronea"
            elif banco.id[q] in malas and rng.random() < 0.7:
                mala = "ambigua"
            k += 1
            registros.append({
                "id": f"sim-{k:06d}", "tipo": "respuesta", "ts": marca_tiempo(), "dispositivo": "simulado",
                "partida": partida, "turno": t, "jugador": jugadores[j], "lector": jugadores[lector],
                "pregunta": banco.id[q], "v": int(banco.v[q]), "categoria": banco.categoria[q], "subtema": banco.subtema[q],
                "nivel_inicial": int(banco.nivel[q]), "nivel_mostrado": int(banco.nivel[q]), "subtema_anunciado": banco.subtema[q],
                "apuesta": apuesta, "es_final": False, "alternativa": alternativa, "acierto": acierto,
                "valoracion": valoracion, "mala": mala, "version_banco": "sim", "version_ajustes": "inicial",
            })

    for j in range(n_jugadores):
        for q in rng.choice(Q, revisiones_por_jugador, replace=False):
            q = int(q)
            k += 1
            percibido = nivel_real[q] + sesgo[j] + b_revision + rng.logistic(0, escala)
            hq = horquilla(percibido) if rng.random() < prob_horquilla else (None, None)
            registros.append({
                "id": f"sim-{k:06d}", "tipo": "revision", "ts": marca_tiempo(), "dispositivo": "simulado",
                "evaluador": jugadores[j], "pregunta": banco.id[q], "v": int(banco.v[q]), "categoria": banco.categoria[q],
                "subtema": banco.subtema[q], "nivel_inicial": int(banco.nivel[q]), "nivel_mostrado": int(banco.nivel[q]),
                "valoracion": valorar(percibido, banco.nivel[q]) if hq[0] is None else "horquilla",
                "nivel_desde": hq[0], "nivel_hasta": hq[1], "mala": None, "version_banco": "sim", "version_ajustes": "inicial",
            })

    exportacion = {"formato": 1, "app": "cuanto-te-arriesgas", "exportado": marca_tiempo(), "dispositivo": "simulado",
                   "version_banco": "sim", "version_ajustes": "inicial", "registros": registros}
    archivo = Path(archivo)
    archivo.parent.mkdir(parents=True, exist_ok=True)
    archivo.write_text(json.dumps(exportacion, ensure_ascii=False), encoding="utf-8")
    return {"nivel_real": nivel_real, "categoria": verdad_cat, "habilidad": dict(zip(jugadores, habilidad)),
            "b_fallo": b_fallo, "b_revision": b_revision, "escala": escala, "malas": malas, "erronea": erronea}
