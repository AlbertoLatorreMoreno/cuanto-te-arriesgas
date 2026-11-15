# Preguntas de relleno retiradas, pendientes de revisar

El 15-11-2026, al hacer más fáciles y amenos los niveles bajos de los temas (PLAN.md, fila 72), se retiraron 175 preguntas de relleno: se acertaban sin saber nada del tema (por sentido común, por una pista del enunciado, por un título que se traduce solo) o repetían el dato de otra. Las propuso Codex y Claude las leyó una a una. El usuario decidió dejarlas fuera del juego hasta revisarlas él.

Cada una está entera, con sus opciones, en `herramientas/relleno_pendiente.json`: para devolver una al banco basta con volver a poner su pregunta en `app/data/temas/<tema>.json` y sus opciones en `app/data/opciones/<tema>.json`, con el mismo id y la misma `v` (el control de versiones lo acepta), y pasar `py herramientas/validar_banco.py --actualizar`. El nivel que aparece es el que tenía.


## Ajedrez (5)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| aje-his-61 | 1 | ¿Qué enfrentamiento político entre bloques sirvió de telón de fondo al duelo entre Fischer y Spassky de 1972? | La Guerra Fría | Se responde por historia política y las pistas, sin saber ajedrez. |
| aje-rec-61 | 1 | ¿Cuántas piezas rivales retira un caballo del tablero al realizar una captura? | 1 | La formulación de una captura individual prácticamente da la respuesta. |
| aje-his-69 | 2 | En «Harry Potter y la piedra filosofal», ¿qué amigo del protagonista dirige la partida de ajedrez con piezas gigantes? | Ron Weasley | Es de Harry Potter, no de ajedrez. |
| aje-tab-18 | 2 | ¿Cuántas diagonales de ocho casillas tiene un tablero de ajedrez? | 2 | Es una propiedad geométrica de una cuadrícula cuadrada, no un saber ajedrecístico. |
| aje-tab-17 | 3 | ¿Qué casilla está en la misma columna que c2 y en la misma fila que f6? | C6 | Basta combinar la letra y el número indicados; no exige saber ajedrez. |

## Aviación comercial (2)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| avi-tec-02 | 1 | ¿Cómo se clasifica un avión por su propulsión si tiene exactamente dos motores? | Bimotor | Se resuelve por el significado de «bi» y «motor», sin conocimientos de aviación. |
| avi-tec-76 | 1 | ¿Junto a qué elementos del avión se sitúan las filas cuyos pasajeros deben poder ayudar en una evacuación? | Las salidas de emergencia | La relación entre ayudar a evacuar y las salidas de emergencia es de sentido común. |

## El mundo del café (24)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| caf-beb-04 | 1 | ¿Qué instrumento permite medir cuánto dura una extracción de café? | El cronómetro | Se responde por la función general de un cronómetro, sin saber de café. |
| caf-beb-06 | 1 | ¿Con qué utensilio recoge y sorbe el catador pequeñas muestras de café de los cuencos? | La cuchara | El utensilio se deduce por sentido común, sin conocimientos de café. |
| caf-beb-11 | 1 | En las recetas de café usadas en España, ¿en qué unidad se expresa normalmente la temperatura del agua? | Los grados Celsius | Pregunta por la unidad habitual de temperatura en España, no por café. |
| caf-beb-12 | 1 | ¿Qué instrumento utiliza un catador para pesar la misma cantidad de café en todos los cuencos? | La balanza | Pesar con una balanza es conocimiento general, no cafetero. |
| caf-her-03 | 1 | ¿Qué fuerza hace que el agua atraviese el café en un filtro de goteo sin bomba? | La gravedad | Es física básica deducible del enunciado, no conocimiento del café. |
| caf-her-04 | 1 | ¿Qué filtro desechable, hecho con una hoja plegada, se utiliza habitualmente en las cafeteras de goteo? | El filtro de papel | El material del filtro queda prácticamente revelado por la descripción. |
| caf-her-05 | 1 | ¿Qué pieza se gira con la mano para accionar un molinillo manual? | La manivela | Pregunta por una pieza mecánica genérica, sin exigir saber de café. |
| caf-her-12 | 1 | ¿Qué filtro reutilizable tradicional de las cafeteras de sifón está confeccionado con un tejido? | El filtro de tela | La expresión «confeccionado con un tejido» revela que es de tela. |
| caf-ori-06 | 1 | ¿En qué continente se encuentra la región cafetera etíope de Guji? | África | Basta con saber que Etiopía está en África; es geografía ajena al café. |
| caf-pla-02 | 1 | ¿Qué parte del cafeto se abre antes de que pueda desarrollarse el fruto? | La flor | Es una regla general de las plantas con flores, no un dato cafetero. |
| caf-her-15 | 2 | ¿Qué dispositivo de seguridad de una cafetera italiana permite liberar una presión excesiva en la caldera? | La válvula | Liberar presión es la función general de una válvula de seguridad. |
| caf-ori-01 | 2 | ¿En qué país se cultivan los cafés de Minas Gerais y São Paulo? | Brasil | Se resuelve ubicando Minas Gerais y São Paulo, sin saber de café. |
| caf-ori-02 | 2 | ¿Qué país asiático, con capital en Hanói, es célebre por su café servido con leche condensada? | Vietnam | La capital, Hanói, permite responder solo con conocimientos de geografía. |
| caf-ori-11 | 2 | ¿En qué ciudad italiana está el histórico Caffè Quadri, en la plaza de San Marcos? | Venecia | La plaza de San Marcos permite identificar Venecia sin conocer el café. |
| caf-ori-12 | 2 | ¿En qué ciudad francesa está el Café de Flore, asociado a escritores y filósofos de Saint-Germain-des-Prés? | París | Puede resolverse ubicando Saint-Germain-des-Prés, sin conocimientos cafeteros. |
| caf-pla-03 | 2 | ¿Qué característica del grano verde se utiliza para clasificarlo mediante cribas? | El tamaño | Clasificar por tamaño es la función general de las cribas. |
| caf-her-10 | 3 | ¿Qué pieza flexible sella la unión entre la parte superior y la inferior de una cafetera italiana? | La junta | Identificar una junta como sello flexible es conocimiento mecánico general. |
| caf-ori-03 | 3 | ¿A qué país pertenecen las islas cafeteras de Java y Sumatra? | Indonesia | Solo exige ubicar Java y Sumatra; el café no interviene en la respuesta. |
| caf-ori-08 | 3 | ¿Qué reino europeo gobernaba Brasil cuando llegó allí el cultivo del café en el siglo dieciocho? | Portugal | Pregunta por la historia colonial de Brasil, no por conocimientos cafeteros. |
| caf-ori-14 | 3 | ¿En qué isla indonesia, donde se encuentra Yakarta, establecieron los neerlandeses importantes plantaciones de café? | Java | La ubicación de Yakarta permite responder sin conocer la historia del café. |
| caf-ori-17 | 3 | ¿Qué país de Oceanía cultiva café en la meseta de Atherton, en Queensland? | Australia | Basta con ubicar Queensland en Australia; el cultivo es accesorio. |
| caf-pla-05 | 3 | ¿Cómo se llama la parte carnosa del fruto del cafeto, situada bajo la piel? | La pulpa | La parte carnosa de un fruto es la pulpa, sin necesidad de conocer el cafeto. |
| caf-pla-13 | 3 | ¿Qué fenómeno meteorológico suele desencadenar la floración del cafeto después de un periodo seco? | La lluvia | La lluvia tras un periodo seco se deduce por conocimientos generales de plantas. |
| caf-pla-18 | 3 | ¿Qué estructura dentro de la semilla del café dará origen a la nueva planta al germinar? | El embrión | Es biología general de las semillas, no un conocimiento específico del café. |

## Dinosaurios (23)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| din-ana-02 | 1 | ¿Qué estructura sin dientes utilizaban muchos dinosaurios herbívoros para cortar vegetación, como hacen las tortugas? | El pico | La comparación con las tortugas permite responder sin saber de dinosaurios. |
| din-ana-03 | 1 | ¿Qué estructuras duras y curvadas remataban los dedos de muchos dinosaurios y podían servir para sujetar presas? | Las garras | La descripción define unas garras sin exigir conocimientos del tema. |
| din-ana-05 | 1 | ¿Qué huesos curvados rodeaban el tórax de los dinosaurios y ayudaban a proteger sus órganos? | Las costillas | Es anatomía general; no exige saber nada de dinosaurios. |
| din-gru-88 | 1 | ¿Qué ciencia estudia a los dinosaurios y a otros seres del pasado a través de sus fósiles? | Paleontología | Repite el dato de din-hal-61 (los paleontólogos). |
| din-hal-01 | 1 | ¿Qué cervatillo de Disney dio nombre a un pequeño dinosaurio depredador descubierto en Montana? | Bambi | Basta conocer al cervatillo de Disney; el vínculo paleontológico es decorativo. |
| din-hal-02 | 1 | ¿Qué colegio de magia de Harry Potter fue homenajeado en el nombre científico de Dracorex? | Hogwarts | Se responde sabiendo Harry Potter, sin conocer Dracorex. |
| din-hal-03 | 1 | ¿Qué monstruo gigante del cine japonés inspiró el nombre de un dinosaurio descrito por Kenneth Carpenter en 1997? | Godzilla | La descripción del monstruo japonés permite responder sin saber de dinosaurios. |
| din-hal-66 | 1 | ¿Qué reptil vivo da nombre a Iguanodon, porque sus dientes recordaban a los de ese animal? | La iguana | Iguanodon revela la respuesta; basta reconocer la palabra iguana. |
| din-yac-03 | 1 | ¿En qué país está Baviera, conocida por sus fósiles del Jurásico? | Alemania | Pregunta de geografía alemana con una referencia fósil prescindible. |
| din-yac-06 | 1 | ¿Qué cordillera entre España y Francia conserva yacimientos de huevos de dinosaurio? | Los Pirineos | La ubicación entre España y Francia basta para identificar los Pirineos. |
| din-yac-09 | 1 | ¿Qué gran desierto del norte de África contiene yacimientos de dinosaurios, como los de Níger? | El Sáhara | Se responde por geografía africana, sin conocer ningún yacimiento. |
| din-yac-63 | 1 | ¿En qué medio vivía y caminaba normalmente un tiranosaurio? | En tierra firme | Es una obviedad sobre un animal terrestre, sin contenido suficiente. |
| din-ana-06 | 2 | ¿Qué hueso del muslo de un dinosaurio iba desde la cadera hasta la rodilla? | El fémur | Pregunta de anatomía general que no exige conocimientos de dinosaurios. |
| din-ana-08 | 2 | ¿Qué material recubre la corona de los dientes de los dinosaurios y es más duro que la dentina? | El esmalte | Es anatomía dental general; la referencia a dinosaurios es prescindible. |
| din-hal-15 | 2 | ¿Qué señor oscuro de Tolkien inspiró el nombre de un dinosaurio carnívoro marroquí descrito en 2012? | Sauron | Basta conocer al señor oscuro de Tolkien; no exige saber del dinosaurio. |
| din-hal-65 | 2 | ¿Qué significa la palabra latina «rex» en el nombre Tyrannosaurus rex? | Rey | Pregunta de vocabulario latino, independiente de los dinosaurios. |
| din-yac-29 | 2 | ¿Qué comunidad autónoma española tiene una «Costa de los Dinosaurios» entre Gijón y Ribadesella? | Asturias | Gijón y Ribadesella permiten responder por geografía española. |
| din-yac-65 | 2 | ¿Qué unidad de tiempo se utiliza habitualmente para expresar la antigüedad de los dinosaurios? | Millones de años | Es una generalidad sobre tiempos prehistóricos, sin contenido específico. |
| din-yac-69 | 2 | ¿Qué gran región del sur de Sudamérica alberga los yacimientos de Argentinosaurus y Patagotitan? | La Patagonia | La gran región del sur de Sudamérica se identifica sin saber de yacimientos. |
| din-hal-21 | 3 | ¿Qué director aragonés de «El ángel exterminador» fue homenajeado en el nombre de un dinosaurio de Teruel descrito en 2023? | Luis Buñuel | Se identifica a Buñuel por su película y origen, sin saber del dinosaurio. |
| din-yac-02 | 3 | ¿En qué país sudamericano está la provincia de Neuquén, famosa por sus yacimientos de dinosaurios? | Argentina | Solo exige situar Neuquén; los yacimientos no intervienen en la respuesta. |
| din-yac-07 | 3 | ¿En qué país está Ceará, un estado conocido por los fósiles de la cuenca de Araripe? | Brasil | Solo exige situar Ceará; la referencia a los fósiles es decorativa. |
| din-yac-08 | 3 | ¿En qué país se encuentra la Costa Jurásica de Dorset? | Reino Unido | Basta situar Dorset; no requiere conocimientos paleontológicos. |

## Clásicos de animación Disney (4)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| dis-est-63 | 1 | ¿Qué tipo de música, asociada a compositores como Bach y Beethoven, sirve de base a «Fantasía»? | La música clásica | Bach y Beethoven permiten responder sin conocer «Fantasía». |
| dis-est-04 | 2 | ¿De qué mitología proceden los dioses que Disney adaptó en «Hércules»? | La griega | Se responde con conocimientos generales de mitología, sin conocer la adaptación Disney. |
| dis-est-67 | 2 | ¿De qué país de la Antigüedad proceden los mitos que inspiraron «Hércules»? | Grecia | El origen de los mitos de Hércules se sabe sin conocer ninguna película de Disney. |
| dis-his-08 | 2 | ¿En qué pequeña embarcación contemplan Rapunzel y Flynn los farolillos en «Enredados»? | Una barca | «Pequeña embarcación» prácticamente proporciona la respuesta «barca». |

## Dragon Ball (4)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| dra-ada-02 | 1 | ¿En qué país comenzó a publicarse el manga de «Dragon Ball»? | Japón | Se acierta sin saber de Dragon Ball: el manga es japonés. |
| dra-ada-06 | 1 | ¿En qué lengua se emitía «Bola de Drac» en TV3? | Catalán | Se responde por conocer TV3, sin saber nada de Dragon Ball. |
| dra-sag-70 | 2 | ¿Qué aparece sobre la cabeza de Goku cuando está muerto y conserva su cuerpo? | Un halo | El halo de un muerto se deduce de la iconografía común, sin conocer la serie. |
| dra-ada-03 | 3 | ¿Qué término inglés usan los aficionados para la secuencia musical que abre un episodio de anime? | Opening | Es vocabulario general del anime, no conocimiento de Dragon Ball. |

## Ferrocarriles (11)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| fer-esp-03 | 1 | ¿En qué isla se inauguró en 1875 el ferrocarril entre Palma e Inca? | Mallorca | Pregunta de geografía: basta con situar Palma e Inca. |
| fer-esp-11 | 1 | ¿Qué siglas tiene la empresa pública creada en 1994 con el nombre de Serveis Ferroviaris de Mallorca? | SFM | Las siglas se deducen del nombre completo incluido en la pregunta. |
| fer-ing-61 | 1 | En la señalización luminosa ferroviaria española, ¿qué color indica parada? | Rojo | Se responde trasladando el significado cotidiano del semáforo rojo. |
| fer-ing-96 | 1 | En la señalización luminosa ferroviaria española, ¿qué color indica vía libre? | Verde | Se responde trasladando el significado cotidiano del semáforo verde. |
| fer-pat-04 | 1 | ¿A qué lugar se dirige el tren de «Polar Express» para visitar a Papá Noel? | Polo Norte | El destino se deduce de la asociación entre Papá Noel y el Polo Norte. |
| fer-veh-62 | 1 | ¿Qué líquido se calienta en la caldera de una locomotora de vapor? | El agua | Basta saber que el vapor se obtiene calentando agua. |
| fer-veh-64 | 1 | ¿Qué suministran los cables de la catenaria a las locomotoras que toman energía de ellos? | La electricidad | La función de unos cables que suministran energía se deduce sin saber de trenes. |
| fer-esp-01 | 2 | ¿Con qué siglas se conoció la entidad estatal creada en 1965 llamada Ferrocarriles de Vía Estrecha? | Feve | Las siglas se forman directamente con el nombre que proporciona el enunciado. |
| fer-ing-06 | 2 | ¿Qué pieza metálica giratoria aprietan las pastillas para frenar una rueda? | El disco | Es mecánica general de frenos, sin contenido específicamente ferroviario. |
| fer-ing-11 | 2 | ¿Cuántos milímetros separan los carriles de una vía de ancho métrico? | 1 000 | Solo exige convertir un metro en milímetros. |
| fer-esp-10 | 3 | ¿En qué comunidad autónoma está la estación internacional de Canfranc, inaugurada en 1928? | Aragón | Pregunta por la ubicación autonómica de una localidad, no por sus ferrocarriles. |

## Harry Potter (5)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| har-mag-15 | 1 | ¿Qué sentimiento da origen a la protección que Lily deja a su hijo al sacrificarse por él? | El amor | El amor se deduce del sacrificio materno sin conocer la saga. |
| har-mag-16 | 1 | ¿En qué recipiente preparan los alumnos sus mezclas en clase de Pociones? | Un caldero | El caldero es un recipiente genérico de pociones y brujería. |
| har-mag-63 | 1 | ¿Qué criaturas del Bosque Prohibido tienen torso humano y cuerpo de caballo? | Los centauros | La descripción define un centauro sin necesitar saber Harry Potter. |
| har-pel-12 | 1 | ¿En qué idioma se rodaron originalmente las películas de Harry Potter? | Inglés | Dato lingüístico externo a la historia, accesible sin conocer la saga. |
| har-mag-17 | 2 | ¿Qué órganos aparecen en el cuello al comer la planta que permite respirar bajo el agua en el Torneo de los Tres Magos? | Branquias | Las branquias se deducen por su función sin conocer la saga. |

## Juego de tronos (15)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| jue-act-12 | 1 | ¿Qué país acogió rodajes de la serie en Córdoba, Cáceres y Gerona? | España | Las ciudades permiten responder por geografía, sin conocer la serie. |
| jue-act-13 | 1 | ¿A qué comunidad autónoma pertenece Almería, una de las provincias elegidas para rodar la serie? | Andalucía | Solo evalúa geografía española. |
| jue-act-18 | 1 | ¿A qué comunidad autónoma pertenece Guipúzcoa, donde se rodaron escenas de Rocadragón? | País Vasco | Solo evalúa geografía española. |
| jue-cas-62 | 1 | ¿Qué parte del cuerpo le cortan a Ned Stark durante su ejecución? | La cabeza | La ejecución y el verbo «cortar» permiten deducir la cabeza sin conocer la escena. |
| jue-lib-11 | 1 | ¿A qué género literario pertenecen las novelas de «Juego de tronos», con sus dragones y su magia? | Fantasía | Los dragones y la magia del enunciado revelan el género. |
| jue-lib-13 | 1 | ¿Qué animal sirve como principal montura de los guerreros dothrakis? | El caballo | El caballo es la respuesta convencional sin necesitar conocimientos del tema. |
| jue-ser-61 | 1 | ¿Qué estación anuncia la frase «Se acerca el...»? | Invierno | Repite el dato de jue-cas-63 («Se acerca el invierno»). |
| jue-act-15 | 2 | ¿En qué serie de «Star Wars» interpreta Pedro Pascal al protagonista, Din Djarin? | The Mandalorian | Pregunta sobre Star Wars; no exige conocer Juego de tronos. |
| jue-act-27 | 2 | ¿Qué banda liderada por Chris Martin tuvo a su batería entre los músicos de la boda de Edmure Tully? | Coldplay | Chris Martin permite identificar la banda sin saber nada de la serie. |
| jue-lib-66 | 2 | ¿En qué idioma se escribieron originalmente las novelas de «Juego de tronos»? | Inglés | Es un dato externo y fácilmente inferible, no conocimiento del universo. |
| jue-act-19 | 3 | ¿En qué saga cinematográfica interpretó Natalia Tena a Tonks antes de encarnar a Osha? | Harry Potter | Tonks permite responder por Harry Potter sin conocer Juego de tronos. |
| jue-act-23 | 3 | ¿En qué país norteafricano se rodaron las escenas de Yunkai en la ciudad fortificada de Ait Ben Hadu? | Marruecos | La ciudad identifica el país por geografía, sin conocer el rodaje. |
| jue-act-29 | 3 | ¿En qué comunidad autónoma están las Bardenas Reales, utilizadas para representar paisajes del mar dothraki? | Navarra | Solo evalúa la ubicación geográfica de las Bardenas Reales. |
| jue-lib-72 | 3 | En los libros, ¿qué cambio hace Yoren en el aspecto de Arya para ayudarla a pasar por un niño? | Le corta el pelo | Cortar el pelo se deduce del propósito de hacerla pasar por un niño. |
| jue-ser-68 | 3 | ¿Qué verbo completa el lema «Lo que está muerto no puede...»? | Morir | «Morir» se deduce por lógica sin conocer el lema ni la serie. |

## League of Legends (6)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| lea-com-04 | 1 | ¿Qué país acogió Worlds 2017, cuya final se celebró en el Estadio Nacional de Pekín? | China | Basta saber que Pekín está en China; no exige conocer League of Legends. |
| lea-pro-62 | 1 | ¿Qué banda de «In the End» interpreta «Heavy Is the Crown», el himno de Worlds 2024? | Linkin Park | La pista de In the End permite responder solo con conocimientos musicales. |
| lea-pro-63 | 1 | ¿Qué género de música popular surcoreana caracteriza al grupo que interpreta «MORE»? | K-pop | La propia definición de música popular surcoreana revela K-pop. |
| lea-run-62 | 1 | Según la biografía de Ahri, ¿a qué animal recuerdan sus nueve colas? | Un zorro | Las nueve colas permiten deducir zorro por cultura general, sin conocer a Ahri. |
| lea-run-66 | 1 | ¿En cuántas largas trenzas lleva recogido el pelo Jinx durante la primera temporada de «Arcane»? | 2 | Repite el dato de lea-run-77 (las dos trenzas de Jinx). |
| lea-pro-70 | 2 | ¿Qué cantante de «Old Town Road» interpreta «STAR WALKIN'», el himno de Worlds 2022? | Lil Nas X | La pista de Old Town Road permite responder sin saber nada del juego. |

## Marvel (13)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| mar-act-12 | 1 | ¿Qué actor que encarna a Indiana Jones interpreta a Thaddeus Ross en «Capitán América: Brave New World»? | Harrison Ford | La pista de Indiana Jones permite responder sin saber nada de Marvel. |
| mar-act-63 | 1 | ¿Qué actriz de «La La Land» interpreta a Gwen Stacy en las películas de «The Amazing Spider-Man»? | Emma Stone | La pista de La La Land permite responder sin conocer su papel en Marvel. |
| mar-act-64 | 1 | La protagonista de «Los juegos del hambre» también interpreta a Mística en «X-Men: Primera generación». ¿Qué actriz es? | Jennifer Lawrence | Basta con conocer a la protagonista de Los juegos del hambre. |
| mar-com-11 | 1 | ¿Qué profesional inventa la historia y escribe los diálogos de un cómic? | El guionista | Es vocabulario general de creación de cómics; no exige saber Marvel. |
| mar-com-12 | 1 | ¿Qué profesional realiza a lápiz las escenas y los personajes de las viñetas? | El dibujante | La propia descripción permite deducir dibujante sin conocer Marvel. |
| mar-com-17 | 1 | ¿En qué país nació la editorial Marvel? | Estados Unidos | Se acierta sin saber de Marvel: la editorial es estadounidense. |
| mar-act-14 | 2 | ¿Qué actor, famoso por interpretar a Dominic Toretto, pone la voz original a Groot? | Vin Diesel | La pista de Dominic Toretto identifica al actor sin conocimientos de Marvel. |
| mar-act-17 | 2 | ¿Qué actriz que interpreta a Jane Foster da vida a Padmé Amidala en las precuelas de «Star Wars»? | Natalie Portman | Basta con saber quién interpreta a Padmé en Star Wars. |
| mar-com-18 | 2 | ¿Cómo se llama el profesional que aplica los colores a las páginas de un cómic? | El colorista | Colorista se deduce de la descripción y no requiere saber Marvel. |
| mar-com-19 | 2 | ¿Cómo se llama una palabra que imita un sonido, como «bum», en una viñeta? | Onomatopeya | Es una definición lingüística general, independiente de Marvel. |
| mar-act-23 | 3 | ¿Qué actor que interpreta a Eddie Brock protagoniza «Mad Max: Furia en la carretera»? | Tom Hardy | Se puede responder conociendo al protagonista de Mad Max, sin saber Marvel. |
| mar-act-65 | 3 | ¿Qué actriz interpreta a Gamora en Marvel y a Neytiri en «Avatar»? | Zoe Saldaña | Saber quién interpreta a Neytiri basta para responder sin conocer Marvel. |
| mar-act-66 | 3 | ¿Qué actor interpreta a Poe Dameron en «Star Wars» y protagoniza «Caballero Luna»? | Oscar Isaac | La pista de Poe Dameron permite responder solo con conocimientos de Star Wars. |

## Pokémon (6)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| pok-der-03 | 1 | ¿Qué parte del cuerpo utiliza Lickitung para recoger el sushi en su minijuego de Pokémon Stadium? | La lengua | Se deduce del rasgo característico de Lickitung sin conocer el minijuego. |
| pok-der-10 | 1 | ¿Qué parte del cuerpo debes cepillarte mientras juegas a Pokémon Smile? | Los dientes | Cepillarse los dientes es una asociación cotidiana; no evalúa conocimientos de Pokémon. |
| pok-der-11 | 2 | ¿Qué piezas móviles de Pokémon Pinball golpean la bola desde la parte inferior del tablero? | Las paletas | Pregunta por elementos de cualquier pinball, no por conocimientos de Pokémon. |
| pok-der-69 | 2 | ¿Qué tecnología permite ver Pokémon superpuestos al entorno real a través de la cámara en Pokémon GO? | Realidad aumentada | Evalúa un concepto tecnológico general, no conocimientos específicos de Pokémon. |
| pok-der-04 | 3 | ¿Con qué accesorio de Nintendo DS trazas los lazos de captura en Pokémon Ranger? | El lápiz táctil | Se responde conociendo el accesorio de la consola, sin saber de Pokémon. |
| pok-der-70 | 3 | ¿Cuál es el mínimo de Pokémon iguales que debes alinear para eliminarlos en Pokémon Shuffle? | 3 | Repite la regla genérica de alinear tres de los puzles, con escaso contenido temático. |

## Segunda Guerra Mundial (21)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| seg-arm-13 | 1 | ¿Qué dispositivo acoplado a un arma de fuego reduce el ruido del disparo? | El silenciador | Definición general de un silenciador; no exige saber nada de esta guerra. |
| seg-arm-61 | 1 | ¿Qué código de puntos y rayas se utilizaba para transmitir mensajes militares? | El código morse | Se responde con cultura general sobre comunicaciones, sin conocer la guerra. |
| seg-eur-12 | 1 | ¿Qué capital alemana tomaron las fuerzas soviéticas en mayo de 1945? | Berlín | Basta con saber cuál es la capital de Alemania. |
| seg-eur-13 | 1 | ¿Qué capital británica sufrió los bombardeos alemanes conocidos como el «Blitz»? | Londres | Basta con identificar la capital británica; no hace falta conocer el Blitz. |
| seg-eur-15 | 1 | ¿Qué país alpino, cuya capital es Berna, se mantuvo neutral durante la Segunda Guerra Mundial? | Suiza | La capital Berna permite responder sin conocer la neutralidad suiza. |
| seg-pac-14 | 1 | ¿Qué ciudad era la capital de Japón durante la Segunda Guerra Mundial? | Tokio | Pregunta de geografía general sobre la capital japonesa. |
| seg-pac-15 | 1 | ¿En qué país estaban las bases aliadas de Brisbane y Sídney durante la guerra del Pacífico? | Australia | Basta con situar Brisbane y Sídney en Australia. |
| seg-per-11 | 1 | ¿Qué físico de la teoría de la relatividad se exilió en Estados Unidos tras la llegada de Hitler al poder? | Albert Einstein | La teoría de la relatividad identifica a Einstein sin saber nada de su exilio. |
| seg-per-12 | 1 | ¿Qué cuento sobre un niño que vive en un asteroide publicó en 1943 el piloto Antoine de Saint-Exupéry? | El principito | Las pistas literarias permiten responder sin conocer la guerra. |
| seg-per-61 | 1 | ¿Qué tipo de texto escribió Ana Frank mientras se escondía de los nazis? | Un diario | Repite el dato de seg-per-14 (el diario de Ana Frank). |
| seg-eur-20 | 2 | ¿Qué capital soviética era el objetivo de la ofensiva alemana denominada «Tifón» en 1941? | Moscú | Basta con saber que Moscú era la capital soviética. |
| seg-eur-64 | 2 | ¿Cómo se llamaban las agrupaciones de barcos mercantes que cruzaban el Atlántico con escolta militar? | Los convoyes | Es una definición general de convoy, sin conocimiento específico de la guerra. |
| seg-eur-65 | 2 | ¿Qué territorio británico al sur de España fue una base estratégica junto a la entrada del Mediterráneo? | Gibraltar | Las pistas geográficas identifican Gibraltar sin conocer su papel militar. |
| seg-per-13 | 2 | ¿Cómo se llama al espía que finge servir a un servicio de inteligencia mientras trabaja en secreto para su adversario? | Agente doble | Definición general de agente doble, ajena a conocimientos específicos del conflicto. |
| seg-per-16 | 2 | ¿Qué antibiótico descubierto por Alexander Fleming se produjo masivamente para tratar a los heridos aliados? | La penicilina | La referencia a Fleming permite responder sin conocer la guerra. |
| seg-per-19 | 2 | ¿Qué profesión hizo famoso a Robert Capa, que documentó el desembarco de Normandía? | Fotógrafo | Pregunta por una profesión de cultura general, no por conocimientos de la guerra. |
| seg-arm-16 | 3 | ¿Qué tecnología utilizaban los buques para detectar submarinos mediante ecos de sonido bajo el agua? | El sonar | Los ecos submarinos definen el sonar sin necesidad de conocer esta guerra. |
| seg-arm-18 | 3 | ¿Qué gas no inflamable mantenía en el aire los dirigibles antisubmarinos estadounidenses de la clase K? | El helio | Se resuelve con conocimientos generales sobre gases y dirigibles. |
| seg-eur-66 | 3 | ¿Qué país escandinavo se mantuvo neutral durante la guerra, a diferencia de Noruega y Dinamarca? | Suecia | Al excluir Noruega y Dinamarca, la geografía escandinava basta para responder. |
| seg-per-27 | 3 | ¿Con qué sigla se conoce al servicio secreto británico exterior en el que trabajó Kim Philby durante la guerra? | MI6 | La definición del servicio exterior británico permite responder sin conocer a Philby. |
| seg-per-30 | 3 | ¿Qué premio periodístico recibió el corresponsal Ernie Pyle en 1944? | El Pulitzer | El premio se puede adivinar por cultura periodística sin conocer a Ernie Pyle. |

## Sorpresa (13)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| sor-leg-12 | 1 | ¿Qué pieza giratoria permite que un coche LEGO ruede sobre el suelo? | Una rueda | Se responde por sentido común, sin conocer LEGO. |
| sor-leg-13 | 1 | ¿Qué animales prehistóricos protagonizan los parques del videojuego «LEGO Jurassic World»? | Los dinosaurios | La referencia a animales prehistóricos y parques jurásicos regala la respuesta. |
| sor-leg-14 | 1 | ¿Qué superhéroe de Gotham protagoniza varios videojuegos de LEGO acompañado por Robin? | Batman | Gotham y Robin permiten responder sin conocer los videojuegos de LEGO. |
| sor-ter-14 | 1 | ¿Qué poder del Estado ejerce la función de juzgar los delitos de terrorismo? | El poder judicial | La propia función de juzgar señala la respuesta, sin conocimientos de terrorismo. |
| sor-leg-15 | 2 | ¿Qué mecanismo de unión permite que una puerta LEGO se abra y se cierre girando sobre un lado? | Una bisagra | Describe una bisagra corriente; no requiere conocimientos de LEGO. |
| sor-leg-16 | 2 | ¿Qué elemento permite unir muchos vagones LEGO mediante atracción, sin engancharlos con un gancho? | Un imán | La atracción sin contacto permite deducir el imán sin conocer LEGO. |
| sor-leg-17 | 2 | ¿De qué material elástico son los neumáticos negros de muchos vehículos LEGO? | El caucho | Se responde por el material habitual de los neumáticos, sin conocer LEGO. |
| sor-leg-18 | 2 | ¿A qué juego corresponden los sets LEGO con un tablero de sesenta y cuatro casillas, reyes y alfiles? | El ajedrez | Las casillas, reyes y alfiles identifican el ajedrez sin saber nada de LEGO. |
| sor-ter-16 | 2 | ¿Cómo se llama la entrega de una persona por un Estado a otro para que sea juzgada o cumpla una condena? | La extradición | Es una definición jurídica general sin vínculo específico con el terrorismo. |
| sor-vie-15 | 2 | ¿Cómo se llama el conjunto de palas giratorias que permite elevarse a los helicópteros empleados en Vietnam? | El rotor | Pregunta por una pieza de cualquier helicóptero; Vietnam es un añadido. |
| sor-vie-17 | 2 | ¿Qué tipo de buque servía de pista flotante para los aviones estadounidenses que combatían en Vietnam? | Un portaaviones | Describe un portaaviones sin exigir ningún conocimiento sobre Vietnam. |
| sor-leg-21 | 3 | ¿Qué civilización inspiró las tumbas y momias de la primera etapa de LEGO Adventurers? | La egipcia | Las tumbas y momias permiten responder por asociación sin conocer la colección. |
| sor-leg-22 | 3 | ¿Qué grupo de superhéroes reúne a Iron Man, Thor y Hulk en un videojuego de LEGO de 2016? | Los Vengadores | Se responde conociendo a los superhéroes, sin saber nada del videojuego de LEGO. |

## Star Wars (5)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| sta-pre-62 | 1 | ¿Qué sustancia fundida fluye bajo Anakin y Obi-Wan durante su duelo en Mustafar? | La lava | La descripción de una sustancia fundida que fluye permite deducir lava sin conocer la saga. |
| sta-pre-65 | 1 | ¿Qué se ve de fondo mientras se aleja el texto amarillo al comienzo de cada precuela? | El espacio | El fondo espacial se deduce del género y del propio título sin conocer las películas. |
| sta-ser-15 | 1 | ¿Qué marca de juguetes da nombre a los videojuegos de Star Wars con personajes de piezas de construcción? | LEGO | La marca se deduce por las piezas de construcción sin saber nada de Star Wars. |
| sta-sec-68 | 2 | ¿Qué gesto de afecto tiene Leia con Rey cuando se encuentran tras la muerte de Han Solo? | La abraza | Un abrazo es la respuesta convencional a un encuentro afectuoso; aporta poco conocimiento. |
| sta-sec-71 | 3 | ¿Cómo está cocinado el porg que Chewbacca se dispone a comer en «Los últimos Jedi»? | Asado | El método de cocción es un detalle culinario de relleno, no conocimiento relevante de la saga. |

## Taylor Swift (18)

| Id | Nivel | Pregunta | Respuesta | Por qué |
|---|---|---|---|---|
| tay-esc-62 | 1 | ¿En qué tipo de recinto deportivo celebró Taylor Swift sus conciertos de Madrid de 2024? | Un estadio | El tipo de recinto se deduce sin conocer sus conciertos. |
| tay-esc-65 | 1 | ¿Qué cantante conocida como la «reina del pop» interpretó «Ghosttown» acompañada por Taylor Swift a la guitarra en 2015? | Madonna | La pista «reina del pop» permite responder sin saber nada de Taylor Swift. |
| tay-pan-01 | 1 | ¿En qué ciudad pasea Taylor Swift junto al Sena en el videoclip de «Begin Again»? | París | La referencia al Sena permite responder por geografía, sin conocer el videoclip. |
| tay-pan-64 | 1 | ¿Qué cantante interpreta a la protagonista de «Hannah Montana: La película», donde Taylor Swift aparece cantando? | Miley Cyrus | Pregunta por la protagonista de Hannah Montana, no por Taylor Swift. |
| tay-can-05 | 2 | ¿Qué dramaturgo creó a los dos amantes cuyos nombres aparecen en «Love Story»? | William Shakespeare | Se responde con cultura literaria sin conocer a Taylor Swift. |
| tay-dis-68 | 2 | ¿Qué canción de «Lover» cuenta un romance secreto de verano y tiene un título que significa «verano cruel»? | Cruel Summer | La traducción del título permite responder solo con conocimientos de inglés. |
| tay-dis-69 | 2 | ¿Qué canción de «1989» trata de una amistad rota y tiene un título que significa «mala sangre»? | Bad Blood | La traducción literal revela el título sin necesitar conocimientos del tema. |
| tay-dis-70 | 2 | ¿Qué canción de Taylor Swift se titula con un adjetivo inglés que significa «guapísimo» o «precioso»? | Gorgeous | Es una pregunta de vocabulario inglés disfrazada de pregunta musical. |
| tay-dis-71 | 2 | ¿Qué canción de Taylor Swift tiene un título que se traduce literalmente como «Sueños más salvajes»? | Wildest Dreams | Basta traducir al inglés las palabras que proporciona el enunciado. |
| tay-dis-73 | 2 | ¿Qué canción de «1989» repite en su estribillo una pregunta sobre haber salido del bosque? | Out of the Woods | La descripción traduce prácticamente el título y permite responder sin conocerla. |
| tay-esc-69 | 2 | ¿Qué cantante canadiense interpretó su éxito «Baby» como invitado de Taylor Swift en el Speak Now World Tour? | Justin Bieber | El cantante canadiense de «Baby» se identifica sin conocer la gira. |
| tay-esc-71 | 2 | ¿Qué antiguo miembro de NSYNC cantó «Mirrors» con Taylor Swift en el 1989 World Tour? | Justin Timberlake | NSYNC y «Mirrors» identifican al cantante sin saber nada de Taylor Swift. |
| tay-pan-11 | 2 | ¿En qué estado estadounidense se rodó el videoclip de «22», con escenas en una casa y en la playa de Malibú? | California | Basta saber en qué estado está Malibú; no exige conocer el videoclip. |
| tay-pan-66 | 2 | ¿En qué musical de cine aparece Taylor Swift junto a personajes con bigotes, orejas y colas de felino? | Cats | La descripción identifica el musical sin conocer la participación de Taylor. |
| tay-esc-01 | 3 | ¿Qué cantante de «Espresso» fue telonera del Eras Tour en Australia en 2024? | Sabrina Carpenter | La pista «cantante de Espresso» da la respuesta sin conocer la gira. |
| tay-esc-24 | 3 | ¿Qué cantante interpretó «Complicated» con Taylor durante el 1989 World Tour en San Diego? | Avril Lavigne | Se identifica a la cantante por «Complicated», sin conocer ese concierto. |
| tay-esc-72 | 3 | En su actuación de «Mean» en los Grammy, ¿qué instrumento de cuerda y cuerpo redondo tocaba Taylor Swift? | El banjo | La descripción permite identificar el instrumento sin conocer la actuación. |
| tay-esc-73 | 3 | ¿Qué antiguo miembro de Take That interpretó «Angels» con Taylor Swift en Wembley durante el Reputation Stadium Tour? | Robbie Williams | Take That y «Angels» identifican al cantante sin conocer la gira. |
