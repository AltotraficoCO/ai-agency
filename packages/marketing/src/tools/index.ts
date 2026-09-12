/**
 * El registro del agente de Marketing: 8 herramientas definidas una sola vez.
 *
 * 3 de lectura (cuentas, campañas con su análisis, Analytics), 3 que tocan
 * dinero y siempre pasan por aprobación humana, y 2 para hablar con el cliente.
 * Igual que en el Webmaster, los adaptadores a AI SDK y a MCP salen de estas
 * mismas definiciones: no hay una segunda copia que pueda divergir.
 */
import { ToolRegistry, type ToolDef } from "@strappy/tools";
import { HERRAMIENTAS_LECTURA } from "./lectura.js";
import { HERRAMIENTAS_CAMBIOS } from "./cambios.js";
import { HERRAMIENTAS_CONFIRMACION } from "./confirmacion.js";

export * from "./lectura.js";
export * from "./cambios.js";
export * from "./confirmacion.js";
export * from "./comun.js";

export const HERRAMIENTAS_MARKETING: readonly ToolDef<never, unknown>[] = [
  ...HERRAMIENTAS_LECTURA,
  ...HERRAMIENTAS_CAMBIOS,
  ...HERRAMIENTAS_CONFIRMACION,
];

/** Registro propio, separado del de sistema y del del Webmaster. */
export const marketingToolRegistry = new ToolRegistry().registerAll(HERRAMIENTAS_MARKETING);
