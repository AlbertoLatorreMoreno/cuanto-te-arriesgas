"""Valida las preguntas finales propias (`app/data/finales.json`).

La final ya no sale del banco: tiene sus propias preguntas, más difíciles, en tres escalones
(nivel 8, 9 y 10, según la ventaja sobre el último) y sin categoría. Dos tipos:
- «pregunta»: como las del banco, con su fuente. Si es de cálculo lleva «segundos» (el
  cronómetro, si la partida lo usa) y su «verificacion», que se calcula y se compara.
- «reto»: «acierta al menos k de n» (por ejemplo, 4 de 5 banderas descritas en voz alta), con
  tiempo siempre. Cada elemento es una descripción con su respuesta, como en las ráfagas.

Lo usa `validar_banco.py`, que valida a la vez el banco, las rondas y las finales, y su archivo
de control (`finales.lock.json`) para que una final que cambia suba su versión.
"""

from __future__ import annotations

import hashlib
import json
import re
from difflib import SequenceMatcher

from validar_banco import APP, PALABRAS_CADUCAN, PALABRAS_PROHIBIDAS, SIMILITUD_AVISO, Informe, jaccard, normalizar, verificar_mates
from validar_rondas import _texto, verificar

FINALES = APP / "data" / "finales.json"
LOCK_FINALES = APP / "data" / "finales.lock.json"

TIPOS = {"pregunta", "reto"}
NIVELES = (8, 10)
SEGUNDOS = {"pregunta": (30, 180), "reto": (15, 180)}
ELEMENTOS = (3, 10)
LARGO_PREGUNTA = 260  # algo más que en el banco: una final puede necesitar contexto
LARGO_RESPUESTA = 60
# En un reto, el mínimo exigido respecto al total: por debajo es más suerte que saber.
PROPORCION_MINIMA = 0.6
SEGUNDOS_POR_ELEMENTO = (4, 25)


def cargar_finales(inf: Informe, ruta=None) -> list[dict]:
    ruta = ruta or FINALES
    if not ruta.exists():
        inf.error(ruta.name, "no existe")
        return []
    datos = json.loads(ruta.read_text(encoding="utf-8"))
    if datos.get("formato") != 1 or not isinstance(datos.get("finales"), list):
        inf.error(ruta.name, "debe tener «formato»: 1 y una lista «finales»")
        return []
    return datos["finales"]


def huella_final(f: dict) -> str:
    """Lo que, si cambia, cambia la final: entonces hay que subir su «v» para no mezclar estadísticas."""
    if f.get("tipo") == "reto":
        contenido = [f.get("tipo"), f.get("enunciado"), f.get("minimo"), f.get("segundos"), f.get("elementos")]
    else:
        contenido = [f.get("tipo"), f.get("pregunta"), f.get("respuesta"), f.get("tambien_vale"), f.get("criterio"), f.get("segundos")]
    return hashlib.sha1(json.dumps(contenido, ensure_ascii=False).encode("utf-8")).hexdigest()[:12]


def _entero(valor) -> bool:
    return isinstance(valor, int) and not isinstance(valor, bool)


def _redaccion(texto: str, donde: str, inf: Informe):
    bajo = texto.lower()
    for palabra in PALABRAS_PROHIBIDAS:
        if palabra in bajo:
            inf.error(donde, f"contiene «{palabra}» (ver normas de redacción)")
    for palabra in PALABRAS_CADUCAN:
        if re.search(rf"\b{re.escape(palabra)}\b", bajo):
            inf.aviso(donde, f"«{palabra}»: ¿es un hecho que puede caducar?")


def _sobrantes(principal: str | None, tambien: list, donde: str, inf: Informe):
    """Quien lee juzga a ojo: una variante que solo cambia tildes o mayúsculas no le dice nada."""
    vistas = {normalizar(principal)} if principal else set()
    for x in tambien:
        if isinstance(x, str) and normalizar(x) in vistas:
            inf.aviso(donde, f"la variante «{x}» solo cambia tildes, mayúsculas o signos: sobra")
        elif isinstance(x, str):
            vistas.add(normalizar(x))


def _validar_pregunta(f: dict, donde: str, inf: Informe):
    texto = _texto(f, "pregunta", donde, inf)
    respuesta = _texto(f, "respuesta", donde, inf)
    for campo in ("criterio", "explicacion", "verificacion"):
        if f.get(campo) is not None and not isinstance(f[campo], str):
            inf.error(donde, f"«{campo}» debe ser texto o null")
    if texto:
        if not re.search(r"¿[^¿?]+\?", texto):
            inf.error(donde, "la pregunta debe contener una interrogación completa, entre «¿» y «?»")
        if len(texto) > LARGO_PREGUNTA:
            inf.error(donde, f"pregunta demasiado larga para leerla en voz alta ({len(texto)} caracteres, máximo {LARGO_PREGUNTA})")
        _redaccion(texto, donde, inf)
    if respuesta:
        if len(respuesta) > LARGO_RESPUESTA:
            inf.error(donde, f"respuesta demasiado larga ({len(respuesta)} caracteres)")
        if texto and len(normalizar(respuesta)) > 3 and normalizar(respuesta) in normalizar(texto):
            inf.aviso(donde, "la respuesta aparece dentro de la pregunta")
    tambien = f.get("tambien_vale")
    if not isinstance(tambien, list) or any(not isinstance(x, str) or not x.strip() for x in tambien):
        inf.error(donde, "«tambien_vale» debe ser una lista de textos no vacíos")
    else:
        _sobrantes(respuesta, tambien, donde, inf)
    if isinstance(f.get("explicacion"), str) and len(f["explicacion"]) > 240:
        inf.aviso(donde, "explicación larga")

    segundos = f.get("segundos")
    if segundos is not None:
        lo, hi = SEGUNDOS["pregunta"]
        if not _entero(segundos) or not lo <= segundos <= hi:
            inf.error(donde, f"«segundos» debe ser null o un entero entre {lo} y {hi}")
        elif not f.get("verificacion"):
            inf.aviso(donde, "lleva tiempo pero no «verificacion»: si es de cálculo, añade la fórmula")
    if isinstance(f.get("verificacion"), str) and respuesta:
        verificar_mates(f, donde, inf)


def _validar_reto(f: dict, donde: str, inf: Informe):
    _texto(f, "titulo", donde, inf)
    enunciado = _texto(f, "enunciado", donde, inf)
    _texto(f, "nota", donde, inf, obligatorio=False)
    if enunciado:
        _redaccion(enunciado, donde, inf)
    for campo in ("pregunta", "respuesta", "criterio"):
        if f.get(campo) is not None:
            inf.error(donde, f"«{campo}» no va en un reto (cada elemento lleva su respuesta)")

    segundos = f.get("segundos")
    lo, hi = SEGUNDOS["reto"]
    if not _entero(segundos) or not lo <= segundos <= hi:
        inf.error(donde, f"un reto lleva tiempo: «segundos» entre {lo} y {hi}")
        segundos = None
    elif segundos % 5:
        inf.aviso(donde, "«segundos» mejor en múltiplos de 5")

    elementos = f.get("elementos")
    if not isinstance(elementos, list) or not ELEMENTOS[0] <= len(elementos) <= ELEMENTOS[1]:
        inf.error(donde, f"un reto lleva entre {ELEMENTOS[0]} y {ELEMENTOS[1]} elementos")
        return
    minimo = f.get("minimo")
    if not _entero(minimo) or not 1 <= minimo <= len(elementos):
        inf.error(donde, f"«minimo» debe ser un entero entre 1 y {len(elementos)}")
    elif minimo / len(elementos) < PROPORCION_MINIMA:
        inf.aviso(donde, f"pide {minimo} de {len(elementos)}: ¿demasiado fácil para una final?")

    # Cada respuesta (y cada variante) solo puede valer para un elemento.
    vistos: dict[str, int] = {}
    for i, e in enumerate(elementos):
        de = f"{donde} · elemento {i + 1}"
        if not isinstance(e, dict):
            inf.error(de, "debe ser un objeto")
            continue
        nombre = _texto(e, "respuesta", de, inf)
        pista = _texto(e, "pista", de, inf)
        clave_nombre = normalizar(nombre) if nombre else ""
        if pista and clave_nombre and (len(clave_nombre) > 2 or clave_nombre.isdigit()) and re.search(rf"\b{re.escape(clave_nombre)}\b", normalizar(pista)):
            inf.error(de, f"la descripción contiene la respuesta («{nombre}»)")
        if e.get("verificacion") is not None:
            verificar(e, nombre, de, inf)
        tambien = e.get("tambien_vale", [])
        if not isinstance(tambien, list) or any(not isinstance(x, str) or not x.strip() for x in tambien):
            inf.error(de, "«tambien_vale» solo admite textos no vacíos")
            tambien = []
        _sobrantes(nombre, tambien, de, inf)
        for variante in ([nombre] if nombre else []) + tambien:
            clave = normalizar(variante)
            if clave in vistos and vistos[clave] != i:
                inf.error(de, f"«{variante}» ya vale para el elemento {vistos[clave] + 1}")
            vistos.setdefault(clave, i)

    if segundos:
        por_elemento = segundos / len(elementos)
        if not SEGUNDOS_POR_ELEMENTO[0] <= por_elemento <= SEGUNDOS_POR_ELEMENTO[1]:
            inf.aviso(donde, f"{segundos} s para {len(elementos)} elementos ({por_elemento:.1f} s cada uno): ¿demasiado fácil o imposible?")


def validar_final(f: dict, inf: Informe):
    donde = f.get("id") if isinstance(f.get("id"), str) else "(final sin id)"
    if not isinstance(f.get("id"), str) or not re.fullmatch(r"fin-\d{3}", f["id"]):
        inf.error(donde, "el id debe tener la forma fin-NNN (tres cifras)")
    if not _entero(f.get("v")) or f["v"] < 1:
        inf.error(donde, "«v» debe ser un entero desde 1")
    if not _entero(f.get("nivel")) or not NIVELES[0] <= f["nivel"] <= NIVELES[1]:
        inf.error(donde, f"«nivel» debe ser {NIVELES[0]}, {NIVELES[0] + 1} o {NIVELES[1]}")
    for campo in ("categoria", "subtema"):
        if campo in f:
            inf.error(donde, f"una final no tiene «{campo}»: es de tema libre")
    _texto(f, "fuente", donde, inf)
    tipo = f.get("tipo")
    if tipo == "pregunta":
        _validar_pregunta(f, donde, inf)
    elif tipo == "reto":
        _validar_reto(f, donde, inf)
    else:
        inf.error(donde, f"tipo desconocido «{tipo}» (pregunta o reto)")


def _numeros(texto: str) -> list[str]:
    return re.findall(r"\d+", texto or "")


def datos_repetidos(finales: list[dict], banco: list[dict], rondas: list[dict], inf: Informe):
    """Avisa si una final da por sabido algo que ya sale en el banco o en las rondas: una serie de un
    reto que es una pregunta del banco, un número de la respuesta (un año, un resultado) que aparece en
    otro texto, o una respuesta que sale en una explicación o en la pista de una ronda. En la revisión
    del 21 de octubre salieron así cuatro series del reto «¿Qué número sigue?», los años de «¿En qué año
    fue?» (en los enunciados de las preguntas de mapa) y «Farrokh Bulsara» en una explicación."""
    # Enunciados y respuestas (donde estaban los años) y, aparte, explicaciones, criterios y pistas
    # (donde se cuelan los nombres). Una sola palabra («Francia», «Siete») coincide sin ser una fuga:
    # de las respuestas con letras solo se buscan las de dos palabras o más.
    enunciados = [(p.get("id"), normalizar(" ".join(str(x) for x in [p.get("pregunta"), p.get("respuesta"), *(p.get("tambien_vale") or [])] if x)))
                  for p in banco]
    notas = [(p.get("id"), normalizar(" ".join(str(x) for x in [p.get("criterio"), p.get("explicacion")] if x))) for p in banco]
    for r in rondas:
        for e in r.get("elementos") or []:
            enunciados.append((r.get("id"), normalizar(" ".join(str(x) for x in [e.get("pista"), e.get("texto"), e.get("respuesta"), *(e.get("tambien_vale") or [])] if x))))
            notas.append((r.get("id"), normalizar(e.get("pista") or "")))
    series = [(id_, " ".join(_numeros(t))) for id_, t in enunciados]

    for f in finales:
        if not isinstance(f, dict) or not isinstance(f.get("id"), str):
            continue
        partes = [(f.get("pregunta") or "", f.get("verificacion"), [f.get("respuesta"), *(f.get("tambien_vale") or [])])]
        partes += [(e.get("pista") or "", e.get("verificacion"), [e.get("respuesta"), *(e.get("tambien_vale") or [])]) for e in f.get("elementos") or []]
        for pista, calculo, respuestas in partes:
            if len(_numeros(pista)) >= 3:
                serie = " ".join(_numeros(pista))
                for id_, s in series:
                    if f" {serie} " in f" {s} ":
                        inf.aviso(f["id"], f"la serie «{pista}» ya es una pregunta: {id_}")
            for r in respuestas:
                clave = re.sub(r"^(el|la|los|las|lo|un|una) ", "", normalizar(str(r or "")))
                if clave.replace(" ", "").isdigit():
                    # Un número que es un dato (un año), no el resultado de una cuenta.
                    lugares = [id_ for id_, t in enunciados if f" {clave} " in f" {t} "] if len(clave) >= 3 and not calculo else []
                else:
                    lugares = [id_ for id_, t in notas if f" {clave} " in f" {t} "] if len(clave.split()) >= 2 else []
                if lugares:
                    inf.aviso(f["id"], f"su respuesta «{r}» también sale en {', '.join(dict.fromkeys(lugares))} (comprueba que no la delata)")


def validar_finales(finales: list[dict], inf: Informe, banco: list[dict] | None = None, rondas: list[dict] | None = None):
    if banco is not None or rondas is not None:
        datos_repetidos(finales, banco or [], rondas or [], inf)
    for f in finales:
        if not isinstance(f, dict):
            inf.error("finales.json", "cada final debe ser un objeto")
            continue
        validar_final(f, inf)
    ids = [f.get("id") for f in finales if isinstance(f, dict)]
    for id_ in sorted({i for i in ids if ids.count(i) > 1}, key=str):
        inf.error(str(id_), "id repetido")

    # Una final que ya está en el banco (o casi) no es nueva para quien la haya visto allí.
    textos = [(f["id"], normalizar(f.get("pregunta") or f.get("enunciado") or "")) for f in finales
              if isinstance(f, dict) and isinstance(f.get("id"), str)]
    for i, (id_a, a) in enumerate(textos):
        for id_b, b in textos[i + 1:]:
            if a and a == b:
                inf.error(id_b, f"idéntica a {id_a}")
    for p in banco or []:
        tp = normalizar(p.get("pregunta", ""))
        for id_f, tf in textos:
            if not tf or abs(len(tf) - len(tp)) > 0.4 * max(len(tf), len(tp)):
                continue
            if tf == tp:
                inf.error(id_f, f"es la pregunta {p.get('id')} del banco")
            elif jaccard(tf, tp) >= 0.6 and SequenceMatcher(None, tf, tp).ratio() >= SIMILITUD_AVISO:
                inf.aviso(id_f, f"muy parecida a {p.get('id')} del banco")


def resumen(finales: list[dict]) -> str:
    por_nivel = {n: 0 for n in range(NIVELES[0], NIVELES[1] + 1)}
    for f in finales:
        if f.get("nivel") in por_nivel:
            por_nivel[f["nivel"]] += 1
    retos = sum(1 for f in finales if f.get("tipo") == "reto")
    niveles = ", ".join(f"{k} de nivel {n}" for n, k in por_nivel.items())
    return f"Finales: {len(finales)} ({niveles}; {retos} retos)"
