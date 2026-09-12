/**
 * El contexto que ven las herramientas del Velocista.
 *
 * Mismo principio que en el Webmaster y en Marketing: `@strappy/tools` valida
 * que ninguna herramienta declare `workspaceId`, `token` o `apiKey` como
 * parámetro del modelo. El sitio y el medidor viajan por aquí, inyectados por
 * el worker.
 */
import type { ToolContext } from "@strappy/tools";
import type { VelocidadContext } from "./ports.js";

export type VelocistaContext = ToolContext & {
  readonly velocidad: VelocidadContext;
};

export function requireVelocidad(ctx: ToolContext, toolSlug: string): VelocidadContext {
  const velocidad = (ctx as VelocistaContext).velocidad;
  if (!velocidad || typeof velocidad.taskId !== "string" || !Array.isArray(velocidad.historial)) {
    throw new Error(
      `La herramienta "${toolSlug}" se ejecutó sin contexto de velocidad. Lo inyecta el worker; nunca puede venir del modelo.`,
    );
  }
  return velocidad;
}

/** Permisos del Velocista. Deny by default. */
export const SCOPES = {
  velocidadRead: "velocidad:read",
  sitioRead: "sitio:read",
  sitioWrite: "sitio:write",
} as const;

/** Lo que se concede a un Velocista completo. */
export const SCOPES_VELOCISTA: readonly string[] = [
  SCOPES.velocidadRead,
  SCOPES.sitioRead,
  SCOPES.sitioWrite,
];

/** Solo mirar: mide, diagnostica y propone, pero no toca el sitio. */
export const SCOPES_VELOCISTA_LECTURA: readonly string[] = [SCOPES.velocidadRead, SCOPES.sitioRead];
