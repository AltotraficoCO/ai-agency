import "server-only";

/**
 * ¿Se puede escribir ahora en esta conversación?
 *
 * LA PREGUNTA SE LA HACE LA BANDEJA AL CANAL, Y LA BANDEJA NO OPINA.
 *
 * Aquí no hay ninguna cuenta de 24 horas, ninguna mención a plantillas y
 * ninguna traducción del texto que devuelve el canal. `canSend()` entrega una
 * `SendRestriction` con el mensaje YA REDACTADO en español y la interfaz lo
 * pinta literal. El día que Meta cambie la ventana —o que entre Instagram con
 * la suya— cambia el adaptador del canal y esta pantalla no se entera.
 *
 * Si algún día aparece en este archivo un `24 * 60 * 60 * 1000`, la abstracción
 * de canal se rompió.
 */
import type { SendPolicy, ChannelContext } from "@strappy/core";
import { getChannel, listChannels } from "@strappy/core";
import { crearAdaptadorWhatsApp, SLUG_WHATSAPP } from "@strappy/whatsapp";
import type { TenantScope } from "@strappy/db";
import { asegurarRegistros } from "../motor/registro";
import type { Restriccion } from "./tipos";

/**
 * Estado que el adaptador de WhatsApp necesita y no puede deducir solo: hasta
 * cuándo se puede escribir libremente y en qué estado está el número emisor.
 */
async function estadoDeConversacion(
  scope: TenantScope,
  conversacionId: string,
): Promise<{ enviarLibreHasta: Date | null; estadoNumero?: "active" | "paused" | "disconnected" }> {
  const { rows } = await scope.query<{
    send_restriction_until: string | null;
    estado_numero: string | null;
  }>(
    `select c.send_restriction_until,
            (select n.status from public.whatsapp_numbers n
              where n.workspace_id = c.workspace_id and n.channel_id = c.channel_id
              order by n.is_default desc limit 1) as estado_numero
       from public.conversations c
      where c.workspace_id = $1 and c.id = $2`,
    [scope.workspaceId, conversacionId],
  );
  const fila = rows[0];
  const estadoNumero = fila?.estado_numero;
  return {
    enviarLibreHasta: fila?.send_restriction_until ? new Date(fila.send_restriction_until) : null,
    ...(estadoNumero === "active" || estadoNumero === "paused" || estadoNumero === "disconnected"
      ? { estadoNumero }
      : {}),
  };
}

/**
 * La política de envío del canal de esta conversación, traducida a la forma
 * que viaja al navegador. «Traducida» es solo cambiar los nombres de los
 * campos: el texto se copia sin tocarlo.
 */
export async function politicaDeEnvio(
  scope: TenantScope,
  input: {
    workspaceId: string;
    canalTipo: string;
    canalId: string;
    conversacionId: string;
  },
): Promise<{ permitido: boolean; restriccion: Restriccion | null }> {
  const politica = await consultarCanal(scope, input);
  if (politica.allowed) return { permitido: true, restriccion: null };

  const r = politica.restriction;
  return {
    permitido: false,
    restriccion: {
      codigo: r.code,
      // Literal. Sin reescribir, sin recortar, sin "mejorar".
      mensaje: r.message,
      ...(r.expiresAt ? { expiraEl: r.expiresAt.toISOString() } : {}),
      ...(r.alternative ? { alternativa: { tipo: r.alternative.kind, etiqueta: r.alternative.label } } : {}),
    },
  };
}

async function consultarCanal(
  scope: TenantScope,
  input: { workspaceId: string; canalTipo: string; canalId: string; conversacionId: string },
): Promise<SendPolicy> {
  const ctx: ChannelContext & { conversationId: string } = {
    workspaceId: input.workspaceId,
    channelId: input.canalId,
    // `canSend` no toca credenciales: decide con el estado que le sirven los
    // puertos. Pasarlas aquí sería filtrar secretos sin motivo.
    credentials: {},
    conversationId: input.conversacionId,
  };

  if (input.canalTipo === SLUG_WHATSAPP) {
    const adaptador = crearAdaptadorWhatsApp({
      leerEstadoConversacion: (id) => estadoDeConversacion(scope, id),
    });
    return adaptador.canSend(ctx);
  }

  asegurarRegistros();
  if (!listChannels().some((c) => c.slug === input.canalTipo)) {
    // Canal que este proceso no conoce (todavía). Callar y bloquear el composer
    // sería mentir sobre algo que no sabemos; se deja escribir y el envío real
    // fallará con el error del canal, que sí es cierto.
    return { allowed: true };
  }
  return getChannel(input.canalTipo).canSend(ctx);
}
