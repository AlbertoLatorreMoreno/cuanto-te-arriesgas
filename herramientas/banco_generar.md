<!-- seccion: base -->
# Preguntas nuevas para «¿Cuánto te arriesgas?»

Hola, Codex. «¿Cuánto te arriesgas?» es un juego de preguntas en español de España para jugar en grupo con un móvil: cada jugador elige del 1 al 10 cuánto se arriesga y recibe una pregunta de ese nivel, que otro jugador lee en voz alta; el grupo decide si la respuesta vale. Tu parte es escribir preguntas nuevas de un subtema. Después, un revisor independiente comprueba cada dato y el nivel, y lo que no pasa se tira: más vale una pregunta menos llamativa pero indiscutible. Gracias.

Lo más importante, por este orden:

1. **Que la respuesta sea correcta e indiscutible**, también para un experto, y que la explicación sea verdadera en cada dato. Si no estás completamente seguro de un dato (una fecha, una cifra, un nombre, una autoría, un récord), no escribas esa pregunta: escribe otra.
2. **Que tenga una sola respuesta válida** (contando las variantes de `tambien_vale`). Nada de «un país que…», «uno de los…», ni preguntas que admitan dos lecturas.
3. **Que el nivel sea el que se pide**, según la rúbrica que va abajo.
4. **Que no se repita nada**: ni dos preguntas del lote sobre lo mismo, ni un dato de los ya usados (la lista va al final).

## Lo que entregas

Tu mensaje final es solo el objeto JSON del esquema, sin texto antes ni después. Campos de cada pregunta:

- `nivel`: el nivel pedido para esa pregunta. Escribe exactamente las que se piden de cada nivel.
- `pregunta`: el texto que se lee en voz alta, con la interrogación entre «¿» y «?» (puede llevar una frase de contexto antes). Mejor corta: menos de 160 caracteres si se puede, nunca más de 220.
- `respuesta`: corta (de 1 a 4 palabras, o un número), sin punto final, con mayúscula inicial y con el estilo del banco: «La raíz», «Marte», «Felipe II», «1492», «2,5».
- `tambien_vale`: otras formas que el grupo debe aceptar: sin artículo, solo el apellido si basta, otra grafía, el título original, el número en letra… `[]` si no hay ninguna.
- `criterio`: una regla para juzgar, solo si hace falta («Basta con el apellido», «Se acepta ±1 año», «No vale Sídney: es la trampa típica»). Cadena vacía si no hace falta.
- `explicacion`: una frase (menos de 200 caracteres) que aporte algo: un dato curioso, el contexto o el razonamiento. Tiene que ser verdadera y no repetir la pregunta.

## Reglas

- **Español de España**: ortografía impecable con tildes, comillas «latinas», y los nombres como se conocen aquí: títulos de películas, series y libros con su título en España (el original, si también se usa, va en `tambien_vale`); personajes históricos y lugares en su forma española (Isabel II, Pekín, Múnich).
- **Para leer en voz alta**: nada de símbolos (√, ², ≥, %), fórmulas, listas de opciones, imágenes ni «¿cuál de estas…?». Se escribe «raíz cuadrada de 144», «al cuadrado», «por ciento».
- **Sin verdadero o falso** ni preguntas de sí o no.
- **Nada que caduque**: ni cargos actuales, ni récords vigentes, ni «¿cuántos títulos tiene…?» sin fecha. Si hace falta, se fija el año («hasta 2020», «en 2010»). No uses estas palabras, que el validador rechaza: «actualmente», «hoy en día», «el actual», «la actual», «los actuales», «este año», «el último», «la última», «récord actual», «vigente». Si quieres preguntar por el último de algo histórico, reformúlalo («el rey visigodo derrotado en Guadalete»).
- **La pregunta no da pistas**: la respuesta (ni una palabra clave suya) no aparece en la pregunta.
- **La dificultad sale del conocimiento**, no de una redacción larga, rebuscada o con trampa.
- **Variedad**: reparte el lote entre temas, épocas, regiones, personas y tipos de dato distintos dentro del subtema. No hagas dos preguntas sobre el mismo personaje, obra o suceso, ni varias con la misma estructura («¿En qué año…?» una detrás de otra).
- **Sin repetir**: ninguna respuesta de la lista «ya usadas» puede ser tu respuesta, y no preguntes por el mismo dato con otras palabras.
- **Escribe con naturalidad**: nombra el Sol, la Tierra, Marte, España o Roma cuando haga falta, aunque estén en la lista de ya usadas; nada de rodeos como «nuestra estrella» o «el planeta rojo» para evitarlos.
- **Niveles bajos (1–3)**: muy conocidas, pero no infantiles ni obvias por el enunciado.
- **Niveles altos (8–10)**: tienen que dar miedo (solo las acierta quien domina el tema), pero la respuesta sigue siendo corta, concreta y verificable. Un dato de especialista, no una pregunta ambigua o retorcida.
- **Números**: coma decimal («2,5»); los miles, con un espacio («10 000»), salvo los años.
- **Temas delicados** (guerras, terrorismo, enfermedades, medicamentos): datos históricos y tono sobrio; nunca un número de víctimas como respuesta, y nunca dosis ni usos que puedan tomarse por un consejo médico.

<!-- seccion: opciones -->
## Las opciones del modo solo

A solas, la pregunta se responde eligiendo entre 8 botones: la correcta y 7 incorrectas. Escríbelas con cada pregunta:

- `incorrectas`: **exactamente 7**, todas falsas sin ninguna duda, también para un experto. Ninguna puede ser correcta en otra lectura de la pregunta, ni otra forma de decir la respuesta (sinónimo, traducción, abreviatura, la misma cifra en otra unidad), ni algo de `tambien_vale`, ni contener la respuesta dentro («Quito Viejo» si es «Quito»).
- **Del mismo tipo y formato que la correcta**: si es una persona, 7 personas; un año, 7 años; el mismo estilo de artículo («El hígado» → «El páncreas»), longitud parecida. Que la correcta no destaque por ser la única larga, la única con artículo o la única redonda.
- **Verosímiles y con la dificultad del nivel**: en los niveles bajos, más fáciles de descartar; en los altos, muy cercanas (personas de la misma época y campo, ciudades del mismo país, cifras próximas). Nada de bromas ni de opciones absurdas. Si el `criterio` dice «No vale X», X va entre las incorrectas.
- **Números**: errores típicos (el doble, la mitad, uno de más, confundir área y perímetro) y cifras cercanas, con el mismo formato que la correcta.
- **Cortas**: menos de 30 caracteres si se puede, nunca más de 60. Distintas entre sí. Prohibido «Ninguna de las anteriores», «Todas» o «No se sabe».
- `boton`: la respuesta tal como va en su botón, solo si `respuesta` no sirve tal cual (lleva paréntesis o una aclaración, o es mucho más larga que las incorrectas). Si sirve, cadena vacía.

<!-- seccion: mates -->
## Mates y lógica

- Hay cronómetro: tienen que poder resolverse de cabeza o con papel y boli en el tiempo de su nivel (va en el lote).
- **Los números del enunciado, siempre en cifras**: «3 dados», «el 15 por ciento de 80», «3/4 de 20», nunca «tres dados» ni «tres cuartos». El validador rechaza los números en letra.
- La respuesta es exacta: un entero, una fracción («1/6»), un decimal con coma («2,5») o en función de pi («9π»). En `tambien_vale` van solo otras formas con cifras (la fracción y el decimal: «0,5» para «1/2»); el número en letra no hace falta («Treinta», «La mitad»).
- `verificacion` es una expresión de Python que **calcula** la respuesta a partir de los datos del enunciado (no el número escrito tal cual): `comb(5, 2)`, `pi * 3**2 / pi`, `Fraction(1, 6) * Fraction(1, 6)`, `sum(1 for n in range(1000, 10000) if n % 7 == 0)`… Solo se puede usar: + - * / ** // %, paréntesis, comparaciones, comprensiones y estos nombres: `pi`, `e`, `sqrt`, `comb`, `perm`, `factorial`, `gcd`, `lcm`, `Fraction`, `log`, `log10`, `log2`, `abs`, `round`, `min`, `max`, `sum`, `range`, `len`, `all`, `any`, `sin`, `cos`, `tan`, `radians`, `degrees` (no hay `str`, `set`, `int` ni `list`). Si la respuesta va en función de pi, la verificación da el número completo (`9 * pi`).
- Es obligatoria en Cálculo, Geometría, Probabilidad y Series numéricas (en las series, el término que sigue calculado con la regla: `3 * 2**5`). En Acertijos de lógica, ponla si la respuesta es un número; si es un nombre o un día, cadena vacía.
- Acertijos de lógica: que se entiendan al oírlos una vez, con todos los datos necesarios y una única solución. Nada de juegos de palabras ambiguos ni de acertijos clásicos con varias respuestas aceptadas.
- Series numéricas: una sola regla clara que dé un único término siguiente; en los niveles altos, reglas menos evidentes (cuadrados, primos, Fibonacci, alternancias, diferencias de diferencias), pero que no admitan otra continuación razonable.
- Probabilidad: el enunciado deja claro si hay reposición, si los dados son distinguibles, etc.

<!-- seccion: mapa -->
## Localízalo (preguntas de mapa)

- Quien juega señala el sitio en un mapa del mundo, y puntúa por distancia. La pregunta empieza por «¿Dónde…?» y apunta a un **sitio concreto** (una ciudad, un pueblo, un monumento, el lugar de una batalla), no a una región enorme.
- `respuesta`: el nombre del sitio con su país o provincia entre paréntesis, como en el banco: «Olimpia (Grecia)», «Almansa (Albacete)», «Isandlwana (Sudáfrica)».
- `lat` y `lon`: las coordenadas del punto exacto, en grados decimales con 4 decimales. Escribe solo sitios cuya ubicación conozcas con seguridad (con un error de pocos kilómetros); se comprobarán por separado.
- `zona`: `espana` (España: península, Baleares, Canarias, Ceuta y Melilla), `europa` (Europa, el Mediterráneo, el norte de África mediterráneo y Oriente Próximo: Turquía, Levante, Irak, Irán, la península arábiga y el Cáucaso) o `resto` (todo lo demás). En el subtema «Historia de España», todas son de `espana`; en los otros dos, ninguna.
- Las difíciles no dicen el país ni la región en la pregunta: con el margen del mapa, saber el país casi siempre basta.

<!-- seccion: final -->
## Cómo trabajar

No necesitas herramientas ni archivos: todo lo que hace falta está en este mensaje. Piensa cada pregunta, comprueba cada dato y repasa al final que hay exactamente las pedidas de cada nivel y que el JSON es válido.
