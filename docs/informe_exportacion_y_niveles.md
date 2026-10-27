# Informe: exportación automática y niveles por valoraciones

*26 de octubre de 2026. Con los datos de `analisis/datos/` (exportaciones del 18, 24 y 25 de octubre).*

---

## 1. ¿Se pueden exportar los datos solos?

> **Hecho** (fase 21 de PLAN.md), con dos cambios sobre lo que se cuenta aquí. Los datos no van a una carpeta de Drive, sino a una **hoja de cálculo** con el script dentro: así Google solo le da permiso sobre esa hoja. Y nadie configura nada en el móvil: la dirección del script va en la app y, **al acabar cada partida, la app pregunta si se envían sus datos**. Como esa dirección es pública, enviar está abierto (con límites) y descargar exige un código que solo está en el ordenador. Pasos: README, «Envío de datos a la hoja del grupo».

**Sí, es viable y gratis**, pero hace falta un sitio donde dejarlos: la app es una web estática en GitHub Pages y no tiene servidor que los reciba. La opción que recomiendo es un **script de Google (Apps Script) que guarda las exportaciones en una carpeta de tu Drive**. Programarlo lleva alrededor de un día; tú solo tendrías que crear el script con tu cuenta (unos 10 minutos, con el código que te pase).

### Por qué hoy no es automático

- Los datos viven en el móvil (IndexedDB). Un navegador no deja guardar archivos ni mandar correos sin que toques algo: el botón «Exportar» abre el menú de compartir, y eso exige un toque.
- GitHub Pages solo sirve archivos; no puede recibir datos.

### Opciones

| Opción | Coste | Trabajo | A favor | En contra |
|---|---|---|---|---|
| **A. Un toque al acabar** (sin servidor): la pantalla final abre sola «Compartir» y el inicio avisa de lo que falta por exportar | 0 € | 1–2 h | Nada que crear ni mantener | No es automático: sigue habiendo que enviarse el archivo y copiarlo |
| **B. Apps Script + Drive** (recomendada) | 0 € | ~1 día | Los datos van a tu Drive (privados); no hay claves en el repositorio público; no caduca | Hace falta una cuenta de Google; la dirección del script es pública, y por eso lleva un código de grupo |
| C. Firebase (Firestore) | 0 € (plan gratuito) | 1–1,5 días | Base de datos de verdad, con reglas de «solo escribir» | Hay que crear el proyecto y configurar las reglas |
| D. Supabase | 0 € (plan gratuito) | 1–1,5 días | Como Firebase | El plan gratuito pausa el proyecto tras una semana sin uso |
| E. Repositorio privado de GitHub + token en el móvil | 0 € | 2 días | Lo más automático: una Action podría calibrar y proponer el `ajustes.json` sola | Un token con permiso de escritura en cada móvil, que además caduca; más piezas que mantener |

### Cómo funcionaría la opción B

1. **El script.** Creas un Apps Script con el código que te pase (unas 40 líneas), lo publicas como «aplicación web» y copias su dirección. Cada envío se guarda como un archivo en una carpeta de tu Drive.
2. **En cada móvil**, en «Datos»: activar «Enviar automáticamente» y pegar la dirección y el código del grupo. Se guardan en el móvil, nunca en el repositorio.
3. **La app envía** los registros nuevos al cerrar cada partida y al abrirse con conexión; sin red, espera a la siguiente vez. Reenviar no hace daño: la calibración ya elimina los registros repetidos por su id.
4. **En el ordenador**, `py analisis/descargar.py` (nuevo) deja los archivos en `analisis/datos/`, o Google Drive para escritorio los sincroniza solo. Después se calibra como siempre.

### Riesgos

- **Privacidad.** Los registros llevan los nombres de los jugadores. Irían solo a tu Drive, y la dirección del script sin el código no sirve para nada. El repositorio público sigue sin datos.
- **Basura.** El script comprobaría el código, el formato y el tamaño, y la calibración ya ignora lo que no es de la app.
- **iPhone y sin conexión.** No hay envío en segundo plano: se envía con la app abierta (al acabar la partida o al abrirla). La exportación manual se queda como respaldo.
- **Por comprobar al programarlo:** que el navegador deja leer la respuesta del script (las aplicaciones web de Apps Script redirigen a otra dirección; con una petición simple suele funcionar).

### Conclusión

Viable, sin coste y con poco trabajo. Lo único que no se puede automatizar es crear el script con tu cuenta. Publicar `ajustes.json` seguiría siendo un paso tuyo (solo la opción E lo quitaría).

---

## 2. ¿Niveles según lo que califique la gente, en vez de la regresión?

**No lo cambiaría:** las valoraciones solas no ven el problema que tienen ahora mismo los niveles. Pero la regresión, tal como se aplica, tampoco lo arregla. Lo rentable es un cambio pequeño en cómo se aplica.

### Qué dicen vuestros datos

60 respuestas (sin contar las finales) y 91 valoraciones:

- **Acertáis mucho más de lo que dice la tabla:** 50 de 60 (83 %), cuando la tabla esperaba 27. En los niveles 7 a 10, 21 de 26 (la tabla esperaba 6). Sale una media de 4,3 puntos por turno; el juego está pensado para que la mejor apuesta dé unos 2,5. Arriesgar casi no tiene riesgo.
- **Las valoraciones dicen que los niveles están bien:** en partida, 26 «Sí» y 6 «Era más fácil», ninguna «Era más difícil», aunque se acertaran preguntas de nivel 7 a 10. En «Revisar preguntas», 40 «Sí» y 19 horquillas que de media caen justo en el nivel que tenían (+0,05).
- Para que los aciertos cuadren con la tabla habría que **bajar todo el banco unos 4 o 5 niveles**. Con mucha cautela: son tres días de datos, hay partidas por equipos (aciertan más que una persona) y apostáis alto en los temas que conocéis, porque el tema se anuncia antes de apostar.

### Por qué las valoraciones solas no bastan

- **Anclaje:** se ve el nivel que tiene la pregunta y se tiende a decir «Sí».
- **Miden lo que parece**, no cuánto acierta el grupo, que es lo que equilibra el juego.
- **Quien la sabe la ve fácil:** acertarla cambia la impresión.
- **Cubren poco:** de 920 preguntas, solo 3 tienen dos valoraciones o más.

### Por qué la regresión, tal como está, tampoco lo arregla

- El modelo calcula un ajuste global (−0,93 niveles: el banco es más fácil de lo que dice) y otro por categoría, pero **solo se aplica a las preguntas con 3 datos o más**: hoy, 4 de 920 (y cambian 2). Las demás conservan su nivel inicial.
- Y ese −0,93 se queda corto porque las valoraciones, casi todas «Sí», tiran hacia los niveles actuales.

### Coste de cada camino

| | Regresión actual | Solo valoraciones | Regresión con el ajuste global aplicado (recomendada) |
|---|---|---|---|
| Código | Hecho y probado | Nuevo, sencillo | Unas 10 líneas en `calibracion.py`, con sus pruebas |
| ¿Ve que acertáis demasiado? | Sí, pero no lo aplica | No | Sí, y lo aplica |
| Ciclo | Exportar, calibrar, publicar | Igual (o lo podría calcular el móvil) | Exportar, calibrar, publicar |

El modelo ya está hecho: lo que cuesta es el ciclo de exportar, calibrar y publicar, y eso es igual en los dos caminos (y la exportación automática lo abarata).

### Recomendación

1. **Mantener la regresión**, que ya usa las valoraciones (también las horquillas) junto con los aciertos.
2. **Aplicar a todas las preguntas el ajuste global y el de su categoría**, y dejar el mínimo de 3 datos solo para el ajuste propio de cada pregunta. Con un tope (por ejemplo, 1 o 2 niveles por calibración) mientras haya pocos datos.
3. **Quitar el ancla en «Revisar preguntas»:** pedir el nivel que le pondríais antes de enseñar el que tiene.
