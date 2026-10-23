# Rúbrica de niveles y normas de redacción

Esta rúbrica la usa quien escribe preguntas (personas o el generador con IA) para poner el **nivel inicial**. Después, la calibración corrige ese nivel con lo que pasa en vuestras partidas.

## Qué significa cada nivel

El nivel está definido por **cuánta gente de vuestro grupo la acertaría**. El «jugador medio» de referencia es un adulto joven español con estudios: cultura general de bachillerato, sin ser especialista en nada en concreto.

| Nivel | Aciertos esperados | Cómo es la pregunta | Ejemplo |
|---|---|---|---|
| 1 | 90 % | Lo sabe casi todo el mundo; cultura básica o cotidiana. | ¿Cuántas patas tiene una araña? → 8 |
| 2 | 80 % | Muy conocido, pero hay que pensarlo un segundo. | ¿En qué continente está Egipto? → África |
| 3 | 70 % | Cultura general de la ESO. | ¿Qué planeta es conocido como el planeta rojo? → Marte |
| 4 | 60 % | Cultura general de bachillerato. | ¿Cuál es el símbolo químico del sodio? → Na |
| 5 | 50 % | La mitad lo sabe; el resto lo ha oído pero duda. | ¿Cuál es el hueso más largo del cuerpo humano? → El fémur |
| 6 | 41 % | Cultura general buena; suele haber una respuesta equivocada tentadora. | ¿Cuál es la capital de Australia? → Canberra |
| 7 | 31 % | Hay que haberlo estudiado o tener interés por el tema. | ¿Qué orgánulo celular fabrica las proteínas? → El ribosoma |
| 8 | 21 % | Aficionados al tema con buena memoria. | ¿Cuál es la capital de Kazajistán? → Astaná |
| 9 | 11 % | Muy difícil: solo quien domina el tema. Uno de cada nueve. | ¿Qué físico formuló el principio de exclusión? → Wolfgang Pauli |
| 10 | 4 % | Dificilísima: de especialista o de auténtico friki del tema. Uno de cada veinticinco. La respuesta sigue siendo corta y verificable. | ¿Qué astrónoma descubrió la relación entre el brillo y el periodo de las cefeidas? → Henrietta Leavitt |

Los niveles 9 y 10 tienen que dar miedo: si una pregunta de nivel 9 la sabría alguien con buena cultura general sin interés especial por el tema, es de nivel 7 u 8. Ante la duda entre dos niveles, el más bajo.

En **Mates y lógica**, la dificultad viene del número de pasos y de lo fácil que es equivocarse, contando con papel y boli:

| Nivel | Ejemplo |
|---|---|
| 1–2 | Una operación directa: 7 × 8. |
| 3–4 | Dos pasos o un porcentaje sencillo: el 15 % de 80. |
| 5–6 | Varios pasos o una idea clave: área de un círculo de radio 3 (en función de π). |
| 7–8 | Hay que plantear algo: probabilidad de sacar dos seises con dos dados. |
| 9–10 | Combinatoria o razonamiento con trampa, de los que casi todo el mundo falla aun con tiempo: cuántos caminos distintos hay por una cuadrícula, cuántos números de 4 cifras tienen todas distintas. |

En **Geohistoria** (preguntas de mapa), el nivel es la probabilidad de señalar a menos de la mitad de la distancia máxima de la pregunta (100 km en España, 500 en Europa, el Mediterráneo y Oriente Próximo, 1500 en el resto):

| Nivel | Ejemplo |
|---|---|
| 1–2 | ¿Dónde está la Torre Eiffel? · ¿Dónde se corren los encierros de San Fermín? |
| 4–5 | ¿Dónde se libró la batalla de Waterloo? · ¿Dónde nació Miguel de Cervantes? |
| 7–8 | ¿Dónde se libró la batalla de Stalingrado? · ¿Dónde fueron derrotados los comuneros? |
| 9–10 | ¿Dónde se libró la batalla del río Talas? · ¿Dónde se fundó la primera universidad de la península? |

Una pregunta de mapa difícil no dice el país ni la región: con 1500 km de margen, saberlo suele bastar para acertar. Fuera de esa mitad no se suma ningún punto; dentro, se pierde uno por cada paso.

## Normas de redacción

1. **Una sola respuesta correcta y corta:** de 1 a 4 palabras, o un número.
2. **Para leer en voz alta:** nada de fórmulas visuales, símbolos raros, «¿cuál de estas?» ni imágenes. Se escribe «raíz cuadrada de 144», no «√144».
3. **Sin hechos que caduquen:** nada de cargos actuales, récords vigentes o «el último…». Si hace falta una fecha, se fija: «en 2010».
4. **Sin verdadero o falso ni opciones:** el azar del 50 % estropea la medida del nivel.
5. **La dificultad sale del conocimiento,** no de una redacción ambigua, larga o con trampa.
6. **La pregunta no da pistas** de la respuesta.
7. **Variantes aceptables** en `tambien_vale` (nombre corto, sin artículo, otra grafía). Si hace falta una regla, va en `criterio`: «basta con el apellido», «se acepta ±1 año».
8. **Decimales con coma** en la respuesta (`2,5`), y la versión con punto o en fracción en `tambien_vale`.
9. **Explicación de una frase** que aporte algo: un dato curioso o el razonamiento.
10. **Mates verificables:** en cálculo, geometría y probabilidad, el campo `verificacion` lleva una expresión en Python que el validador calcula y compara con la respuesta. Se puede usar `pi`, `sqrt`, `comb`, `perm`, `factorial`, `gcd`, `lcm`, `Fraction`, `sum` y `range`.
