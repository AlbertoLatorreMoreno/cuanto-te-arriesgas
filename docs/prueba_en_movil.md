# Prueba en el móvil (fase 12)

Dos partes: **ya, por wifi**, para probar el juego en la mano, y **al final, instalada desde GitHub Pages**, para lo que solo funciona con HTTPS (instalarla, jugar sin conexión, pantalla siempre encendida, compartir el archivo).

## 1. Ya, por wifi

### Abrirla

1. En el ordenador, desde la carpeta del proyecto (si no lo tienes ya en marcha):
   ```bash
   py -m http.server 8000 --directory app
   ```
   Así escucha en toda la red, no solo en el ordenador.
2. Con el móvil en la **misma wifi** que el ordenador, abre en el navegador del móvil:
   **http://<IP-del-ordenador>:8000**
   La IP puede cambiar si reinicias el router: la actual sale con `ipconfig` («Dirección IPv4» del adaptador Wi-Fi).

### Si el móvil no la abre: el cortafuegos

Tu wifi está marcada en Windows como **red pública**, y en las redes públicas Windows bloquea las conexiones que llegan a Python. Hay que cambiarlo tú, porque son ajustes de seguridad del sistema:

- **Recomendado, si es la wifi de casa:** márcala como privada. En Windows 10: *Configuración → Red e Internet → Wi-Fi → la de casa → Perfil de red: Privado*. Después, deja que Python reciba conexiones en redes privadas: la próxima vez que arranques el servidor, Windows preguntará; elige *Permitir acceso*. Si no pregunta (por ejemplo, porque ya lo rechazaste una vez): *Panel de control → Sistema y seguridad → Firewall de Windows Defender → Permitir una aplicación o una característica a través de Firewall de Windows Defender → Cambiar la configuración*, y en las filas de «Python» marca *Privada*.
- **No recomendado:** permitir Python también en redes públicas. Funciona, pero en cualquier wifi pública (una cafetería) cualquiera podría abrir lo que sirvas mientras el servidor esté en marcha.

Con el servidor parado no hay nada que ver desde fuera, así que no hace falta deshacer nada al terminar.

### Qué probar

Apunta el modelo del móvil y el navegador (y su versión, si la sabes). Para cada punto: ✅ o ❌ y qué pasó.

| # | Prueba | Qué tiene que pasar |
|---|---|---|
| 1 | Abrir la app | Carga en unos segundos; nada se sale de la pantalla |
| 2 | Nueva partida, 3 jugadores, pasando el móvil | Los nombres se escriben sin que la página haga zoom; «Empezar» se ve con el teclado cerrado |
| 3 | Jugar varios turnos | Los botones responden al primer toque; un doble toque rápido no salta pantallas |
| 4 | Una pregunta de Mates con cronómetro | Al acabarse suena (sube el volumen) y, en Android, vibra; en iPhone no vibra (Safari no deja) |
| 5 | Caer en una casilla ★ (ronda) | Una lista: tocar nombres rápido cuenta todos y la pantalla no se mueve. Una ráfaga: «Acertó» y «Pasa» van de una en una |
| 6 | «Deshacer» | Vuelve al paso anterior, también de un turno ya cerrado |
| 7 | Cerrar el navegador a mitad y volver a abrir la dirección | Sale «Continuar partida» y sigue donde estaba |
| 8 | Deslizar hacia abajo estando arriba del todo | No recarga la página |
| 9 | Botón «atrás» del móvil en mitad de la partida | Vuelve al inicio con el aviso «Partida guardada» |
| 10 | Una partida con narrador | No pide pasar el móvil |
| 11 | «Revisar preguntas» | Se valora y se pasa a la siguiente |
| 12 | Datos → Exportar | Por wifi se **descarga** el archivo (sin HTTPS no se puede compartir). Apunta dónde aparece |
| 13 | Datos → Jugadores recordados | Se abre la lista; «Olvidar» pide confirmación |
| 14 | Tema oscuro del móvil y letra grande en los ajustes del sistema | Todo se lee y nada se sale |
| 15 | Girar el móvil | Se juega, aunque en horizontal hay que desplazarse para apostar (está pensado en vertical) |

**Lo que por wifi no se puede probar** (necesita HTTPS): instalarla, jugar sin conexión, la pantalla siempre encendida, compartir el archivo al exportar y el almacenamiento persistente. Eso va en la parte 2.

**Los datos de esta prueba no se mezclan con los de verdad.** El móvil los guarda para la dirección `http://<IP-del-ordenador>:8000`, que es distinta de la de GitHub Pages. Si exportas desde aquí partidas de prueba, no copies ese archivo en `analisis/datos/`.

## 2. Al final: instalada desde GitHub Pages

Cuando publiques (pasos en el README), en el móvil:

1. Abre `https://<usuario>.github.io/<repositorio>/`.
2. Instálala. En Android (Chrome): menú ⋮ → *Instalar aplicación* (o *Añadir a pantalla de inicio*). En iPhone (Safari): *Compartir* → *Añadir a pantalla de inicio*.

| # | Prueba | Qué tiene que pasar |
|---|---|---|
| 1 | Abrirla desde el icono | Pantalla completa, sin la barra del navegador |
| 2 | Partida completa | Como en la parte 1 |
| 3 | Pantalla encendida | Durante la partida no se apaga sola |
| 4 | Modo avión y abrir la app | Carga y se juega una partida entera sin conexión |
| 5 | Exportar | Abre el menú de compartir (WhatsApp, correo…) con el archivo |
| 6 | Volver otro día | Los contadores de «Datos» siguen ahí |
| 7 | Publicar un cambio (por ejemplo, un `ajustes.json` nuevo) y abrir la app con conexión | La siguiente vez que se abre ya usa lo nuevo |

**Hecho cuando** una partida completa y una exportación funcionan con la app instalada y sin conexión.

## Cómo contar el resultado

Copia las tablas con ✅ o ❌ en cada fila, y una frase con lo que pasó cuando algo falle (mejor con una captura).
