"""Pruebas del agente nivelador (sin llamar a Codex)."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import banco_codex as bc  # noqa: E402
import nivelar_codex as nc  # noqa: E402


class TestNivelar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ctx = bc.Contexto()

    def test_el_nivel_estimado_es_la_media_redondeada_y_pide_las_dos_pasadas(self):
        self.assertIsNone(nc.estimado([]))
        self.assertIsNone(nc.estimado([4]))
        self.assertEqual(nc.estimado([4, 4]), 4)
        self.assertEqual(nc.estimado([4, 5]), 5, "la mitad, hacia arriba: ante la duda, más difícil")
        self.assertEqual(nc.estimado([1, 4]), 3)

    def test_solo_se_nivelan_los_temas_de_fan(self):
        temas = nc.temas_fan(self.ctx, [])
        self.assertIn("ajedrez", temas)
        self.assertNotIn("sorpresa", temas, "Sorpresa va con el jugador medio")
        self.assertNotIn("ciencias", temas)
        self.assertEqual(nc.temas_fan(self.ctx, ["ajedrez"]), ["ajedrez"])

    def test_cada_pasada_baraja_distinto_y_reparte_todas_las_preguntas(self):
        del_tema = {p["id"] for p in self.ctx.banco if p["categoria"] == "ajedrez"}
        uno, dos = nc.lotes_de(self.ctx, "ajedrez", 1), nc.lotes_de(self.ctx, "ajedrez", 2)
        for lotes in (uno, dos):
            self.assertEqual({p["id"] for lote in lotes for p in lote}, del_tema)
            self.assertEqual(sum(len(lote) for lote in lotes), len(del_tema))
        self.assertNotEqual([p["id"] for p in uno[0]], [p["id"] for p in dos[0]])
        self.assertEqual([p["id"] for p in uno[0]], [p["id"] for p in nc.lotes_de(self.ctx, "ajedrez", 1)[0]], "retomar da los mismos lotes")

    def test_el_mensaje_no_dice_el_nivel_que_tienen(self):
        lote = nc.lotes_de(self.ctx, "ajedrez", 1)[0][:5]
        texto = nc.prompt(self.ctx, "ajedrez", lote)
        self.assertIn("prueba del casual", texto)
        cola = texto.split("# Este lote")[1]
        for p in lote:
            self.assertIn(p["pregunta"], cola)
            self.assertNotIn(f"nivel {p['nivel']}:", cola)
        self.assertNotIn('"nivel"', cola)

    def test_el_detector_de_relleno_solo_mira_las_generadas_de_nivel_bajo(self):
        lotes = nc.lotes_de(self.ctx, "harry_potter", 1, nc.DETECTAR)
        miradas = [p for lote in lotes for p in lote]
        self.assertTrue(miradas)
        for p in miradas:
            self.assertEqual(p["origen"], "generada", "las escritas a mano son del usuario")
            self.assertLessEqual(p["nivel"], nc.NIVEL_MAX_RELLENO)
        texto = nc.prompt(self.ctx, "harry_potter", lotes[0][:5], nc.DETECTAR)
        self.assertIn("de relleno", texto)
        self.assertIn("una nota por cada número", texto)
        self.assertNotIn("Niveles 4 a 6", texto, "sin la rúbrica: aquí no se pone nivel")
        self.assertEqual(set(nc.DETECTAR.esquema["properties"]), {"notas"})

    def test_de_relleno_son_las_que_suman_tres_entre_las_dos_pasadas(self):
        a, b, c, d = [p["id"] for p in nc.lotes_de(self.ctx, "ajedrez", 1, nc.DETECTAR)[0][:4]]
        notas = {a: [2, 2], b: [2, 0], c: [1, 1], d: [2]}
        with mock.patch.object(nc, "cargar", return_value=notas):
            self.assertEqual({p["id"] for p, _ in nc.de_relleno(self.ctx, ["ajedrez"])}, {a})
            self.assertEqual({p["id"] for p, _ in nc.de_relleno(self.ctx, ["ajedrez"], suma=2)}, {a, b, c}, "con una pasada no se decide")

    def test_al_redactor_de_un_tema_se_le_dice_que_facil_no_es_de_relleno(self):
        self.assertIn("de relleno", bc.referencia(self.ctx, "ajedrez"))
        self.assertNotIn("de relleno", bc.referencia(self.ctx, "sorpresa"))
        self.assertIn("Fácil no es de relleno", bc.rubrica_para(self.ctx, "ajedrez"))

    def test_retirar_quita_la_pregunta_y_sus_opciones_y_deja_la_leccion(self):
        generadas = [p for p in self.ctx.banco if p["categoria"] == "ajedrez" and p["origen"] == "generada"][:2]
        fuera, queda = generadas
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            ruta = tmp / self.ctx.cats["ajedrez"]["archivo"]
            ruta.parent.mkdir(parents=True)
            ruta.write_text(bc.escribir_banco("ajedrez", generadas), encoding="utf-8")
            ruta_op = tmp / "opciones.json"
            op = {"formato": 1, "opciones": {p["id"]: {"v": 1, "incorrectas": list("abcdefg")} for p in generadas}, "no_aptas": {}}
            ruta_op.write_text(json.dumps(op), encoding="utf-8")
            with mock.patch.object(nc.vb, "APP", tmp), mock.patch.object(nc.vo, "archivo_opciones", return_value=ruta_op), \
                    mock.patch.object(bc, "LOTES", tmp / "lotes"), mock.patch.object(nc, "RELLENO", tmp / "relleno"), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(nc.retirar(self.ctx, {fuera["id"], "zzz-zzz-99"}), 1)
                estado = bc.cargar_estado("ajedrez", fuera["subtema"])
            self.assertEqual([p["id"] for p in json.loads(ruta.read_text(encoding="utf-8"))["preguntas"]], [queda["id"]])
            self.assertEqual(set(json.loads(ruta_op.read_text(encoding="utf-8"))["opciones"]), {queda["id"]})
            self.assertIn("de relleno", estado["lecciones"][-1])
            self.assertIn(fuera["id"], (tmp / "relleno" / "retiradas.jsonl").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
