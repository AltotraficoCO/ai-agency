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
