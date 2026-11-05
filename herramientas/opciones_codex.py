"""Opciones incorrectas del modo solo con Codex (la CLI de OpenAI, con la cuenta del usuario): para las preguntas de
texto que aún no las tienen para su versión actual (las nuevas o las reescritas).

Uso:
    py herramientas/opciones_codex.py preparar              # lotes en herramientas/opciones_lotes/entrada
    py herramientas/opciones_codex.py lanzar [--paralelo 4] # Codex hace cada lote (salida/<lote>.json)
    py herramientas/opciones_codex.py incorporar            # las pasa a app/data/opciones/*.json
    py herramientas/validar_opciones.py                     # y siempre, después, el validador

Las instrucciones que recibe Codex están en herramientas/opciones_instrucciones.md. Codex no toca archivos: recibe
cada lote por la entrada estándar y devuelve un JSON. Lo que crea que está mal en el banco lo deja en «dudas»;
`incorporar` las junta en herramientas/opciones_lotes/dudas.md para revisarlas a mano (no cambia el banco).
La carpeta de lotes está en .gitignore.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validar_banco as vb  # noqa: E402
import validar_opciones as vo  # noqa: E402

AQUI = Path(__file__).resolve().parent
LOTES = AQUI / "opciones_lotes"
INSTRUCCIONES = AQUI / "opciones_instrucciones.md"
POR_LOTE = 40


def codex() -> str:
    """La CLI de Codex: la del PATH o la que instala la app de escritorio."""
    for c in (shutil.which("codex"), Path(os.environ.get("USERPROFILE", "")) / ".codex" / ".sandbox-bin" / "codex.exe"):
        if c and Path(c).exists():
            return str(c)
    sys.exit("No encuentro la CLI de Codex (codex). Instálala o añádela al PATH.")


def preparar(config: dict) -> list[str]:
    inf = vb.Informe()
    banco = vb.cargar_banco(config, inf)
    opciones, no_aptas = vo.cargar_opciones(config, inf)
    nombres = {c["id"]: c["nombre"] for c in vb.categorias_del_banco(config)}
    subnombres = {(c["id"], s["id"]): s["nombre"] for c in vb.categorias_del_banco(config) for s in c["subtemas"]}
    faltan = defaultdict(list)
    for p in banco:
        if p.get("tipo") == "mapa" or p["id"] in no_aptas or opciones.get(p["id"], {}).get("v") == p.get("v"):
            continue
        faltan[p["categoria"]].append(p)
    (LOTES / "entrada").mkdir(parents=True, exist_ok=True)
    (LOTES / "salida").mkdir(parents=True, exist_ok=True)
    hechos = []
    for cat, ps in faltan.items():
        ps.sort(key=lambda q: (q["subtema"], q["nivel"], q["id"]))
        for k in range(0, len(ps), POR_LOTE):
            lote = f"{cat}_{k // POR_LOTE + 1:02d}"
            datos = {
                "lote": lote,
                "categoria": nombres[cat],
                "preguntas": [{c: p[c] for c in ("id", "v", "nivel", "pregunta", "respuesta", "tambien_vale", "criterio", "explicacion") if c in p}
                              | {"subtema": subnombres[(cat, p["subtema"])]} for p in ps[k:k + POR_LOTE]],
            }
            (LOTES / "entrada" / f"{lote}.json").write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
            hechos.append(lote)
    return hechos


def extraer_json(texto: str) -> dict:
    texto = re.sub(r"^```(?:json)?\s*|\s*```$", "", texto.strip())
    return json.loads(texto[texto.find("{"): texto.rfind("}") + 1])


def lanzar_lote(lote: str) -> str:
    entrada = (LOTES / "entrada" / f"{lote}.json").read_text(encoding="utf-8")
    crudo = LOTES / "salida" / f"{lote}.crudo.txt"
    prompt = INSTRUCCIONES.read_text(encoding="utf-8") + f"\n\nEste es el lote «{lote}». Responde solo con el JSON."
    t0 = time.time()
    r = subprocess.run([codex(), "exec", "-s", "read-only", "--skip-git-repo-check", "-C", str(LOTES), "-o", str(crudo), prompt],
                       input=entrada, capture_output=True, text=True, encoding="utf-8", errors="replace")
    try:
        datos = extraer_json(crudo.read_text(encoding="utf-8"))
        (LOTES / "salida" / f"{lote}.json").write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
        return f"{lote}: {len(datos.get('opciones', {}))} con opciones, {len(datos.get('no_aptas', {}))} no aptas, en {time.time() - t0:.0f} s"
    except Exception as e:  # noqa: BLE001
        (LOTES / "salida" / f"{lote}.error.txt").write_text(((r.stdout or "") + (r.stderr or ""))[-5000:], encoding="utf-8")
        return f"{lote}: ERROR {e}"


def incorporar(config: dict, carpeta: Path) -> tuple[int, int, list[str]]:
    """Pasa las salidas de Codex a app/data/opciones. Lo de cada id sustituye a lo que hubiera."""
    inf = vb.Informe()
    por_id = {p["id"]: p for p in vb.cargar_banco(config, inf)}
    nuevas, no_aptas, dudas = {}, {}, []
    for ruta in sorted(carpeta.glob("*.json")):
        if ruta.name.endswith(".crudo.json"):
            continue
        datos = json.loads(ruta.read_text(encoding="utf-8"))
        nuevas.update(datos.get("opciones") or {})
        no_aptas.update(datos.get("no_aptas") or {})
        for id_, texto in (datos.get("dudas") or {}).items():
            dudas.append(f"- **{id_}** ({por_id.get(id_, {}).get('pregunta', '?')} → {por_id.get(id_, {}).get('respuesta', '?')}): {texto}")
    por_cat = defaultdict(lambda: ({}, {}))
    for id_, o in nuevas.items():
        if id_ in por_id:
            por_cat[por_id[id_]["categoria"]][0][id_] = {k: o[k] for k in ("v", "correcta", "incorrectas") if k in o}
    for id_, motivo in no_aptas.items():
        if id_ in por_id:
            por_cat[por_id[id_]["categoria"]][1][id_] = motivo
    carpeta_app = vo.carpeta_opciones(config)
    carpeta_app.mkdir(parents=True, exist_ok=True)
    for cat in vb.categorias_del_banco(config):
        if cat.get("tipo") == "mapa" or cat["id"] not in por_cat:
            continue
        ruta = vo.archivo_opciones(config, cat)
        actual = json.loads(ruta.read_text(encoding="utf-8")) if ruta.exists() else {"formato": 1, "opciones": {}, "no_aptas": {}}
        ops, noap = por_cat[cat["id"]]
        for id_ in ops:
            actual.setdefault("no_aptas", {}).pop(id_, None)
        for id_ in noap:
            actual.setdefault("opciones", {}).pop(id_, None)
        actual["opciones"] = dict(sorted({**actual.get("opciones", {}), **ops}.items()))
        actual["no_aptas"] = dict(sorted({**actual.get("no_aptas", {}), **noap}.items()))
        ruta.write_text(escribir(actual), encoding="utf-8")
    return len(nuevas), len(no_aptas), dudas


def escribir(datos: dict) -> str:
    """Una pregunta por línea: diffs legibles y archivos pequeños."""
    lineas = ["{", '  "formato": 1,', '  "opciones": {']
    ops = list(datos.get("opciones", {}).items())
    for i, (id_, o) in enumerate(ops):
        lineas.append(f"    {json.dumps(id_, ensure_ascii=False)}: {json.dumps(o, ensure_ascii=False)}" + ("," if i < len(ops) - 1 else ""))
    lineas += ["  },", '  "no_aptas": {']
    noap = list(datos.get("no_aptas", {}).items())
    for i, (id_, m) in enumerate(noap):
        lineas.append(f"    {json.dumps(id_, ensure_ascii=False)}: {json.dumps(m, ensure_ascii=False)}" + ("," if i < len(noap) - 1 else ""))
    lineas += ["  }", "}"]
    return "\n".join(lineas) + "\n"


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("accion", choices=["preparar", "lanzar", "incorporar"])
    ap.add_argument("lotes", nargs="*", help="lanzar: solo estos lotes")
    ap.add_argument("--paralelo", type=int, default=4)
    ap.add_argument("--carpeta", help="incorporar: carpeta con las salidas (por defecto, opciones_lotes/salida)")
    args = ap.parse_args(argv)
    config = vb.cargar_config()
    if args.accion == "preparar":
        lotes = preparar(config)
        print(f"{len(lotes)} lotes en {LOTES / 'entrada'}" if lotes else "Todas las preguntas tienen opciones.")
    elif args.accion == "lanzar":
        lotes = args.lotes or sorted(p.stem for p in (LOTES / "entrada").glob("*.json") if not (LOTES / "salida" / p.name).exists())
        with ThreadPoolExecutor(args.paralelo) as ex:
            for linea in ex.map(lanzar_lote, lotes):
                print(linea, flush=True)
    else:
        n, m, dudas = incorporar(config, Path(args.carpeta) if args.carpeta else LOTES / "salida")
        print(f"Incorporadas: {n} con opciones y {m} no aptas.")
        if dudas:
            (LOTES / "dudas.md").parent.mkdir(parents=True, exist_ok=True)
            (LOTES / "dudas.md").write_text("# Dudas de Codex sobre el banco\n\n" + "\n".join(dudas) + "\n", encoding="utf-8")
            print(f"{len(dudas)} dudas sobre el banco en {LOTES / 'dudas.md'}")
        print("Ahora:  py herramientas/validar_opciones.py")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(principal())
