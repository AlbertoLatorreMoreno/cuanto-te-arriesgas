# Primeras partidas: guía de prueba (fase 7)

Objetivo: comprobar que el juego funciona y es divertido, y reunir los primeros datos para calibrar.

## Antes de quedar

- [ ] La app abre en el móvil que vais a usar (publicada o por la wifi de casa: ver README).
- [ ] Si está publicada, instálala («Añadir a pantalla de inicio») y ábrela una vez con conexión. En iPhone es importante: Safari borra los datos de las webs que no se abren en 7 días, y las instaladas deberían quedar a salvo.
- [ ] Batería cargada: la pantalla se queda encendida durante la partida.
- [ ] Opcional: cada uno revisa 20–30 preguntas en «Revisar preguntas» (si lo tenéis claro, tocad el nivel que le pondríais en vez de «más fácil / más difícil»: dice más). Son valoraciones rápidas y muy útiles al principio, pero esas preguntas ya no le saldrán jugando mientras queden otras sin ver.

## Durante la partida

- Usad siempre los mismos nombres (o apodos): así el modelo reconoce a cada jugador.
- Valorad el nivel cuando lo tengáis claro, sobre todo si una pregunta parecía mucho más fácil o difícil de lo que decía.
- Si una pregunta está mal, «Cambiar pregunta» con el motivo. Si ya se ha jugado, marcadla como mala.
- Apuntad aparte lo que chirríe: reglas confusas, pantallas lentas, botones que se tocan sin querer, preguntas que dan pie a discusiones.
- Fijaos en el cronómetro de Mates y lógica: si los tiempos se quedan cortos o sobran, se cambian en `app/data/config.json` (`cronometro.segundos_por_nivel`, un número por nivel del 1 al 10). También se puede quitar al crear la partida.
- Al acabar la quedada, exportad los datos («Datos y exportación»): mientras no se exportan, solo están en ese móvil.

## Qué observar

| Pregunta | Dónde mirarlo |
|---|---|
| ¿Cuánto dura una partida corta y una media? | Reloj; el número de turnos sale al final |
| ¿Todos apostáis siempre entre 4 y 7? | Informe de calibración: tabla de apuestas |
| ¿La final es demasiado dura o demasiado fácil? | ¿Cuántos intentos hacen falta para acertarla? |
| ¿Los niveles se corresponden con los aciertos? | Informe: aciertos por nivel frente al objetivo |
| ¿Qué categorías os parecen más difíciles? | Informe: ajuste por categoría |
| ¿Las de mapa dan demasiados puntos, o casi ninguno? | En la partida, los «+N de M» del resultado; en el informe, el ajuste de Geohistoria |
| ¿Alguna ronda divertida da demasiadas casillas (o casi ninguna)? | Informe: sección «Rondas divertidas», con su aviso; se ajusta su tiempo en `app/data/rondas.json` (y se sube su `v`) |

## Después de 3–5 partidas

1. Exporta los datos y cópialos en `analisis/datos/`.
2. Primero en seco, para leer el informe sin cambiar nada:
   ```bash
   py analisis/calibrar.py --seco
   ```
3. Lee `analisis/salida/informe.md`: preguntas que cambian de nivel, retiradas y huecos.
4. Si te convence, calibra de verdad y publica `app/data/ajustes.json`:
   ```bash
   py analisis/calibrar.py
   ```
5. Ajusta parámetros si hace falta, en `app/data/config.json`:
   - Duración: `metas[].puntos`.
   - Dureza de la final: `metas[].paso_final` (más alto, final más fácil) y `final.nivel_base`.
   - Prudencia del modelo: `modelo.min_datos_cambio` (más alto, cambia menos), `modelo.sd_ajuste_pregunta` (más bajo, cambia menos) y `modelo.escala_valoracion` (más alto, las valoraciones pesan menos frente a los aciertos).

## Señales para las mejoras posteriores al MVP

- Casi todas las apuestas entre 4 y 7 → cartas de apuesta que se gastan.
- Muchos niveles vacíos o casi agotados en «Datos» → toca generar preguntas (README, sección del generador).
- Partidas que se alargan → meta más baja o casillas especiales que aceleren.
