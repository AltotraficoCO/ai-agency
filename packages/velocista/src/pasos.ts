/**
 * El registro de trabajo del Velocista.
 *
 * Mismo contrato que el del Webmaster y el de Marketing: mientras el encargo
 * corre, la persona no ve llamadas a herramientas sino pasos contados para
 * ella, que cambian de estado en vivo.
 *
 * Regla de seguridad heredada: el detalle sale de la ENTRADA de la herramienta,
 * así que solo se leen unas pocas claves conocidas e inofensivas.
 */

/**
 * El tipo vive en `@strappy/agentes`: lo comparten los cinco oficios, y el
 * worker y la web lo leen igual venga de quien venga. Estaba copiado byte a
 * byte en cada paquete, así que añadir un estado nuevo al armazón habría dejado
 * a los demás atrás sin que nada avisara.
 */
import type { EstadoPaso, PasoTrabajo } from "@strappy/agentes";

export type { EstadoPaso, PasoTrabajo };

/** En gerundio y sin siglas: lo lee el dueño del negocio. */
const ETIQUETAS: Readonly<Record<string, string>> = {
  velocidad_medir: "Midiendo la velocidad de tu página",
  velocidad_listar_paginas: "Mirando qué páginas tiene tu web",
  velocidad_revisar_imagenes: "Revisando el peso de tus imágenes",
  velocidad_revisar_plugins: "Revisando los complementos de tu web",
  velocidad_comparar: "Comparando cómo iba antes y cómo va ahora",
  velocidad_activar_cache: "Proponiendo activar la caché",
  pedir_aprobacion: "Pidiéndote aprobación",
  preguntar_al_cliente: "Haciéndote una pregunta",
  pedir_ayuda_a_companero: "Pidiéndole ayuda a un compañero",
};

export function etiquetaDePaso(herramienta: string): string {
  return ETIQUETAS[herramienta] ?? "Trabajando en la velocidad de tu web";
}

/** Claves de la entrada que dan contexto sin riesgo, en orden de preferencia. */
const CLAVES_DETALLE = ["motivo", "pregunta", "propuesta", "ruta", "url", "plugin", "dispositivo"] as const;

const PARECE_SECRETO = /pass|token|secret|clave|credencial|authorization|cookie|api_key/i;

function recortar(texto: string, maximo = 90): string {
  const limpio = texto
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
