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
   Sube los archivos: en el repositorio vacío, *uploading an existing file*, y arrastra **el contenido** de la carpeta del proyecto (no la carpeta entera, para que `index.html` quede arriba del todo). Son unos 90 archivos, por debajo del límite de 100 por subida (por poco: no arrastres nada de lo que sigue). Si subes así, a mano, `.gitignore` no actúa, así que **no arrastres**: las exportaciones de `analisis/datos/` (los `.json`) ni la carpeta `analisis/salida/`, porque llevan los nombres de los jugadores (el informe de calibración tiene una tabla por jugador); tampoco hace falta `.claude/`, `analisis/r_anterior/` (la calibración en R, ya retirada), ni `analisis/simulados/`, `generador/candidatas/` o las carpetas `__pycache__` si las tienes.
2. En el repositorio: *Settings → Pages → Deploy from a branch*, rama `main`, carpeta `/ (root)`.
3. Abre `https://<usuario>.github.io/<repositorio>/` en el móvil y usa «Añadir a pantalla de inicio».

La app queda instalada, funciona sin conexión y, cuando hay red, descarga sola las versiones nuevas del banco y de los ajustes. Las exportaciones de partidas no se suben: `.gitignore` las excluye porque llevan los nombres de los jugadores.

**Al publicar cambios en el código** (`app/js`, `app/css` o `app/sw.js`), antes de subirlos:

```bash
py herramientas/versionar.py
```

Pone una versión en las direcciones de los archivos, para que ningún móvil mezcle archivos viejos con nuevos justo después de actualizar. Si cambias solo el banco o los ajustes, no hace falta. Si se te olvida, las pruebas de `herramientas` lo detectan.

---

## El ciclo de mejora

```
jugar y valorar → exportar → calibrar → publicar ajustes → jugar con niveles corregidos
```

1. **Jugar.** Tras cada pregunta, si queréis, decid si encajaba con su nivel o marcadla como mala. «Revisar preguntas» sirve para valorar sin jugar, y ahí también podéis decir qué nivel le pondríais (o una horquilla: «entre un 4 y un 5»).
2. **Exportar.** En «Datos y exportación» → «Exportar datos». Envíate el archivo y cópialo en `analisis/datos/`. Hazlo al acabar cada quedada: hasta entonces los datos solo están en el móvil, y en iPhone Safari borra los de las webs no instaladas que no se abren en 7 días.
3. **Calibrar.**
   ```bash
   py analisis/calibrar.py
   ```
   Escribe `app/data/ajustes.json` (niveles corregidos y preguntas retiradas) y un informe en `analisis/salida/informe.md`. Con `--seco` solo genera el informe.
4. **Publicar.** Sube el nuevo `ajustes.json` a GitHub, en `app/data/`, sustituyendo al anterior (en la web: entra en esa carpeta y *Add file → Upload files*). El móvil lo recogerá en la siguiente apertura con conexión.

Qué hace el modelo y por qué: [PLAN.md, sección 3](PLAN.md#3-cómo-mejora-el-modelo-con-el-tiempo).

### Practicar sin datos reales

```bash
py analisis/simular_partidas.py
py analisis/calibrar.py --datos analisis/simulados --seco
```

La simulación genera partidas con niveles reales conocidos (en `analisis/simulados/verdad.csv`) para ver cómo los recupera la calibración. Nunca escribe en `analisis/datos/`. Ojo: `--seco` no toca `ajustes.json`, pero sí sustituye el informe de `analisis/salida/`; vuelve a calibrar con tus datos para recuperarlo.

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

## Geohistoria: preguntas de mapa

La quinta categoría se responde tocando un mapa. Cada pregunta tiene una zona de acierto alrededor del sitio: dentro, sumas lo que arriesgaste menos un punto por cada «paso» que te alejes (el paso es más corto cuanto más arriesgas); fuera, nada (las reglas exactas, en «Cómo se juega» y en [docs/esquema_datos.md](docs/esquema_datos.md)). Las preguntas están en `app/data/preguntas/geohistoria.json` y llevan `lat`, `lon` y `distancia_max_km`; el generador con IA no las hace.

El mapa (`app/data/mapa.json`, unos 240 KB) sale de los países de [Natural Earth](https://www.naturalearthdata.com/) 1:50m, de dominio público. Para regenerarlo (por ejemplo, con otra simplificación), descarga `ne_50m_admin_0_countries.geojson` de su repositorio en GitHub y:

```bash
py herramientas/generar_mapa.py ruta/ne_50m_admin_0_countries.geojson
```

---

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
| Motor del juego (reglas, selección, deshacer, preguntas de mapa, 350 partidas simuladas y 200 con acciones al azar) | `node --test "tests/**/*.test.js"` |
| Validador del banco y versionado de archivos | `py -m unittest discover -s herramientas` |
| Banco de preguntas, rondas y finales | `py herramientas/validar_banco.py` |
| Generador (con un cliente simulado: no gasta API) | `py -m unittest discover -s generador` |
| Calibración, simulador y modelo filtro | `py -m unittest discover -s analisis` |

Todo es Python (con numpy y scipy) salvo la app, que es JavaScript. R ya no hace falta: la calibración se pasó a Python en la fase 13, comprobando antes que daba los mismos resultados.

---

## Estructura

```
app/                 la app (lo que se publica)
  js/motor.js          reglas del juego (puro, con tests)
  js/geo.js            distancias, puntos y proyección de las preguntas de mapa
  js/mapa.js           el mapa interactivo de Geohistoria
  js/banco.js          selección de preguntas y alternativas
  js/sesion.js         deshacer y guardado
  js/almacen.js        localStorage + IndexedDB
  js/pantallas/        una por pantalla
  data/                configuración, banco, rondas, finales, ajustes y control de versiones
tests/               tests del motor (Node)
herramientas/        validador del banco, versionado de archivos, generador del mapa y de los iconos
analisis/            calibración, informe, simulador y modelo filtro (datos/ para las exportaciones)
generador/           generación de preguntas con IA (Python)
docs/                rúbrica, formato de datos y guías de las primeras partidas y de la prueba en el móvil
```
