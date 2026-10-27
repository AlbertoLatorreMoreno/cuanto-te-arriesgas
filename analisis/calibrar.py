"""Calibra los niveles de las preguntas con todas las exportaciones de la app.

Uso (desde la carpeta raíz del proyecto):
    py analisis/calibrar.py                 # lee analisis/datos/ y escribe app/data/ajustes.json
    py analisis/calibrar.py --seco          # solo el informe, sin tocar ajustes.json
    py analisis/calibrar.py --datos otra/carpeta --salida otra/ruta/ajustes.json
    py analisis/calibrar.py --aceptar-retiradas   # si el freno de retiradas se ha parado y las retiradas son buenas

Resultados: app/data/ajustes.json, analisis/salida/informe.md y analisis/salida/niveles.csv
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from calibracion import RAIZ, calibrar, escribir_ajustes, freno_retiradas, leer_ajustes
from informe import escribir_csv, escribir_informe, tabla_niveles


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--datos", type=Path, default=RAIZ / "analisis" / "datos", help="carpeta con las exportaciones")
    ap.add_argument("--salida", type=Path, default=RAIZ / "app" / "data" / "ajustes.json", help="dónde escribir los ajustes")
    ap.add_argument("--seco", action="store_true", help="solo el informe, sin tocar ajustes.json")
    ap.add_argument("--aceptar-retiradas", action="store_true", help="escribe los ajustes aunque se retiren de golpe muchas preguntas")
    args = ap.parse_args(argv)

    carpeta_salida = RAIZ / "analisis" / "salida"
    carpeta_salida.mkdir(parents=True, exist_ok=True)
    previos = leer_ajustes(RAIZ)
    res = calibrar(RAIZ, args.datos)
    freno = freno_retiradas(res.ajustes["retiradas"], previos.get("retiradas") or {}, res.datos.marcas,
                            (res.config.get("retirada") or {}).get("max_por_calibracion"))
    frenado = freno is not None and not args.aceptar_retiradas

    escribir_csv(tabla_niveles(res, previos), carpeta_salida / "niveles.csv")
    escribir_informe(res, carpeta_salida / "informe.md", previos)
    if not args.seco and not frenado:
        escribir_ajustes(res.ajustes, args.salida)

    print(f"Exportaciones: {res.exportaciones.n_archivos} · preguntas jugadas: {len(res.datos.respuestas)} · valoraciones: {len(res.datos.valoraciones)}")
    if res.exportaciones.ignorados:
        print(f"Archivos ignorados (no se pueden leer o no son de la app): {', '.join(res.exportaciones.ignorados)}")
    print(f"Preguntas que cambian de nivel: {len(res.ajustes['niveles'])} · retiradas: {len(res.ajustes['retiradas'])}")
    print("Informe: analisis/salida/informe.md")
    if frenado:
        origen = ", ".join(f"{quien} ({n})" for quien, n in freno["origen"])
        print(f"\nOJO: esta calibración retiraría de golpe {len(freno['nuevas'])} preguntas nuevas, y el máximo es "
              f"{res.config['retirada']['max_por_calibracion']}. No se ha tocado ajustes.json.\n"
              f"Cualquiera puede enviar datos a la hoja del grupo, así que pueden ser marcas falsas. Las marcas vienen sobre todo de: {origen}.\n"
              "Míralo en el informe («Preguntas retiradas»). Si son buenas, repite con --aceptar-retiradas.")
        return 2
    print("Modo seco: no se ha modificado ajustes.json" if args.seco else f"Ajustes escritos en {args.salida}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(principal())
