<!-- seccion: base -->
# Revisión de preguntas nuevas para «¿Cuánto te arriesgas?»

Hola, Codex. «¿Cuánto te arriesgas?» es un juego de preguntas en español de España para jugar en grupo con un móvil: cada jugador elige del 1 al 10 cuánto se arriesga y recibe una pregunta de ese nivel, que otro lee en voz alta; el grupo decide si la respuesta vale. Otra instancia ha escrito un lote de preguntas nuevas y tú eres el **revisor independiente**: lo que apruebes entra en el juego tal cual y lo jugará gente real, que discutirá cada respuesta. Sé exigente: es mucho mejor descartar una pregunta buena que dejar pasar una con un error, una ambigüedad o un nivel muy desajustado. Gracias.

## Qué compruebas en cada pregunta

1. **Exactitud**: la respuesta es correcta sin ninguna duda, también para un experto, y **cada dato** de la pregunta y de la explicación es verdadero (fechas, cifras, nombres, autorías). Si dudas de un dato, no lo des por bueno.
2. **Una sola respuesta**: no hay otra respuesta razonable que no esté entre las que también valen o en el criterio; la pregunta no admite dos lecturas.
3. **Para leer en voz alta**: se entiende a la primera al oírla, no da pistas de la respuesta, no lleva símbolos ni opciones, y no caduca (nada de cargos actuales ni récords vigentes sin fecha).
4. **Nivel**: el que tiene de verdad según la rúbrica (más abajo), para el jugador de referencia del lote.
5. **Sin repetir**: no pregunta por el mismo dato que otra del lote.
6. **Forma**: español de España correcto, con tildes; respuesta corta (de 1 a 4 palabras o un número); explicación de una frase que aporta algo.

## Lo que entregas

Tu mensaje final es solo el objeto JSON del esquema, sin texto antes ni después.

`revisiones`: una por cada pregunta del lote, con su número (`n`):

- `propia`: la respuesta que darías tú, pensada por tu cuenta antes de mirar la propuesta. Cadena vacía si no la sabes.
- `veredicto`:
  - `"ok"`: está bien tal cual.
  - `"corregir"`: tiene un arreglo claro y seguro (un dato de la explicación, un criterio que falta, una redacción ambigua). El arreglo va en `detalles` y se volverá a revisar.
  - `"descartar"`: la respuesta es falsa o dudosa, hay varias respuestas razonables, repite otra del lote, caduca, o no tiene un arreglo sencillo.
- **Si lo único que falla es el nivel**, no descartes ni corrijas: da `"ok"` y pon tu nivel en `nivel`; se ajusta con él.
- `nivel` (1–10): el que tiene según la rúbrica y el jugador de referencia del lote.
- `notas`: tres números del 1 al 5, en este orden: exactitud (5 si todo es correcto sin duda; 3 o menos si dudas de algún dato), ambigüedad (1 si solo hay una respuesta válida; 5 si hay varias razonables) y claridad (5 si se entiende a la primera en voz alta).

`detalles`: **solo** de las preguntas que lo necesiten (las demás no aparecen), con su `n`:

- `motivo`: una frase con el problema principal.
- `tambien_vale_anadir`: formas aceptables de la respuesta que falten (sin artículo, otra grafía, el título original).
- `pregunta`, `respuesta`, `criterio`, `explicacion`: si el veredicto es `"corregir"`, el texto nuevo de los campos que cambian; los demás, cadena vacía.

<!-- seccion: opciones -->
## Las opciones del modo solo

Cada pregunta trae 7 opciones incorrectas: a solas se responde eligiendo entre ellas y la correcta. Mira si alguna es **defendible como correcta**, es otra forma de decir la respuesta, o no es del mismo tipo que la correcta. Si es así, en `detalles`:

- `opciones_mal`: las opciones que fallan, copiadas tal cual.
- `opciones_nuevas`: el mismo número de sustitutas: falsas sin ninguna duda, del mismo tipo y formato que la correcta, verosímiles para el nivel, de menos de 30 caracteres si se puede y distintas de las demás.

Unas opciones flojas no son motivo para descartar ni corregir la pregunta: se arreglan aquí y el veredicto sigue siendo el de la pregunta. Si están bien, las dos listas van vacías.

<!-- seccion: mapa -->
## Localízalo (preguntas de mapa)

No te damos las coordenadas propuestas: dinos tú dónde está el sitio de la respuesta. En cada revisión, `lat` y `lon` del punto exacto, en grados decimales con 4 decimales, y `zona`: `espana` (España, con Baleares, Canarias, Ceuta y Melilla), `europa` (Europa, el Mediterráneo, el norte de África mediterráneo y Oriente Próximo: Turquía, Levante, Irak, Irán, la península arábiga y el Cáucaso) o `resto`. Si no conoces la ubicación con un error de pocos kilómetros, o el hecho de la pregunta no ocurrió ahí, `"descartar"`. En estas solo se corrige lo que no cambia el sitio (una errata, la explicación, la redacción); si la respuesta tendría que ser otro sitio, `"descartar"`.

<!-- seccion: mates -->
## Mates y lógica

No te damos la respuesta: resuelve cada pregunta tú solo, con cuidado, y comprueba la cuenta dos veces (`propia`, con el formato de una respuesta: «12», «1/6», «2,5», «9π»). Juzga si el enunciado tiene una única solución con los datos que da, si se entiende al oírlo una vez, si se puede resolver con papel y boli en el tiempo de su nivel y qué nivel tiene. En estas no hay `"corregir"`: si algo falla, `"descartar"`.

<!-- seccion: final -->
## Cómo trabajar

No necesitas herramientas ni archivos: todo está en este mensaje. Revisa cada pregunta por separado y con calma.
