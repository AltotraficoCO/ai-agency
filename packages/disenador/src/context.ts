/**
 * El contexto que ven las herramientas del Diseñador.
 *
 * Mismo principio que en el resto de agentes: `@strappy/tools` valida que
 * ninguna herramienta declare `workspaceId`, `token` o `apiKey` como parámetro
 * del modelo. El generador de imágenes y la biblioteca del sitio viajan por
 * aquí, inyectados por el worker.
 */
import type { ToolContext } from "@strappy/tools";
import type { DisenoContext } from "./ports.js";

export type DisenadorContext = ToolContext & {
  readonly diseno: DisenoContext;
};

export function requireDiseno(ctx: ToolContext, toolSlug: string): DisenoContext {
  const diseno = (ctx as DisenadorContext).diseno;
  if (!diseno || typeof diseno.taskId !== "string") {
    throw new Error(
      `La herramienta "${toolSlug}" se ejecutó sin contexto de diseño. Lo inyecta el worker; nunca puede venir del modelo.`,
    );
  }
  return diseno;
}

/** Permisos del Diseñador. Deny by default. */
export const SCOPES = {
  /** Mirar el estilo del sitio y su biblioteca. */
  disenoRead: "diseno:read",
  /** Generar una imagen: gasta créditos de la cartera. */
  imagenCrear: "imagen:create",
  /** Subir a la biblioteca del cliente. */
  mediosWrite: "medios:write",
} as const;

export const SCOPES_DISENADOR: readonly string[] = [
  SCOPES.disenoRead,
  SCOPES.imagenCrear,
  SCOPES.mediosWrite,
];

/** Solo diseñar: útil cuando el cliente no quiere que se suba nada a su sitio. */
export const SCOPES_DISENADOR_SIN_PUBLICAR: readonly string[] = [
  SCOPES.disenoRead,
  SCOPES.imagenCrear,
];
