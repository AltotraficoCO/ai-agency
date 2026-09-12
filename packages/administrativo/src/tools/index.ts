/**
 * El registro del agente Administrativo: 8 herramientas definidas una sola vez.
 *
 * 3 de lectura (caja, facturas por cobrar, clientes), 2 que dejan papel en la
 * contabilidad y siempre pasan por aprobación humana, 1 que redacta el cobro
 * sin enviarlo y 2 para hablar con el cliente. Igual que en el Webmaster y en
 * Marketing, los adaptadores a AI SDK y a MCP salen de estas mismas
 * definiciones: no hay una segunda copia que pueda divergir.
 */
import { ToolRegistry, type ToolDef } from "@strappy/tools";
import { HERRAMIENTAS_LECTURA } from "./lectura.js";
import { HERRAMIENTAS_DOCUMENTOS } from "./documentos.js";
import { HERRAMIENTAS_COBROS } from "./cobros.js";
import { HERRAMIENTAS_CONFIRMACION } from "./confirmacion.js";

export * from "./lectura.js";
export * from "./documentos.js";
export * from "./cobros.js";
export * from "./confirmacion.js";
export * from "./comun.js";

export const HERRAMIENTAS_ADMINISTRATIVO: readonly ToolDef<never, unknown>[] = [
  ...HERRAMIENTAS_LECTURA,
  ...HERRAMIENTAS_DOCUMENTOS,
  ...HERRAMIENTAS_COBROS,
  ...HERRAMIENTAS_CONFIRMACION,
];

/** Registro propio, separado del de sistema y del de los demás agentes. */
export const administrativoToolRegistry = new ToolRegistry().registerAll(HERRAMIENTAS_ADMINISTRATIVO);
