/**
 * El contexto que ven las herramientas del Webmaster.
 *
 * `@strappy/tools` define `ToolContext` con `workspaceId`, `scopes`, `dryRun`
 * y los puertos genéricos. El Webmaster necesita además el sitio sobre el que
 * trabaja, y ese dato NO puede venir del modelo: si el modelo pudiera elegir
 * la URL o las credenciales, una inyección de prompt sería un cambio en el
 * WordPress de otro cliente. Por eso viaja aquí, inyectado por el runtime, y
 * el registro de `@strappy/tools` rechaza al arrancar cualquier herramienta
 * que declare `workspaceId` o `token` como parámetro.
 */
import type { ToolContext } from "@strappy/tools";
import type { SitioContext } from "./ports.js";

export type WebmasterContext = ToolContext & {
  readonly sitio: SitioContext;
};

export function requireSitio(ctx: ToolContext, toolSlug: string): SitioContext {
  const sitio = (ctx as WebmasterContext).sitio;
  if (!sitio || typeof sitio.siteId !== "string" || typeof sitio.taskId !== "string") {
    throw new Error(
      `La herramienta "${toolSlug}" se ejecutó sin contexto de sitio. El worker debe inyectarlo; nunca puede venir del modelo.`,
    );
  }
  return sitio;
}

/** Permisos del Webmaster. Deny by default: el worker concede solo los que aplican. */
export const SCOPES = {
  wpRead: "wp:read",
  wpWrite: "wp:write",
  wpAdmin: "wp:admin",
  conectorRead: "conector:read",
  conectorWrite: "conector:write",
  navegador: "navegador:use",
} as const;

/** Todos los permisos que puede necesitar un Webmaster sobre un WordPress. */
export const SCOPES_WORDPRESS: readonly string[] = [
  SCOPES.wpRead,
  SCOPES.wpWrite,
  SCOPES.wpAdmin,
  SCOPES.navegador,
];

/** Los de un sitio propio conectado por el contrato estándar. */
export const SCOPES_CONECTOR: readonly string[] = [
  SCOPES.conectorRead,
  SCOPES.conectorWrite,
  SCOPES.navegador,
];
