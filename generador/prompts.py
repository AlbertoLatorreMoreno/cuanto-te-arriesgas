"""Textos que se envían al modelo y esquemas JSON de las respuestas."""

from __future__ import annotations

from comun import Proyecto, plural, vb

SUBTEMAS_VERIFICABLES = vb.SUBTEMAS_VERIFICABLES  # los mismos que exige el validador


def sistema_generador(proyecto: Proyecto) -> str:
    rubrica = (proyecto.raiz / "docs" / "rubrica_niveles.md").read_text(encoding="utf-8")
    return f"""Escribes preguntas para «¿Cuánto te arriesgas?», un juego de preguntas en español de España para jugar en grupo con un móvil.
Cada jugador elige del 1 al 10 cuánto se arriesga y recibe una pregunta de ese nivel. Otro jugador la lee en voz alta y el grupo decide si la respuesta vale.
Lo más importante es que el nivel sea correcto y que la respuesta sea indiscutible.

{rubrica}

Además:
- Escribe en español de España, con el registro de un concurso de televisión: claro, directo y sin adornos.
- La respuesta tiene que ser verificable y estable. Si no estás seguro de un dato, no escribas esa pregunta.
- No repitas ni parafrasees las preguntas que ya existen en el subtema, y no uses sus respuestas: ni como respuesta ni dentro de tu pregunta o tu explicación. En una partida pueden salir juntas y una delataría a la otra.
- Varía los temas dentro del subtema y la forma de preguntar.
- `explicacion` es una frase que aporta un dato curioso o el razonamiento; no repite la respuesta sin más.
- `criterio` es una cadena vacía si no hace falta ninguna regla para juzgar la respuesta.
- `verificacion` es una cadena vacía salvo en Mates y lógica (cálculo, geometría y probabilidad, donde es obligatoria): una expresión de Python que calcule la respuesta.
- `nivel` es el nivel que se te pidió para esa pregunta; `nivel_estimado`, el que crees que tiene de verdad, del 1 al 10."""


def usuario_generador(proyecto: Proyecto, cat: str, sub: str, pedidos: dict[int, int],
                      existentes: list[dict], ejemplos: dict[int, list[dict]]) -> str:
    c = proyecto.categoria(cat)
    s = proyecto.subtema(cat, sub)
    total = sum(pedidos.values())
    lineas = [
        f"Escribe {plural(total, 'pregunta nueva', 'preguntas nuevas')} de la categoría «{c['nombre']}», subtema «{s['nombre']}», con estos niveles:",
        *[f"- nivel {nivel}: {plural(n, 'pregunta')}" for nivel, n in sorted(pedidos.items())],
        "Pon en `nivel` el nivel para el que escribes cada pregunta (uno de los pedidos).",
        "",
    ]
    if (cat, sub) in SUBTEMAS_VERIFICABLES:
        lineas += ["En este subtema `verificacion` es obligatoria.", ""]
    con_ejemplos = {n: e for n, e in ejemplos.items() if e}
    if con_ejemplos:
        lineas.append("Preguntas de referencia de cada nivel (de otros subtemas), para calibrar la dificultad:")
        for nivel, lista in sorted(con_ejemplos.items()):
            lineas += [f"- nivel {nivel}: {e['pregunta']} → {e['respuesta']}" for e in lista]
        lineas.append("")
    if existentes:
        lineas.append("Preguntas que ya existen en este subtema, con su respuesta (no las repitas, no las parafrasees y no uses sus respuestas):")
        lineas += [f"- {e['pregunta']} → {e['respuesta']}" for e in existentes]
    return "\n".join(lineas)


ESQUEMA_GENERACION = {
    "type": "object",
    "properties": {
        "preguntas": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "nivel": {"type": "integer"},
                    "pregunta": {"type": "string"},
                    "respuesta": {"type": "string"},
                    "tambien_vale": {"type": "array", "items": {"type": "string"}},
                    "criterio": {"type": "string"},
                    "explicacion": {"type": "string"},
                    "verificacion": {"type": "string"},
                    "nivel_estimado": {"type": "integer"},
                },
                "required": ["nivel", "pregunta", "respuesta", "tambien_vale", "criterio", "explicacion", "verificacion", "nivel_estimado"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["preguntas"],
    "additionalProperties": False,
}


def sistema_juez(proyecto: Proyecto) -> str:
    rubrica = (proyecto.raiz / "docs" / "rubrica_niveles.md").read_text(encoding="utf-8")
    return f"""Revisas preguntas de «¿Cuánto te arriesgas?», un juego de preguntas en español de España. Tu trabajo es detectar problemas antes de que lleguen a una partida.

{rubrica}

Para cada pregunta, puntúa del 1 al 5:
- exactitud: 5 si la respuesta y la explicación son correctas sin duda; 1 si alguna es falsa. Si dudas de un dato, no pases de 3. Si la respuesta puede cambiar con el tiempo (cargos actuales, récords vigentes, «el último…»), no pases de 2.
- ambiguedad: 1 si solo hay una respuesta válida (contando «también vale»); 5 si hay varias respuestas razonables que no están recogidas o la pregunta admite interpretaciones distintas.
- claridad: 5 si se entiende a la primera al oírla en voz alta; 1 si es confusa, larga o da pistas de la respuesta.
Además:
- nivel_estimado: el nivel del 1 al 10 que crees que tiene de verdad, según la rúbrica.
- comentario: una frase con el problema principal, o una cadena vacía si no hay ninguno.
Sé exigente: es mejor descartar una pregunta buena que dejar pasar una errónea."""


def usuario_juez(preguntas: list[dict]) -> str:
    lineas = ["Revisa estas preguntas. Devuelve una valoración por cada una, con su mismo id.", ""]
    for p in preguntas:
        lineas.append(f"id: {p['id']}")
        lineas.append(f"nivel asignado: {p['nivel']}")
        lineas.append(f"pregunta: {p['pregunta']}")
        lineas.append(f"respuesta: {p['respuesta']}")
        if p.get("tambien_vale"):
            lineas.append(f"también vale: {' · '.join(p['tambien_vale'])}")
        if p.get("criterio"):
            lineas.append(f"criterio: {p['criterio']}")
        if p.get("explicacion"):
            lineas.append(f"explicación: {p['explicacion']}")
        lineas.append("")
    return "\n".join(lineas)


ESQUEMA_JUEZ = {
    "type": "object",
    "properties": {
        "valoraciones": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "exactitud": {"type": "integer"},
                    "ambiguedad": {"type": "integer"},
                    "claridad": {"type": "integer"},
                    "nivel_estimado": {"type": "integer"},
                    "comentario": {"type": "string"},
                },
                "required": ["id", "exactitud", "ambiguedad", "claridad", "nivel_estimado", "comentario"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["valoraciones"],
    "additionalProperties": False,
}
