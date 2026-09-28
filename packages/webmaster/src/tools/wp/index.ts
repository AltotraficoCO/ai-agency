/**
 * Las herramientas de WordPress del Webmaster.
 *
 * Cada una se define UNA vez, con `defineTool` de `@strappy/tools`. En el
 * proyecto anterior la misma herramienta estaba escrita dos veces —una en
 * `executor.ts` y otra en `mcp/server.ts`— y las dos copias divergieron; los
 * adaptadores a AI SDK y a MCP viven en el registro y no aquí.
 *
 * Toda mutación hace tres cosas antes de tocar el sitio:
 *   1. lee el estado actual (nunca se edita a ciegas),
 *   2. lo guarda como backup y devuelve `backup_id`,
 *   3. pasa por la puerta de aprobación si la acción es sensible.
 */
import type { ToolDef } from "@strappy/tools";
import { esBloqueo } from "../../aprobacion.js";
import { sitioSalud, sitioLeerDiseno, wpListarContenido, wpLeerContenido, wpListarPlugins, wpLeerAjustes, wpListarComentarios, wpListarUsuarios } from "./lectura.js";
import { wpEditarContenido, wpCrearContenido, wpBorrarContenido, wpCambiosRecientes, wpRestaurarContenido } from "./contenido.js";
import { wpInstalarPlugin, wpCambiarPlugin, wpEliminarPlugin } from "./plugins.js";
import { wpActualizarAjustes, wpModerarComentario, wpCrearTermino, wpSubirMedia, wpListarMedios } from "./ajustes.js";
import { wpCrearUsuario, wpCambiarRolUsuario } from "./usuarios.js";
import { wpCrearPaginaElementor, wpCrearHeaderGlobal } from "./elementor.js";
import { verificarHttp, wpRefrescarCache } from "./verificacion.js";

export * from "./lectura.js";
export * from "./contenido.js";
export * from "./plugins.js";
export * from "./ajustes.js";
export * from "./usuarios.js";
export * from "./elementor.js";
export * from "./verificacion.js";

export const HERRAMIENTAS_WP: readonly ToolDef<never, unknown>[] = [
  sitioSalud,
  sitioLeerDiseno,
  wpRefrescarCache,
  wpListarContenido,
  wpLeerContenido,
  wpListarPlugins,
  wpLeerAjustes,
  wpListarComentarios,
  wpListarUsuarios,
  wpEditarContenido,
  wpCrearContenido,
  wpBorrarContenido,
  wpCambiosRecientes,
  wpRestaurarContenido,
  wpInstalarPlugin,
  wpCambiarPlugin,
  wpEliminarPlugin,
  wpActualizarAjustes,
  wpModerarComentario,
  wpCrearTermino,
  wpSubirMedia,
  wpListarMedios,
  wpCrearUsuario,
  wpCambiarRolUsuario,
  wpCrearPaginaElementor,
  wpCrearHeaderGlobal,
  verificarHttp,
] as unknown as readonly ToolDef<never, unknown>[];

export { esBloqueo };
