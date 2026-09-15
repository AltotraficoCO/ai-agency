/**
 * Lo último que pasa antes de que un texto del modelo llegue al cliente.
 *
 * Las dos funciones vienen del bucle del Webmaster y valen igual para cualquier
 * agente: los modelos que razonan en voz alta lo hacen en todos los oficios, y
 * el cierre con "RESUMEN:" es el contrato con la persona que lee el encargo.
 */

/**
 * Quita el razonamiento que algunos modelos (GLM, DeepSeek) escriben dentro del
 * texto con etiquetas <think>. Si llega sin la etiqueta de apertura —pasa
 * cuando el proveedor recorta el principio—, se descarta todo hasta la última
 * de cierre: lo que va antes es el borrador, no la respuesta.
 */
export function quitarRazonamiento(texto: string): string {
  let limpio = texto.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const cierre = limpio.toLowerCase().lastIndexOf("</think>");
  if (cierre >= 0) limpio = limpio.slice(cierre + "</think>".length);
  return limpio.replace(/<\/?think>/gi, "").trim();
}

/** El cierre obligatorio. Si el modelo no lo dio, se dice, no se inventa. */
export function extraerResumen(texto: string, simulacion: boolean): string {
  const i = texto.lastIndexOf("RESUMEN:");
  if (i >= 0) return texto.slice(i + "RESUMEN:".length).trim();
  if (texto) return texto;
  return simulacion
    ? "La exploración terminó sin un plan escrito."
    : "La tarea terminó sin resumen del agente.";
}

/** Recorta para una línea de registro, sin etiquetas ni saltos. */
export function recortar(texto: string, maximo = 90): string {
  const limpio = texto.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1)}…` : limpio;
}

// ---------------------------------------------------------------------------
// Tapar credenciales
// ---------------------------------------------------------------------------

/**
 * Cualquier cabecera de autenticación, venga como venga.
 *
 * El valor se traga entero, esquema incluido: si solo se tapara hasta el
 * «Bearer», el token quedaría escrito justo detrás.
 */
const AUTORIZACION =
  /\b(authorization|x-api-key|access[-_]token|api[-_]?key)\b["']?\s*[:=]\s*["']?\s*(?:(?:Bearer|Basic|Token)\s+)?[^\s"',}]+/gi;
/** `Bearer …` y `Basic …` sueltos dentro del cuerpo de un error de un tercero. */
const ESQUEMA = /\b(Bearer|Basic)\s+[A-Za-z0-9+/=._-]{8,}/gi;
/** `?key=…`, `&access_token=…`: así viaja un secreto dentro de una URL. */
const SECRETO_EN_URL = /([?&](?:key|api_?key|access_token|secret)=)[^&\s"']+/gi;

/**
 * Tapa lo que nunca debe llegar al cliente.
 *
 * No es paranoia: los adaptadores de servicios externos meten el cuerpo de la
 * respuesta dentro de sus errores —es lo único que permite entender un 403 sin
 * entrar al servidor de nadie— y ese cuerpo lo escribe un tercero. Si ese texto
 * acaba en el resumen de un encargo, el token queda escrito en la base de datos
 * del cliente y en su pantalla.
 *
 * Se tapan tres cosas: los secretos que el worker conoce porque los descifró,
 * cualquier cabecera de autenticación y cualquier secreto metido en una URL.
 * Los secretos cortos se ignoran a propósito: tapar una cadena de tres letras
 * llenaría de asteriscos el texto entero.
 */
export function crearTapadera(secretos: readonly string[]): (texto: string) => string {
  const utiles = secretos.filter((s) => typeof s === "string" && s.trim().length >= 6);
  return (texto: string): string => {
    let salida = texto
      .replace(AUTORIZACION, "$1: ***")
      .replace(ESQUEMA, "$1 ***")
      .replace(SECRETO_EN_URL, "$1***");
    for (const secreto of utiles) salida = salida.split(secreto).join("***");
    return salida;
  };
}
