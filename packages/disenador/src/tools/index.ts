/**
 * El registro del Diseñador: 6 herramientas definidas una sola vez.
 *
 * 2 de mirar (el estilo de la marca y la biblioteca del cliente), 2 que cuestan
 * algo (dibujar y publicar) y 2 para hablar con el cliente. Igual que en el
 * resto de agentes, los adaptadores a AI SDK y a MCP salen de estas mismas
 * definiciones: no hay una segunda copia que pueda divergir.
 */
import { ToolRegistry, type ToolDef } from "@strappy/tools";
import { HERRAMIENTAS_LECTURA } from "./lectura.js";
import { HERRAMIENTAS_CREACION } from "./creacion.js";
import { HERRAMIENTAS_CONFIRMACION } from "./confirmacion.js";

export * from "./lectura.js";
export * from "./creacion.js";
export * from "./confirmacion.js";
export * from "./comun.js";

export const HERRAMIENTAS_DISENADOR: readonly ToolDef<never, unknown>[] = [
  ...HERRAMIENTAS_LECTURA,
  ...HERRAMIENTAS_CREACION,
  ...HERRAMIENTAS_CONFIRMACION,
];

/** Registro propio, separado del de sistema y del de los demás agentes. */
export const disenadorToolRegistry = new ToolRegistry().registerAll(HERRAMIENTAS_DISENADOR);
