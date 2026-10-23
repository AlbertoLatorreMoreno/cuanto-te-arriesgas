"""Llamadas a la API de Claude con salida JSON estructurada.

- Modelo: Claude Opus 5.5 (`claude-opus-5-5`).
- La salida se fuerza con un esquema JSON (`output_config.format`), así que la respuesta
  es siempre JSON válido con la forma pedida.
- Respaldo en el servidor (`fallbacks: "default"`): si el modelo rechaza una petición por
  seguridad, la API la repite con el modelo que Anthropic recomienda para ese caso.
- La clave de API se lee del entorno (ANTHROPIC_API_KEY o `ant auth login`); nunca va en el código.
"""

from __future__ import annotations

import json
import logging

MODELO = "claude-opus-5-5"
BETA_RESPALDO = "server-side-fallback-2026-07-01"

log = logging.getLogger("generador")


class ErrorGenerador(Exception):
    """Fallo que hay que explicar al usuario (no un error de programación)."""


class Rechazo(ErrorGenerador):
    """El modelo (y su respaldo) han rechazado la petición."""


class Cortada(ErrorGenerador):
    """La respuesta llegó al límite de longitud. El razonamiento del modelo (siempre activo en
    Opus 5.5) también cuenta, así que quien llama repite la petición en trozos más pequeños."""


def crear_cliente():
    try:
        import anthropic
    except ImportError as exc:
        raise ErrorGenerador("Falta el SDK de Anthropic. Instálalo con:  py -m pip install -r generador/requirements.txt") from exc
    return anthropic.Anthropic()


def llamar_json(cliente, *, sistema: str, usuario: str, esquema: dict, esfuerzo: str = "high", max_tokens: int = 16000) -> dict:
    """Hace una petición y devuelve el JSON de la respuesta ya interpretado."""
    try:
        respuesta = _crear(cliente, sistema, usuario, esquema, esfuerzo, max_tokens)
    except TypeError as exc:
        if any(param in str(exc) for param in ("fallbacks", "output_config", "betas")):
            raise ErrorGenerador("Tu versión del SDK de Anthropic es antigua. Actualízala con:  py -m pip install -U anthropic") from exc
        raise
    return _interpretar(respuesta)


def _crear(cliente, sistema, usuario, esquema, esfuerzo, max_tokens):
    return cliente.beta.messages.create(
        model=MODELO,
        max_tokens=max_tokens,
        betas=[BETA_RESPALDO],
        fallbacks="default",
        # El texto de sistema es igual en todas las llamadas: se marca para la caché de prompts.
        system=[{"type": "text", "text": sistema, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": usuario}],
        output_config={"effort": esfuerzo, "format": {"type": "json_schema", "schema": esquema}},
    )


def _interpretar(respuesta) -> dict:
    if respuesta.stop_reason == "refusal":
        detalle = getattr(respuesta, "stop_details", None)
        categoria = getattr(detalle, "category", None) if detalle else None
        raise Rechazo(f"El modelo ha rechazado la petición (categoría: {categoria or 'sin especificar'}).")
    if respuesta.stop_reason == "max_tokens":
        raise Cortada("La respuesta se ha cortado por longitud.")

    iteraciones = getattr(getattr(respuesta, "usage", None), "iterations", None) or []
    if any(getattr(i, "type", None) == "fallback_message" for i in iteraciones):
        log.info("La petición la ha respondido el modelo de respaldo %s", getattr(respuesta, "model", "?"))

    texto = next((b.text for b in respuesta.content if b.type == "text"), None)
    if texto is None:
        raise ErrorGenerador("La respuesta no trae texto.")
    try:
        return json.loads(texto)
    except json.JSONDecodeError as exc:
        raise ErrorGenerador(f"La respuesta no es JSON válido: {exc}") from exc


def explicar_error_api(exc: Exception) -> str | None:
    """Traduce los errores del SDK a un mensaje útil. Devuelve None si no es un error de la API."""
    try:
        import anthropic
    except ImportError:
        return None
    if isinstance(exc, anthropic.AuthenticationError):
        return "Clave de API no válida o ausente. Define ANTHROPIC_API_KEY o ejecuta `ant auth login`."
    if isinstance(exc, anthropic.PermissionDeniedError):
        return "La clave no tiene permiso para usar este modelo."
    if isinstance(exc, anthropic.NotFoundError):
        return f"Modelo o endpoint no encontrado ({MODELO}). ¿Está actualizado el SDK?"
    if isinstance(exc, anthropic.RateLimitError):
        return "Límite de peticiones alcanzado. Espera un poco y vuelve a lanzar (las ya generadas se han guardado)."
    if isinstance(exc, anthropic.BadRequestError):
        return f"Petición rechazada por la API: {exc.message}"
    if isinstance(exc, anthropic.APIStatusError):
        return f"Error de la API ({exc.status_code}): {exc.message}"
    if isinstance(exc, anthropic.APIConnectionError):
        return "No hay conexión con la API. Revisa la red."
    return None
