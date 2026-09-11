/**
 * De un error técnico a una frase que entiende quien no programa.
 *
 * Módulo puro: lo usan el aprendizaje al GUARDAR el detalle de una fuente y la
 * lectura al ENSEÑARLO, porque en la base ya hay detalles viejos en inglés
 * («AI Gateway authentication failed… npx vercel link») escritos antes de que
 * existiera esto. Nunca sale una traza ni una instrucción técnica.
 */

/** Error cuyo mensaje ya está escrito para la persona. */
export class ErrorLegible extends Error {}

const GENERICO = "No se pudo aprender de esta fuente. Vuelve a intentarlo.";

/** Fallo del proveedor de búsqueda por significado: no es culpa de la fuente. */
export function esFalloDeProveedor(texto: string): boolean {
  return /gateway|authentication|unauthori[sz]ed|api[ _-]?key|\b401\b|\b403\b|embedding|vercel link|oidc|rate limit|quota/i.test(
    texto,
  );
}

/** ¿Parece ya una frase en español pensada para la persona? */
function pareceLegible(texto: string): boolean {
  return (
    texto.length <= 240 &&
    !/\n\s+at\s|stack|npx |https?:\/\/[^\s]*vercel|error:/i.test(texto) &&
    /[áéíóúñ¿¡]|\b(el|la|los|las|de|no|para|esta|este|con)\b/i.test(texto)
  );
}

export function traducirDetalle(texto: string): string {
  const m = texto.trim();
  if (m === "") return GENERICO;
  if (esFalloDeProveedor(m)) {
    return "No pudimos preparar la búsqueda inteligente. Vuelve a leer la fuente: se guardará para buscar por palabras.";
  }
  if (/abort|timeout|timed out|ETIMEDOUT/i.test(m)) {
    return "No pudimos leer esa dirección: tardó demasiado en responder. Inténtalo más tarde.";
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|getaddrinfo|certificate|socket/i.test(m)) {
    return "No pudimos leer esa dirección. Revisa que esté bien escrita y que la página esté publicada.";
  }
  if (/password|encrypted/i.test(m)) {
    return "El archivo está protegido con contraseña: quítasela y vuelve a subirlo.";
  }
  if (/invalid pdf|corrupt|end of central directory|not a valid zip|could not find|invalid spreadsheet/i.test(m)) {
    return "No pudimos abrir el archivo: parece dañado o no es del formato que dice su nombre.";
  }
  if (/statement timeout|canceling statement|deadlock|connection terminated|too many clients/i.test(m)) {
    return "Tuvimos un problema guardando lo aprendido. Vuelve a leer la fuente en un momento.";
  }
  return pareceLegible(m) ? m : GENERICO;
}

export function mensajeLegible(error: unknown): string {
  if (error instanceof ErrorLegible) return error.message;
  return traducirDetalle(error instanceof Error ? error.message : String(error));
}
