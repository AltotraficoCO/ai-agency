/**
 * El contexto que ven las herramientas del agente Administrativo.
 *
 * Mismo principio que en el Webmaster y en Marketing: `@strappy/tools` valida
 * que ninguna herramienta declare `workspaceId`, `token` o `apiKey` como
 * parámetro del modelo. La conexión contable viaja por aquí, inyectada por el
 * worker.
 */
import type { ToolContext } from "@strappy/tools";
import type { LibrosContext } from "./ports.js";

export type AdministrativoContext = ToolContext & {
  readonly libros: LibrosContext;
};

export function requireLibros(ctx: ToolContext, toolSlug: string): LibrosContext {
  const libros = (ctx as AdministrativoContext).libros;
  if (!libros || typeof libros.taskId !== "string" || typeof libros.conexionId !== "string") {
    throw new Error(
      `La herramienta "${toolSlug}" se ejecutó sin contexto de contabilidad. Lo inyecta el worker; nunca puede venir del modelo.`,
    );
  }
  return libros;
}

/** Permisos del agente Administrativo. Deny by default. */
export const SCOPES = {
  contabilidadRead: "contabilidad:read",
  contabilidadWrite: "contabilidad:write",
} as const;

/** Lo que se concede a un agente administrativo completo. */
export const SCOPES_ADMINISTRATIVO: readonly string[] = [
  SCOPES.contabilidadRead,
  SCOPES.contabilidadWrite,
];

/** Solo mirar: útil mientras el cliente no quiera que se emita nada en su nombre. */
export const SCOPES_ADMINISTRATIVO_LECTURA: readonly string[] = [SCOPES.contabilidadRead];
