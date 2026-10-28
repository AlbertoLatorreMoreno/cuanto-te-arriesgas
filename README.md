# ¿Cuánto te arriesgas?

Juego de preguntas para jugar en grupo con un solo móvil. En tu turno eliges del 1 al 10 cuánto te arriesgas: ese número es la dificultad de tu pregunta y los puntos que sumas si aciertas. Con vuestras partidas, una regresión logística (en Python) reajusta el nivel de cada pregunta para vuestro grupo.

- Reglas completas: en la app («Cómo se juega») y en [PLAN.md](PLAN.md#2-reglas-del-mvp).
- Plan de actuación, decisiones y estado: [PLAN.md](PLAN.md).

---

## Jugar

### En el ordenador (para probar)

```bash
py -m http.server 8000 --directory app
```

Abre <http://localhost:8000>. Hace falta un servidor: abierta con doble clic, el navegador no deja cargar los módulos ni los datos de la app.

### En el móvil, sin publicar nada

Con el ordenador y el móvil en la misma wifi:

```bash
py -m http.server 8000 --directory app --bind 0.0.0.0
```

En el móvil abre `http://<IP-del-ordenador>:8000` (la IP sale con `ipconfig`). Se juega igual, pero sin instalación, sin modo sin conexión y sin pantalla siempre encendida, porque eso exige HTTPS. Exportar descarga el archivo en vez de abrir el menú de compartir.

Si el móvil no la abre, suele ser el cortafuegos de Windows con la wifi marcada como red pública. Los pasos para arreglarlo, y la lista de lo que conviene probar en el móvil, están en [docs/prueba_en_movil.md](docs/prueba_en_movil.md).

### En el móvil, publicada en GitHub Pages (recomendado)

1. Crea un repositorio en GitHub (*New repository*). Con una cuenta gratuita, Pages solo funciona en repositorios públicos: el banco de preguntas y los ajustes serán visibles, pero no las exportaciones de partidas.
   Sube los archivos: en el repositorio vacío, *uploading an existing file*, y arrastra **el contenido** de la carpeta del proyecto (no la carpeta entera, para que `index.html` quede arriba del todo). Son unos 100 archivos, justo el límite de una subida: si la web no los admite todos, súbelos en dos veces (por ejemplo, primero la carpeta `app` y después el resto). Si subes así, a mano, `.gitignore` no actúa, así que **no arrastres**: las exportaciones de `analisis/datos/` (los `.json`), `analisis/envio.json` (el código de descarga de la hoja del grupo) ni la carpeta `analisis/salida/`, porque llevan los nombres de los jugadores (el informe de calibración tiene una tabla por jugador); tampoco hace falta `.claude/`, `analisis/r_anterior/` (la calibración en R, ya retirada), ni `analisis/simulados/`, `generador/candidatas/` o las carpetas `__pycache__` si las tienes.
2. En el repositorio: *Settings → Pages → Deploy from a branch*, rama `main`, carpeta `/ (root)`.
3. Abre `https://<usuario>.github.io/<repositorio>/` en el móvil y usa «Añadir a pantalla de inicio».

La app queda instalada, funciona sin conexión y, cuando hay red, descarga sola las versiones nuevas del banco y de los ajustes. Las exportaciones de partidas no se suben: `.gitignore` las excluye porque llevan los nombres de los jugadores.

**Al publicar cambios en el código** (`app/js`, `app/css` o `app/sw.js`), antes de subirlos:

```bash
py herramientas/versionar.py
```

Pone una versión en las direcciones de los archivos, para que ningún móvil mezcle archivos viejos con nuevos justo después de actualizar, y las huellas de los scripts de `index.html` en su política de seguridad (CSP), que no deja ejecutar nada más. Si cambias solo el banco o los ajustes, no hace falta. Si se te olvida, las pruebas de `herramientas` lo detectan.

---

## El ciclo de mejora

```
jugar y valorar → exportar → calibrar → publicar ajustes → jugar con niveles corregidos
```

1. **Jugar.** Tras cada pregunta, si queréis, decid si encajaba con su nivel o marcadla como mala. «Revisar preguntas» sirve para valorar sin jugar, y ahí también podéis decir qué nivel le pondríais (o una horquilla: «entre un 4 y un 5»).
2. **Exportar.** En «Datos y exportación» → «Exportar datos». Envíate el archivo y cópialo en `analisis/datos/`. Hazlo al acabar cada quedada: hasta entonces los datos solo están en el móvil, y en iPhone Safari borra los de las webs no instaladas que no se abren en 7 días.
   Con el [envío a la hoja del grupo](#envío-de-datos-a-la-hoja-del-grupo) en marcha no hace falta: al acabar cada partida, la app pregunta si se envían sus datos, y `py analisis/descargar.py` los trae a `analisis/datos/`.
3. **Calibrar.**
   ```bash
   py analisis/calibrar.py
   ```
   Escribe `app/data/ajustes.json` (niveles corregidos y preguntas retiradas) y un informe en `analisis/salida/informe.md`. Con `--seco` solo genera el informe.
4. **Publicar.** Sube el nuevo `ajustes.json` a GitHub, en `app/data/`, sustituyendo al anterior (en la web: entra en esa carpeta y *Add file → Upload files*). El móvil lo recogerá en la siguiente apertura con conexión.

Qué hace el modelo y por qué: [PLAN.md, sección 3](PLAN.md#3-cómo-mejora-el-modelo-con-el-tiempo). Si conviene exportar sin tocar nada y si bastaría con las valoraciones en vez de la regresión: [docs/informe_exportacion_y_niveles.md](docs/informe_exportacion_y_niveles.md).

### Practicar sin datos reales

```bash
py analisis/simular_partidas.py
py analisis/calibrar.py --datos analisis/simulados --seco
```

La simulación genera partidas con niveles reales conocidos (en `analisis/simulados/verdad.csv`) para ver cómo los recupera la calibración. Nunca escribe en `analisis/datos/`. Ojo: `--seco` no toca `ajustes.json`, pero sí sustituye el informe de `analisis/salida/`; vuelve a calibrar con tus datos para recuperarlo.

---

## Envío de datos a la hoja del grupo

Al acabar cada partida, la app pregunta: «¿Enviamos los datos de esta partida?». Si decís que sí, se envían en el momento (sin conexión, en cuanto la haya) a una hoja de cálculo de Google de la cuenta de la app; si decís que no, no se envía nada de esa partida, y en la pantalla final queda un botón por si cambiáis de opinión. Al salir de «Revisar preguntas» se pregunta lo mismo por las valoraciones. Nadie tiene que configurar nada en el móvil.

Mientras `app/data/config.json` no tenga la dirección del script, la app no pregunta nada y todo sigue como antes (exportar a mano).

**Ponerlo en marcha (una vez, unos 10 minutos):**

1. Con la cuenta de Google de la app, crea una hoja de cálculo nueva (<https://sheets.new>). Si en el navegador tienes abiertas varias cuentas de Google, hazlo en una ventana privada con solo esa: Apps Script se lía con varias cuentas a la vez.
2. En la hoja: *Extensiones → Apps Script*. Borra lo que haya y pega el contenido de [`herramientas/apps_script.gs`](herramientas/apps_script.gs).
3. Cambia `const CODIGO_DESCARGA = "";` por un código secreto, de al menos 8 caracteres (por ejemplo, tres palabras con guiones), y guarda. Solo sirve para descargar los datos desde el ordenador: no va en la app.
4. *Implementar → Nueva implementación*, tipo *Aplicación web*. *Ejecutar como*: tú (tiene que salir la cuenta de la app). *Quién tiene acceso*: *Cualquier usuario* (no *Cualquier usuario con una cuenta de Google*: con eso, los móviles recibirían la página de inicio de sesión). Pulsa *Implementar* y autoriza el acceso. Google avisará de que la aplicación no está verificada (es tuya, nadie la ha revisado): *Configuración avanzada* → *Ir a… (no seguro)*. Solo pide permiso para esa hoja, no para el resto de tu Drive.
5. Copia la dirección de la aplicación web (acaba en `/exec`). Para comprobarla, ábrela en el navegador: tiene que decir «El script funciona».
6. Pon esa dirección en `app/data/config.json`, en `"envio": { "url": "…" }`, y publica la app. Desde ese momento, todos los móviles preguntan al acabar cada partida.
7. En el ordenador, crea `analisis/envio.json` con el código de descarga (`.gitignore` lo excluye):

   ```json
   {"codigo": "…"}
   ```

   y, antes de calibrar:

   ```bash
   py analisis/descargar.py
   ```

   Deja en `analisis/datos/arriesga-hoja.json` todo lo que hay en la hoja (cada vez sustituye al anterior). Puede convivir con las exportaciones a mano: la calibración descarta los registros repetidos.

**A tener en cuenta:**

- La dirección del script va en la app, que es pública: quien la mire podría enviar datos a la hoja. Por eso el script solo acepta registros con la forma de los de la app, como mucho 500 por envío y 3000 al día, y leer la hoja exige el código, que no está en ningún sitio público.
- La hoja lleva los nombres de los jugadores: no la compartáis.
- Si cambias el script, en *Implementar → Gestionar implementaciones* edita la que hay y elige *Nueva versión*: así la dirección no cambia. Al pegar la versión nueva de `herramientas/apps_script.gs`, vuelve a poner tu código en la línea de `CODIGO_DESCARGA` (en el repositorio va vacía).
- Tras 10 intentos con un código equivocado, la descarga se cierra una hora (también con el bueno), para que nadie lo adivine probando. Enviar no se cierra.
- La app solo puede conectarse con el script de `config.json`: la dirección está también en la CSP de `app/index.html`. Si la cambias, cámbiala en los dos sitios (las pruebas de `herramientas` lo vigilan).
- Todo lo que se publica en `<usuario>.github.io` comparte origen con la app: otra web tuya publicada ahí podría leer los datos que la app guarda en cada móvil. Si algún día publicas otro proyecto en GitHub Pages, hazlo desde otra cuenta u organización, o con un dominio propio.
- En «Datos y exportación» se ve cuánto se ha enviado desde ese móvil y si queda algo pendiente, con un botón para reintentar. La exportación a mano sigue funcionando.
- Como cualquiera podría enviar datos falsos, `descargar.py` descarta lo que no tiene la forma de un registro de la app y enseña cuántos llegan de cada móvil y con qué nombres: si ves uno que no es del grupo, borra sus filas de la hoja antes de calibrar. Y si una calibración retiraría de golpe más de 10 preguntas (`retirada.max_por_calibracion`), no toca `ajustes.json`: mira el informe y, si las retiradas son buenas, repite con `py analisis/calibrar.py --aceptar-retiradas`.
- Para probarlo sin Google, `py herramientas/script_simulado.py` hace de script en este ordenador: pon `http://127.0.0.1:8011/exec` como dirección en `config.json` (sin publicarla así) y descarga con el código `codigo-de-prueba`. Lo que recibe se pierde al pararlo.

---

## Generar preguntas nuevas con IA

Necesita el SDK de Anthropic y una clave de API (`ANTHROPIC_API_KEY` o `ant auth login`):

```bash
py -m pip install -r generador/requirements.txt
```

1. **Ver qué haría, sin gastar.** Lista las combinaciones de subtema y nivel con menos de 3 preguntas:
   ```bash
   py generador/generar.py --seco
   ```
2. **Generar.** Pide las preguntas agrupadas por subtema (todos los niveles que falten en una sola llamada), las valida (esquema, cálculos de mates, duplicados), un segundo modelo las juzga y el filtro descarta las dudosas. El resultado va a `generador/candidatas/`, no al banco:
   ```bash
   py generador/generar.py --max-celdas 10
   py generador/generar.py --celda mates/calculo/7 --cantidad 3
   ```
3. **Revisar e incorporar.** Lee el archivo de candidatas y quita las que no te gusten:
   ```bash
   py generador/incorporar.py generador/candidatas/lote-AAAAMMDD-HHMMSS.json --excluir id1,id2
   ```

Usa Claude Opus 5.5 con salida JSON estructurada. Si el modelo rechaza una petición, la API la repite automáticamente con el modelo de respaldo recomendado (`fallbacks: "default"`).

**Modelo filtro.** Al principio el filtro usa umbrales fijos sobre las notas del juez. Cuando tengáis datos, puntúa también el banco semilla y entrena la regresión logística que aprende de vuestras marcas de «pregunta mala»:

```bash
py generador/juez.py --banco
py analisis/entrenar_filtro.py
```

Esto escribe `generador/filtro.json`, que el generador usa en adelante. Hacen falta al menos 40 preguntas etiquetadas, con 8 malas y 8 buenas como mínimo.

---

## Localízalo: preguntas de mapa

La quinta categoría (hasta el 26 de octubre se llamaba Geohistoria; en los datos su id sigue siendo `geohistoria`) se responde tocando un mapa. Cada pregunta tiene una zona de acierto alrededor del sitio: dentro, sumas lo que arriesgaste menos un punto por cada «paso» que te alejes (el paso es más corto cuanto más arriesgas); fuera, nada (las reglas exactas, en «Cómo se juega» y en [docs/esquema_datos.md](docs/esquema_datos.md)). Las preguntas están en `app/data/preguntas/geohistoria.json` y llevan `lat`, `lon` y `distancia_max_km`; el generador con IA no las hace.

El mapa (`app/data/mapa.json`, unos 240 KB) sale de los países de [Natural Earth](https://www.naturalearthdata.com/) 1:50m, de dominio público. Para regenerarlo (por ejemplo, con otra simplificación), descarga `ne_50m_admin_0_countries.geojson` de su repositorio en GitHub y:

```bash
py herramientas/generar_mapa.py ruta/ne_50m_admin_0_countries.geojson
```

---

## Temas: la pregunta de cada jugador

Al crear la partida, cada jugador puede elegir un tema (Harry Potter, Star Wars, Marvel, Juego de tronos, Segunda Guerra Mundial o Sorpresa) y, en una de cada 5 de sus preguntas normales, le toca una de su tema en vez de la de la casilla. Las preguntas están en `app/data/temas/<tema>.json`, con el mismo formato que el banco, y los temas, en `config.json` (`temas`). Sus niveles son para quien elige el tema (salvo en Sorpresa): ver la rúbrica. Por qué así y cuántas hacen falta: [docs/informe_temas.md](docs/informe_temas.md).

- Para añadir preguntas a un tema, escríbelas en su archivo con un id nuevo de su subtema (`har-pel-11`…) y valida con `py herramientas/validar_banco.py --actualizar`. Basta con una por subtema y nivel, pero si un tema se elige mucho conviene llegar a dos.
- Para un tema nuevo: añádelo a `config.json` (`temas.lista`), crea su archivo y súmalo a `ARCHIVOS` en `app/sw.js` (si no, no se podrá jugar sin conexión).
- Con cada partida se envía (o se exporta) el tema que eligió cada jugador. El informe de calibración tiene una sección «Temas» con cuántas veces se elige cada uno y cuántas de sus preguntas han salido ya: los más elegidos son los primeros a los que conviene escribir más.
- El generador no rellena los temas solo (`--seco` solo lista los huecos del tablero), pero se le puede pedir uno: `py generador/generar.py --celda harry_potter/peliculas/6 --cantidad 3` (gasta API).

## Editar el banco a mano

Las preguntas están en `app/data/preguntas/<categoría>.json`, una por línea. Normas de redacción y niveles: [docs/rubrica_niveles.md](docs/rubrica_niveles.md). Formato: [docs/esquema_datos.md](docs/esquema_datos.md).

- **Si cambias el texto, la respuesta, «también vale» o el criterio de una pregunta, sube su `v`.** Así sus datos antiguos no se mezclan con los nuevos.
- No borres preguntas: retíralas desde la calibración o deja que la marquen como mala.
- Las rondas divertidas (listas y ráfagas) están en `app/data/rondas.json`. Cada una lleva su fuente, y si cambias su tiempo o sus elementos, sube también su `v`. El informe de calibración dice cuántas casillas da de media cada ronda, por si hay que ajustar su tiempo.
- Las preguntas finales tienen su propio archivo, `app/data/finales.json`: más difíciles, de tema libre, de nivel 8, 9 o 10, y algunas son retos «acierta 4 de 5». Llevan fuente y la misma regla de la `v`. El informe dice cuánto se acierta cada una, por si hay que subirla de nivel.
- Después de editar (valida a la vez el banco, las rondas y las finales):
  ```bash
  py herramientas/validar_banco.py --actualizar
  ```

---

## Pruebas

| Qué | Orden |
|---|---|
| Motor del juego (reglas, selección, deshacer, preguntas de mapa, empates, 350 partidas simuladas y 200 con acciones al azar), envío a la hoja del grupo y el script de Google (con una hoja simulada) | `node --test "tests/**/*.test.js"` |
| Validador del banco y versionado de archivos | `py -m unittest discover -s herramientas` |
| Banco de preguntas, rondas y finales | `py herramientas/validar_banco.py` |
| Generador (con un cliente simulado: no gasta API) | `py -m unittest discover -s generador` |
| Calibración, simulador, modelo filtro y descarga de la hoja del grupo | `py -m unittest discover -s analisis` |

Todo es Python (con numpy y scipy) salvo la app, que es JavaScript. R ya no hace falta: la calibración se pasó a Python en la fase 13, comprobando antes que daba los mismos resultados.

---

## Estructura

```
app/                 la app (lo que se publica)
  js/motor.js          reglas del juego (puro, con tests)
  js/geo.js            distancias, puntos y proyección de las preguntas de mapa
  js/mapa.js           el mapa interactivo de Localízalo
  js/banco.js          selección de preguntas y alternativas
  js/sesion.js         deshacer y guardado
  js/almacen.js        localStorage + IndexedDB
  js/envio.js          envío de datos a la hoja del grupo (con permiso, al acabar cada partida)
  js/pantallas/        una por pantalla
  data/                configuración, banco, temas, rondas, finales, ajustes y control de versiones
tests/               tests del motor (Node)
herramientas/        validador del banco, versionado de archivos, generador del mapa y de los iconos, y el script de Google de la hoja del grupo (con un sustituto local para probar)
analisis/            calibración, informe, simulador, modelo filtro y descarga de la hoja del grupo (datos/ para las exportaciones)
generador/           generación de preguntas con IA (Python)
docs/                rúbrica, formato de datos y guías de las primeras partidas y de la prueba en el móvil
```
