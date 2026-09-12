/**
 * El contexto que ven las herramientas de Marketing.
 *
 * Mismo principio que en el Webmaster: `@strappy/tools` valida que ninguna
 * herramienta declare `workspaceId`, `token` o `apiKey` como parámetro del
 * modelo. Las cuentas publicitarias viajan por aquí, inyectadas por el worker.
 */
import type { ToolContext } from "@strappy/tools";
import type { CuentasContext } from "./ports.js";

export type MarketingContext = ToolContext & {
  readonly cuentas: CuentasContext;
};

export function requireCuentas(ctx: ToolContext, toolSlug: string): CuentasContext {
  const cuentas = (ctx as MarketingContext).cuentas;
  if (!cuentas || typeof cuentas.taskId !== "string" || !Array.isArray(cuentas.ads)) {
    throw new Error(
      `La herramienta "${toolSlug}" se ejecutó sin contexto de cuentas. Lo inyecta el worker; nunca puede venir del modelo.`,
    );
  }
  return cuentas;
}

/** Permisos del agente de Marketing. Deny by default. */
export const SCOPES = {
  adsRead: "ads:read",
  adsWrite: "ads:write",
  analyticsRead: "analytics:read",
} as const;

/** Lo que se concede a un agente de Marketing completo. */
export const SCOPES_MARKETING: readonly string[] = [
  SCOPES.adsRead,
  SCOPES.adsWrite,
  SCOPES.analyticsRead,
];

/** Solo mirar: útil mientras la conexión de la plataforma no permita escribir. */
export const SCOPES_MARKETING_LECTURA: readonly string[] = [SCOPES.adsRead, SCOPES.analyticsRead];
