# Temas nuevos para «¿Cuánto te arriesgas?»

Hola, Codex. «¿Cuánto te arriesgas?» es un juego de preguntas en español de España para jugar en grupo con un móvil: cada jugador elige del 1 al 10 cuánto se arriesga y recibe una pregunta de ese nivel. Además de las categorías generales, cada jugador puede elegir **un tema** que le gusta, y de vez en cuando le sale una pregunta de él; también hay días del reto diario dedicados a un tema. Tu parte es **proponer temas nuevos**. El dueño del juego elegirá los que quiera y, de cada uno, otra instancia escribirá unas 240 preguntas (del nivel 1 al 10) y otra las revisará dato a dato. Gracias.

## Qué hace bueno a un tema

1. **Tiene público**. De dos clases, y queremos de las dos:
   - `masivo`: mucha gente joven de España lo sigue y se picaría por demostrar que sabe (un videojuego, una artista, una saga, un deporte, un programa).
   - `nicho`: poca gente, pero muy aficionada, y con datos que sorprenden a los demás (un tipo de máquina, una ciencia, un género musical, una afición).
2. **Da para 240 preguntas de respuesta corta y verificable** (un nombre, un año, una cifra), desde lo que sabe cualquiera que lo conozca hasta lo que solo sabe un experto. Un tema demasiado estrecho se agota; uno demasiado ancho es una categoría, no un tema.
3. **Sus datos son estables y están bien documentados**: no dependen de la actualidad (plantillas, clasificaciones, récords vigentes, parches del juego), ni de rumores, ni de opiniones. En un tema vivo (una artista en activo, un videojuego que cambia), los subtemas se centran en lo que ya no cambia.
4. **No es delicado ni divide**: nada de política de partidos, religión como creencia, sucesos recientes con víctimas ni salud como consejo.
5. **No repite** las categorías ni los temas que ya existen (lista al final).

También valen **temas con un formato propio de pregunta**, si todo cabe en una pregunta de texto con respuesta corta: por ejemplo, en un tema de lingüística, un subtema «¿De qué idioma es esta palabra?» (se da una palabra y su significado, y se adivina el idioma).

## Lo que entregas

Tu mensaje final es solo el objeto JSON del esquema. De cada tema:

- `id`: en minúsculas, sin tildes, con guiones bajos («taylor_swift»). `nombre`: como se verá («Taylor Swift»). `corto`: de 14 caracteres como mucho, para un botón.
- `publico`: `masivo` o `nicho`.
- `referencia`: `fan` si el nivel se mide con quien elige el tema porque lo sigue (una de nivel 5 la acierta la mitad de los fans), o `medio` si se mide con el jugador medio (un tema de cultura general).
- `por_que`: una frase: quién lo elegiría y por qué da juego.
- `riesgo`: una frase con lo que puede salir mal (datos que cambian, fuentes que se contradicen, poco material para los niveles bajos…), o cadena vacía.
- `subtemas`: exactamente 4, que repartan el tema sin pisarse, cada uno con `id` (una palabra en minúsculas), `nombre` y `rincones`: 8 rincones concretos y distintos del subtema, de los que saldrían preguntas («campeones y sus habilidades», «mundiales hasta 2020»), para que las preguntas no se queden en lo más manido.

Ordena los temas de mejor a peor dentro de cada clase. Mejor pocos y buenos: si no llegas al número pedido con temas que cumplan todo, entrega menos.

## Cómo trabajar

No necesitas herramientas ni archivos: todo está en este mensaje.
