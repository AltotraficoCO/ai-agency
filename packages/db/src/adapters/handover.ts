/**
 * `HandoverPort`: pasar la conversación a una persona y cerrarla.
 *
 * Escalar hace tres cosas indivisibles: marca `handover_state`, APAGA el bot y
 * deja el evento en la bitácora. Si solo se marcara el estado, el motor podría
 * seguir respondiendo por encima de la persona que acaba de tomar el mando —que
 * es exactamente el bug que la relectura de `handover_state` dentro del lock
 * existe para evitar, y que aquí no debe reintroducirse.
 */
import type { HandoverPort } from '@strappy/tools';
import type { TenantScope } from '../client.js';

export function crearHandoverPort(scope: TenantScope): HandoverPort {
  const ws = scope.workspaceId;

  return {
    async escalate({ workspaceId, conversationId, reason, urgency, summary }) {
      scope.assertSameWorkspace(workspaceId);

      const { rows } = await scope.query<{ assigned_team_id: string | null }>(
        `update public.conversations
            set handover_state = 'pending_human',
                bot_enabled = false,
                priority = case when $3 = 'alta' then 2 else priority end,
                assigned_team_id = coalesce(
                  assigned_team_id,
                  (select id from public.teams
                    where workspace_id = $1 and is_default limit 1)),
                updated_at = now()
          where workspace_id = $1 and id = $2
          returning assigned_team_id`,
        [ws, conversationId, urgency],
      );

      await scope.query(
        `insert into public.conversation_events
           (workspace_id, conversation_id, type, actor_type, payload)
         values ($1, $2, 'escalado_a_humano', 'bot', $3::jsonb)`,
        [
          ws,
          conversationId,
          JSON.stringify({ motivo: reason, urgencia: urgency, resumen: summary ?? null }),
        ],
      );

      if (summary) {
        await scope.query(
          `insert into public.notes (workspace_id, conversation_id, body)
           values ($1, $2, $3)`,
          [ws, conversationId, `El agente pasó la conversación: ${summary}`],
        );
      }

      const equipo = rows[0]?.assigned_team_id ?? undefined;
      // `notified` es honesto: aquí solo se deja la conversación en la bandeja.
      // El aviso al equipo lo manda el canal de notificaciones, que aún no existe.
      return { notified: false, ...(equipo ? { queue: equipo } : {}) };
    },

    async close({ workspaceId, conversationId, outcome, note }) {
      scope.assertSameWorkspace(workspaceId);
      await scope.query(
        `update public.conversations
            set status = 'closed', closed_at = now(), updated_at = now()
          where workspace_id = $1 and id = $2`,
        [ws, conversationId],
      );
      await scope.query(
        `insert into public.conversation_events
           (workspace_id, conversation_id, type, actor_type, payload)
         values ($1, $2, 'conversacion_cerrada', 'bot', $3::jsonb)`,
        [ws, conversationId, JSON.stringify({ resultado: outcome, nota: note ?? null })],
      );
    },
  };
}
