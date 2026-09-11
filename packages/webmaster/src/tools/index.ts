/**
 * El registro del Webmaster: 45 herramientas definidas UNA sola vez.
 *
 * 24 de WordPress (incluidas `sitio_salud`, `sitio_leer_diseno` y `verificar_http`), 3 de plantillas
 * de Elementor, 10 del conector estándar, 6 de navegador y referencias, y
 * `pedir_aprobacion`, que es como el agente le pregunta algo al cliente. Los
 * adaptadores a AI SDK y a MCP viven en `@strappy/tools` y salen de estas mismas
 * definiciones: no hay una segunda copia que pueda divergir.
 */
import { ToolRegistry, type ToolDef } from "@strappy/tools";
import { HERRAMIENTAS_WP } from "./wp.js";
import { HERRAMIENTAS_ELEMENTOR } from "./elementor.js";
import { HERRAMIENTAS_CONECTOR } from "./conector.js";
import { HERRAMIENTAS_NAVEGADOR } from "./navegador.js";
import { HERRAMIENTAS_CONFIRMACION } from "./confirmacion.js";

export * from "./wp.js";
export * from "./elementor.js";
export * from "./conector.js";
export * from "./navegador.js";
export * from "./confirmacion.js";

export const HERRAMIENTAS_WEBMASTER: readonly ToolDef<never, unknown>[] = [
  ...HERRAMIENTAS_WP,
  ...HERRAMIENTAS_ELEMENTOR,
  ...HERRAMIENTAS_CONECTOR,
  ...HERRAMIENTAS_NAVEGADOR,
  ...HERRAMIENTAS_CONFIRMACION,
];

/** Registro propio: no se mezcla con el de sistema para no exponerlo a todos. */
export const webmasterToolRegistry = new ToolRegistry().registerAll(HERRAMIENTAS_WEBMASTER);
