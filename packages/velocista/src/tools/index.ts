/**
 * El registro del Velocista: 8 herramientas definidas una sola vez.
 *
 * 5 de lectura (medir, páginas, imágenes, complementos, comparar), 1 que toca
 * la web del cliente y siempre pasa por aprobación humana, y 2 para hablar con
 * el cliente. Igual que en los demás agentes, los adaptadores a AI SDK y a MCP
 * salen de estas mismas definiciones: no hay una segunda copia que diverja.
 */
import { ToolRegistry, type ToolDef } from "@strappy/tools";
import { HERRAMIENTAS_LECTURA } from "./lectura.js";
import { HERRAMIENTAS_CAMBIOS } from "./cambios.js";
import { HERRAMIENTAS_CONFIRMACION } from "./confirmacion.js";

export * from "./lectura.js";
export * from "./cambios.js";
export * from "./confirmacion.js";
export * from "./comun.js";

export { HERRAMIENTAS_LECTURA, HERRAMIENTAS_CAMBIOS };

/** Las de velocidad a secas, sin confirmación: el Webmaster ya tiene la suya. */
export const HERRAMIENTAS_VELOCIDAD: readonly ToolDef<never, unknown>[] = [
  ...HERRAMIENTAS_LECTURA,
  ...HERRAMIENTAS_CAMBIOS,
];

export const HERRAMIENTAS_VELOCISTA: readonly ToolDef<never, unknown>[] = [
  ...HERRAMIENTAS_LECTURA,
  ...HERRAMIENTAS_CAMBIOS,
  ...HERRAMIENTAS_CONFIRMACION,
];

/** Registro propio, separado del de sistema y del de los demás agentes. */
export const velocistaToolRegistry = new ToolRegistry().registerAll(HERRAMIENTAS_VELOCISTA);
