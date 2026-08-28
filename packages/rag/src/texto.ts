/** Utilidades de texto compartidas por la ingesta y el troceado. */
import { createHash } from "node:crypto";

/** Hash estable del contenido. Es lo que decide si algo hay que reindexar. */
export function hashContenido(texto: string): string {
  return createHash("sha256").update(normalizarParaHash(texto), "utf8").digest("hex");
}

/**
 * Normaliza antes de hashear: un espacio de más o un salto de línea distinto
 * en una web no es un cambio de contenido, y si lo tratáramos como tal cada
 * revisión nocturna reindexaría el sitio entero.
 */
export function normalizarParaHash(texto: string): string {
  return texto.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Estimación de tokens sin tokenizador.
 *
 * Traer un tokenizador real (y su tabla de 2 MB) para decidir dónde cortar un
 * párrafo no se paga. En castellano ~3.7 caracteres por token es una
 * aproximación suficientemente buena; el objetivo de 700-900 tiene margen.
 */
export function estimarTokens(texto: string): number {
  const limpio = texto.trim();
  if (limpio === "") return 0;
  return Math.max(1, Math.ceil(limpio.length / 3.7));
}

/** Corta un párrafo largo por frases, respetando signos del castellano. */
export function dividirEnFrases(texto: string): string[] {
  const frases = texto.match(/[^.!?…\n]+[.!?…]*\s*/g);
  if (!frases) return [texto];
  return frases.map((f) => f.trimEnd()).filter((f) => f !== "");
}

/** Colapsa espacios pero conserva la estructura de párrafos del markdown. */
export function limpiarMarkdown(md: string): string {
  return md
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
