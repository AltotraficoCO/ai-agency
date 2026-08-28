/**
 * Contexto de ejecución de una herramienta.
 *
 * `workspaceId` lo inyecta el runtime y es inmutable. NUNCA llega como
 * parámetro del modelo: si el modelo pudiera elegir el workspace, cualquier
 * inyección de prompt sería una fuga de datos entre clientes. El registro
 * rechaza al arrancar cualquier herramienta cuyo esquema declare ese campo.
 */
import type { ToolPorts } from "./ports.js";

export type ToolContext = {
  /** Inmutable e inyectado por el runtime. Frontera de aislamiento entre clientes. */
  readonly workspaceId: string;
  readonly agentId?: string;
  readonly conversationId?: string;
  /** Contacto de la conversación, si la herramienta corre dentro de una. */
  readonly contactId?: string;
  readonly agentRunId?: string;
  /** Slug del canal. Solo para trazas: ninguna herramienta cambia según el canal. */
  readonly channelSlug?: string;
  /**
   * Efectos externos en seco. Lo pone el runtime a partir del canal
   * (el simulador lo activa). La herramienta no pregunta por el canal.
   */
  readonly dryRun: boolean;
  /** Permisos concedidos a esta ejecución. Deny by default. */
  readonly scopes: readonly string[];
  readonly ports: ToolPorts;
  readonly now: () => Date;
  readonly timezone?: string;
  readonly abortSignal?: AbortSignal;
};

export class ToolScopeError extends Error {
  constructor(
    readonly toolSlug: string,
    readonly missing: readonly string[],
  ) {
    super(
      `La herramienta "${toolSlug}" necesita permisos que esta ejecución no tiene: ${missing.join(", ")}.`,
    );
    this.name = "ToolScopeError";
  }
}

export function assertScopes(ctx: ToolContext, toolSlug: string, required: readonly string[]): void {
  const faltan = required.filter((s) => !ctx.scopes.includes(s));
  if (faltan.length > 0) throw new ToolScopeError(toolSlug, faltan);
}

/** Verifica que lo que llegó por `experimental_context` es un contexto de verdad. */
export function assertToolContext(value: unknown, toolSlug: string): ToolContext {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as ToolContext).workspaceId !== "string" ||
    (value as ToolContext).workspaceId.length === 0
  ) {
    throw new Error(
      `La herramienta "${toolSlug}" se ejecutó sin ToolContext. El runtime debe inyectarlo; nunca puede venir del modelo.`,
    );
  }
  return value as ToolContext;
}

const CLAVES_SECRETAS = /(token|secret|password|passwd|apikey|api_key|authorization|cookie|credential|private_key)/i;

/**
 * Filtra secretos antes de persistir o registrar cualquier cosa.
 * Se aplica a los argumentos y al resultado de toda herramienta: un token que
 * entra al historial de una conversación ya no se puede sacar de ahí.
 */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = CLAVES_SECRETAS.test(k) ? "«oculto»" : redactSecrets(v, depth + 1);
  }
  return out as unknown as T;
}
