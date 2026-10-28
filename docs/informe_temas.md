# Informe: temas nicho y el tema de cada jugador

*28 de octubre de 2026. Simulado con el motor y el banco reales (400 partidas por caso, con rondas y finales propias) y con las apuestas de vuestras exportaciones (68 respuestas en 8 partidas; incluye la partida de prueba del 18 de octubre).*

---

## Resumen

> **Hecho** (fase 23 de PLAN.md) con las cuatro recomendaciones: 1 de cada 5 turnos normales, los temas pequeños en Sorpresa, los cinco temas gordos y 250 preguntas escritas a mano. En los ejemplos de la sección 5 algunas preguntas cambiaron al escribirlas (de nivel, de redacción o por otras), para no repetir datos del banco ni bloquear otras preguntas. Y lo de la sección 8 sobre los datos cambió en un punto: cada turno lleva ahora `tema_elegido` (un texto, que el script y la descarga aceptan), para contar qué temas se eligen y saber a cuáles escribir más preguntas.

- **Me parece muy buena idea**, y encaja con la mecánica: elegir tu tema es decir «de esto sé», y la apuesta lo convierte en tensión. Arriesgar un 9 en tu tema y fallarlo duele más que fallar uno de química.
- **Los temas van aparte del tablero.** Al crear la partida, cada jugador elige el suyo (o ninguno) y, en **uno de cada 5 de sus turnos normales** (al azar dentro de cada tanda, nunca dos seguidos), le toca una pregunta de su tema en vez de la de la casilla: «Tu tema · Harry Potter: películas y actores. ¿Cuánto te arriesgas?». Sale unas 2 veces por jugador en la corta y 4–5 en la media.
- **Temas gordos con 4 subtemas:** Harry Potter, Star Wars, Marvel, Juego de tronos y Segunda Guerra Mundial. **Los pequeños** (samuráis, medicamentos, LEGO, Vietnam, terrorismo), juntos en un tema «Sorpresa» que también se puede elegir.
- **Niveles pensados para quien elige el tema** (un fan, no el jugador medio) y **un ajuste propio por tema** en la calibración. Si no, la pregunta de tu tema sería un chollo.
- **Para empezar, 250 preguntas:** 40 por tema gordo (una por casilla) y 50 en Sorpresa. Así, un jugador que elige siempre el mismo tema juega unas 13 partidas cortas antes de que se le repita una. Después se amplían los temas que más se elijan.
- **Trabajo:** alrededor de un día de programación, y otro largo para escribir y contrastar las preguntas a mano. La hoja de Google no hay que tocarla.

---

## 1. Qué me parece

**A favor**

- Da identidad a cada jugador («el de Star Wars») y mete variedad sin tocar el tablero ni alargar la partida: la pregunta de tema sustituye a una normal.
- Lo que pides de ejemplo sale solo con los subtemas: «Harry Potter: películas y actores» es justo «cuánto sabes de los actores de Harry Potter». El motor ya anuncia un subtema antes de la apuesta, elige la pregunta por nivel y tiene la cadena de alternativas, el deshacer y los registros: un tema es, para él, una categoría que no está en el tablero.

**Riesgos, y cómo se evitan**

- **Que tu tema sea un chollo.** Si sus niveles fueran los del jugador medio, un fan acertaría casi siempre la de nivel 7. Se evita con niveles pensados para fans y la calibración por tema (sección 4), y con que todos tengan las mismas preguntas de tema por partida (sección 2).
- **El contenido.** Una pregunta de fan de nivel 9 o 10 tiene que ser correcta, no ambigua y no estar ya en el banco. Hay que contrastarlas como en la fase 15.
- **Temas delicados** (terrorismo, Holocausto, Vietnam): solo datos históricos (sección 7).

**Lo que no haría:** una sexta categoría en el tablero (a quien no le gusta Star Wars le tocaría igual) ni sacar preguntas de fan en la partida normal.

---

## 2. Cuándo sale la pregunta de tu tema

Turnos normales son los que no son final ni ronda ★. Media de preguntas de tema por jugador y partida, contando una en cada tanda de N turnos normales:

| Partida | Turnos (mediana) | Turnos normales por jugador | 1 de cada 4 | **1 de cada 5** | 1 de cada 6 |
|---|---|---|---|---|---|
| Corta, 2 jugadores | 34 | 12,6 | 3,2 | **2,5** | 2,1 |
| Corta, 4 jugadores | 59 | 11,4 | 2,9 | **2,3** | 1,9 |
| Corta, 6 jugadores | 78 | 10,8 | 2,7 | **2,2** | 1,8 |
| Media, 2 jugadores | 59 | 24,1 | 6,0 | **4,8** | 4,0 |
| Media, 4 jugadores | 103 | 22,1 | 5,5 | **4,4** | 3,7 |
| Media, 6 jugadores | 143 | 20,9 | 5,2 | **4,2** | 3,5 |

Con 1 de cada 5, una de cada cinco preguntas normales es de tema: como una sexta categoría, pero la tuya. Con 4 jugadores y la corta son unas 9 preguntas de tema por partida entre todos.

**Por tandas, no al azar en cada turno.** Con un 20 % de probabilidad en cada turno, la media es la misma, pero el reparto es injusto:

| 4 jugadores, 1 de cada 5 | Jugadores sin ninguna (corta / media) | Partidas en que alguien tiene 3 o más que otro (corta / media) |
|---|---|---|
| **Una en cada tanda de 5 turnos** | 0,9 % / 0 % | 6 % / 12 % |
| Al azar en cada turno | 12 % / 1,6 % | 64 % / 78 % |

La diferencia que queda con las tandas viene de quien llega antes a la meta: desde ahí juega finales, no turnos normales. Si la pregunta de tema sale en el 2.º, 3.º o 4.º turno de cada tanda, nunca hay dos seguidas ni sale en el primer turno.

---

## 3. Cuántas preguntas hacen falta

Un jugador que elige siempre el mismo tema, con 4 jugadores, 1 de cada 5 y vuestras apuestas (media 5,8; el 40 % entre 6 y 7):

| Preguntas en el tema | Partidas cortas hasta la 1.ª repetida (mediana) | Partidas medias |
|---|---|---|
| 20 | 7 | 4 |
| **40** | **13** | **7** |
| 60 | 19 | 10 |
| 80 | 25 | 13 |
| 120 | 36 | 19 |

Antes de repetir, algunas salen de un nivel al lado del apostado (los puntos siguen siendo lo apostado): con 40 preguntas, una de cada cinco a partir de la 6.ª partida corta; con 80, una de cada seis a partir de la 11.ª. Si dos jugadores eligen el mismo tema, se gasta el doble.

**Propuesta:** 40 por tema gordo (4 subtemas × 10 niveles) y 50 en Sorpresa para empezar, y ampliar a 80 los que más se elijan: los datos dirán cuáles son. Si los fans apuestan más alto que en las preguntas normales, harán falta más en los niveles altos.

---

## 4. Niveles y calibración

Quien responde una pregunta de su tema la ha elegido porque sabe de eso. Por eso:

1. **El jugador de referencia de un tema es quien lo elige:** ha visto las películas o leído los libros, sin ser experto. Nivel 1: lo sabe cualquier fan; nivel 10: solo el auténtico friki (uno de cada veinticinco). Una de nivel 5 de Harry Potter es bastante más difícil que una de nivel 5 de Entretenimiento. La rúbrica tendría una tabla propia con ejemplos. En Sorpresa, que se elige por variedad y no por saber, el nivel es el del jugador medio.
2. **Cada tema, su propio ajuste en la calibración,** como una categoría más. Lo que se desvíen los niveles de un tema para vuestros fans lo absorbe ese ajuste, sin mover los de Entretenimiento ni la habilidad de cada jugador, que se mide sobre todo con las preguntas normales. Hoy la calibración solo lee las categorías del tablero: descartaría las respuestas de tema como «pregunta que ya no existe».
3. **Más margen para ese ajuste.** Cada categoría se puede desviar poco (`sd_ajuste_categoria` = 0,75 niveles). Un tema puede desviarse más (fans muy fans, o un tema que solo elige una persona): propongo 1,5.
4. **Las preguntas de tema no salen en la partida normal.** Mezclar respuestas de fans y de no fans en la misma pregunta haría que su nivel no fuera ni lo uno ni lo otro.

Si un tema solo lo elige una persona, el modelo no distingue «sabe mucho de Harry Potter» de «estas preguntas son fáciles», pero no hace falta: el nivel que cuenta es el de quien las juega. En «Revisar preguntas» conviene que valoren las de cada tema sus fans.

---

## 5. Temas, subtemas y ejemplos

| Tema | Subtemas | Para empezar |
|---|---|---|
| Harry Potter | Los libros · Películas y actores · Hechizos, pociones y criaturas · Hogwarts y el mundo mágico | 40 |
| Star Wars | La trilogía original (IV–VI) · Las precuelas (I–III) · Las secuelas (VII–IX) · Series, spin-offs y rodajes | 40 |
| Marvel | Películas y series · Héroes y villanos · Actores · Cómics y creadores | 40 |
| Juego de tronos | Casas y personajes · La serie · Actores y rodaje · Libros y «La casa del dragón» | 40 |
| Segunda Guerra Mundial | Europa y África · El Pacífico · Personajes · Armas, espías y tecnología | 40 |
| Sorpresa | Samuráis y Japón feudal · Medicamentos · LEGO · Guerra de Vietnam · Terrorismo en la historia | 50 |

Un subtema por película («Star Wars: Episodio III») también se puede, pero cada uno necesita sus 10 niveles: 90 preguntas solo para las nueve películas. Mejor empezar por trilogías (cada pregunta dice de qué película es) y partirlas cuando haya más.

Otros temas que podrían entrar después: El Señor de los Anillos, Pokémon, Los Simpson, Disney o fútbol; y en Sorpresa, piratas, vikingos o dinosaurios.

**Ejemplos** (borrador, con la vara de fan):

| Tema · subtema | Nivel | Pregunta | Respuesta |
|---|---|---|---|
| Harry Potter · Películas y actores | 2 | ¿Qué actor interpretó a Severus Snape? | Alan Rickman |
| Harry Potter · Hogwarts y el mundo mágico | 6 | ¿Qué hay que decir para que el mapa del merodeador vuelva a quedar en blanco? | «Travesura realizada» |
| Harry Potter · Los libros | 10 | ¿Qué número tiene la cámara de Harry en Gringotts? | 687 |
| Star Wars · La trilogía original | 1 | ¿Cómo se llama el wookiee copiloto del Halcón Milenario? | Chewbacca |
| Star Wars · Las precuelas | 5 | ¿En qué planeta volcánico luchan Obi-Wan y Anakin en «La venganza de los Sith»? | Mustafar |
| Star Wars · Las precuelas | 9 | ¿En qué planeta se esconde el general Grievous en «La venganza de los Sith»? | Utapau |
| Marvel · Héroes y villanos | 1 | ¿Cómo se llama el martillo de Thor? | Mjolnir |
| Marvel · Películas y series | 5 | ¿En qué planeta consigue Thanos la Gema del Alma? | Vormir |
| Marvel · Actores | 7 | ¿Qué actor fue Bruce Banner en «El increíble Hulk», de 2008? | Edward Norton |
| Juego de tronos · Casas y personajes | 1 | ¿Cómo se llama el hermano enano de Cersei y Jaime Lannister? | Tyrion |
| Juego de tronos · La serie | 5 | ¿Cómo se llama la espada de acero valyrio de Jon Nieve? | Garra |
| Juego de tronos · Actores y rodaje | 9 | ¿Qué actor interpreta a Ramsay Bolton? | Iwan Rheon |
| Segunda Guerra Mundial · Europa y África | 2 | ¿Qué país invadió Alemania el 1 de septiembre de 1939? | Polonia |
| Segunda Guerra Mundial · El Pacífico | 5 | ¿En qué batalla de 1942 hundió Estados Unidos cuatro portaaviones japoneses? | Midway |
| Segunda Guerra Mundial · Armas, espías y tecnología | 8 | ¿Qué espía español, con el nombre en clave «Garbo», engañó a los alemanes sobre el desembarco de Normandía? | Juan Pujol |
| Sorpresa · Samuráis | 4 | ¿Cómo se llama el código de honor de los samuráis? | Bushido |
| Sorpresa · Medicamentos | 6 | ¿De la corteza de qué árbol salió el antecedente de la aspirina? | El sauce |
| Sorpresa · LEGO | 7 | ¿Qué significa «LEGO» en danés? | «Juega bien» |
| Sorpresa · Guerra de Vietnam | 6 | ¿Cómo se llamaba la red de caminos con la que Vietnam del Norte abastecía a la guerrilla del sur? | La ruta Ho Chi Minh |
| Sorpresa · Terrorismo en la historia | 7 | ¿Sobre qué localidad escocesa estalló en 1988 un avión de Pan Am por una bomba? | Lockerbie |

---

## 6. Lo que ya hay en el banco

Preguntas, rondas y finales que ya tocan estos temas. Sus datos no se pueden repetir en los temas (un jugador podría encontrárselos dos veces):

| Tema | Ya hay | Cuáles |
|---|---|---|
| Harry Potter | 2 | Emma Watson (Entretenimiento, nivel 4) y la ronda de los siete libros |
| Star Wars | 2 | Darth Vader (nivel 1) y la ronda de los nueve episodios |
| Marvel | 1 | La ronda de superhéroes |
| Juego de tronos | 4 | La serie, el lema de los Stark, Daenerys y Dubrovnik (Series, niveles 1, 5, 7 y 8) |
| Segunda Guerra Mundial | 16 | Hitler, Churchill, Hiroshima, el fin de la guerra, el Plan Marshall, Yalta, Chamberlain y Jesse Owens; en Localízalo, Normandía, Ana Frank, Núremberg, Auschwitz y Stalingrado; Pearl Harbor, en un reto final, y dos que la nombran de pasada |
| Vietnam | 2 | La capital (Hanói) y Dien Bien Phu (Localízalo) |
| Terrorismo | 2 | Las Torres Gemelas (Localízalo) y el atentado de Sarajevo |
| Samuráis | 1 | Kurosawa y «Los siete samuráis» |
| Medicamentos | 4 | La insulina y el páncreas, los islotes de Langerhans, y la penicilina de Fleming y la vacuna de Jenner, en dos retos finales |
| LEGO | 0 | — |

La Segunda Guerra Mundial es la que más se solapa: es historia general y el banco ya tiene sus datos más conocidos. Su tema tendría que ir a lo que no está (frentes, operaciones, armas, espías, el Pacífico).

---

## 7. Temas delicados

- **Terrorismo:** solo historia (fechas, lugares, organizaciones, consecuencias), como el 11-S que ya está en Localízalo. Ninguna respuesta que sea un número de víctimas, explicaciones sobrias y nada reciente. Con ETA y el 11-M puede haber en el grupo alguien a quien le toque de cerca: si preferís dejarlo fuera, Sorpresa funciona igual con otro subtema.
- **Segunda Guerra Mundial y Vietnam:** lo mismo con el Holocausto y las matanzas.
- **Medicamentos:** historia y curiosidades (descubrimientos, nombres, orígenes), nunca dosis ni usos que alguien pudiera tomar como un consejo.
- **Destripes:** en Juego de tronos o Star Wars, la explicación puede contar una muerte. Quien elige el tema ya lo ha visto.

---

## 8. Qué hay que programar

| Pieza | Cambio |
|---|---|
| `config.json` | La lista de temas (nombre, color, archivo y subtemas) y cada cuánto salen (`temas.cada` = 5). |
| `app/data/temas/` | Un archivo por tema, con el formato del banco. |
| Motor | El tema de cada jugador y su tanda; en el turno que toca, la categoría es su tema. Nunca en la final ni en una ronda ★. Deshacer y reanudar funcionan igual: todo va guardado en la partida. |
| Banco | Los temas entran en el índice: la selección por subtema y nivel, las alternativas y las fugas ya sirven. |
| Pantallas | «Nueva partida» (un selector de tema por jugador, que recuerda el último que eligió), el anuncio «Tu tema», «Revisar preguntas», «Datos» y «Cómo se juega». |
| `sw.js` | Los archivos de los temas en la caché, para jugar sin conexión (cada archivo va en una lista). |
| Validador y generador | Cobertura de cada tema (al menos una por casilla), duplicados con el banco, las rondas y las finales, y la rúbrica de fans para el generador. |
| Calibración e informe | Leer los temas, un ajuste por tema con más margen y una sección por tema en el informe. |
| Datos | Ningún campo nuevo: la categoría de la respuesta es el tema. Así no hay que tocar el script de Google, que solo mira el tipo, ni `descargar.py`, que descarta un registro con un campo lógico que no conoce (un `es_tema: true` haría perder todas las respuestas de tema enviadas a la hoja). |
| Pruebas | Turnos de tema (frecuencia, nunca seguidos, ni en la final ni en rondas, con deshacer), índice con temas, partidas simuladas con temas, validador y calibración con un tema. |

---

## 9. Lo que decides tú

1. **Cada cuánto sale:** 1 de cada 5 turnos normales (recomendado: unas 2 por jugador en la corta y 4–5 en la media), 1 de cada 4 (3 y 5–6), 1 de cada 6 (2 y 3–4) o una sola por partida.
2. **Los temas pequeños** (samuráis, medicamentos, LEGO, Vietnam y terrorismo): juntos en Sorpresa (recomendado), cada uno como tema propio que se elige (harían falta 40 por tema en vez de 10) o como subtemas nuevos del juego normal, para todos y con niveles del jugador medio.
3. **La lista de temas gordos:** los cinco de la sección 5, o añadir o quitar alguno.
4. **El contenido:** a mano, contrastado y sin gastar API, como en la fase 15 (recomendado), o con el generador, que gasta API.
