"""Pruebas de la calibración y del modelo filtro. Uso: py -m unittest discover -s analisis

Son las que antes estaban en R (probar_calibracion.R), más las del simulador."""

from __future__ import annotations

import copy
import json
import math
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

from calibracion import (RAIZ, Banco, Modelo, TablaObjetivo, ajustar, calibrar, contar, cortes_valoracion, leer_banco, leer_config,
                         leer_exportaciones, leer_rondas, log_prob_valoracion, media_prevista, preparar_datos, retiradas_por_marcas,
                         vista_antes)
from informe import escribir_csv, escribir_informe, tabla_niveles
from modelo_filtro import CARACTERISTICAS, caracteristicas_de, entrenar_logistica_ridge, filtro_generador, prob_mala
from simulacion import simular_exportacion

CONFIG = leer_config(RAIZ)
BANCO = leer_banco(RAIZ, CONFIG)


def callado(_):
    pass


def calibrar_callado(carpeta, avisos=None):
    return calibrar(RAIZ, Path(carpeta), avisar=(avisos.append if avisos is not None else callado))


def escribir_exportacion(ruta: Path, registros: list[dict], **extra):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps({"formato": 1, "app": "cuanto-te-arriesgas", **extra, "registros": registros}, ensure_ascii=False), encoding="utf-8")


def leer_informe(res, tmp: Path, nombre: str) -> list[str]:
    ruta = tmp / nombre
    escribir_informe(res, ruta)
    return ruta.read_text(encoding="utf-8").splitlines()


def rmse(a, b) -> float:
    return float(np.sqrt(np.mean((np.asarray(a) - np.asarray(b)) ** 2)))


class ConSimulaciones(unittest.TestCase):
    """Dos exportaciones simuladas que comparten varias pruebas: una pequeña (3 partidas) y una grande (40)."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="calibracion-"))
        cls.verdad_peq = simular_exportacion(CONFIG, BANCO, cls.tmp / "peq" / "sim.json", semilla=7, n_partidas=3, revisiones_por_jugador=10)
        cls.verdad = simular_exportacion(CONFIG, BANCO, cls.tmp / "sim" / "sim.json", semilla=11, n_partidas=40)
        cls.res = calibrar_callado(cls.tmp / "sim")
        cls.res_peq = calibrar_callado(cls.tmp / "peq")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)


class TestModelo(ConSimulaciones):
    def _gradiente_numerico(self, modelo, par, indices, h=1e-5):
        salida = []
        for i in indices:
            e = np.zeros(len(par))
            e[i] = h
            salida.append((modelo.objetivo(par + e) - modelo.objetivo(par - e)) / (2 * h))
        return np.array(salida)

    def test_gradiente_analitico_frente_al_numerico(self):
        datos = preparar_datos(leer_exportaciones(self.tmp / "peq", avisar=callado).registros, BANCO, CONFIG)
        modelo = Modelo(datos, BANCO, CONFIG)
        rng = np.random.default_rng(3)
        par = modelo.inicial + rng.normal(0, 0.3, len(modelo.inicial))
        no_d = [i for i in range(len(par)) if i not in set(modelo.indices_d.tolist())]
        indices = list(dict.fromkeys(no_d + rng.choice(modelo.indices_d, 60, replace=False).tolist()
                                     + modelo.indices_d[np.unique(modelo.qA)][:20].tolist()))
        g = modelo.gradiente(par)
        num = self._gradiente_numerico(modelo, par, indices)
        err = float(np.max(np.abs(num - g[indices]) / np.maximum(1, np.abs(num))))
        self.assertLess(err, 1e-5, f"error relativo máximo {err:.1e}")
        # Lo mismo con la estimación del ruido de las valoraciones activada (modelo.sd_log_escala_valoracion > 0).
        config_ls = copy.deepcopy(CONFIG)
        config_ls["modelo"]["sd_log_escala_valoracion"] = 1
        modelo_ls = Modelo(datos, BANCO, config_ls)
        par_ls = np.concatenate([par, [math.log(CONFIG["modelo"]["escala_valoracion"]) + 0.2]])
        self.assertEqual(len(par_ls), len(modelo_ls.inicial))
        i_ls = indices + [len(par_ls) - 1]
        err_ls = float(np.max(np.abs(self._gradiente_numerico(modelo_ls, par_ls, i_ls) - modelo_ls.gradiente(par_ls)[i_ls])
                              / np.maximum(1, np.abs(self._gradiente_numerico(modelo_ls, par_ls, i_ls)))))
        self.assertLess(err_ls, 1e-5)

    def test_horquillas_y_particion(self):
        """Una horquilla «de 1 a 5» equivale a «más fácil» que un 6, «de 6 a 6» a «sí» y «de 7 a 10» a «más
        difícil»; las horquillas al revés o fuera de rango se descartan, y las probabilidades suman 1."""
        rango = CONFIG["niveles"]
        k = [cortes_valoracion(v, 6, a, b, rango) for v, a, b in [
            ("facil", None, None), ("horquilla", 1, 5), ("justa", None, None), ("horquilla", 6, 6), ("dificil", None, None),
            ("horquilla", 7, 10), ("horquilla", 4, 5), ("horquilla", 5, 4), ("horquilla", 0, 3)]]
        self.assertEqual(k[0], k[1])
        self.assertEqual(k[2], k[3])
        self.assertEqual(k[4], k[5])
        self.assertEqual(k[6], (3.5, 5.5))
        self.assertEqual(k[7], (None, None))
        self.assertEqual(k[8], (None, None))
        cortes_i = np.array([-np.inf, 3.5, 5.5, 7.5])
        cortes_s = np.array([3.5, 5.5, 7.5, np.inf])
        for U in (2.3, 5.1, 9.7):
            total = float(np.sum(np.exp(log_prob_valoracion(np.full(4, U), 1.3, cortes_i, cortes_s))))
            self.assertAlmostEqual(total, 1.0, places=12)

    def test_recupera_los_niveles_verdaderos(self):
        n_resp = contar([x["q"] for x in self.res.datos.respuestas], len(BANCO))
        con3 = n_resp >= 3
        real = self.verdad["nivel_real"]
        r_ini = rmse(BANCO.nivel[con3], real[con3])
        r_est = rmse(self.res.ajuste.nivel_continuo[con3], real[con3])
        self.assertLess(r_est, 0.8 * r_ini, f"RMSE {r_est:.2f} frente a {r_ini:.2f}, {int(con3.sum())} preguntas")

    def test_las_preguntas_sin_datos_no_empeoran(self):
        d = self.res_peq.datos
        sin = (contar([x["q"] for x in d.respuestas], len(BANCO)) == 0) & (contar([x["q"] for x in d.valoraciones], len(BANCO)) == 0)
        real = self.verdad_peq["nivel_real"]
        self.assertLessEqual(rmse(self.res_peq.ajuste.nivel_continuo[sin], real[sin]), rmse(BANCO.nivel[sin], real[sin]) + 0.02)

    def test_habilidades_y_efectos(self):
        u, m = self.res.ajuste.u, self.res.modelo
        hab = [float(u["theta"][m.jugadores.index(j)]) for j in self.verdad["habilidad"]]
        corr = float(np.corrcoef(hab, list(self.verdad["habilidad"].values()))[0, 1])
        self.assertGreater(corr, 0.8, f"correlación {corr:.2f}")
        self.assertLess(abs(float(np.mean(u["theta"]))), 0.05, "la habilidad media queda centrada en 0")
        cat_est = dict(zip(m.categorias, u["cat"] + u["global"]))
        self.assertLess(cat_est["entretenimiento"], -0.2)
        self.assertGreater(cat_est["historia"], 0.15)
        self.assertTrue(0.2 < u["beta"] < 1.2, f"quien falla percibe la pregunta más difícil ({u['beta']:.2f})")
        self.assertTrue(-0.9 < u["gamma"] < 0, f"efecto del modo revisión ({u['gamma']:.2f})")
        self.assertAlmostEqual(math.exp(u["ls"]), CONFIG["modelo"]["escala_valoracion"], msg="el ruido de las valoraciones queda fijo")


class TestResultados(ConSimulaciones):
    def test_sin_datos_no_cambia_nada(self):
        vacia = self.tmp / "vacia"
        vacia.mkdir()
        res = calibrar_callado(vacia)
        self.assertEqual(res.ajustes["niveles"], {})
        self.assertEqual(res.ajustes["retiradas"], {})
        texto = json.dumps(res.ajustes)
        self.assertIn('"niveles": {}', texto, "los ajustes vacíos se escriben como objetos {}")

    def test_retiradas(self):
        retiradas = self.res.ajustes["retiradas"]
        self.assertIn(self.verdad["erronea"], retiradas, "retira la pregunta marcada como errónea")
        otras = [q for q in self.verdad["malas"] if q != self.verdad["erronea"]]
        marcas = self.res.datos.marcas
        dos = [q for q in otras if len({m["quien"] for m in marcas if m["pregunta"] == q}) >= 2]
        self.assertTrue(all(q in retiradas for q in dos), "retira las marcadas por dos partidas distintas")
        self.assertTrue(all(q in self.verdad["malas"] for q in retiradas), "y solo esas")

    def test_niveles_y_versiones(self):
        self.assertTrue(np.all((self.res.nuevo >= 1) & (self.res.nuevo <= 10)))
        ajustadas = set(self.res.ajustes["niveles"]) | set(self.res.ajustes["retiradas"])
        versiones = self.res.ajustes["versiones"]
        self.assertEqual(set(versiones), ajustadas)
        self.assertTrue(all(versiones[q] == BANCO.v[BANCO.posicion[q]] for q in ajustadas))
        # En el informe, un ajuste anterior calculado para otra versión no cuenta como nivel anterior.
        a, b = BANCO.id[0], BANCO.id[1]
        previos = {"niveles": {a: int(BANCO.nivel[0]) % 10 + 1, b: int(BANCO.nivel[1]) % 10 + 1},
                   "versiones": {a: int(BANCO.v[0]) + 1, b: int(BANCO.v[1])}}
        tab = tabla_niveles(self.res, previos)
        self.assertEqual(tab[0]["nivel_anterior"], BANCO.nivel[0])
        self.assertEqual(tab[1]["nivel_anterior"], BANCO.nivel[1] % 10 + 1)

    def test_con_pocos_datos_el_nivel_no_cambia(self):
        d = self.res_peq.datos
        n = contar([x["q"] for x in d.respuestas], len(BANCO)) + contar([x["q"] for x in d.valoraciones], len(BANCO))
        pocos = n < CONFIG["modelo"]["min_datos_cambio"]
        self.assertTrue(np.all(self.res_peq.nuevo[pocos] == BANCO.nivel[pocos]))

    def test_exportar_dos_veces_no_duplica(self):
        carpeta = self.tmp / "doble"
        carpeta.mkdir()
        shutil.copy(self.tmp / "sim" / "sim.json", carpeta / "sim.json")
        shutil.copy(self.tmp / "sim" / "sim.json", carpeta / "sim-copia.json")
        res2 = calibrar_callado(carpeta)
        self.assertEqual(len(res2.datos.respuestas), len(self.res.datos.respuestas))
        self.assertTrue(np.allclose(res2.ajuste.nivel_continuo, self.res.ajuste.nivel_continuo, atol=1e-6))

    def test_el_simulador_juega_como_la_app(self):
        """Nadie recibe una pregunta ya vista salvo marcada como repetida: la calibración no detecta ninguna más."""
        self.assertEqual(self.res.datos.descartes["vista_antes"], 0)
        self.assertGreater(len(self.res.datos.respuestas), 800)

    def test_csv(self):
        ruta = self.tmp / "niveles.csv"
        escribir_csv(tabla_niveles(self.res), ruta)
        lineas = ruta.read_text(encoding="utf-8").splitlines()
        self.assertEqual(lineas[0], '"id","categoria","subtema","nivel_inicial","nivel_anterior","nivel_nuevo","nivel_continuo",'
                                    '"incertidumbre","n_respuestas","aciertos","n_valoraciones","retirada"')
        self.assertEqual(len(lineas), len(BANCO) + 1)
        self.assertTrue(lineas[1].startswith(f'"{BANCO.id[0]}",'))
        self.assertTrue(lineas[1].endswith(("TRUE", "FALSE")))
        escribir_csv(tabla_niveles(self.res_peq), ruta)
        self.assertTrue(any(",NA," in linea for linea in ruta.read_text(encoding="utf-8").splitlines()[1:]),
                        "con pocas partidas, las preguntas sin datos salen sin incertidumbre (NA)")


class TestDatosRaros(ConSimulaciones):
    def test_versiones_antiguas_desconocidas_y_repetidas(self):
        r = json.loads((self.tmp / "sim" / "sim.json").read_text(encoding="utf-8"))["registros"]
        # Cuatro respuestas normales (ni repetidas ni marcadas) que se estropean de cuatro maneras.
        i0, i1, i2, i3 = [i for i, x in enumerate(r) if x["tipo"] == "respuesta" and x["alternativa"] is None and x["mala"] is None][:4]
        r[i0]["v"] = 99
        r[i1]["pregunta"] = "no-existe-99"
        del r[i2]["v"]  # registro sin versión: también se descarta
        r[i3]["alternativa"] = "repetida"  # quien responde ya la había visto
        r[i3]["mala"] = "ambigua"
        escribir_exportacion(self.tmp / "raros" / "raros.json", r)
        d3 = preparar_datos(leer_exportaciones(self.tmp / "raros", avisar=callado).registros, BANCO, CONFIG)
        base = self.res.datos
        self.assertEqual(d3.descartes["version_antigua"], base.descartes["version_antigua"] + 2)
        self.assertEqual(d3.descartes["pregunta_desconocida"], 1)
        self.assertTrue(all(0 <= x["q"] < len(BANCO) for x in d3.respuestas))
        # Las cuatro salen del modelo (las que la calibración detecta como vistas antes pueden variar, porque
        # las tres primeras ya no cuentan como vistas de su pregunta).
        self.assertEqual(d3.descartes["repetida"], base.descartes["repetida"] + 1)
        self.assertEqual(len(d3.respuestas) + d3.descartes["vista_antes"], len(base.respuestas) + base.descartes["vista_antes"] - 4)
        self.assertTrue(any(m["pregunta"] == r[i3]["pregunta"] and m["motivo"] == "ambigua" for m in d3.marcas),
                        "la marca de calidad de una repetida sí cuenta")

    def test_cronometro(self):
        mates = [i for i in range(len(BANCO)) if BANCO.categoria[i] == "mates"][:2]
        regs = [{"id": f"reloj-{k}", "tipo": "respuesta", "ts": "2026-10-18T10:00:00.000Z", "partida": "pr", "turno": k, "jugador": "ana",
                 "pregunta": BANCO.id[i], "v": int(BANCO.v[i]), "nivel_mostrado": int(BANCO.nivel[i]), "apuesta": int(BANCO.nivel[i]),
                 "es_final": False, "acierto": k == 1, "cronometro": 60 if k == 1 else None, "tiempo_agotado": True if k == 1 else None}
                for k, i in enumerate(mates, start=1)]
        escribir_exportacion(self.tmp / "reloj" / "e.json", regs)
        res = calibrar_callado(self.tmp / "reloj")
        self.assertEqual([x["cronometro"] for x in res.datos.respuestas], [60, None])
        self.assertEqual([x["tiempo_agotado"] for x in res.datos.respuestas], [True, None])
        texto = leer_informe(res, self.tmp, "informe_reloj.md")
        self.assertTrue(any(linea.startswith("## Cronómetro") for linea in texto))
        self.assertIn("| Con cronómetro | 1 | 100 % | 1 |", texto)

    def test_un_archivo_cortado_o_ajeno_se_ignora_con_aviso(self):
        self.test_cronometro()
        rotos = self.tmp / "rotos"
        rotos.mkdir(exist_ok=True)
        bueno = (self.tmp / "reloj" / "e.json").read_text(encoding="utf-8")
        (rotos / "buena.json").write_text(bueno, encoding="utf-8")
        (rotos / "cortada.json").write_text(bueno[: len(bueno) // 2], encoding="utf-8")
        (rotos / "lista.json").write_text("[1, 2, 3]", encoding="utf-8")
        (rotos / "otra-app.json").write_text('{"app": "otra", "formato": 1, "registros": []}', encoding="utf-8")
        avisos = []
        res = calibrar_callado(rotos, avisos)
        self.assertEqual(len(res.datos.respuestas), 2)
        self.assertEqual(set(res.exportaciones.ignorados), {"cortada.json", "lista.json", "otra-app.json"})
        self.assertEqual(sum(1 for a in avisos if a.startswith(("Ignoro cortada.json", "Ignoro lista.json", "Ignoro otra-app.json"))), 3)
        self.assertTrue(any(linea.startswith("**Archivos ignorados** (3)") for linea in leer_informe(res, self.tmp, "informe_rotos.md")))

    def test_dos_moviles_y_preguntas_ya_vistas(self):
        """Repetidas que la app no pudo marcar: quien ya vio una pregunta (misma id y misma v) en un registro anterior
        de cualquier exportación, respondiéndola, leyéndola o revisándola, no cuenta en el modelo al responderla después."""
        qm = [BANCO.id[i] for i in range(len(BANCO)) if BANCO.v[i] == 1][:6]
        q_v2 = next(BANCO.id[i] for i in range(len(BANCO)) if BANCO.v[i] == 2)
        nivel = lambda q: int(BANCO.nivel[BANCO.posicion[q]])  # noqa: E731

        def reg(id_, hora, tipo, pregunta, v=None, **extra):
            return {"id": id_, "tipo": tipo, "ts": f"2026-10-18T{hora}.000Z", "pregunta": pregunta,
                    "v": int(BANCO.v[BANCO.posicion[pregunta]]) if v is None else v, "nivel_mostrado": nivel(pregunta), **extra}

        def resp(id_, hora, jugador, lector, pregunta, acierto=True, v=None, **extra):
            return reg(id_, hora, "respuesta", pregunta, v=v, partida=id_[0], jugador=jugador, lector=lector, acierto=acierto,
                       apuesta=nivel(pregunta), es_final=False, **extra)

        movil_a = [resp("a1", "10:00:00", "ana", "beto", qm[0]), resp("a2", "10:01:00", "beto", "ana", qm[1], acierto=False),
                   reg("a3", "10:02:00", "anulacion", qm[2], partida="a", jugador="ana", lector="beto", motivo="conocida", momento="antes"),
                   reg("a4", "10:05:00", "revision", qm[3], evaluador="carla", valoracion="justa"),
                   resp("a5", "10:06:00", "dani", "eva", q_v2, v=1),  # versión anterior: se descarta y no cuenta como vista
                   resp("a6", "12:00:00", "dani", "eva", qm[4])]  # eva lee qm[4] después de haberla respondido en el otro móvil
        movil_b = [movil_a[0],  # la misma respuesta exportada desde los dos móviles: se cuenta una vez y no se repite a sí misma
                   resp("b0", "09:00:00", "eva", "fran", qm[4]),  # antes que en el otro móvil: cuenta
                   resp("b1", "11:00:00", "beto", "dani", qm[0]),  # la leyó en el otro móvil
                   resp("b2", "11:01:00", "ana", "beto", qm[1], valoracion="facil", mala="ambigua"),  # la leyó; su marca sí cuenta
                   resp("b3", "11:02:00", "ana", "carla", qm[2]),  # se la anularon en el otro móvil, después de verla
                   resp("b4", "11:03:00", "carla", "dani", qm[3]),  # la revisó
                   resp("b5", "11:04:00", "dani", "fran", q_v2),  # vio otra versión: cuenta
                   resp("b6", "11:05:00", "fran", "dani", qm[0]),  # no la había visto: cuenta
                   resp("b7", "11:06:00", "ana", "fran", qm[0], alternativa="repetida")]  # la marcó la app: solo cuenta como tal
        escribir_exportacion(self.tmp / "moviles" / "a.json", movil_a, dispositivo="movil-a")
        escribir_exportacion(self.tmp / "moviles" / "b.json", movil_b, dispositivo="movil-b")
        res = calibrar_callado(self.tmp / "moviles")
        d = res.datos
        entran = sorted(f"{x['jugador']} {BANCO.id[x['q']]}" for x in d.respuestas)
        esperadas = sorted(f"{j} {q}" for j, q in zip(["ana", "beto", "dani", "eva", "dani", "fran"], [qm[0], qm[1], qm[4], qm[4], q_v2, qm[0]]))
        self.assertEqual(res.exportaciones.n_duplicados, 1)
        self.assertEqual(d.descartes["version_antigua"], 1)
        self.assertEqual(entran, esperadas)
        self.assertEqual(d.descartes["vista_antes"], 4)
        self.assertEqual(d.descartes["repetida"], 1)
        self.assertEqual(len(d.valoraciones), 1)
        self.assertTrue(any(m["pregunta"] == qm[1] and m["motivo"] == "ambigua" for m in d.marcas))
        texto = leer_informe(res, self.tmp, "informe_moviles.md")
        self.assertTrue(any(linea.endswith("(lo marcó la app) | 1 |") for linea in texto))
        self.assertTrue(any(linea.endswith("(lo detecta la calibración) | 4 |") for linea in texto))

    def test_vista_antes_sin_fecha_o_sin_jugador(self):
        regs = [{"jugador": "ana", "pregunta": "x", "v": 1, "ts": "2026-10-18T10:00:00.000Z"},
                {"jugador": "ana", "pregunta": "x", "v": 1, "ts": "no es una fecha"},
                {"lector": "ana", "pregunta": "x", "v": 1, "ts": "2026-10-18T11:00:00.000Z"},
                {"jugador": "ana", "pregunta": "x", "v": 1, "ts": "2026-10-18T12:00:00.000Z"}]
        self.assertEqual(vista_antes(regs), [False, False, False, True])


class TestRetiradaYRondas(unittest.TestCase):
    def test_regla_de_retirada_y_restaurar(self):
        marcas = [{"pregunta": "a", "quien": "partida:1", "motivo": "ambigua"}, {"pregunta": "a", "quien": "partida:2", "motivo": "ambigua"},
                  {"pregunta": "b", "quien": "evaluador:x", "motivo": "erronea"}]
        self.assertEqual(sorted(retiradas_por_marcas(marcas, CONFIG)), ["a", "b"], "dos marcas distintas o una «errónea»")
        self.assertEqual(list(retiradas_por_marcas(marcas, CONFIG, restaurar=["b"])), ["a"], "una pregunta restaurada no se retira")

    def test_rondas(self):
        tmp = Path(tempfile.mkdtemp(prefix="rondas-"))
        reales = {r["id"]: r for r in leer_rondas(RAIZ, CONFIG)}
        try:
            def ronda(id_, ronda_, aciertos, v=None, alternativa=None, mala=None):
                return {"id": id_, "tipo": "ronda", "ts": "2026-10-18T10:00:00.000Z", "partida": "pr", "turno": 1, "jugador": "ana",
                        "lector": "luis", "ronda": ronda_, "v": v or reales[ronda_]["v"], "tipo_ronda": "lista", "segundos": 45, "total": 12, "leidos": None,
                        "marcados": list(range(aciertos)), "extra": 0, "aciertos": aciertos, "alternativa": alternativa,
                        "tiempo_agotado": True, "mala": mala}
            regs = [ronda("r1", "ron-apostoles", 9, mala="aburrida"), ronda("r2", "ron-apostoles", 8), ronda("r3", "ron-apostoles", 10),
                    ronda("r4", "ron-apostoles", 12, alternativa="repetida"), ronda("r5", "ron-apostoles", 11, v=99),
                    ronda("r6", "ron-gentilicios", 0),
                    {"id": "r7", "tipo": "ronda_anulada", "ts": "2026-10-18T10:01:00.000Z", "partida": "pr", "turno": 2, "jugador": "luis",
                     "lector": "ana", "ronda": "ron-gases-nobles", "v": reales["ron-gases-nobles"]["v"], "motivo": "conocida"},
                    {"id": "r8", "tipo": "respuesta", "ts": "2026-10-18T10:02:00.000Z", "partida": "pr", "turno": 3, "jugador": "ana",
                     "lector": "luis", "pregunta": BANCO.id[0], "v": int(BANCO.v[0]), "nivel_mostrado": int(BANCO.nivel[0]),
                     "apuesta": int(BANCO.nivel[0]), "es_final": False, "acierto": True}]
            escribir_exportacion(tmp / "e.json", regs)
            res = calibrar_callado(tmp)
            fila = {f["id"]: f for f in res.rondas["tabla"]}
            self.assertEqual(len(res.datos.respuestas), 1, "las rondas no entran en el modelo de niveles")
            self.assertEqual(res.datos.descartes["pregunta_desconocida"], 0, "ni cuentan como preguntas que ya no existen")
            self.assertEqual((fila["ron-apostoles"]["veces"], fila["ron-apostoles"]["media"], fila["ron-apostoles"]["maximo"]), (3, 9, 10))
            self.assertEqual(fila["ron-apostoles"]["malas"], 1)
            self.assertEqual((fila["ron-gases-nobles"]["cambiada"], fila["ron-gases-nobles"]["veces"]), (1, 0))
            self.assertEqual((res.rondas["repetidas"], res.rondas["otra_version"]), (1, 1))
            # Lo previsto con los niveles de sus elementos: un poco más de 5 en los apóstoles, lejos de los 9 que se sacan aquí.
            self.assertAlmostEqual(fila["ron-apostoles"]["prevista"], 5.3, delta=0.2)
            texto = leer_informe(res, tmp, "informe.md")
            self.assertIn("## Rondas divertidas", texto)
            prevista = f"{fila['ron-apostoles']['prevista']:.1f}".replace(".", ",")
            self.assertTrue(any(linea.startswith(f"| Los doce apóstoles | lista | 3 | 9,0 | {prevista} | 10 | 12 | 30 s | 0 | 1 | da muchas casillas")
                                for linea in texto), [linea for linea in texto if "apóstoles" in linea])
            self.assertTrue(any(linea.startswith("| Gentilicios | ráfaga | 1 | 0,0 |") and "pocos datos" in linea for linea in texto))
            self.assertIn("Fuera de estas cuentas: 1 jugada en que quien jugaba ya conocía la ronda y 1 jugada de una versión anterior.", texto)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_la_prevista_de_cada_ronda_es_la_del_validador(self):
        """La calibración y el validador (`herramientas/validar_rondas.py`) calculan lo mismo: la media
        prevista es la suma de la curva «llegar a k aciertos». En las de ordenar, el total no cuenta el primero."""
        sys.path.insert(0, str(RAIZ / "herramientas"))
        try:
            import validar_rondas as vr
        finally:
            sys.path.pop(0)
        rondas = json.loads((RAIZ / "app" / CONFIG["rondas"]["archivo"]).read_text(encoding="utf-8"))["rondas"]
        leidas = {r["id"]: r for r in leer_rondas(RAIZ, CONFIG)}
        self.assertTrue(any(r["tipo"] == "ordenar" for r in rondas))
        for r in rondas:
            with self.subTest(ronda=r["id"]):
                self.assertAlmostEqual(leidas[r["id"]]["prevista"], sum(vr.curva_de_ronda(r, CONFIG)), places=9)
                self.assertEqual(leidas[r["id"]]["total"], len(r["elementos"]) - (r["tipo"] == "ordenar"))
        self.assertIsNone(media_prevista({"tipo": "lista", "elementos": [{"texto": "x"}]}, CONFIG), "sin niveles no hay prevista")


class TestMapa(unittest.TestCase):
    def test_el_acierto_de_mapa_se_recalcula_con_la_zona_actual(self):
        """Las respuestas de mapa guardan si se acertó con la zona de entonces (hasta el 26 de octubre, la mitad de la
        distancia máxima): la calibración lo recalcula con la de ahora."""
        mapa = [i for i in range(len(BANCO)) if BANCO.categoria[i] == "geohistoria"][:3]
        fraccion = CONFIG["mapa"]["acierto_fraccion"]
        # A 0,4, 0,6 y 0,8 veces la distancia máxima: con la zona de la mitad, solo la primera era acierto.
        distancias = [400, 600, 800]
        regs = [{"id": f"mapa-{k}", "tipo": "respuesta", "ts": f"2026-10-24T10:0{k}:00.000Z", "partida": "pm", "turno": k, "jugador": f"j{k}",
                 "lector": f"l{k}", "pregunta": BANCO.id[i], "v": int(BANCO.v[i]), "nivel_mostrado": int(BANCO.nivel[i]), "apuesta": int(BANCO.nivel[i]),
                 "es_final": False, "acierto": d < 500, "distancia_km": d, "distancia_max_km": 1000, "puntos": 0}
                for k, (i, d) in enumerate(zip(mapa, distancias), start=1)]
        datos = preparar_datos(regs, BANCO, CONFIG)
        self.assertEqual([x["y"] for x in datos.respuestas], [int(d < 1000 * fraccion) for d in distancias])
        self.assertEqual([x["y"] for x in datos.respuestas], [1, 1, 0], "con la zona de tres cuartos, a 600 km de 1000 ya es acierto")
        self.assertEqual([r["acierto"] for r in regs], [True, False, False], "los registros originales no cambian")


class TestFinales(unittest.TestCase):
    def test_finales(self):
        tmp = Path(tempfile.mkdtemp(prefix="finales-"))
        try:
            finales = {f["id"]: f for f in json.loads((RAIZ / "app" / "data" / "finales.json").read_text(encoding="utf-8"))["finales"]}
            pregunta = next(f for f in finales.values() if f["tipo"] == "pregunta" and f["nivel"] == 8)
            reto = next(f for f in finales.values() if f["tipo"] == "reto" and f["nivel"] == 10)

            def final(id_, f, acierto, v=None, alternativa=None, aciertos=None, valoracion=None, mala=None):
                return {"id": id_, "tipo": "final", "ts": "2026-10-19T10:00:00.000Z", "partida": "pf", "turno": 1, "jugador": "ana",
                        "lector": "luis", "final": f["id"], "v": v or f["v"], "tipo_final": f["tipo"], "nivel": f["nivel"],
                        "nivel_pedido": f["nivel"], "ventaja": 0, "alternativa": alternativa, "cronometro": None, "tiempo_agotado": None,
                        "acierto": acierto, "aciertos": aciertos, "minimo": f.get("minimo"), "total": len(f.get("elementos") or []) or None,
                        "leidos": None, "marcados": None, "valoracion": valoracion, "mala": mala}
            regs = [final("f1", pregunta, True, valoracion="facil"), final("f2", pregunta, True), final("f3", pregunta, False, mala="ambigua"),
                    final("f4", pregunta, True, alternativa="repetida"), final("f5", pregunta, True, v=99),
                    final("f6", reto, False, aciertos=2), final("f7", reto, True, aciertos=reto["minimo"]),
                    {"id": "f8", "tipo": "final_anulada", "ts": "2026-10-19T10:01:00.000Z", "partida": "pf", "turno": 2, "jugador": "ana",
                     "lector": "luis", "final": reto["id"], "v": reto["v"], "nivel": reto["nivel"], "motivo": "conocida", "momento": "antes"}]
            escribir_exportacion(tmp / "e.json", regs)
            res = calibrar_callado(tmp)
            self.assertEqual(len(res.datos.respuestas), 0, "las finales propias no entran en el modelo de niveles")
            self.assertEqual(res.datos.descartes["pregunta_desconocida"], 0, "ni cuentan como preguntas que ya no existen")
            fila = {f["id"]: f for f in res.finales["tabla"]}
            self.assertEqual((fila[pregunta["id"]]["veces"], fila[pregunta["id"]]["acertada"], fila[pregunta["id"]]["facil"]), (3, 2, 1))
            self.assertEqual(fila[pregunta["id"]]["malas"], 1)
            self.assertEqual((fila[reto["id"]]["veces"], fila[reto["id"]]["acertada"], fila[reto["id"]]["cambiada"]), (2, 1, 1))
            self.assertEqual(fila[reto["id"]]["media_aciertos"], (2 + reto["minimo"]) / 2)
            nivel = {f["nivel"]: f for f in res.finales["niveles"]}
            self.assertEqual((nivel[8]["jugadas"], nivel[8]["acertadas"], nivel[8]["objetivo"]), (3, 2, CONFIG["final"]["objetivo_acierto"][0]))
            self.assertEqual(nivel[9]["jugadas"], 0, "los niveles sin jugadas también salen, con su objetivo")
            self.assertEqual((res.finales["repetidas"], res.finales["otra_version"]), (1, 1))
            texto = leer_informe(res, tmp, "informe.md")
            self.assertIn("## Preguntas finales", texto)
            self.assertIn(f"| 8 | 3 | 2 | 67 % | {round(CONFIG['final']['objetivo_acierto'][0] * 100)} % |", texto)
            corto = pregunta["pregunta"] if len(pregunta["pregunta"]) <= 70 else pregunta["pregunta"][:69].rstrip() + "…"
            self.assertTrue(any(linea.startswith(f"| {corto} | pregunta | 8 | 3 | 2 |") and "demasiado fácil: súbela de nivel" in linea for linea in texto))
            self.assertTrue(any(linea.startswith(f"| {reto['titulo']} | reto ({reto['minimo']} de {len(reto['elementos'])}) | 10 | 2 | 1 |")
                                and "pocos datos" in linea for linea in texto))
            self.assertIn("Fuera de estas cuentas: 1 jugada en que quien jugaba ya conocía la final y 1 jugada de una versión anterior.", texto)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class TestTemas(unittest.TestCase):
    """Un tema solo lo responde quien lo elige: si un fan acierta sus preguntas mucho más de lo que dice su nivel,
    lo absorbe el ajuste de ese tema (con más margen que el de una categoría), sin mover las del tablero."""

    @staticmethod
    def _ajustar(config, sd_tema=None, con_tema=True):
        config = copy.deepcopy(config)
        if sd_tema is not None:
            config["modelo"]["sd_ajuste_tema"] = sd_tema
        tema = config["temas"]["lista"][0]
        en_tablero = [i for i, c in enumerate(BANCO.categoria) if c in {x["id"] for x in config["categorias"]}]
        ids_tema = [f"{tema['id'][:3]}-{s['id'][:3]}-{n:02d}" for s in tema["subtemas"] for n in range(1, 11)]
        banco = Banco(id=[BANCO.id[i] for i in en_tablero] + ids_tema,
                      v=np.array([int(BANCO.v[i]) for i in en_tablero] + [1] * len(ids_tema)),
                      categoria=[BANCO.categoria[i] for i in en_tablero] + [tema["id"]] * len(ids_tema),
                      subtema=[BANCO.subtema[i] for i in en_tablero] + [s["id"] for s in tema["subtemas"] for _ in range(10)],
                      nivel=np.array([int(BANCO.nivel[i]) for i in en_tablero] + list(range(1, 11)) * len(tema["subtemas"])))
        rng = np.random.default_rng(4)
        p_obj = TablaObjetivo(config).p
        registros, k = [], 0

        def responder(jugador, q, nivel_real):
            nonlocal k
            k += 1
            registros.append({
                "id": f"tema-{k:05d}", "tipo": "respuesta", "ts": f"2026-10-28T18:{k // 60 % 60:02d}:{k % 60:02d}.000Z", "dispositivo": "prueba",
                "partida": f"p{k // 50}", "turno": k, "jugador": jugador, "lector": "narra", "pregunta": banco.id[q], "v": int(banco.v[q]),
                "categoria": banco.categoria[q], "subtema": banco.subtema[q], "nivel_inicial": int(banco.nivel[q]),
                "nivel_mostrado": int(banco.nivel[q]), "subtema_anunciado": banco.subtema[q], "apuesta": int(banco.nivel[q]),
                "es_final": False, "alternativa": None, "acierto": bool(rng.random() < p_obj(np.array([nivel_real]))[0]),
                "valoracion": None, "mala": None, "version_banco": "prueba", "version_ajustes": "inicial",
            })

        for jugador in ("fan", "otro"):
            for q in rng.choice(len(en_tablero), 200, replace=False):
                responder(jugador, int(q), float(banco.nivel[q]))  # las del tablero, como dice su nivel
        for q in range(len(en_tablero), len(banco) if con_tema else 0):
            responder("fan", q, float(banco.nivel[q]) - 3)  # las de su tema le parecen tres niveles más fáciles
        datos = preparar_datos(registros, banco, config)
        modelo = Modelo(datos, banco, config)
        u = ajustar(modelo, avisar=callado).u
        return len(datos.respuestas), len(registros), dict(zip(modelo.categorias, u["cat"])), tema["id"]

    def test_el_ajuste_del_tema_recoge_lo_que_sabe_quien_lo_elige(self):
        n, total, cat, tema = self._ajustar(CONFIG)
        self.assertEqual(n, total, "ninguna respuesta de tema se descarta")
        self.assertLess(cat[tema], -1.0, f"ajuste del tema {cat[tema]:.2f}")
        # Las categorías del tablero quedan como sin esas respuestas.
        _, _, sin_tema, _ = self._ajustar(CONFIG, con_tema=False)
        for c in CONFIG["categorias"]:
            self.assertLess(abs(cat[c["id"]] - sin_tema[c["id"]]), 0.15, f"{c['id']}: {cat[c['id']]:.2f} frente a {sin_tema[c['id']]:.2f}")
        # Con el margen de una categoría (0,75), el tema se movería bastante menos.
        _, _, estrecho, _ = self._ajustar(CONFIG, sd_tema=CONFIG["modelo"]["sd_ajuste_categoria"])
        self.assertLess(cat[tema], estrecho[tema] - 0.2)

    def test_el_informe_cuenta_los_temas_elegidos(self):
        hp, sw = (t["id"] for t in CONFIG["temas"]["lista"][:2])
        de_hp = BANCO.categoria.index(hp)
        normal = BANCO.categoria.index(CONFIG["categorias"][0]["id"])

        def respuesta(k, partida, jugador, q, elegido):
            return {"id": f"te-{k}", "tipo": "respuesta", "ts": f"2026-10-28T18:00:{k:02d}.000Z", "dispositivo": "prueba", "partida": partida,
                    "turno": k, "jugador": jugador, "lector": "narra", "pregunta": BANCO.id[q], "v": int(BANCO.v[q]), "categoria": BANCO.categoria[q],
                    "subtema": BANCO.subtema[q], "nivel_inicial": int(BANCO.nivel[q]), "nivel_mostrado": int(BANCO.nivel[q]),
                    "subtema_anunciado": BANCO.subtema[q], "apuesta": 5, "es_final": False, "alternativa": None, "acierto": True,
                    "valoracion": None, "mala": None, "tema_elegido": elegido, "version_banco": "prueba", "version_ajustes": "inicial"}

        # Ana elige Harry Potter en una partida (y le sale una) y Star Wars en otra (y no le sale ninguna); Luis juega sin tema.
        registros = [respuesta(1, "p1", "ana", normal, hp), respuesta(2, "p1", "ana", de_hp, hp), respuesta(3, "p1", "luis", normal + 1, None),
                     respuesta(4, "p2", "ana", normal + 2, sw)]
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            escribir_exportacion(tmp / "datos" / "temas.json", registros)
            texto = leer_informe(calibrar_callado(tmp / "datos"), tmp, "informe.md")
        inicio = texto.index("## Temas")
        fin = next(i for i in range(inicio + 1, len(texto)) if texto[i].startswith("## "))
        filas = {linea.split("|")[1].strip(): [c.strip() for c in linea.split("|")[2:-1]]
                 for linea in texto[inicio:fin] if linea.startswith("| ") and not linea.startswith("| Tema")}
        nombres = {t["id"]: t["nombre"] for t in CONFIG["temas"]["lista"]}
        self.assertEqual(filas[nombres[hp]][:3], ["1", "1 de 40", "1"])
        self.assertEqual(filas[nombres[sw]][:3], ["1", "0 de 40", "0"])
        self.assertEqual(filas["Sin tema"][0], "1")
        # Los más elegidos, primero (a igualdad, el que más se ha gastado).
        self.assertEqual(list(filas)[:2], [nombres[hp], nombres[sw]])


class TestModeloFiltro(unittest.TestCase):
    def test_respuesta_numerica_con_el_signo_menos_del_banco(self):
        casos = {"42": 1, "−273,15 °C": 1, "-4": 1, " 9π": 1, "1/2": 1, "Raíz de 3": 0, "Todos": 0, "Marte": 0}
        self.assertEqual({k: filtro_generador.es_numerica(k) for k in casos}, casos)

    def test_reproduce_el_caso_guardado(self):
        """generador/caso_filtro_comun.json guarda un modelo, seis preguntas y sus probabilidades (las calculó R)."""
        caso = json.loads((RAIZ / "generador" / "caso_filtro_comun.json").read_text(encoding="utf-8"))
        self.assertEqual(caso["modelo"]["caracteristicas"], CARACTERISTICAS)
        ids, X = caracteristicas_de(caso["preguntas"])
        m = caso["modelo"]
        modelo = {"intercepto": m["intercepto"], "pesos": np.array(m["pesos"]), "medias": np.array(m["medias"]), "desviaciones": np.array(m["desviaciones"])}
        p = prob_mala(modelo, X)
        for q, valor in zip(ids, p):
            self.assertAlmostEqual(float(valor), caso["esperado"][q], places=9)

    def test_aprende_el_signo_y_clasifica(self):
        rng = np.random.default_rng(5)
        n = 300
        X = np.column_stack([rng.integers(1, 6, n), rng.integers(1, 6, n), rng.integers(1, 6, n), rng.integers(0, 5, n),
                             rng.uniform(0.3, 1.5, n), rng.binomial(1, 0.2, n)]).astype(float)
        z = -1 - 1.2 * (X[:, 0] - 4) + 1.0 * (X[:, 1] - 2)
        y = rng.binomial(1, 1 / (1 + np.exp(-z)))
        modelo = entrenar_logistica_ridge(X, y)
        pesos = dict(zip(CARACTERISTICAS, modelo["pesos"]))
        self.assertLess(pesos["exactitud"], -0.5)
        self.assertGreater(pesos["ambiguedad"], 0.5)
        acierto = float(np.mean((prob_mala(modelo, X) > 0.5) == (y == 1)))
        self.assertGreater(acierto, 0.75, f"acierto {acierto:.0%}")


if __name__ == "__main__":
    unittest.main()
