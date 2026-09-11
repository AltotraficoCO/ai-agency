/**
 * Construcción del conjunto de herramientas de un turno.
 *
 * El motor filtra después por tipo de agente; aquí solo se decide qué
 * herramientas EXISTEN para este agente, que es lo que hay en `agent_tools`
 * más las seis de sistema.
 *
 * Cada invocación deja una fila en `tool_runs`. No es telemetría opcional: sin
 * ella nadie puede responder «¿qué hizo mi agente?», que es la primera pregunta
 * cuando algo sale mal.
 */
import type { ToolSet } from "ai";
import type { ToolContract } from "@strappy/core";
import type { TenantScope } from "@strappy/db";
import {
  SYSTEM_TOOLS,
  toAiToolSet,
  toPromptContracts,
  type ToolContext,
  type ToolInvocationLog,
  type ToolPorts,
} from "@strappy/tools";

export type EntradaHerramientas = {
  scope: TenantScope;
  ports: ToolPorts;
  agentRunId?: string;
  /** Avisa de cada invocación en el acto. El simulador lo usa para enseñar el trabajo en vivo. */
  alInvocar?: (log: ToolInvocationLog) => void;
};

export function crearToolsFor(entrada: EntradaHerramientas) {
  return async (input: {
    workspaceId: string;
    agentId: string;
    conversationId: string;
  }): Promise<{ tools: ToolSet; contracts: readonly ToolContract[] }> => {
    const tools = toAiToolSet(SYSTEM_TOOLS, {
      onInvocation: (log) => {
        entrada.alInvocar?.(log);
        // Sin await: registrar no debe retrasar la respuesta al cliente, y si
        // el registro falla el turno sigue siendo válido. `started_at` queda en
        // `now()` —el inicio de la transacción del turno, igual que sus
        // mensajes— y `finished_at` en la hora real, para poder colgar cada
        // paso de su respuesta y medir cuánto tardó.
        void entrada.scope
          .query(
            `insert into public.tool_runs
               (workspace_id, agent_run_id, conversation_id, tool_slug,
                input, output, status, latency_ms, error_detail, finished_at)
             values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, clock_timestamp())`,
            [
              entrada.scope.workspaceId,
              entrada.agentRunId ?? null,
              input.conversationId || null,
              log.slug,
              JSON.stringify(log.input ?? {}),
              log.output === undefined ? null : JSON.stringify(log.output),
              log.error ? "failed" : "succeeded",
              log.durationMs,
              log.error ?? null,
            ],
          )
          .catch(() => undefined);
      },
    });

    return { tools, contracts: toPromptContracts(SYSTEM_TOOLS) };
  };
}

export function crearToolContext(input: {
  workspaceId: string;
  agentId: string;
  conversationId: string;
  contactId?: string;
  agentRunId?: string;
  channelSlug: string;
  /** Lo decide el canal, no el motor: el simulador ejecuta en seco. */
  dryRun: boolean;
  ports: ToolPorts;
  timezone?: string;
}): ToolContext {
  return {
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    conversationId: input.conversationId,
    ...(input.contactId ? { contactId: input.contactId } : {}),
    ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
    channelSlug: input.channelSlug,
    dryRun: input.dryRun,
    // Deny by default: solo lo que un agente conversacional necesita.
    scopes: ["knowledge:read", "contacts:write", "handover:write", "scheduling:write"],
    ports: input.ports,
    now: () => new Date(),
    ...(input.timezone ? { timezone: input.timezone } : {}),
  };
}
