# Formato de los datos

Todos los archivos son JSON en UTF-8. Las fechas van en ISO 8601 UTC (`2026-10-17T18:30:00.000Z`).

## Configuración — `app/data/config.json`

Única fuente de verdad para la app (JavaScript) y las herramientas (Python): categorías y subtemas (ids, nombres, colores y archivo de preguntas), metas y paso de la final, tabla de aciertos objetivo, motivos de anulación y de «pregunta mala», reglas de retirada y parámetros del modelo (penalizaciones, ruido fijo de las valoraciones y mínimo de datos para cambiar un nivel). Si cambias categorías o subtemas, el validador comprobará que el banco sigue cubriéndolos. El cronómetro (`cronometro`) dice qué categorías lo llevan y cuántos segundos hay en cada nivel (`segundos_por_nivel`, del 1 al 10); cambiando esa lista se ajustan los tiempos sin tocar el código. La final va de `final.nivel_base` (8) a `final.nivel_max` (10); sus preguntas propias están en `final.archivo` (ver «Finales propias»), y `final.objetivo_acierto` (12, 6 y 3 %) es cuánto se busca que se acierten en cada nivel: lo usan el informe y las simulaciones. `metas[].duracion` es el texto que se ve al elegir la meta: si cambias la final o los puntos, conviene volver a simular la duración. `jugadores.olvidar_tras_dias` (180) es el plazo tras el que el móvil olvida solo a un jugador que no ha vuelto a jugar (ver «Datos del móvil»). `rondas` configura las rondas divertidas (ver su apartado).

## Pregunta — `app/data/preguntas/<categoria>.json`

```json
{
  "categoria": "ciencias",
  "preguntas": [
    {
      "id": "cie-ast-01",
      "v": 1,
      "categoria": "ciencias",
      "subtema": "astronomia",
      "nivel": 3,
      "pregunta": "¿Qué planeta es conocido como el planeta rojo?",
      "respuesta": "Marte",
      "tambien_vale": [],
      "criterio": null,
      "explicacion": "Su color se debe al óxido de hierro de su superficie.",
      "verificacion": null,
      "origen": "semilla"
    }
  ]
}
```

| Campo | Obligatorio | Descripción |
|---|---|---|
| `id` | sí | Único y permanente: `<cat>-<sub>-<nn>`. No incluye el nivel, porque el nivel cambia con la calibración. |
| `v` | sí | Versión. **Súbela si cambias la pregunta, la respuesta, `tambien_vale` o `criterio`.** |
| `categoria`, `subtema` | sí | Ids de `config.json`. |
| `nivel` | sí | Nivel **inicial** (1–10) según la rúbrica. La calibración no lo toca: escribe sus correcciones en `ajustes.json`. |
| `pregunta`, `respuesta` | sí | Texto para leer en voz alta y respuesta corta. |
| `tambien_vale` | sí (puede ser `[]`) | Variantes aceptables. |
| `criterio` | no | Regla para el juicio: «basta con el apellido». |
| `explicacion` | no | Una frase que se muestra junto a la respuesta. |
| `verificacion` | en cálculo, geometría y probabilidad | Expresión en Python que calcula la respuesta. El validador solo admite operaciones aritméticas y unas pocas funciones, con límites de tamaño (exponentes, factoriales, rangos), para que una fórmula escrita por la IA no pueda colgarlo. |
| `origen` | sí | `semilla`, `generada` o `manual`. |
| `tipo` | en las categorías de mapa | `"mapa"`: se responde señalando un punto (ver «Preguntas de mapa»). Solo en las categorías con `"tipo": "mapa"` en `config.json`, y en ellas, en todas. |
| `lat`, `lon` | en las de mapa | El punto correcto, en grados (latitud entre −80 y 80, porque el mapa no llega a los polos). |
| `distancia_max_km` | en las de mapa | El doble del radio de la zona de acierto (que es `distancia_max_km × config.mapa.acierto_fraccion`, la mitad): una de `config.mapa.distancias_km` (200 en España; 1000 en Europa, el Mediterráneo y Oriente Próximo; 3000 en el resto), es decir, zonas de 100, 500 y 1500 km. |
| `vista` | no | Encuadre inicial del mapa (`config.mapa.vistas`); si falta, el de su subtema. |
| `juez` | no | Puntuaciones del juez IA (fase 6): `{"exactitud": 1-5, "ambiguedad": 1-5, "claridad": 1-5, "nivel_estimado": 1-10, "comentario": "…"}`. No cambian la versión de la pregunta. |

### Preguntas de mapa (Geohistoria)

Quien lee dice un hecho («¿dónde fue la batalla de Waterloo?») y quien juega lo señala en el mapa (`app/data/mapa.json`, generado con `herramientas/generar_mapa.py` a partir de los países de Natural Earth 1:50m, de dominio público; proyección de Mercator). La app mide la distancia `d` al punto correcto (fórmula del haversine) y:

- **Zona de acierto:** un círculo de radio `R = distancia_max_km × config.mapa.acierto_fraccion` (la mitad) alrededor del sitio.
- **Puntos:** quien arriesga `N` suma `N − ⌊d · N / R⌋`, nunca menos de 0. Es decir, pierde un punto por cada «paso» de distancia (`R / N`, más corto cuanto más arriesga), y fuera de la zona no suma nada. Avanza esas casillas.
- **Acierto** (para el modelo de niveles, que solo entiende acierto o fallo, y para ganar la final): `d < R`, que es lo mismo que sumar al menos un punto.
- **Nivel:** igual que en las demás, cuánta gente del grupo «acierta» así. Por eso las difíciles no dicen el país: con 3000 km de margen, saber el país casi siempre basta.

Hasta la fase 19, los puntos llegaban hasta `distancia_max_km`: quien no sabía dónde estaba el sitio sumaba igualmente varios puntos con las apuestas altas (arriesgar 10 rendía unos 2 puntos de media, frente a 0,4 en una pregunta normal). Con la zona, los puntos esperados de cada apuesta quedan cerca de los de la tabla, y la calibración mantiene la probabilidad de acierto.

El generador con IA no hace preguntas de mapa (necesitan coordenadas comprobadas): se escriben a mano. Si cambias el punto, la distancia, el texto o la respuesta de una, sube su `v`.

## Control de versiones — `app/data/preguntas.lock.json`

Lo mantiene `herramientas/validar_banco.py --actualizar`. Guarda `{id: {"v": n, "huella": "..."}}`. Si una huella cambia sin que suba `v`, el validador da error, porque mezclaría datos de dos preguntas distintas. Una pregunta borrada del banco se queda con `"eliminada": true`, para que su id no se vuelva a usar.

## Ajustes — `app/data/ajustes.json`

Lo escribe `analisis/calibrar.py`. La app aplica `niveles` sobre el nivel inicial y oculta las `retiradas`.

```json
{
  "formato": 1,
  "version": "2026-10-20T21:05:00Z",
  "generado_por": "analisis/calibrar.py",
  "n_respuestas": 412,
  "n_valoraciones": 230,
  "niveles": { "cie-ast-01": 2, "his-pai-07": 8 },
  "retiradas": { "ent-cin-12": "erronea" },
  "versiones": { "cie-ast-01": 1, "his-pai-07": 2, "ent-cin-12": 2 }
}
```

`niveles` solo incluye las preguntas cuyo nivel cambia. `versiones` guarda la `v` de cada pregunta de `niveles` y `retiradas` cuando se calibró: si después se reescribe y sube su `v`, la app (y el generador) dejan de aplicarle el ajuste y vuelve a salir con su nivel inicial, sin esperar a la siguiente calibración; sus datos nuevos empiezan de cero, porque R descarta los de versiones anteriores. Sin `versiones` (ajustes antiguos), los ajustes se aplican siempre. `version` es la que muestra la app y queda en cada registro como `version_ajustes` (`inicial` mientras no se haya calibrado).

## Registro (IndexedDB) y exportación

Cada evento es un registro con un `id` único (UUID). La exportación es un único archivo:

```json
{
  "formato": 1,
  "app": "cuanto-te-arriesgas",
  "exportado": "2026-10-20T21:00:00.000Z",
  "dispositivo": "4f1c…",
  "version_banco": "1456bdae",
  "version_ajustes": "inicial",
  "registros": [ … ]
}
```

Campos comunes a todos los registros: `id`, `tipo`, `ts`, `dispositivo`, `version_banco` y `version_ajustes`. Los de preguntas (respuesta, anulación y revisión) llevan además `pregunta`, `v`, `categoria`, `subtema`, `nivel_inicial` y `nivel_mostrado`; los de rondas, `ronda` y `v`, y los de finales propias, `final` y `v`.

### `tipo: "respuesta"`: una pregunta jugada

| Campo | Descripción |
|---|---|
| `partida`, `turno` | Id de la partida y número de turno. |
| `jugador`, `lector` | Clave del jugador que responde y del que lee (nombre normalizado). Con narrador, `lector` es siempre el narrador. |
| `modo` | `"pasar"` (el móvil pasa al siguiente jugador) o `"narrador"` (una persona que no juega lee todas las preguntas). Falta en los registros anteriores a este campo, que son todos `"pasar"`. |
| `subtema_anunciado` | Subtema que se anunció antes de apostar. Puede no coincidir con `subtema` (el de la pregunta) si no quedaban preguntas de ese subtema y nivel. |
| `apuesta` | Número elegido (en la final, el nivel calculado). |
| `es_final` | `true` si era la pregunta final. |
| `cronometro`, `tiempo_agotado` | Segundos que hubo para responder y si se acabaron antes de ver la respuesta. Los dos `null` si la pregunta no llevaba cronómetro (otra categoría, o partida sin él). |
| `alternativa` | `null` o el motivo por el que la pregunta no es exactamente la pedida: `otro_subtema`, `otro_nivel`, `repetida`. Una respuesta `repetida` (quien responde ya la había visto) no entra en la calibración, aunque su marca de «pregunta mala» sí cuenta. La calibración deja fuera también las que la app no pudo marcar (ver «Preguntas ya vistas» en las reglas de los registros). Si una pregunta es de otro nivel y además ya la había visto, queda como `repetida`. |
| `acierto` | `true` / `false`. En una pregunta de mapa, si quedó a menos de la mitad de `distancia_max_km`. |
| `valoracion` | `"facil"` (más fácil de lo que dice su nivel), `"justa"`, `"dificil"` o `null`. |
| `mala` | `null` o id del motivo (`config.motivos_mala`). |
| `lat_senalada`, `lon_senalada`, `distancia_km`, `distancia_max_km`, `puntos` | Solo en las preguntas de mapa: el punto que se señaló, a cuántos km quedó del correcto, la distancia máxima de la pregunta y los puntos que sumó (`null` en la final, donde no se suman puntos). |

### `tipo: "anulacion"`: el lector pidió otra pregunta

`partida`, `turno`, `jugador`, `lector`, `modo`, `motivo` (id de `config.motivos_anulacion`) y `momento` (`"antes"` o `"despues"` de ver la respuesta).

### `tipo: "revision"`: valoración en el modo revisión

`evaluador`, `valoracion` y `mala`, con el mismo significado que arriba. Aquí `valoracion` también puede ser `"horquilla"`: quien revisa dice qué nivel le pondría, o entre qué dos niveles, y van en `nivel_desde` y `nivel_hasta` (enteros del 1 al 10; iguales si es un solo nivel; `null` con las otras valoraciones).

En la calibración, cada valoración acota el nivel que percibe quien valora (con el nivel mostrado L): «más fácil», por debajo de L − 0,5; «sí», entre L − 0,5 y L + 0,5; «más difícil», por encima de L + 0,5; y una horquilla «de a a b», entre a − 0,5 y b + 0,5, abierta por abajo si a = 1 y por arriba si b = 10. Así, «de 1 a L − 1» equivale a «más fácil», pero «de 4 a 5» dice mucho más. Una horquilla al revés o fuera de rango se descarta.

### `tipo: "ronda"`: una ronda divertida jugada

No llevan `pregunta`, `categoria` ni niveles: no entran en el modelo de niveles, y la calibración saca de ellas sus propias estadísticas (ver «Rondas divertidas»).

| Campo | Descripción |
|---|---|
| `partida`, `turno`, `jugador`, `lector`, `modo` | Como en una respuesta. |
| `ronda`, `v` | Id y versión de la ronda. |
| `tipo_ronda` | `"lista"` o `"rafaga"`. |
| `segundos` | El tiempo que tenía. |
| `total` | Elementos de la lista (en una abierta, los de la lista de referencia) o descripciones de la ráfaga. |
| `leidos` | En una ráfaga, a cuántas descripciones dio tiempo; `null` en una lista. |
| `marcados` | Índices (desde 0) de los elementos acertados, en orden. |
| `extra` | En una lista abierta, las respuestas que valían y no estaban en la lista. |
| `aciertos` | `marcados` + `extra`: las casillas que avanza (como mucho, hasta la meta). |
| `alternativa` | `"repetida"` si quien jugaba ya conocía la ronda (no quedaban nuevas); la calibración no la cuenta. |
| `tiempo_agotado` | Si se acabó el tiempo antes de terminarla. |
| `mala` | Marca de «ronda mala», con los motivos de `config.motivos_mala`, o `null`. |

### `tipo: "ronda_anulada"`: quien lee cambió la ronda

`partida`, `turno`, `jugador`, `lector`, `modo`, `ronda`, `v` y `motivo` (de `config.motivos_anulacion`).

### `tipo: "final"`: una final propia jugada

Como las rondas, no entra en el modelo de niveles: el informe la cuenta aparte (ver «Finales propias»). Si no cargó el archivo de finales, la final es una pregunta del banco y queda como una `respuesta` con `es_final: true`, como antes.

| Campo | Descripción |
|---|---|
| `partida`, `turno`, `jugador`, `lector`, `modo` | Como en una respuesta. |
| `final`, `v` | Id y versión de la final. |
| `tipo_final` | `"pregunta"` o `"reto"`. |
| `nivel` | El de la final que salió. |
| `nivel_pedido`, `ventaja` | El nivel que tocaba por la ventaja sobre el último y por las finales ya falladas, y esa ventaja. |
| `rebaja` | Escalones que bajó la final porque quien jugaba ya había fallado otras (una por cada final fallada, sin bajar de `final.nivel_base`). `0` en los registros anteriores a esta regla. |
| `alternativa` | `null`, `"otro_nivel"` (no quedaban nuevas del nivel pedido) o `"repetida"` (quien jugaba ya la había visto; el informe no la cuenta). |
| `cronometro`, `tiempo_agotado` | Segundos que hubo y si se acabaron. En un reto siempre hay tiempo; en una pregunta de cálculo, solo si la partida lleva cronómetro. |
| `acierto` | Si la ganó. En un reto, `aciertos >= minimo`. |
| `aciertos`, `minimo`, `total`, `leidos`, `marcados` | Solo en un reto (si no, `null`): cuántas acertó, cuántas necesitaba, de cuántas, a cuántas dio tiempo y cuáles (índices desde 0). |
| `valoracion` | Como en una respuesta (solo en las preguntas; en un reto, `null`). |
| `mala` | Marca de «final mala», con los motivos de `config.motivos_mala`, o `null`. |

### `tipo: "final_anulada"`: quien lee cambió la final

`partida`, `turno`, `jugador`, `lector`, `modo`, `final`, `v`, `nivel`, `motivo` (de `config.motivos_anulacion`) y `momento`, como en una anulación.

## Rondas divertidas — `app/data/rondas.json`

```json
{
  "formato": 1,
  "rondas": [
    {
      "id": "ron-apostoles", "v": 1, "tipo": "lista", "titulo": "Los doce apóstoles",
      "enunciado": "Nombra a los doce apóstoles de Jesús.",
      "segundos": 45, "cerrada": true,
      "nota": "Matías, elegido para sustituir a Judas Iscariote, vale en su lugar.",
      "fuente": "Mateo 10, 2-4; …",
      "elementos": [{ "texto": "Pedro", "tambien_vale": ["Simón Pedro"] }, …]
    },
    {
      "id": "ron-calculo-mental", "v": 1, "tipo": "rafaga", "titulo": "Cálculo mental",
      "enunciado": "Te digo operaciones y dices el resultado…", "segundos": 40, "nota": null, "fuente": "…",
      "elementos": [{ "pista": "Siete por ocho", "respuesta": "56", "tambien_vale": [], "verificacion": "7*8" }, …]
    }
  ]
}
```

- **Lista** (`tipo: "lista"`): de 5 a 30 elementos con `texto` y sus variantes en `tambien_vale`. `cerrada: true` si solo cuentan los de la lista; `false` si es una lista de referencia y decide el grupo («personajes rosas»).
- **Ráfaga** (`tipo: "rafaga"`): de 6 a 15 descripciones (`pista`) con su `respuesta`. Una pista no puede contener su respuesta. Si la respuesta es un cálculo, `verificacion` lleva la fórmula y el validador comprueba el resultado.
- `enunciado` es lo que se lee en voz alta, sin el tiempo (la app lo dice aparte). `fuente`, obligatoria: de dónde sale la lista. `nota`: aclaraciones para quien lee.
- Una variante solo puede valer para un elemento (si no, no se sabe cuál marcar).
- `segundos`: entre 10 y 180. El validador avisa si quedan menos de 1,5 o más de 8 segundos por elemento en una lista cerrada (3 a 10 en una ráfaga). La idea es que decirlo todo sea muy difícil.
- **Versiones.** `app/data/rondas.lock.json` guarda la huella de cada ronda (tipo, enunciado, segundos, si es cerrada y elementos). Si cambias algo de eso, sube su `v`: las estadísticas de la versión anterior dejan de contar.

En `config.json`, `rondas.archivo` dice dónde está el archivo; `rondas.cada`, cada cuántas casillas hay una especial (8), y `rondas.media_aviso`, cuándo avisa el informe: si una ronda da de media más de `alta` (6) casillas o menos de `baja` (1), con al menos `minimo_jugadas` (3).

**En el informe de calibración**, la sección «Rondas divertidas» da por cada ronda las veces que se ha jugado, los aciertos de media y el máximo, cuántas veces se cambió y cuántas se marcó como mala. Solo cuenta la versión actual de cada ronda y deja fuera las que quien jugaba ya conocía.

## Finales propias — `app/data/finales.json`

La pregunta final no sale del banco: tiene su propio archivo, con preguntas más difíciles y de tema libre (sin categoría), en tres escalones: nivel 8, 9 y 10, según la ventaja sobre el último.

```json
{
  "formato": 1,
  "finales": [
    {
      "id": "fin-009", "v": 1, "nivel": 8, "tipo": "pregunta",
      "pregunta": "¿Cuántas vértebras tiene el cuello de una jirafa?", "respuesta": "7", "tambien_vale": ["Siete"],
      "criterio": null, "explicacion": "Las mismas que un ser humano…", "segundos": null,
      "fuente": "Encyclopaedia Britannica, «giraffe»"
    },
    {
      "id": "fin-041", "v": 1, "nivel": 9, "tipo": "reto", "titulo": "Banderas de estados (I)",
      "enunciado": "Te describo cinco banderas de estados de Estados Unidos… Hay que acertar al menos cuatro.",
      "minimo": 4, "segundos": 60, "nota": null, "fuente": "…",
      "elementos": [{ "pista": "Una franja vertical azul con una estrella blanca…", "respuesta": "Texas", "tambien_vale": [] }, …]
    }
  ]
}
```

- **Pregunta** (`tipo: "pregunta"`): como las del banco, pero sin `categoria`, `subtema` ni `origen`, y con `fuente` obligatoria. Si es de cálculo, `segundos` (de 30 a 180) es su tiempo cuando la partida lleva cronómetro, y `verificacion`, la fórmula que el validador calcula y compara con la respuesta.
- **Reto** (`tipo: "reto"`): «acierta al menos `minimo` de estas», con de 3 a 10 descripciones (`pista` y `respuesta`, como en una ráfaga). Lleva tiempo siempre (`segundos`, de 15 a 180). El validador avisa si el mínimo es menos del 60 % del total (más suerte que saber).
- El id es `fin-` y tres cifras. El validador da error si una final es una pregunta del banco, y avisa si se le parece mucho, si una variante de `tambien_vale` solo cambia tildes o mayúsculas, o si da por sabido algo que ya sale en el banco o en las rondas: una serie que ya es una pregunta, un número de la respuesta (un año) en un enunciado, o una respuesta de dos o más palabras en una explicación o en una pista.
- **Versiones.** `app/data/finales.lock.json` guarda la huella de cada final (en una pregunta: texto, respuesta, variantes, criterio y tiempo; en un reto: enunciado, mínimo, tiempo y elementos). Si cambias algo de eso, sube su `v`.
- La app elige una final nueva del nivel pedido para quien juega. Si no quedan, nunca una más difícil mientras haya otra opción: primero una nueva de un nivel más fácil (la más cercana), después la del nivel pedido (o de uno más fácil) vista hace más tiempo, y solo entonces una de un nivel más difícil. Antes, a la misma distancia elegía la más difícil, y al agotarse las de nivel 8 la rebaja dejaba de funcionar. Si el archivo no carga, la final es una pregunta del banco, como antes.

**En el informe de calibración**, la sección «Preguntas finales» da, por nivel, cuántas se han jugado y qué parte se acertó frente al objetivo, y por final, las veces, las acertadas, los aciertos de media de los retos, las valoraciones, los cambios y las marcas de «mala». Avisa de las que se aciertan más del doble de lo buscado.

## Modelo filtro — `generador/filtro.json`

Lo escribe `analisis/entrenar_filtro.py` y lo lee `generador/filtro.py`, que es también quien calcula las características. Es una regresión logística ridge sobre características estandarizadas: `P(mala) = σ(intercepto + Σ peso·(x − media)/desviación)`. Una candidata se descarta si `P(mala) > umbral`.

| Característica | Cálculo |
|---|---|
| `exactitud`, `ambiguedad`, `claridad` | Puntuaciones del juez, de 1 a 5 |
| `desvio_nivel` | \|nivel estimado por el juez − nivel de la pregunta\| |
| `longitud` | Caracteres de la pregunta / 100 |
| `numerica` | 1 si la respuesta empieza por un número (con o sin signo menos, también el tipográfico «−»), 0 si no |

Etiquetas de entrenamiento: **mala** si la pregunta está retirada o tiene alguna marca de calidad; **buena** si se ha jugado al menos una vez sin marcas. Las demás no se usan.

`generador/caso_filtro_comun.json` fija un modelo, seis preguntas y sus probabilidades (las calculó la versión en R, antes de retirarla en la fase 13); las pruebas del generador y de `analisis` comprueban que el cálculo sigue dando lo mismo. Si cambias una característica a propósito, recalcula las probabilidades de ese archivo.

## Reglas de los registros

- Deshacer un turno cerrado **borra** su registro, así que no llega a exportarse.
- La clave de jugador es el nombre en minúsculas, sin tildes, sin caracteres invisibles (marcas de dirección, espacios de ancho cero… que se cuelan al copiar un nombre de otra app) y con los espacios normalizados: «Ana Pérez» → `ana perez`. Es igual en todos los móviles. Un nombre que se queda vacío así no vale.
- La calibración elimina duplicados por `id`, así que exportar varias veces no es un problema. Un archivo que no se puede leer (cortado) o que no es de la app se ignora con un aviso, y el informe lo lista; el resto se calibra igual.
- **Preguntas ya vistas.** La app marca una respuesta como `repetida` solo con lo que sabe ese móvil (`cta.vistas`), y lo olvida al olvidar a un jugador. Por eso la calibración (`vista_antes` en `analisis/calibracion.py`) deja fuera del modelo, además, cualquier respuesta cuyo `jugador` ya había visto esa pregunta, con la misma `pregunta` y la misma `v`, en un registro anterior de cualquier exportación: como `jugador` de una respuesta o de una anulación, como `lector` o como `evaluador` de una revisión. Son los mismos casos en los que la app apunta una pregunta como vista. «Anterior» quiere decir con un `ts` estrictamente menor (la hora de cada móvil), sin importar en qué archivo esté; un registro no cuenta como vista de sí mismo, aunque se haya exportado desde dos móviles. Como con las `repetida`, no cuentan ni el acierto ni la valoración de esa respuesta, pero su marca de «pregunta mala» sí. El informe da por separado las que marcó la app y las que detecta la calibración; una que marcó la app solo se cuenta como tal.

## Datos del móvil (localStorage)

Además del registro, cada móvil guarda en `localStorage`, con el prefijo `cta.`, lo que necesita para jugar. Nada de esto se exporta.

| Clave | Contenido |
|---|---|
| `cta.partida` | La partida en curso y su pila de deshacer. |
| `cta.jugadores` | Jugadores recordados: `[{ clave, nombre, ultima }]`, donde `ultima` es la última vez que empezó una partida (jugando o narrando) o una revisión. Sirve para sugerir nombres. |
| `cta.vistas` | Preguntas vistas por cada jugador: `{ clave: { idPregunta: fecha } }`. Sirve para no repetirle preguntas. |
| `cta.revisadas` | Preguntas revisadas por cada evaluador, con el mismo formato. |
| `cta.pref.*` | Preferencias: meta, sorteo, narrador, cronómetro, rondas, quién revisa y fecha de la última exportación. |
| `cta.dispositivo` | Identificador del móvil, que va en cada registro. |

Si algo de esto tiene una forma inesperada (una versión anterior, una escritura a medias), se lee como vacío: nunca impide abrir la app. Con la app abierta dos veces en el mismo móvil (dos pestañas, o instalada y en el navegador), las preguntas vistas se combinan en vez de pisarse, y si una ventana cambia la partida, la otra deja de jugarla y vuelve al inicio.

**Olvidar a un jugador** (pantalla «Datos», con confirmación) borra su entrada en `cta.jugadores`, `cta.vistas` y `cta.revisadas`, y las preferencias de narrador o de quién revisa si lo nombran. Nunca toca el registro de IndexedDB: sus respuestas y valoraciones se siguen exportando y R las sigue usando. Si vuelve a jugar, le pueden salir preguntas que ya vio en ese móvil; R las reconoce en los registros y no usa esas respuestas para calcular niveles (ver «Preguntas ya vistas»). Lo mismo pasa si alguien juega en varios móviles.

**Olvido automático.** Al abrir la app se olvida a quien lleve más de `jugadores.olvidar_tras_dias` días (180, unos 6 meses) sin jugar ni revisar, salvo a quien esté en la partida a medias. El plazo es largo a propósito: un grupo que queda cada pocos meses no pierde sus nombres, y en cambio desaparecen solos los de prueba («yo», «tú») y los invitados de un día; tras medio año, además, volver a ver una pregunta importa poco, porque ya no se recuerda. Con 0 no se olvida a nadie.
