/**
 * El registro de trabajo del agente Administrativo.
 *
 * Mismo contrato que el del Webmaster y el de Marketing: mientras el encargo
 * corre, la persona no ve llamadas a herramientas sino pasos contados para
 * ella, que cambian de estado en vivo.
 *
 * Regla de seguridad heredada, y aquí más importante que en ningún otro agente:
 * el detalle sale de la ENTRADA de la herramienta, así que solo se leen unas
 * pocas claves conocidas. Un paso nunca puede acabar mostrando el importe y el
 * nombre de un cliente de otro.
 */

/**
 * El tipo vive en `@strappy/agentes`: lo comparten los cinco oficios, y el
 * worker y la web lo leen igual venga de quien venga. Estaba copiado byte a
 * byte en cada paquete, así que añadir un estado nuevo al armazón habría dejado
 * a los demás atrás sin que nada avisara.
 */
import type { EstadoPaso, PasoTrabajo } from "@strappy/agentes";

export type { EstadoPaso, PasoTrabajo };

/** En gerundio y sin jerga contable: lo lee el dueño del negocio, no su contador. */
const ETIQUETAS: Readonly<Record<string, string>> = {
  admin_estado_de_caja: "Revisando cuánto te deben y cuánto entró",
  admin_informe_del_negocio: "Preparando el informe de cómo va el negocio",
  admin_facturas_por_cobrar: "Revisando las facturas sin pagar",
  admin_buscar_cliente: "Buscando al cliente",
  admin_emitir_factura: "Proponiendo emitir una factura",
  admin_registrar_pago: "Proponiendo registrar un pago",
  admin_preparar_recordatorio: "Escribiendo el recordatorio de cobro",
  pedir_aprobacion: "Pidiéndote aprobación",
  preguntar_al_cliente: "Haciéndote una pregunta",
};

export function etiquetaDePaso(herramienta: string): string {
  return ETIQUETAS[herramienta] ?? "Trabajando en tus cuentas";
}

/** Claves de la entrada que dan contexto sin riesgo, en orden de preferencia. */
const CLAVES_DETALLE = ["motivo", "pregunta", "propuesta", "texto", "factura_numero", "dias"] as const;

const PARECE_SECRETO = /pass|token|secret|clave|credencial|authorization|cookie/i;

export function recortar(texto: string, maximo = 90): string {
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
