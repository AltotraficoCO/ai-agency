/**
 * El registro de trabajo del agente de Marketing.
 *
 * Mismo contrato que el del Webmaster (`@strappy/webmaster/pasos`): mientras el
 * encargo corre, la persona no ve llamadas a herramientas sino pasos contados
 * para ella, que cambian de estado en vivo. Lo que cambia son las etiquetas:
 * aquí se habla de campañas y de presupuestos, no de páginas y plugins.
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

/** En gerundio y sin siglas: lo lee el dueño del negocio, no un anunciante. */
const ETIQUETAS: Readonly<Record<string, string>> = {
  ads_listar_cuentas: "Revisando tus cuentas de publicidad",
  ads_revisar_campanas: "Mirando cómo van tus campañas",
  analytics_resumen_web: "Revisando las visitas de tu web",
  ads_cambiar_presupuesto: "Proponiendo un cambio de presupuesto",
  ads_pausar_campana: "Proponiendo pausar una campaña",
  ads_activar_campana: "Proponiendo reactivar una campaña",
  pedir_aprobacion: "Pidiéndote aprobación",
  preguntar_al_cliente: "Haciéndote una pregunta",
};

export function etiquetaDePaso(herramienta: string): string {
  return ETIQUETAS[herramienta] ?? "Trabajando en tu publicidad";
}

/** Claves de la entrada que dan contexto sin riesgo, en orden de preferencia. */
const CLAVES_DETALLE = ["motivo", "pregunta", "propuesta", "campana_id", "cuenta_id", "plataforma"] as const;

const PARECE_SECRETO = /pass|token|secret|clave|credencial|authorization|cookie/i;

/** Local a propósito: `tools/comun.ts` ya publica un `recortar` para otra cosa. */
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
