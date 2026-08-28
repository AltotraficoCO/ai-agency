import "server-only";

/**
 * Del webhook a la bandeja.
 *
 * El puente entre el evento crudo ya guardado y las tablas que la bandeja lee.
 * Corre DESPUÉS de responder a Meta (`after()` en la ruta), nunca dentro de la
 * ruta caliente: el objetivo del handler son 200 ms y aquí hay cuatro
 * escrituras.
 *
 * TODO LO QUE HACE ES IDEMPOTENTE, y lo es apoyándose en restricciones de la
 * base, no en comprobaciones previas:
 *   · el contacto, por `contacts_ws_phone_uniq`;
 *   · la conversación, por `conversations_ws_external_uniq`;
 *   · el mensaje, por `messages_ws_external_uniq`.
 * Dos entregas simultáneas del mismo evento pasan las dos por aquí y dejan una
 * sola fila; un `select` previo dejaría dos.
 *
 * Cuando el worker de WhatsApp exista, este módulo es lo que sustituye: la ruta
 * dejará de llamarlo y el consumidor leerá `webhook_events` en estado
 * `pending`, que es donde la ruta ya los deja.
 */
import { crearAdaptadorWhatsApp } from "@strappy/whatsapp";
import type { InboundMessage } from "@strappy/core";
import type { TenantScope } from "@strappy/db";
import { conEspacio, consultar } from "../db/pool";

/** El adaptador solo se usa para PARSEAR: no envía nada y no toca la base. */
const adaptadorLectura = crearAdaptadorWhatsApp({
  leerEstadoConversacion: async () => ({ enviarLibreHasta: null }),
});

type Ruta = {
  workspace_id: string;
  channel_id: string;
  agent_id: string | null;
};

/** Materializa un evento ya guardado. Devuelve cuántos mensajes entraron. */
export async function materializarEvento(input: {
  eventoId: string;
  externalKey: string;
  raw: unknown;
}): Promise<number> {
  const rutas = await consultar<Ruta>(
    `select workspace_id, channel_id, agent_id from public.channel_routing
      where external_key = $1 and is_active`,
    [input.externalKey],
  );
  const ruta = rutas[0];
  if (!ruta) return 0;

  const entrantes = await adaptadorLectura.parseInbound(input.raw, {
    workspaceId: ruta.workspace_id,
    channelId: ruta.channel_id,
    credentials: {},
  });
  if (entrantes.length === 0) return 0;

  const guardados = await conEspacio(ruta.workspace_id, async (scope) => {
    let n = 0;
    for (const entrante of entrantes) {
      const contactoId = await asegurarContacto(scope, entrante);
      const conversacionId = await asegurarConversacion(scope, {
        contactoId,
        canalId: ruta.channel_id,
        agenteId: ruta.agent_id,
        clave: entrante.externalContactId,
      });
      const nuevo = await guardarMensaje(scope, {
        conversacionId,
        contactoId,
        canalId: ruta.channel_id,
        entrante,
      });
      if (nuevo) n += 1;
    }
    return n;
  });

  // Fuera de la transacción del tenant: `webhook_events` sin resolver es
  // transversal por definición, y marcarlo procesado no debe deshacerse si una
  // de las escrituras del hilo falla.
  await consultar(
    `update public.webhook_events set status = 'processed', processed_at = now()
      where id = $1 and status = 'pending'`,
    [input.eventoId],
  );
  return guardados;
}

async function asegurarContacto(scope: TenantScope, entrante: InboundMessage): Promise<string> {
  const { rows } = await scope.query<{ id: string }>(
    `insert into public.contacts (workspace_id, phone, name, source)
     values ($1, $2, $3, 'whatsapp')
     on conflict (workspace_id, phone) where phone is not null
       do update set name = coalesce(contacts.name, excluded.name),
                     last_seen_at = now(),
                     updated_at = now()
     returning id`,
    [scope.workspaceId, entrante.externalContactId, entrante.contactName ?? null],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("No se pudo registrar el contacto del mensaje entrante.");
  return id;
}

async function asegurarConversacion(
  scope: TenantScope,
  input: { contactoId: string; canalId: string; agenteId: string | null; clave: string },
): Promise<string> {
  const { rows } = await scope.query<{ id: string }>(
    `insert into public.conversations
       (workspace_id, contact_id, channel_id, agent_id, external_key, status, handover_state)
     values ($1, $2, $3, $4, $5, 'open', 'bot')
     on conflict (workspace_id, channel_id, external_key) where external_key is not null
       do update set status = case when conversations.status = 'closed'
                                   then 'open' else conversations.status end,
                     updated_at = now()
     returning id`,
    [scope.workspaceId, input.contactoId, input.canalId, input.agenteId, input.clave],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("No se pudo abrir la conversación del mensaje entrante.");
  return id;
}

async function guardarMensaje(
  scope: TenantScope,
  input: {
    conversacionId: string;
    contactoId: string;
    canalId: string;
    entrante: InboundMessage;
  },
): Promise<boolean> {
  const { entrante } = input;
  const { tipo, contenido } = aColumnas(entrante);

  const { rows } = await scope.query<{ id: string }>(
    `insert into public.messages
       (workspace_id, conversation_id, contact_id, channel_id, external_id, direction,
        author_type, content_type, content, status, provider_timestamp)
     values ($1, $2, $3, $4, $5, 'inbound',
             'contact', $6, $7::jsonb, 'delivered', $8::timestamptz)
     on conflict do nothing
     returning id`,
    [
      scope.workspaceId,
      input.conversacionId,
      input.contactoId,
      input.canalId,
      entrante.externalId,
      tipo,
      JSON.stringify(contenido),
      entrante.sentAt.toISOString(),
    ],
  );
  if (!rows[0]) return false;

  // La ventana de servicio se proyecta como un instante genérico. Cuánto dura
  // lo decide el canal (`calcularFinDeVentana`); esta tabla solo guarda el
  // resultado, y por eso la columna no se llama «ventana de WhatsApp».
  await scope.query(
    `update public.conversations
        set send_restriction_until = greatest(
              coalesce(send_restriction_until, 'epoch'::timestamptz),
              $2::timestamptz + interval '24 hours')
      where workspace_id = $3 and id = $1`,
    [input.conversacionId, entrante.sentAt.toISOString(), scope.workspaceId],
  );
  return true;
}

/** `MessageContent` a las columnas del esquema, sin depender de `@strappy/db`. */
function aColumnas(entrante: InboundMessage): { tipo: string; contenido: Record<string, unknown> } {
  const c = entrante.content;
  switch (c.kind) {
    case "text":
      return { tipo: "text", contenido: { text: c.text } };
    case "image":
      return { tipo: "image", contenido: { media_id: c.mediaId, caption: c.caption ?? null } };
    case "audio":
      return { tipo: "audio", contenido: { media_id: c.mediaId, duration_ms: c.durationMs ?? null } };
    case "video":
      return { tipo: "video", contenido: { media_id: c.mediaId, caption: c.caption ?? null } };
    case "document":
      return { tipo: "document", contenido: { media_id: c.mediaId, filename: c.filename ?? null } };
    case "location":
      return {
        tipo: "location",
        contenido: { latitude: c.latitude, longitude: c.longitude, label: c.label ?? null },
      };
    case "buttons":
      return { tipo: "interactive", contenido: { text: c.text, options: c.options } };
    default:
      return { tipo: "unsupported", contenido: { described_as: c.describedAs } };
  }
}
