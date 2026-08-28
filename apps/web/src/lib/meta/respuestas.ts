/**
 * Elegir una opción es un evento de interfaz, no una inferencia.
 *
 * Cuando alguien pulsa «WhatsApp» sabemos con certeza qué contestó y a qué
 * pregunta. Mandar eso al modelo para que él «entienda» que hay que escribir
 * `canal: "whatsapp"` en el borrador es pagar tokens y latencia por perder
 * garantías: un martes el modelo lo escribe en otra clave y la pregunta vuelve.
 *
 * Así que las respuestas cerradas se aplican aquí, antes de que el modelo vea
 * nada. El modelo se entera leyendo el borrador ya actualizado. Es lo que hace
 * que la regla «nunca preguntes algo que ya sabes» sea una garantía y no una
 * súplica en el prompt.
 *
 * Módulo puro: no toca la base ni el modelo.
 */
import { ETIQUETAS_RECOGER, escribirEnRuta } from "@strappy/core";

export type RespuestaElegida = {
  readonly clave: string;
  /** Uno o varios valores, tal cual salieron de las opciones. */
  readonly valores: readonly string[];
};

/** Claves cuyo valor es una lista de textos dentro del borrador. */
const LISTAS_DE_TEXTO = new Set(["hace", "noHace", "escalar"]);

/**
 * Convierte respuestas en un parcial de borrador.
 *
 * Devuelve solo las ramas que cambian: quien lo guarda lo funde, y fundir un
 * parcial es lo único que permite que dos herramientas del mismo turno
 * escriban sin pisarse.
 */
export function respuestasAParcial(
  respuestas: readonly RespuestaElegida[],
): Record<string, unknown> {
  let parcial: Record<string, unknown> = {};

  for (const respuesta of respuestas) {
    const valores = respuesta.valores.map((v) => v.trim()).filter((v) => v.length > 0);
    if (valores.length === 0) continue;

    if (respuesta.clave === "recoger") {
      parcial = escribirEnRuta(
        parcial,
        "recoger",
        valores.map((valor) => ({
          clave: valor,
          etiqueta: ETIQUETAS_RECOGER[valor] ?? valor,
          obligatorio: valor === "nombre" || valor === "telefono",
        })),
      );
      continue;
    }

    if (LISTAS_DE_TEXTO.has(respuesta.clave)) {
      parcial = escribirEnRuta(parcial, respuesta.clave, valores);
      continue;
    }

    // Varias respuestas a una pregunta escalar se unen con comas: es lo que la
    // persona dijo, y recortarla a la primera sería inventarnos su respuesta.
    parcial = escribirEnRuta(parcial, respuesta.clave, valores.join(", "));
  }

  return parcial;
}

/** Cómo se lee en el chat lo que la persona acaba de elegir. */
export function frasearRespuestas(
  respuestas: readonly RespuestaElegida[],
  etiquetas: Readonly<Record<string, string>> = {},
): string {
  const partes = respuestas
    .map((r) => r.valores.map((v) => etiquetas[v] ?? v).join(", "))
    .filter((t) => t.trim().length > 0);
  return partes.join(" · ");
}
