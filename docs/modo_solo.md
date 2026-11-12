# Modo solo: el reto del día

Fase 27, decidida con el usuario el 5 de noviembre de 2026. Lo que decidió él va marcado con **(usuario)**; lo demás lo decidió Claude, con Codex como auditor externo, y es **revisable**. El formato de los datos está en [esquema_datos.md](esquema_datos.md).

## Reglas

- **Escalera del 1 al 10 (usuario).** Diez preguntas: la primera, de nivel 1; la décima, de nivel 10.
- **Bote.** Cada acierto suma los puntos de su escalón, `config.solo.puntos` (10 × nivel: «cada acierto suma su nivel», **usuario**), por el multiplicador de velocidad, redondeado.
- **Fallar pierde todo el bote (usuario)**, y quedarse sin tiempo cuenta como fallar.
- **Plantarse (usuario).** Antes de cada pregunta (desde la segunda) se ve su nivel, su categoría y su subtema, cuánto tiempo hay y entre cuántos puntos vale, y se decide: seguir o plantarse con el bote. Acertar la décima termina la escalera con el bote entero.
- **Velocidad (usuario).** El multiplicador empieza en ×2 al mostrar la pregunta y baja en línea recta hasta ×1 cuando se acaba el tiempo (`multiplicador_max`). Tiempos (revisable): texto, de 20 s (niveles 1 y 2) a 40 s (nivel 10), en `config.solo.segundos`; Mates y lógica, los de su cronómetro de la partida (de 45 s a 1 min 15 s); mapa, 30 s hasta el nivel 5 y 40 s desde el 6 (`segundos_mapa`).
- **8 opciones (usuario).** La correcta y 7 incorrectas, barajadas. La app corrige sola. Que en el 9 o el 10 se pueda acertar al azar un 12,5 % no importa: «habrá tenido que acertar la 5, 6, 7, 8». Las de Localízalo se responden en el mapa, como en la partida.
- **El reto del día (usuario).** Las mismas 10 preguntas, con las opciones en el mismo orden, para todos los que juegan ese día. Se juega una vez por jugador y día (cuenta desde que se ve la primera pregunta). Al acabar se comparte el resultado: fecha, tema, un emoji por escalón (⚡ acierto rápido, ×1,5 o más; 🟩 acierto; 🟥 fallo; ⏰ sin tiempo; ✋ plantado; 🏆 completa), los puntos y la dirección de la app, sin respuestas.
- **El día** es el de España (`zona_horaria`), no el del móvil, y se fija al tocar «Jugar»: una escalera empezada antes de medianoche sigue siendo del día anterior.
- **Días temáticos: dos por semana (usuario)**, miércoles y domingo (revisable cuáles). Todo el reto es de una categoría del tablero, de Localízalo o de un tema, por turnos (`temas_dia`). Los demás días se mezclan: 2 preguntas de cada categoría del tablero, 1 de Localízalo y 1 más de la categoría de texto menos usada, en escalones al azar (revisable).
- **Práctica (usuario: reto + práctica).** Escaleras con preguntas al azar, todas las que se quiera, de todas las categorías del tablero o de una (o de un tema), mejor sin ver. Nunca salen preguntas de los retos de hoy en adelante.
- Lo jugado a solas cuenta como pregunta vista: no saldrá en una partida mientras queden otras sin ver.
- **Una escalera a medias por móvil.** Si se cierra la app, se retoma donde estaba. Con una pregunta en pantalla, el tiempo sigue corriendo: al volver queda lo que quede, o es un fallo. Atrasar el reloj del móvil no devuelve tiempo.
- En el menú: racha de días seguidos con el reto jugado, mejor reto y mejor práctica de cada jugador.

### Puntos y plantarse (decidido: 10 × nivel, **usuario**, 5-11-2026)

Con 10 × nivel, a un jugador medio le compensa plantarse pronto. Con las probabilidades de la tabla objetivo, más lo que se acierta al azar con 8 opciones (entre 1/8 y 0,3 de lo que no se sabe), la estrategia con más puntos esperados es plantarse **antes del escalón 5** (unos 54-68 puntos de media). Si los puntos se doblaran en cada escalón (10, 20, 40… 5120), compensaría llegar **al 6, 7 u 8**. En un reto entre amigos, donde importa ganar a los demás y no la media, la gente arriesgará más de lo que dice el cálculo. Es una línea de `config.json` (`solo.puntos`). Visto el cálculo, el usuario decidió mantener 10 × nivel.

## Datos

- **Opciones:** `app/data/opciones/<archivo>.json`, una por archivo del banco con preguntas de texto. Solo valen para la versión `v` de la pregunta: si se reescribe, no sale a solas hasta rehacerlas. Las generó Codex lote a lote, con las instrucciones de `herramientas/opciones_instrucciones.md`; otra pasada de Codex las auditó (opciones defendibles, opciones que regalan la respuesta), y Claude las revisó por muestras y con `herramientas/validar_opciones.py`. Las preguntas que no funcionan con opciones (sobre todo acertijos con dos o tres respuestas posibles) están en `no_aptas`.
- **Calendario:** `app/data/retos.json`, de `herramientas/generar_retos.py`. 42 días por delante (con 84, a la práctica le quedaban niveles vacíos). Los días ya publicados no cambian. Una pregunta del calendario que se retire (o se quede sin opciones) la sustituye la app por otra de su categoría y nivel, elegida con la fecha como semilla entre las que no han salido en ningún reto hasta ese día, así que ampliar el calendario no la cambia. Si el calendario se acaba, la app arma el reto con la fecha como semilla (igual en todos los móviles con la misma versión del banco): mejor ampliarlo antes.
- **Carga:** las opciones y el calendario se descargan al entrar por primera vez en «Jugar solo» (no retrasan el arranque) y el service worker los guarda para jugar sin conexión. Todo o nada: con un archivo a medias, el reto de hoy saldría distinto.
- **Registros:** `solo` (cada pregunta respondida) y `solo_fin` (cada escalera), con ids fijos (la escalera y su escalón, o `fin`): al retomar una escalera se vuelven a guardar sin duplicarse, y la escalera terminada no se borra hasta guardar su registro final y su resumen. La calibración no los usa todavía: con 8 opciones, el azar, el descarte y la velocidad cambian la dificultad, así que habría que calibrarlos aparte.
- **El final, al momento (12-11-2026):** el registro `solo_fin` se guarda al responder la pregunta que acaba la escalera (o al plantarse) y, con el envío aceptado, sale entonces, sin esperar a «Ver el resultado»: en la hoja había escaleras que llegaron dos días tarde, cuando su jugador volvió a abrir la app, y las de quien no volvió no llegaron.
- **Opinar sobre la dificultad (12-11-2026):** bajo el resultado de cada pregunta, «¿Te ha parecido de nivel N?» con «Más fácil», «Sí» y «Más difícil». Es opcional y no frena la escalera; se guarda como una valoración con `origen: "solo"` (docs/esquema_datos.md) al tocar «Continuar».
- **Envío:** al acabar la primera escalera se pregunta una vez si se envían las partidas a solas; la respuesta se recuerda y se puede cambiar en «Datos y exportación». Hace falta desplegar la versión nueva del Apps Script (acepta `solo` y `solo_fin`); mientras no se despliegue, esos registros no se envían, pero no frenan los de las partidas, que van antes y en tandas aparte.

## Lo que no se puede evitar

Es una competición de confianza: sin servidor, nadie impide borrar los datos del navegador para repetir el reto, jugarlo en dos móviles o buscar en internet mientras corre el tiempo. Lo que sí está cubierto: cerrar la app no deja repetir ni para el tiempo, y atrasar el reloj no lo devuelve.
