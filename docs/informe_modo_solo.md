# Modo solo: informe de la fase 27

Del 5 de noviembre de 2026. Reglas y decisiones en [modo_solo.md](modo_solo.md).

## Las opciones

- **1021 preguntas de texto con sus 7 incorrectas** y 29 que no funcionan con opciones (`no_aptas`, con el motivo), de 1050. Las 120 de Localízalo se juegan en el mapa.
- Las generó Codex en 26 lotes. En una segunda pasada, Codex auditó 26 lotes y corrigió 74 preguntas: incorrectas defendibles (el ARN como «molécula que guarda la información genética», el retículo endoplasmático rugoso como «orgánulo que fabrica las proteínas», Eris como «décimo planeta»…), opciones que regalaban la respuesta (la única con artículo, con número o en plural) y algunas absurdas.
- `herramientas/validar_opciones.py`: 0 errores y 37 avisos, revisados a mano (familiares con el mismo apellido, como Ralf Schumacher, o variantes como Red Dead Revolver: trampas legítimas en niveles altos).

Preguntas que se pueden jugar a solas, por categoría y nivel:

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Ciencias | 20 | 20 | 20 | 18 | 19 | 19 | 19 | 20 | 19 | 19 | 193 |
| Historia y geografía | 19 | 19 | 20 | 20 | 19 | 20 | 20 | 20 | 20 | 20 | 197 |
| Entretenimiento | 20 | 20 | 20 | 19 | 20 | 20 | 20 | 20 | 18 | 20 | 197 |
| Mates y lógica | 17 | 18 | 20 | 20 | 17 | 19 | 20 | 20 | 18 | 18 | 187 |
| Localízalo | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 120 |
| Harry Potter | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 39 |
| Star Wars | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 40 |
| Marvel | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 39 |
| Juego de tronos | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 40 |
| Segunda Guerra Mundial | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 40 |
| Sorpresa | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 5 | 49 |

## Dudas de Codex sobre el banco

Al hacer y auditar las opciones, Codex señaló 55 preguntas cuya respuesta es discutible o cuyo enunciado admite otra respuesta. No se ha tocado el banco: cambiar el texto de una pregunta obliga a subir su versión (y a rehacer sus opciones), y es decisión del usuario. Algunas son de peso (una respuesta que no es la única correcta); otras, matices.

- **cie-ast-14** (Ciencias, nivel 7): «¿Cómo se llama el límite alrededor de un agujero negro del que ni la luz puede escapar?» → Horizonte de sucesos
  - La respuesta es correcta, pero la explicación necesita un matiz: el tamaño del horizonte también depende de la rotación y, en general, de la carga eléctrica del agujero negro.
- **cie-bio-05** (Ciencias, nivel 2): «¿Qué molécula guarda la información genética de los seres vivos?» → El ADN
  - El ADN es correcto, pero el enunciado también permite defender el ARN. Conviene preguntar por el material hereditario de los organismos celulares.
- **cie-bio-09** (Ciencias, nivel 5): «¿Cuántos cromosomas tiene una célula humana normal que no sea un gameto?» → 46
  - 46 es lo esperado para una célula somática diploide, pero el enunciado incluye células humanas normales sin cromosomas, como los eritrocitos maduros, y células poliploides. Conviene especificar «célula somática diploide».
  - No todas las células humanas normales que no son gametos tienen 46 cromosomas: los eritrocitos maduros carecen de ellos y existen células normalmente poliploides. Debe especificarse una célula somática diploide nucleada.
- **cie-bio-11** (Ciencias, nivel 6): «¿Cómo se llama la división celular que produce los gametos?» → Meiosis
  - Conviene especificar «en los animales»: en las plantas, la meiosis produce esporas y los gametos se forman por mitosis.
  - La meiosis produce gametos en el ciclo animal, pero en las plantas produce esporas y los gametos se forman por mitosis. El enunciado debe acotarse a los animales.
- **cie-bio-28** (Ciencias, nivel 4): «¿A qué reino de los seres vivos pertenecen las setas y los mohos?» → Hongos
  - Para completar siete distractores he combinado nombres de reinos de distintos sistemas taxonómicos. Protistas y Protozoos tienen circunscripciones solapadas; no son siete reinos alternativos de una única clasificación.
- **cie-bio-37** (Ciencias, nivel 9): «¿Cómo se llama la muerte celular programada, con la que el cuerpo elimina las células que ya no necesita?» → Apoptosis
  - La apoptosis es una forma de muerte celular programada, pero existen otras. Conviene preguntar por la forma que elimina células mediante fragmentación en cuerpos apoptóticos.
- **cie-bio-40** (Ciencias, nivel 10): «¿Cómo se llama la proteína, sacada de una medusa, que se usa en los laboratorios para hacer brillar las células?» → Proteína verde fluorescente
  - La respuesta prevista es correcta, pero «hacer brillar» también puede describir el uso de la aequorina, otra proteína de medusa empleada en células. Añadir «con fluorescencia verde» haría inequívoca la pregunta.
- **cie-cue-20** (Ciencias, nivel 9): «¿Cómo se llaman los grupos de células que producen la insulina?» → Islotes de Langerhans
  - Los islotes son la respuesta esperada, pero «células beta» también responde razonablemente al enunciado: son las que producen insulina. No las incluyo como incorrecta. Conviene preguntar por las agrupaciones endocrinas del páncreas.
  - La exclusión tajante de «células beta» es discutible: son las células que producen insulina dentro de los islotes. Conviene preguntar expresamente por las agrupaciones endocrinas del páncreas. El aviso no justifica añadir «células beta» como incorrecta.
- **cie-cue-28** (Ciencias, nivel 4): «¿Qué grupo sanguíneo se considera el donante universal?» → 0 negativo
  - Conviene precisar «donante universal de glóbulos rojos». Para donar plasma, el grupo universal es AB, lo que permite otra interpretación del enunciado.
  - «Donante universal» depende del componente transfundido. 0 negativo corresponde a glóbulos rojos; AB, a plasma. El enunciado permite ambas interpretaciones.
- **cie-cue-30** (Ciencias, nivel 6): «¿Cómo se llama el músculo más grande que tenemos?» → El glúteo mayor
  - «Más grande» no define una medida. El dorsal ancho es defendible por superficie. El cuádriceps femoral también se describe anatómicamente como un músculo con cuatro cabezas, por lo que descartarlo únicamente por ser un grupo no es un criterio sólido.
- **cie-fis-14** (Ciencias, nivel 7): «¿A cuántos metros por segundo viaja aproximadamente el sonido en el aire?» → 340 m/s
  - Falta indicar la temperatura: 340 m/s corresponde aproximadamente a 15 °C. Algunas incorrectas pueden ser velocidades válidas a otras temperaturas, aunque quedan fuera del margen del criterio. Añadir «a unos 15 °C» al enunciado.
  - 340 m/s es una aproximación habitual a temperatura ambiente, pero la velocidad depende de la temperatura. Sin especificarla, no se justifica aceptar exclusivamente valores entre 330 y 350 m/s.
- **cie-fis-39** (Ciencias, nivel 10): «¿Qué físico neerlandés licuó el helio por primera vez y descubrió la superconductividad en 1911?» → Heike Kamerlingh Onnes
  - La respuesta es correcta, pero la primera licuefacción del helio fue en 1908; 1911 corresponde al descubrimiento de la superconductividad. Conviene separar las fechas en el enunciado.
- **ent-dep-27** (Entretenimiento, nivel 4): «¿Cuántos sets hay que ganar para llevarse un partido masculino de un torneo de Grand Slam?» → 3
  - Conviene especificar «un partido individual masculino». En dobles masculinos de Grand Slam se puede ganar con dos sets; he omitido el 2 para evitar una opción defendible.
  - Tres corresponde a individuales masculinos. Los partidos de dobles masculinos de Grand Slam se ganan con dos sets; el enunciado también los incluye.
- **ent-ser-11** (Entretenimiento, nivel 6): «¿Cómo se llama el jefe de la oficina de Scranton en la versión estadounidense de «The Office»?» → Michael Scott
  - Michael Scott es correcto, pero la oficina de Scranton tiene otros jefes durante la serie. Conviene preguntar por el jefe interpretado por Steve Carell.
  - Falta acotar la etapa: Michael Scott dirige Scranton durante las primeras temporadas, pero Andy Bernard y Dwight Schrute, entre otros, también ocupan el puesto. Conviene especificar «al comienzo de la serie».
- **ent-ser-38** (Entretenimiento, nivel 10): «¿Cómo se llama la cárcel de mujeres donde transcurre la serie española «Vis a vis»?» → Cruz del Sur
  - Cruz del Sur es correcto para las dos primeras temporadas; después la acción se traslada a Cruz del Norte. Conviene precisar «en las dos primeras temporadas».
  - Cruz del Sur corresponde a las dos primeras temporadas; en la tercera y la cuarta la prisión es Cruz del Norte. Conviene especificar «en las dos primeras temporadas».
- **ent-vid-01** (Entretenimiento, nivel 1): «¿Cómo se llama el fontanero bigotudo de Nintendo?» → Mario
  - Luigi también es un fontanero bigotudo de Nintendo. Añadir «que viste de rojo» haría inequívoca la pregunta.
- **ent-vid-09** (Entretenimiento, nivel 5): «¿Cómo se llama el protagonista de la saga «The Legend of Zelda»?» → Link
  - Zelda protagoniza The Legend of Zelda: Echoes of Wisdom, por lo que el criterio resulta demasiado absoluto. Conviene preguntar por el héroe que suele portar la Espada Maestra.
  - Link es la respuesta habitual, pero Zelda también protagoniza entregas de la saga. El criterio «No vale Zelda: es la princesa» no basta para excluirla.
- **ent-vid-30** (Entretenimiento, nivel 5): «¿Qué juego de disparos por equipos enfrenta a terroristas y antiterroristas?» → Counter-Strike
  - La descripción también encaja con otros juegos, como varios Rainbow Six. Añadir que nació como una modificación de Half-Life permitiría identificar Counter-Strike sin ambigüedad.
- **ent-vid-34** (Entretenimiento, nivel 7): «¿Cómo se llama el soldado protagonista de la saga «Metal Gear Solid», experto en esconderse en cajas de cartón?» → Solid Snake
  - La saga tiene varios protagonistas: Big Boss también se esconde en cajas. Conviene concretar «Metal Gear Solid de 1998» para identificar inequívocamente a Solid Snake.
  - La descripción no distingue inequívocamente a Solid Snake: Naked Snake y Venom Snake también protagonizan entregas de Metal Gear Solid y se esconden en cajas de cartón.
- **har-lib-10** (Harry Potter, nivel 10): «¿Qué número tiene la cámara de Harry en el banco de Gringotts?» → 687
  - El número 687 corresponde a las películas; las novelas no especifican el número de la cámara de Harry. Conviene indicarlo en la pregunta y cambiar el subtema «Los libros».
- **har-pel-09** (Harry Potter, nivel 9): «¿Qué actor puso la voz al elfo Dobby?» → Toby Jones
  - Toby Jones es la voz de Dobby en la versión original en inglés. Conviene precisarlo en el enunciado, porque en el doblaje de España lo interpreta otro actor.
- **his-ant-09** (Historia y geografía, nivel 5): «¿Qué ciudad fue la capital del Imperio bizantino?» → Constantinopla
  - El criterio exige incluir Bizancio, pero es un nombre histórico de la misma ciudad. Lo he omitido para respetar la prohibición de usar nombres alternativos de la correcta; conviene retirar esa exigencia del criterio.
  - Excluir Bizancio por ser un nombre anterior y admitir Estambul resulta discutible: ambos designan la misma ciudad. El aviso no exige añadir Bizancio a las incorrectas.
- **his-ant-14** (Historia y geografía, nivel 7): «¿Qué emperador romano mandó construir una muralla de lado a lado del norte de Britania?» → Adriano
  - La descripción también encaja con el muro de Antonino, construido por orden de Antonino Pío. Para identificar inequívocamente a Adriano, conviene especificar que la muralla iba del río Tyne al fiordo de Solway.
- **his-ant-18** (Historia y geografía, nivel 7): «¿Qué documento firmó el rey inglés Juan sin Tierra en 1215 para limitar su propio poder?» → La Carta Magna
  - La respuesta es correcta, pero Juan sin Tierra no firmó la Carta Magna: la autenticó con su sello. Conviene sustituir «firmó» por «selló».
  - Juan sin Tierra selló la Carta Magna; no la firmó. La respuesta es correcta, pero el verbo del enunciado es inexacto.
- **his-con-17** (Historia y geografía, nivel 9): «¿Qué país fue el primero de Europa en reconocer el voto de las mujeres en elecciones nacionales, en 1906?» → Finlandia
  - Conviene precisar sufragio femenino universal e igualitario. Si se incluyen territorios autónomos europeos, la isla de Man ya concedió el voto a determinadas mujeres en 1881.
- **his-con-20** (Historia y geografía, nivel 10): «¿Qué antiguo esclavo dirigió la revolución de Haití a finales del siglo XVIII?» → Toussaint Louverture
  - Toussaint Louverture es correcto, pero el enunciado admite otros dirigentes que habían sido esclavos, como Jean-François Papillon o Georges Biassou. Añadir que murió preso en Francia en 1803 permitiría identificarlo de forma inequívoca.
- **his-esp-06** (Historia y geografía, nivel 2): «¿Qué pueblo dominó buena parte de la península ibérica durante casi ocho siglos en la Edad Media?» → Los musulmanes
  - La respuesta es válida, pero los musulmanes no constituyen un único pueblo y no dominaron buena parte de la península durante los casi ocho siglos completos. Sería más preciso preguntar qué comunidad religiosa mantuvo reinos peninsulares entre 711 y 1492.
  - Los poderes musulmanes estuvieron presentes casi ocho siglos, pero no dominaron buena parte de la península durante todo ese periodo: desde el siglo XIII quedaron reducidos básicamente a Granada. Además, «Los omeyas» no es una equivalencia válida para el conjunto de ese dominio.
- **his-esp-25** (Historia y geografía, nivel 3): «¿Quién fue el primer presidente del Gobierno elegido en las urnas tras la dictadura, en 1977?» → Adolfo Suárez
  - Adolfo Suárez es la respuesta esperada, pero en 1977 se eligieron las Cortes, no directamente al presidente del Gobierno. Conviene preguntar quién continuó como presidente tras las primeras elecciones democráticas.
- **his-pai-35** (Historia y geografía, nivel 8): «¿Cuál es la capital de Honduras?» → Tegucigalpa
  - Tegucigalpa es la respuesta habitual, pero la Constitución establece que Tegucigalpa y Comayagüela constituyen conjuntamente la capital. Convendría precisar este matiz y admitir también la respuesta conjunta.
  - Tegucigalpa es la respuesta habitual, pero el artículo 8 de la Constitución establece que Tegucigalpa y Comayagüela, conjuntamente, constituyen la capital de Honduras. La respuesta del banco es incompleta en sentido constitucional.
- **his-rel-13** (Historia y geografía, nivel 7): «¿Cuál es el lago más grande de África?» → El lago Victoria
  - Victoria es el mayor por superficie; Tanganica, por volumen. El enunciado debe precisar «por superficie».
- **his-rel-32** (Historia y geografía, nivel 6): «¿Qué lago salado, entre Israel y Jordania, está en el punto más bajo de la superficie terrestre?» → El mar Muerto
  - Debe precisar «punto más bajo de las tierras emergidas»: la superficie terrestre también incluye fondos oceánicos más profundos.
- **his-rel-37** (Historia y geografía, nivel 10): «¿Qué lago es el mayor de toda Europa?» → El Ládoga
  - Conviene añadir «situado íntegramente en Europa» al enunciado. El mar Caspio, exigido como distractor por el criterio, es mayor y está parcialmente en Europa; su exclusión debe figurar en la pregunta.
  - Ládoga es el mayor lago situado íntegramente en Europa. Excluir el Caspio mediante «se considera aparte» no resuelve la ambigüedad de «toda Europa».
- **jue-act-07** (Juego de tronos, nivel 7): «¿En qué país se rodaron casi todas las escenas de más allá del Muro?» → Islandia
  - Islandia es una localización habitual, pero «casi todas» parece excesivo: también se rodaron escenas de más allá del Muro en Irlanda del Norte, como las de Casa Austera. Mejor preguntar qué país aportó los paisajes glaciares.
- **jue-act-08** (Juego de tronos, nivel 8): «¿Qué ermita sobre un islote de Vizcaya hizo de Rocadragón en la séptima temporada?» → San Juan de Gaztelugatxe
  - La localización es correcta, pero la ermita no representó el castillo de Rocadragón: se utilizaron el entorno y las escaleras de Gaztelugatxe, con el castillo añadido digitalmente.
- **jue-cas-10** (Juego de tronos, nivel 10): «¿Cómo se llamaba de verdad el mozo de cuadras de Invernalia que solo sabía decir una palabra?» → Wylis
  - Wylis es el nombre en la serie; en los libros se llama Walder. Conviene añadir «en la serie» al enunciado.
  - Wylis es su nombre en la serie; en los libros se llama Walder. El enunciado no especifica la versión.
- **jue-lib-04** (Juego de tronos, nivel 4): «¿Cómo se llama el rey enfermo con el que empieza «La casa del dragón»?» → Viserys
  - La serie comienza con Jaehaerys en el Gran Consejo. Viserys es el rey de la trama principal posterior; conviene precisar el enunciado.
- **jue-lib-09** (Juego de tronos, nivel 9): «¿Qué editorial barcelonesa publicó en España las novelas de Poniente de George R. R. Martin, con la traducción que todavía se lee?» → Gigamesh
  - El enunciado también permite Plaza & Janés: es barcelonesa y ha publicado las novelas con esa traducción. Para hacer inequívoca Gigamesh, añadir «originalmente» o preguntar qué editorial inició su publicación en España.
- **mat-log-05** (Mates y lógica, nivel 3): «Un granjero tiene 17 ovejas y se le mueren todas menos 9. ¿Cuántas le quedan?» → 9
  - 9 cuenta únicamente las ovejas vivas. El enunciado debería preguntar cuántas le quedan vivas para excluir 17.
- **mat-log-10** (Mates y lógica, nivel 4): «¿Cuántos meses del año tienen 28 días?» → Todos
  - 12 requiere interpretar «tienen 28 días» como «tienen al menos 28 días». Si significa exactamente 28, la respuesta es 1 en un año común y 0 en uno bisiesto.
- **mat-log-18** (Mates y lógica, nivel 7): «Fuera de una habitación hay tres interruptores y solo uno enciende la bombilla de dentro. Si solo puedes entrar una vez, ¿qué propiedad de la bombilla, además de la luz, usas para saber cuál es?» → El calor
  - La solución presupone una bombilla que conserve calor detectable tras apagarla. Conviene especificar que es incandescente para que el procedimiento resulte inequívoco.
- **mat-log-27** (Mates y lógica, nivel 5): «¿Cuántas veces puedes restarle 1 a 10?» → Una vez
  - «Una vez» depende de interpretar una cadena de restas sobre el resultado anterior. El enunciado también permite repetir la operación 10 − 1 cuantas veces se quiera, o restar sucesivamente hasta cero y responder «diez veces». Las opciones siguen la interpretación del banco, pero esta pregunta requiere revisión.
  - «Una vez» presupone restar únicamente al valor inicial, una restricción que el enunciado no establece. El criterio no elimina la interpretación válida de restas sucesivas.
- **mat-ser-30** (Mates y lógica, nivel 5): «Tras 11, 13, 17, 19 y 23, ¿qué número toca?» → 29
  - 29 continúa los primos consecutivos, pero 25 continúa la alternancia +2, +4. El criterio interno no elimina esa interpretación del enunciado visible.
- **mat-ser-39** (Mates y lógica, nivel 10): «Tras 2, 6, 30 y 210, ¿qué número toca?» → 2310
  - 2310 corresponde a multiplicar por primos consecutivos; 1890 corresponde a multiplicar por impares consecutivos. Ambas reglas encajan con todos los términos dados.
- **seg-eur-07** (Segunda Guerra Mundial, nivel 7): «¿Junto a qué ciudad soviética se libró en 1943 la mayor batalla de tanques de la historia?» → Kursk
  - La calificación de «mayor batalla de tanques de la historia» depende de cómo se delimiten y comparen Kursk, Projórovka y Brody. Conviene identificarla por la ofensiva alemana de julio de 1943 y evitar ese superlativo.
- **seg-eur-10** (Segunda Guerra Mundial, nivel 10): «¿En qué ciudad alemana, a orillas del Elba, se encontraron por primera vez soldados estadounidenses y soviéticos?» → Torgau
  - El primer contacto se produjo el 25 de abril de 1945 en Lorenzkirch, frente a Strehla. Torgau fue el escenario del encuentro más conocido. Conviene sustituir «por primera vez» por una referencia al célebre encuentro de Torgau.
  - El primer contacto entre soldados estadounidenses y soviéticos se produjo cerca de Strehla el 25 de abril de 1945, antes del encuentro de Torgau. Hay que reformular el enunciado si se mantiene Torgau como respuesta.
- **seg-per-05** (Segunda Guerra Mundial, nivel 5): «¿Qué mariscal soviético dirigió la toma de la capital alemana, en 1945?» → Gueorgui Zhúkov
  - Zhúkov es la respuesta habitual, pero Iván Kónev también dirigió tropas que tomaron Berlín. Para asegurar una respuesta única, convendría preguntar qué mariscal mandaba el Primer Frente Bielorruso durante la toma.
- **sor-leg-02** (Sorpresa, nivel 2): «¿Cómo se llaman los parques temáticos de la marca, con atracciones hechas con millones de piezas?» → Legoland
  - El enunciado dice «de la marca» sin nombrar LEGO. Si se muestra sin contexto, falta ese antecedente.
- **sor-leg-05** (Sorpresa, nivel 5): «¿Qué película de animación de 2014 tenía como canción «Todo es fantástico»?» → La LEGO película
  - En el doblaje de España, la canción se conoce como «Todo es fabuloso», no «Todo es fantástico». La película indicada sí es correcta.
- **sor-leg-07** (Sorpresa, nivel 7): «¿Qué gama de LEGO, con engranajes, ejes y motores, sirve para montar máquinas?» → Technic
  - Technic es válida, pero Mindstorms y Boost también permiten construir máquinas con engranajes, ejes y motores. Conviene añadir una característica exclusiva.
- **sor-med-09** (Sorpresa, nivel 9): «¿Qué planta de flores moradas, venenosa, usó en 1785 el médico William Withering para tratar la hidropesía?» → La dedalera
  - La dedalera es correcta, pero 1785 corresponde a la publicación de Withering sobre su uso. Sus tratamientos e investigaciones habían comenzado aproximadamente una década antes.
- **sor-sam-01** (Sorpresa, nivel 1): «¿Cómo se llama la espada larga y curva de los samuráis?» → Katana
  - La katana es válida, pero el tachi también es una espada larga y curva de los samuráis. Conviene precisar la descripción.
- **sor-vie-07** (Sorpresa, nivel 7): «¿Cómo se llamaba el herbicida tóxico con el que el ejército estadounidense deshojaba la selva?» → Agente Naranja
  - Agente Naranja es válido, pero también se emplearon otros herbicidas, como los agentes Blanco y Azul. La redacción no identifica uno de forma exclusiva.
- **sta-ori-09** (Star Wars, nivel 9): «¿Qué actor británico interpretaba a Darth Vader bajo el traje?» → David Prowse
  - David Prowse es el intérprete principal, pero el británico Bob Anderson también llevó el traje durante los duelos de los episodios V y VI. Conviene precisar que se busca al intérprete principal.
  - Falta acotar la interpretación principal en la trilogía original: Bob Anderson también llevó el traje en escenas de lucha, y los británicos Spencer Wilding y Daniel Naprous interpretaron físicamente a Vader en Rogue One.
- **sta-sec-04** (Star Wars, nivel 4): «¿Quién es el líder supremo de la Primera Orden en los episodios VII y VIII?» → Snoke
  - Snoke es correcto, pero Kylo Ren también se convierte en líder supremo al final del episodio VIII. Conviene precisar «en el episodio VII y al comienzo del VIII».
  - Snoke ocupa el cargo en ambos episodios, pero Kylo Ren se convierte en líder supremo al final del VIII. Conviene precisar que se pregunta por el líder anterior a Kylo Ren.
- **sta-ser-06** (Star Wars, nivel 6): «¿En qué país se rodaron las escenas de Tatooine de la primera película?» → Túnez
  - Túnez es correcto, pero también se rodaron escenas de Tatooine de la primera película en Death Valley, Estados Unidos. Conviene preguntar «¿En qué país africano…?».
  - Túnez es una respuesta válida, pero también se rodaron escenas de Tatooine de la primera película en Estados Unidos, en el Valle de la Muerte. El enunciado no determina un único país.
