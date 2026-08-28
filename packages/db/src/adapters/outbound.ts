/**
 * `OutboundQueue` contra `messages`.
 *
 * No hay tabla de cola aparte a propósito: el mensaje saliente NACE en
 * `messages` con `status = 'pending'` y quien envía de verdad lo pasa a `sent`.
 * Así la bandeja ve la respuesta en el mismo instante en que el motor la
 * decide, sin esperar al proveedor, y no hay dos fuentes de verdad.
 *
 * La idempotencia se apoya en `messages_ws_external_uniq (workspace_id,
 * external_id)`: un reintento del worker reusa la misma clave y el segundo
 * insert no hace nada.
 */
import type { OutboundQueue } from '@strappy/core';
import type { TenantScope } from '../client.js';
import { aColumnas } from './content.js';

export function crearOutboundQueue(scope: TenantScope): OutboundQueue {
  const ws = scope.workspaceId;

  return {
    async enqueue({ message, workspaceId, channelId, agentRunId, idempotencyKey }) {
      scope.assertSameWorkspace(workspaceId);
      const { contentType, content } = aColumnas(message.content);

      const { rows } = await scope.query<{ id: string }>(
        `with agente as (
           select agent_id, agent_version_id
             from public.agent_runs
            where workspace_id = $1 and id = $2
         ), nuevo as (
           insert into public.messages
             (workspace_id, conversation_id, contact_id, channel_id, external_id,
              direction, author_type, agent_id, agent_version_id,
              content_type, content, status, sent_at)
           select $1, c.id, c.contact_id, $3, $4,
                  'outbound', 'bot', a.agent_id, a.agent_version_id,
                  -- clock_timestamp(), no now(): dentro de una transacción
                  -- now() es la hora de apertura y empata con el entrante.
                  $5, $6::jsonb, 'pending', clock_timestamp()
             from public.conversations c, agente a
            where c.workspace_id = $1 and c.id = $7
           on conflict do nothing
           returning id
         )
         select id from nuevo
         union all
         select id from public.messages
          where workspace_id = $1 and external_id = $4
          limit 1`,
        [
          ws,
          agentRunId,
          channelId,
          idempotencyKey,
          contentType,
          JSON.stringify(content),
          message.conversationId,
        ],
      );

      const fila = rows[0];
      if (!fila) throw new Error('No se pudo encolar el mensaje saliente.');
      return { queuedId: fila.id };
    },
  };
}

/** Marca un saliente como entregado. Lo llama el transporte, no el motor. */
export async function marcarEnviado(
  scope: TenantScope,
  input: { messageId: string; externalId: string },
): Promise<void> {
  await scope.query(
    `update public.messages
        set status = 'sent', external_id = $3, sent_at = coalesce(sent_at, now())
      where workspace_id = $1 and id = $2 and status = 'pending'`,
    [scope.workspaceId, input.messageId, input.externalId],
  );
}
