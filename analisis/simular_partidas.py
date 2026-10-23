"""Genera una exportación simulada (con niveles reales conocidos) para practicar la calibración.

Uso (desde la carpeta raíz del proyecto):
    py analisis/simular_partidas.py [--partidas 30] [--semilla 1]
    py analisis/calibrar.py --datos analisis/simulados --seco

La exportación va a analisis/simulados/, nunca a analisis/datos/, para no mezclarla con datos reales.
"""

from __future__ import annotations

import argparse
import sys

from calibracion import RAIZ, leer_banco, leer_config
from simulacion import simular_exportacion


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--partidas", type=int, default=30)
    ap.add_argument("--semilla", type=int, default=1)
    args = ap.parse_args(argv)
    config = leer_config(RAIZ)
    banco = leer_banco(RAIZ, config)
    carpeta = RAIZ / "analisis" / "simulados"
    verdad = simular_exportacion(config, banco, carpeta / "simulacion.json", semilla=args.semilla, n_partidas=args.partidas)
    lineas = ['"id","nivel_inicial","nivel_real"'] + [f'"{q}",{banco.nivel[i]},{round(float(verdad["nivel_real"][i]), 2):.15g}'
                                                       for i, q in enumerate(banco.id)]
    (carpeta / "verdad.csv").write_text("\n".join(lineas) + "\n", encoding="utf-8")
    print("Exportación simulada en analisis/simulados/simulacion.json (niveles reales en verdad.csv)")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(principal())
