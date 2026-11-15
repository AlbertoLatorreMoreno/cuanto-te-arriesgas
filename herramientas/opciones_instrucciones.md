# Opciones incorrectas para «¿Cuánto te arriesgas?»

Hola, Codex. «¿Cuánto te arriesgas?» es un juego de preguntas en español de España. En su modo solo cada pregunta se responde eligiendo entre **8 opciones**: la correcta y **7 incorrectas**. Tu parte es escribir las 7 incorrectas de cada pregunta. Después se revisa tu trabajo con un validador (`herramientas/validar_opciones.py`) y a mano. Gracias.

## Lo que recibes

Al final de este mensaje, en un bloque `<stdin>`, va el lote: unas 40 preguntas de una categoría. Cada una trae `id`, `v` (versión), `nivel` (1 = facilísima, 10 = solo la acierta un 4 % de la gente), `pregunta`, `respuesta` (la correcta), `tambien_vale` (otras formas de la correcta), a veces `criterio` (cómo se juzga; a menudo dice «No vale X»: X es la trampa típica) y `explicacion`.

## Lo que entregas

Tu **mensaje final** es solo un objeto JSON válido (sin ``` ni texto antes o después), con esta forma exacta:

```json
{
  "lote": "<lote>",
  "opciones": {
    "cie-bio-01": { "v": 1, "incorrectas": ["…", "…", "…", "…", "…", "…", "…"] },
    "cie-bio-02": { "v": 1, "correcta": "Oxígeno", "incorrectas": ["…"] }
  },
  "no_aptas": {
    "cie-xxx-99": "motivo breve"
  },
  "dudas": {
    "cie-yyy-07": "creo que la respuesta del banco está mal porque…"
  }
}
```

- Cada pregunta del lote va o en `opciones` o en `no_aptas`, nunca en las dos ni en ninguna.
- `v` se copia de la entrada.
- `correcta` es opcional: úsalo solo si `respuesta` no sirve tal cual como texto de un botón (tiene paréntesis o aclaraciones, es muy larga, o tiene un formato distinto al de las incorrectas). Debe decir lo mismo que `respuesta`, más corto. Si `respuesta` ya sirve, no lo pongas.

## Reglas de las incorrectas

1. **Exactamente 7**, todas **incorrectas sin ninguna duda**, también para un experto. Ninguna puede ser correcta en otra interpretación de la pregunta, ni una forma distinta de decir la respuesta (sinónimo, nombre alternativo, traducción, abreviatura, la misma cifra en otra unidad), ni algo que esté en `tambien_vale`.
2. **Del mismo tipo y formato que la correcta**: si es una persona, 7 personas; una ciudad, 7 ciudades; un año, 7 años; un número con unidad, la misma unidad; el mismo estilo de artículo («El hígado» → «El páncreas», «La vesícula biliar»…), de longitud parecida. Que la correcta no destaque por ser la única larga, la única con artículo, la única redonda, etc.
3. **Verosímiles y con la dificultad del nivel**: en los niveles 1 a 4 tienen que poder descartarse sabiendo la respuesta «más o menos» (quien la sabe no debe dudar por culpa de las opciones); en niveles altos, muy cercanas (personas de la misma época y campo, ciudades del mismo país, cifras próximas). Nada de opciones de broma, absurdas o imposibles de un vistazo, salvo en los niveles 1 a 3 de los temas (no del tablero): ahí pueden ser graciosas o disparatadas, como pidió el usuario el 15-11-2026, menos en los temas serios (Segunda Guerra Mundial; terrorismo, Vietnam y medicamentos de Sorpresa).
   - **Años y cantidades en los niveles 1 a 4** (fuera de Mates; el validador lo exige): en «¿En qué año…?», ninguna incorrecta a menos de 5 años de la correcta y como mucho dos a menos de 10 (en el nivel 4: ninguna a menos de 3 y como mucho dos a menos de 5). Para la llegada a la Luna (1969) valen 1945, 1957, 1961, 1975, 1981, 1989 y 1992; no valen 1967, 1968 ni 1970. En «¿Cuántos…?», si la respuesta es 20 o más, ninguna incorrecta a menos de un 10 % de la correcta (un 5 % en el nivel 4): para 206 huesos, 156 o 256, no 196 ni 216. Las cuentas pequeñas («8 peones») sí llevan los números de al lado.
   - En esos niveles tampoco nombres casi iguales al correcto ni numeraciones seguidas («La Orden 65» y «La Orden 67» para «La Orden 66»).
4. **La trampa del `criterio`**: si dice «No vale X» y X es un valor del mismo tipo que la respuesta, X debe estar entre las incorrectas. Si el criterio da un margen («Vale entre 7 y 7,3»), todas las incorrectas quedan claramente fuera de ese margen.
5. **Números** con formato español (coma decimal: «2,25»; miles sin separador o con punto en números grandes, coherente con la correcta). Usa errores típicos (el doble, la mitad, uno de más o de menos, confundir área y perímetro, sumar en vez de multiplicar…) y cifras cercanas (salvo lo dicho en la regla 3 para los niveles 1 a 4), nunca dos opciones iguales con distinto formato.
6. Prohibido: «Ninguna de las anteriores», «Todas», «No se sabe», opciones que contengan la respuesta correcta dentro (p. ej. «Quito Viejo» si la respuesta es «Quito») o que la contradigan obviamente con el propio enunciado.
7. **Cortas**: lo ideal es menos de 30 caracteres y nunca más de 60, porque se muestran como botones en un móvil, de dos en dos.
8. Las 7 distintas entre sí (también sin tildes ni mayúsculas) y distintas de la correcta.
9. Ortografía impecable en español de España, con tildes.

## Cuándo una pregunta es «no apta»

Ponla en `no_aptas` con un motivo breve si con 8 opciones deja de tener sentido: pide varias cosas a la vez («nombra tres…») que no caben en un botón, la respuesta es una explicación larga, o las opciones la regalarían sin remedio (p. ej., la pregunta es «¿sí o no?»). No abuses: casi todas deberían ser aptas.

## Cómo trabajar

No necesitas herramientas ni archivos: todo lo que hace falta está aquí. Lee el lote entero y piensa cada pregunta. Comprueba también que la respuesta del banco es correcta: si crees que está mal o es dudosa, haz igualmente sus opciones y explícalo en `dudas` (si no hay ninguna, `"dudas": {}`). Antes de contestar, repasa que el JSON es válido y que cada pregunta tiene exactamente 7 incorrectas.
