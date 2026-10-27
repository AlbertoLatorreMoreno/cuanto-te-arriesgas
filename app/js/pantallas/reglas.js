// Cómo se juega.

import { cabecera, h, montar } from "../dom.js";
import { rangoCronometro, unirNombres } from "../util.js";

export function pantallaReglas(app, { volverA = "inicio" } = {}) {
  const [corta, media] = app.config.metas;
  const { nivel_base, nivel_max } = app.config.final;
  const pct = (i) => Math.round(app.config.objetivo_acierto[i] * 100);

  montar(
    cabecera("Cómo se juega", () => app.ir(volverA)),
    h(
      "article",
      { class: "reglas" },
      h("p", {}, "Un móvil para todo el grupo. En tu turno decides cuánto te arriesgas: ese número, del 1 al 10, es la dificultad de tu pregunta y los puntos que sumas si aciertas."),
      h("h2", {}, "Un turno"),
      h(
        "ol",
        {},
        h("li", {}, "La casilla en la que estás decide la categoría, y la app anuncia un tema: «Ciencias: astronomía». En la salida, la categoría es al azar."),
        h("li", {}, "Dices hasta cuánto te arriesgas, del 1 al 10."),
        h("li", {}, "Pasas el móvil al siguiente jugador, que lee la pregunta en voz alta sin enseñar la respuesta."),
        h("li", {}, "Contestas. Quien lee mira la respuesta y el grupo decide si vale. En caso de duda, decide quien lee."),
        h("li", {}, "Si aciertas, avanzas tantas casillas como arriesgaste (si te pasas, te quedas en la meta). Si fallas, te quedas donde estás."),
        h("li", {}, "El turno pasa al siguiente, que ya tiene el móvil en la mano."),
      ),
      h("h2", {}, "Con narrador"),
      h(
        "p",
        {},
        "Si lo elegís al empezar, una persona que no juega se queda el móvil toda la partida: pregunta a cada uno hasta cuánto se arriesga, lee su pregunta en voz alta, mira la respuesta y marca si ha acertado. El móvil no se pasa.",
      ),
      ...app.config.categorias
        .filter((c) => c.tipo === "mapa" && app.config.mapa)
        .map((c) => {
          const fraccion = app.config.mapa.acierto_fraccion ?? 0.75;
          const [espana, europa, mundo] = [...app.config.mapa.distancias_km].sort((a, b) => a - b).map((d) => d * fraccion);
          return [
            h("h2", {}, `${c.nombre}: preguntas de mapa 🗺`),
            h(
              "p",
              {},
              `En las casillas de ${c.nombre} te dicen un hecho («¿dónde fue la batalla de Waterloo?») y lo señalas tocando el mapa; puedes moverlo y acercarte antes de confirmar. ` +
                `Quien lee la lee en voz alta y te devuelve el móvil. Cada pregunta tiene una zona de acierto alrededor del sitio (${espana} km en España, ${europa} km en Europa, el Mediterráneo y Oriente Próximo, y ${mundo} km en el resto del mundo). ` +
                `Si tocas dentro, sumas lo que arriesgaste menos 1 punto por cada «paso» que te alejes del sitio; fuera, nada. El paso es la zona repartida entre lo que arriesgues, así que es más corto cuanto más arriesgas: ` +
                `con una de Europa y arriesgando 5, pierdes un punto cada ${europa / 5} km. Si es tu final, la aciertas si tocas dentro de la zona.`,
            ),
          ];
        }),
      app.config.cronometro?.categorias?.length ? h("h2", {}, "Cronómetro") : null,
      app.config.cronometro?.categorias?.length
        ? h(
            "p",
            {},
            `Si lo activáis al empezar, las preguntas de ${unirNombres(app.config.cronometro.categorias.map((c) => app.nombreCategoria(c)))} tienen tiempo, ${rangoCronometro(app.config)}. ` +
              `Quien lee pone el cronómetro al terminar de leer; cuando suena, hay que responder ya. Papel y boli, permitidos.${app.finales?.length ? " Las finales de cálculo también llevan tiempo." : ""}`,
          )
        : null,
      app.rondas?.length ? h("h2", {}, "Rondas divertidas ★") : null,
      app.rondas?.length
        ? h(
            "p",
            {},
            `Si las activáis al empezar, una de cada ${app.config.rondas.cada} casillas lleva una estrella. Quien empieza su turno en una juega una ronda en vez de una pregunta, y sin apuesta: ` +
              "o nombra todos los que pueda de una lista («los doce apóstoles»), o acierta las descripciones que le van leyendo («¿de qué país es esta bandera?»). " +
              "Quien lee pone el tiempo y marca los aciertos, y se avanza una casilla por cada uno. En las listas abiertas, como «personajes rosas», decide el grupo.",
          )
        : null,
      h("h2", {}, "La meta y la pregunta final"),
      h(
        "p",
        {},
        `La partida corta acaba en ${corta.puntos} puntos y la media en ${media.puntos}. Al llegar a la meta no ganas todavía: en tu siguiente turno respondes la pregunta final. ` +
          `Su nivel es ${nivel_base}, más 1 por cada ${corta.paso_final} puntos que le saques al último (${media.paso_final} en la partida media), hasta un máximo de ${nivel_max}. ` +
          `Si la fallas, lo vuelves a intentar en tu siguiente turno, y cada final fallada baja un escalón la siguiente (nunca por debajo de ${nivel_base}); además, mientras los demás se acercan, la ventaja se reduce.`,
      ),
      h("h2", {}, "Quién gana, empates y ronda de oro 🥇"),
      h(
        "p",
        {},
        "Si aciertas la final, la ronda se termina antes de darte por ganador: los que van detrás de ti en el orden llevan un turno menos, así que, si ya están en la meta, responden su final, y si la aciertan, empatáis. " +
          "Si nadie más la acierta, ganas tú. Con empate, ninguno gana ni pierde, salvo que juguéis la ronda de oro: " +
          `cada empatado responde una final de nivel ${nivel_base}; si solo la acierta uno, gana; si la aciertan varios, siguen solo ellos, y si no la acierta nadie, otra ronda.`,
      ),
      app.finales?.length
        ? h(
            "p",
            {},
            "Las finales no salen de las preguntas normales: son de tema libre y más difíciles. Algunas son retos con tiempo, como «de estas cinco banderas, acierta al menos cuatro»: " +
              "quien lee pone el cronómetro y marca los aciertos, y si llegas al mínimo, ganas.",
          )
        : null,
      h("h2", {}, "Qué significa cada nivel"),
      h(
        "p",
        {},
        `Un jugador medio de vuestro grupo acierta el ${pct(0)} % de las preguntas de nivel 1, el ${pct(4)} % de las de nivel 5 y solo el ${pct(9)} % de las de nivel 10. ` +
          "Las apuestas medias (5 o 6) son las que más puntos dan de media; arriesgar más compensa cuando vas perdiendo.",
      ),
      h("h2", {}, "Si algo va mal"),
      h(
        "ul",
        {},
        h("li", {}, "«Cambiar pregunta»: si ya la conocías o está mal, quien lee puede pedir otra. La anulada no cuenta."),
        h("li", {}, "«Deshacer» corrige un toque equivocado, aunque ya se haya pasado el turno. Después de «Ver resultados» ya no se puede."),
        h("li", {}, "Si se cierra la app, la partida se guarda y se puede continuar."),
      ),
      h("h2", {}, "Ayudad a mejorar las preguntas"),
      h(
        "p",
        {},
        "Tras cada pregunta podéis decir si encajaba con su nivel o marcarla como mala. Con esas valoraciones, un modelo de regresión logística reajusta los niveles para vuestro grupo. También podéis valorar preguntas sin jugar en «Revisar preguntas».",
      ),
    ),
  );
}
