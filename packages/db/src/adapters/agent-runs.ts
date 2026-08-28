/**
 * `AgentRunStore` contra `agent_runs`.
 *
 * Cada turno del motor abre una fila aquí. Es a la vez la traza para depurar
 * («¿por qué no contestó?») y la línea de la factura: `credits` y `steps` salen
 * de aquí, y `usage_daily` se agrega a partir de esta tabla.
 */
import type { AgentRunStore, SkipReason } from '@strappy/core';
import type { TenantScope } from '../client.js';
import { motivoDeSalto } from './conversations.js';

const ESTADOS: Record<'ok' | 'skipped' | 'error', string> = {
  ok: 'succeeded',
  skipped: 'skipped',
  error: 'failed',
};

const MOTIVOS = new Set<SkipReason>([
  'taken_over',
  'bot_disabled',
  'paused',
  'contact_blocked',
  'no_credits',
  'channel_restricted',
  'lock_busy',
  'superseded',
]);

export type OpcionesAgentRun = {
  /** Qué disparó la ejecución. `manual` es lo que usa el simulador. */
  trigger?: 'inbound' | 'schedule' | 'automation' | 'manual' | 'retry' | 'catalog_task';
  mode?: 'lite' | 'max';
};

export function crearAgentRunStore(
  scope: TenantScope,
  opciones: OpcionesAgentRun = {},
): AgentRunStore {
  const ws = scope.workspaceId;
  const trigger = opciones.trigger ?? 'inbound';

  return {
    async start({ workspaceId, agentId, conversationId, promptHash, model }) {
      scope.assertSameWorkspace(workspaceId);
      const { rows } = await scope.query<{ id: string }>(
        `insert into public.agent_runs
           (workspace_id, agent_id, conversation_id, trigger, status, mode, model, metadata)
         values ($1, $2, $3, $4, 'running', $5, $6, jsonb_build_object('prompt_hash', $7::text))
         returning id`,
        [ws, agentId, conversationId, trigger, opciones.mode ?? null, model, promptHash],
      );
      const fila = rows[0];
      if (!fila) throw new Error('No se pudo abrir la ejecución del agente.');
      return { id: fila.id };
    },

    async finish({ agentRunId, status, steps, credits, detail, restriction }) {
      // `detail` trae el motivo del salto cuando el motor omite la respuesta.
      const motivo =
        status === 'skipped' && detail && MOTIVOS.has(detail as SkipReason)
          ? motivoDeSalto(detail as SkipReason)
          : null;

      await scope.query(
        `update public.agent_runs
            set status       = $3,
                steps        = $4,
                credits      = $5,
                skip_reason  = coalesce($6, skip_reason),
                error_detail = coalesce($7, error_detail),
                finished_at  = now(),
                latency_ms   = greatest(0, (extract(epoch from (now() - started_at)) * 1000)::int),
                metadata     = metadata || $8::jsonb
          where workspace_id = $1 and id = $2`,
        [
          ws,
          agentRunId,
          ESTADOS[status],
          steps,
          credits,
          motivo,
          status === 'error' ? (detail ?? null) : null,
          JSON.stringify(
            restriction
              ? { restriccion: { codigo: restriction.code, mensaje: restriction.message } }
              : {},
          ),
        ],
      );
    },
  };
}
