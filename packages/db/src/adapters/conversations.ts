/**
 * `ConversationStore` contra el esquema real.
 *
 * Índices en los que se apoya:
 *   messages_ws_conv_created_idx (workspace_id, conversation_id, created_at desc)
 *   conversation_events_ws_conv_idx (workspace_id, conversation_id, created_at desc)
 *
 * Todo orden por `created_at` lleva desempate por `direction` y por `id`. No es
 * pedantería: el mensaje que entra y la respuesta que sale se escriben en la
 * MISMA transacción, y `now()` devuelve la hora de la transacción, no la del
 * INSERT. Sin desempate los dos empatan y el agente puede acabar leyendo su
 * propia respuesta antes que la pregunta.
 *
 * El resumen rodante vive en dos sitios a propósito: el texto en
 * `conversations.summary` (que es lo que la bandeja enseña) y su metadato
 * —hasta qué mensaje resume y cuántos lleva— en `conversations.variables._resumen`.
 * Así no hace falta una tabla más y la interfaz sigue leyendo una columna de texto.
 */
import type {
  ConversationSnapshot,
  ConversationStore,
  HandoverState,
  RollingSummary,
  SkipReason,
  StoredMessage,
} from '@strappy/core';
import type { TenantScope } from '../client.js';
import { desdeColumnas } from './content.js';
import { CLAVE_RESUMEN, aFecha, datosRecogidos } from './util.js';

/**
 * Traducción de los motivos del motor a `agent_runs.skip_reason`, que es un
 * conjunto cerrado en el esquema. `lock_busy` y `superseded` no tienen columna
 * propia: son duplicados de trabajo, y como tales se registran.
 */
const MOTIVO_A_COLUMNA: Record<SkipReason, string> = {
  taken_over: 'taken_over',
  bot_disabled: 'bot_disabled',
  paused: 'bot_paused',
  contact_blocked: 'contact_blocked',
  no_credits: 'no_credits',
  channel_restricted: 'send_restricted',
  lock_busy: 'duplicate',
  superseded: 'duplicate',
};

export function motivoDeSalto(reason: SkipReason): string {
  return MOTIVO_A_COLUMNA[reason];
}

type FilaConversacion = {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  channel_id: string;
  channel_kind: string;
  handover_state: string;
  bot_enabled: boolean;
  bot_paused_until: string | null;
  contact_blocked: boolean;
  external_contact_id: string | null;
  contact_name: string | null;
  contact_notes: string | null;
  variables: Record<string, unknown> | null;
  timezone: string | null;
  message_count: string | number;
};

/**
 * Quién manda ahora mismo, resuelto a los tres estados que entiende el motor.
 * El esquema tiene tres señales distintas —`handover_state`, `bot_enabled` y
 * `bot_paused_until`— y el motor solo necesita saber si debe hablar.
 */
export function estadoDeMando(fila: {
  handover_state: string;
  bot_enabled: boolean;
  bot_paused_until: string | Date | null;
}): HandoverState {
  if (fila.handover_state === 'human' || fila.handover_state === 'pending_human') return 'human';
  if (!fila.bot_enabled) return 'paused';
  if (fila.bot_paused_until && aFecha(fila.bot_paused_until).getTime() > Date.now()) return 'paused';
  return 'bot';
}

export function crearConversationStore(scope: TenantScope): ConversationStore {
  const ws = scope.workspaceId;

  return {
    async load(conversationId): Promise<ConversationSnapshot | null> {
      const { rows } = await scope.query<FilaConversacion>(
        `select c.id,
                c.workspace_id,
                c.agent_id,
                c.channel_id,
                ch.kind                                as channel_kind,
                c.handover_state,
                c.bot_enabled,
                c.bot_paused_until,
                ct.is_blocked                          as contact_blocked,
                coalesce(ct.external_id, ct.phone, ct.id::text) as external_contact_id,
                ct.name                                as contact_name,
                ct.properties->>'notas'                as contact_notes,
                c.variables,
                coalesce(w.timezone, 'America/Bogota') as timezone,
                (select count(*) from public.messages m
                  where m.workspace_id = c.workspace_id
                    and m.conversation_id = c.id)      as message_count
           from public.conversations c
           join public.contacts   ct on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
           join public.channels   ch on ch.workspace_id = c.workspace_id and ch.id = c.channel_id
           join public.workspaces w  on w.id = c.workspace_id
          where c.workspace_id = $1 and c.id = $2`,
        [ws, conversationId],
      );
      const fila = rows[0];
      if (!fila) return null;
      if (!fila.agent_id) return null;

      const contacto: { name?: string; notes?: string } = {};
      if (fila.contact_name) contacto.name = fila.contact_name;
      if (fila.contact_notes) contacto.notes = fila.contact_notes;

      return {
        id: fila.id,
        workspaceId: fila.workspace_id,
        agentId: fila.agent_id,
        channelId: fila.channel_id,
        channelSlug: fila.channel_kind,
        externalContactId: fila.external_contact_id ?? fila.id,
        handoverState: estadoDeMando(fila),
        contactBlocked: fila.contact_blocked,
        messageCount: Number(fila.message_count),
        ...(Object.keys(contacto).length > 0 ? { contact: contacto } : {}),
        collected: datosRecogidos(fila.variables),
        timezone: fila.timezone ?? 'America/Bogota',
      };
    },

    async readHandoverState(conversationId): Promise<HandoverState> {
      const { rows } = await scope.query<{
        handover_state: string;
        bot_enabled: boolean;
        bot_paused_until: string | null;
      }>(
        `select handover_state, bot_enabled, bot_paused_until
           from public.conversations
          where workspace_id = $1 and id = $2`,
        [ws, conversationId],
      );
      const fila = rows[0];
      // Sin fila no hay a quién responder: se trata como si una persona hubiera
      // tomado el mando, que es la salida segura.
      if (!fila) return 'human';
      return estadoDeMando(fila);
    },

    async listRecentMessages(conversationId, limit): Promise<readonly StoredMessage[]> {
      const { rows } = await scope.query<{
        id: string;
        direction: string;
        author_type: string;
        content_type: string;
        content: unknown;
        sent_at: string | null;
        created_at: string;
      }>(
        `select id, direction, author_type, content_type, content, sent_at, created_at
           from public.messages
          where workspace_id = $1 and conversation_id = $2
            and status <> 'deleted'
          order by created_at desc, direction desc, id desc
          limit $3`,
        [ws, conversationId, limit],
      );
      return rows.reverse().map(aMensajeGuardado);
    },

    async listMessagesForSummary({ conversationId, sinceMessageId, limit }) {
      const { rows } = await scope.query<{
        id: string;
        direction: string;
        author_type: string;
        content_type: string;
        content: unknown;
        sent_at: string | null;
        created_at: string;
      }>(
        `select m.id, m.direction, m.author_type, m.content_type, m.content, m.sent_at, m.created_at
           from public.messages m
          where m.workspace_id = $1 and m.conversation_id = $2
            and m.status <> 'deleted'
            and ($3::uuid is null or m.created_at > (
                  select m2.created_at from public.messages m2
                   where m2.workspace_id = $1 and m2.id = $3::uuid))
          order by m.created_at asc, m.direction asc, m.id asc
          limit $4`,
        [ws, conversationId, sinceMessageId ?? null, Math.max(0, limit)],
      );
      return rows.map(aMensajeGuardado);
    },

    async loadSummary(conversationId): Promise<RollingSummary | null> {
      const { rows } = await scope.query<{
        summary: string | null;
        meta: { through_message_id?: string; message_count?: number } | null;
      }>(
        `select summary, variables->$3 as meta
           from public.conversations
          where workspace_id = $1 and id = $2`,
        [ws, conversationId, CLAVE_RESUMEN],
      );
      const fila = rows[0];
      if (!fila?.summary || !fila.meta?.through_message_id) return null;
      return {
        text: fila.summary,
        throughMessageId: fila.meta.through_message_id,
        messageCount: Number(fila.meta.message_count ?? 0),
      };
    },

    async saveSummary(conversationId, summary): Promise<void> {
      await scope.query(
        `update public.conversations
            set summary = $3,
                variables = coalesce(variables, '{}'::jsonb) || jsonb_build_object($4::text, $5::jsonb),
                updated_at = now()
          where workspace_id = $1 and id = $2`,
        [
          ws,
          conversationId,
          summary.text,
          CLAVE_RESUMEN,
          JSON.stringify({
            through_message_id: summary.throughMessageId,
            message_count: summary.messageCount,
          }),
        ],
      );
    },

    async recordSkip({ conversationId, agentRunId, reason, detail }): Promise<void> {
      // Siempre queda rastro en la conversación, incluso cuando el salto ocurrió
      // antes de abrir una ejecución (agentRunId vacío): sin esto no hay forma
      // de explicarle a nadie por qué su agente no contestó.
      await scope.query(
        `insert into public.conversation_events
           (workspace_id, conversation_id, type, actor_type, payload)
         values ($1, $2, 'motor_omitio', 'system', $3::jsonb)`,
        [ws, conversationId, JSON.stringify({ motivo: reason, detalle: detail ?? null })],
      );
      if (agentRunId) {
        await scope.query(
          `update public.agent_runs
              set skip_reason = $3, error_detail = coalesce($4, error_detail)
            where workspace_id = $1 and id = $2`,
          [ws, agentRunId, motivoDeSalto(reason), detail ?? null],
        );
      }
    },
  };
}

function aMensajeGuardado(fila: {
  id: string;
  direction: string;
  author_type: string;
  content_type: string;
  content: unknown;
  sent_at: string | null;
  created_at: string;
}): StoredMessage {
  const rol = fila.direction === 'inbound' ? 'user' : fila.author_type === 'system' ? 'system' : 'assistant';
  return {
    id: fila.id,
    role: rol,
    content: desdeColumnas(fila.content_type, fila.content),
    sentAt: aFecha(fila.sent_at ?? fila.created_at),
    ...(fila.author_type === 'human' ? { byHuman: true } : {}),
  };
}
