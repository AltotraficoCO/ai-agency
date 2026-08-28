/**
 * El registro del Webmaster: 39 herramientas definidas UNA sola vez.
 *
 * 23 de WordPress (incluidas `sitio_salud` y `verificar_http`), 10 del
 * conector estándar y 6 de navegador y referencias. Los adaptadores a AI SDK
 * y a MCP viven en `@strappy/tools` y salen de estas mismas definiciones: no
 * hay una segunda copia que pueda divergir.
 */
import { ToolRegistry, type ToolDef } from "@strappy/tools";
import { HERRAMIENTAS_WP } from "./wp.js";
import { HERRAMIENTAS_CONECTOR } from "./conector.js";
import { HERRAMIENTAS_NAVEGADOR } from "./navegador.js";

export * from "./wp.js";
export * from "./conector.js";
export * from "./navegador.js";

export const HERRAMIENTAS_WEBMASTER: readonly ToolDef<never, unknown>[] = [
  ...HERRAMIENTAS_WP,
  ...HERRAMIENTAS_CONECTOR,
  ...HERRAMIENTAS_NAVEGADOR,
];

/** Registro propio: no se mezcla con el de sistema para no exponerlo a todos. */
export const webmasterToolRegistry = new ToolRegistry().registerAll(HERRAMIENTAS_WEBMASTER);
