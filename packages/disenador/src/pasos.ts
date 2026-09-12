/**
 * El registro de trabajo del Diseñador.
 *
 * Mismo contrato que el resto de agentes: mientras el encargo corre, la persona
 * no ve llamadas a herramientas sino pasos contados para ella. Aquí importan
 * especialmente porque generar una imagen tarda: sin un «Dibujando la portada»
 * en pantalla, el cliente cree que se colgó.
 *
 * Regla de seguridad heredada: el detalle sale de la ENTRADA de la herramienta,
 * así que solo se leen unas pocas claves conocidas e inofensivas.
 */

export type EstadoPaso = "en_curso" | "hecho" | "error" | "esperando";

export type PasoTrabajo = {
  readonly id: string;
  readonly herramienta: string;
  readonly etiqueta: string;
  readonly estado: EstadoPaso;
  readonly detalle: string | null;
  /** ISO 8601. */
  readonly en: string;
};

/** En gerundio y en el idioma del cliente: lo lee el dueño, no un diseñador. */
const ETIQUETAS: Readonly<Record<string, string>> = {
  img_ver_estilo: "Mirando los colores de tu marca",
  img_listar_medios: "Revisando tu biblioteca de imágenes",
  img_generar: "Dibujando la imagen",
  img_publicar: "Subiendo la imagen a tu sitio",
  pedir_aprobacion: "Pidiéndote aprobación",
  preguntar_al_cliente: "Haciéndote una pregunta",
  pedir_ayuda_a_companero: "Pidiéndole ayuda a un compañero",
};

export function etiquetaDePaso(herramienta: string): string {
  return ETIQUETAS[herramienta] ?? "Trabajando en tus imágenes";
}

/** Claves de la entrada que dan contexto sin riesgo, en orden de preferencia. */
const CLAVES_DETALLE = ["idea", "pregunta", "propuesta", "motivo", "buscar", "formato"] as const;

const PARECE_SECRETO = /pass|token|secret|clave|credencial|authorization|cookie/i;

function recortar(texto: string, maximo = 90): string {
  const limpio = texto.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1)}…` : limpio;
}

/** Una línea legible sacada de la entrada, o null si no hay nada seguro que decir. */
export function detalleDePaso(entrada: unknown): string | null {
  if (entrada === null || typeof entrada !== "object" || Array.isArray(entrada)) return null;
  const objeto = entrada as Record<string, unknown>;
  for (const clave of CLAVES_DETALLE) {
    if (PARECE_SECRETO.test(clave)) continue;
    const valor = objeto[clave];
    if (typeof valor === "string" && valor.trim()) return recortar(valor);
    if (typeof valor === "number") return String(valor);
  }
  return null;
}
