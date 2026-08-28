import "server-only";

/**
 * Las escrituras de la bandeja.
 *
 * DOS INVARIANTES QUE ESTE ARCHIVO SOSTIENE, Y QUE LOS TESTS VIGILAN:
 *
 *  1. Una NOTA INTERNA nunca toca `messages`. Se escribe en `notes` y punto.
 *     No hay una rama, ni un `if`, ni un campo `es_interna` en el mensaje que
 *     alguien pueda invertir por accidente: son dos funciones distintas contra
 *     dos tablas distintas. Equivocarse de destinatario exige borrar código.
 *
 *  2. Escribir al cliente exige DOS permisos independientes: tener el mando y
 *     que el canal lo permita. Los dos se comprueban aquí, en el servidor, no
 *     solo en el composer: una pestaña vieja con el botón todavía activo no
 *     puede colarse por encima de la persona que tomó el control.
 *
 * Tomar el control apaga el bot en la MISMA sentencia que cambia el estado. Si
 * fueran dos, entre una y otra el motor podría estar componiendo una respuesta
 * y la persona acabaría hablando a dos voces con el cliente: es exactamente el
 * bug que la relectura de `handover_state` dentro del cerrojo evita en el
 * motor, y no debe reintroducirse desde este lado.
 */
import { crearPuertos, type TenantScope } from "@strappy/db";
import { conEspacio } from "../db/pool";
import { crearResumidor } from "../motor/resumidor";
import { politicaDeEnvio } from "./canales";
import { resolverMando } from "./consultas";
import type { Restriccion } from "./tipos";

export type ResultadoAccion = {
  readonly ok: boolean;
  readonly mensaje?: string;
  readonly restriccion?: Restriccion;
  readonly datos?: Record<string, unknown>;
};

type Contexto = {
  readonly workspaceId: string;
  readonly usuarioId: string;
  readonly conversacionId: string;
};

/** Deja rastro en la bitácora. Todo lo que cambia el mando pasa por aquí. */
async function registrarEvento(
  scope: TenantScope,
  ctx: Contexto,
  tipo: string,
  payload: Record<string, unknown> = {},
  actor: "human" | "system" = "human",
): Promise<void> {
  await scope.query(
    `insert into public.conversation_events
       (workspace_id, conversation_id, type, actor_type, actor_user_id, payload)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      ctx.workspaceId,
      ctx.conversacionId,
      tipo,
      actor,
      actor === "human" ? ctx.usuarioId : null,
      JSON.stringify(payload),
    ],
  );
}

type FilaMando = {
  handover_state: string;
  bot_enabled: boolean;
  bot_paused_until: string | null;
  assignee_user_id: string | null;
  channel_id: string;
  canal_tipo: string;
  contact_id: string;
  contacto_externo: string | null;
};

async function leerMando(scope: TenantScope, ctx: Contexto): Promise<FilaMando | null> {
  const { rows } = await scope.query<FilaMando>(
    `select c.handover_state, c.bot_enabled, c.bot_paused_until, c.assignee_user_id,
            c.channel_id, ch.kind as canal_tipo, c.contact_id,
            coalesce(ct.phone, ct.external_id, ct.id::text) as contacto_externo
       from public.conversations c
       join public.channels ch on ch.workspace_id = c.workspace_id and ch.id = c.channel_id
       join public.contacts ct on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
      where c.workspace_id = $1 and c.id = $2`,
    [ctx.workspaceId, ctx.conversacionId],
  );
  return rows[0] ?? null;
}

// ── Mando ────────────────────────────────────────────────────────────────────

/** Tomar el control: una sentencia, tres efectos, ninguna ventana entre ellos. */
export async function tomarControl(ctx: Contexto): Promise<ResultadoAccion> {
  return conEspacio(ctx.workspaceId, async (scope) => {
    const { rows } = await scope.query<{ id: string }>(
      `update public.conversations
          set handover_state = 'human',
              bot_enabled = false,
              bot_paused_until = null,
              assignee_user_id = $3,
              status = case when status = 'snoozed' then 'open' else status end,
              snoozed_until = null,
              updated_at = now()
        where workspace_id = $1 and id = $2
        returning id`,
      [ctx.workspaceId, ctx.conversacionId, ctx.usuarioId],
    );
    if (!rows[0]) return { ok: false, mensaje: "Esa conversación ya no existe." };
    await registrarEvento(scope, ctx, "control_tomado");
    return { ok: true };
  });
}

/** Devolver la conversación a la IA, con o sin resumen de lo que pasó. */
export async function devolverControl(
  ctx: Contexto,
  opciones: { resumen?: string } = {},
): Promise<ResultadoAccion> {
  return conEspacio(ctx.workspaceId, async (scope) => {
    await scope.query(
      `update public.conversations
          set handover_state = 'bot', bot_enabled = true, bot_paused_until = null,
              updated_at = now()
        where workspace_id = $1 and id = $2`,
      [ctx.workspaceId, ctx.conversacionId],
    );
    await registrarEvento(scope, ctx, "control_devuelto");
    if (opciones.resumen?.trim()) {
      await guardarResumenManual(scope, ctx, opciones.resumen.trim());
    }
    return { ok: true };
  });
}

/**
 * Callar a la IA un rato sin quedarte el hilo.
 *
 * `bot_paused_until` en el futuro con `bot_enabled = true` es distinto de
 * apagar el bot: cuando venza, el agente vuelve solo. Es lo que quiere quien
 * dice «déjame una hora y sigue tú».
 */
export async function pausarIA(ctx: Contexto, minutos: number): Promise<ResultadoAccion> {
  const limpios = Math.min(Math.max(Math.round(minutos), 5), 60 * 24);
  return conEspacio(ctx.workspaceId, async (scope) => {
    await scope.query(
      `update public.conversations
          set handover_state = 'bot', bot_enabled = true,
              bot_paused_until = now() + make_interval(mins => $3::int),
              updated_at = now()
        where workspace_id = $1 and id = $2`,
      [ctx.workspaceId, ctx.conversacionId, limpios],
    );
    await registrarEvento(scope, ctx, "bot_pausado", { minutos: limpios });
    return { ok: true, datos: { minutos: limpios } };
  });
}

/**
 * Pedirle el control a quien lo tiene.
 *
 * No se lo quita: deja el evento y una nota que menciona a esa persona. Quitar
 * el hilo de las manos de un compañero a mitad de una frase es peor que
 * esperar diez segundos.
 */
export async function solicitarControl(ctx: Contexto): Promise<ResultadoAccion> {
  return conEspacio(ctx.workspaceId, async (scope) => {
    const mando = await leerMando(scope, ctx);
    if (!mando?.assignee_user_id) return { ok: false, mensaje: "Ya no lo tiene nadie: puedes tomarlo." };
    await registrarEvento(scope, ctx, "control_solicitado", { a: mando.assignee_user_id });
    await scope.query(
      `insert into public.notes (workspace_id, conversation_id, contact_id, author_user_id, body, mentions)
       values ($1, $2, $3, $4, $5, $6::uuid[])`,
      [
        ctx.workspaceId,
        ctx.conversacionId,
        mando.contact_id,
        ctx.usuarioId,
        "Pidió el control de esta conversación.",
        [mando.assignee_user_id],
      ],
    );
    return { ok: true };
  });
}

// ── Estado de la conversación ────────────────────────────────────────────────

export async function asignar(ctx: Contexto, usuarioId: string | null): Promise<ResultadoAccion> {
  return conEspacio(ctx.workspaceId, async (scope) => {
    await scope.query(
      `update public.conversations
          set assignee_user_id = $3::uuid, updated_at = now()
        where workspace_id = $1 and id = $2`,
      [ctx.workspaceId, ctx.conversacionId, usuarioId],
    );
    await registrarEvento(scope, ctx, "conversacion_asignada", { a: usuarioId });
    return { ok: true };
  });
}

/** Posponer hasta un instante concreto; `null` la devuelve a la bandeja. */
export async function posponer(ctx: Contexto, hasta: string | null): Promise<ResultadoAccion> {
  return conEspacio(ctx.workspaceId, async (scope) => {
    if (!hasta) {
      await scope.query(
        `update public.conversations
            set status = 'open', snoozed_until = null, updated_at = now()
          where workspace_id = $1 and id = $2`,
        [ctx.workspaceId, ctx.conversacionId],
      );
      await registrarEvento(scope, ctx, "conversacion_reabierta");
      return { ok: true };
    }
    const fecha = new Date(hasta);
    if (Number.isNaN(fecha.getTime())) return { ok: false, mensaje: "Esa fecha no es válida." };
    await scope.query(
      `update public.conversations
          set status = 'snoozed', snoozed_until = $3::timestamptz, updated_at = now()
        where workspace_id = $1 and id = $2`,
      [ctx.workspaceId, ctx.conversacionId, fecha.toISOString()],
    );
    await registrarEvento(scope, ctx, "conversacion_pospuesta", { hasta: fecha.toISOString() });
    return { ok: true };
  });
}

export async function cerrar(ctx: Contexto, abrir: boolean): Promise<ResultadoAccion> {
  return conEspacio(ctx.workspaceId, async (scope) => {
    await scope.query(
      abrir
        ? `update public.conversations
              set status = 'open', closed_at = null, snoozed_until = null, updated_at = now()
            where workspace_id = $1 and id = $2`
        : `update public.conversations
              set status = 'closed', closed_at = now(), updated_at = now()
            where workspace_id = $1 and id = $2`,
      [ctx.workspaceId, ctx.conversacionId],
    );
    await registrarEvento(scope, ctx, abrir ? "conversacion_reabierta" : "conversacion_cerrada");
    return { ok: true };
  });
}

/** Marcar leída. Sin evento: abrir una conversación no es un hecho que contar. */
export async function marcarLeida(ctx: Contexto): Promise<ResultadoAccion> {
  return conEspacio(ctx.workspaceId, async (scope) => {
    await scope.query(
      `update public.conversations set unread_count = 0, updated_at = now()
        where workspace_id = $1 and id = $2 and unread_count > 0`,
      [ctx.workspaceId, ctx.conversacionId],
    );
    return { ok: true };
  });
}

// ── Etiquetas ────────────────────────────────────────────────────────────────

export async function etiquetar(
  ctx: Contexto,
  etiquetaId: string,
  poner: boolean,
): Promise<ResultadoAccion> {
  return conEspacio(ctx.workspaceId, async (scope) => {
    if (poner) {
      await scope.query(
        `insert into public.taggings (workspace_id, tag_id, entity_type, entity_id, created_by)
         values ($1, $2, 'conversation', $3, $4)
         on conflict (tag_id, entity_type, entity_id) do nothing`,
        [ctx.workspaceId, etiquetaId, ctx.conversacionId, ctx.usuarioId],
      );
    } else {
      await scope.query(
        `delete from public.taggings
          where workspace_id = $1 and tag_id = $2
            and entity_type = 'conversation' and entity_id = $3`,
        [ctx.workspaceId, etiquetaId, ctx.conversacionId],
      );
    }
    await registrarEvento(scope, ctx, poner ? "etiqueta_puesta" : "etiqueta_quitada", {
      etiqueta: etiquetaId,
    });
    return { ok: true };
  });
}

export async function crearEtiqueta(input: {
  workspaceId: string;
  nombre: string;
  color: string;
}): Promise<{ id: string; nombre: string; color: string } | null> {
  return conEspacio(input.workspaceId, async (scope) => {
    const { rows } = await scope.query<{ id: string; name: string; color: string }>(
      `insert into public.tags (workspace_id, name, color) values ($1, $2, $3)
       on conflict (workspace_id, name) do update set color = excluded.color
       returning id, name, color`,
      [input.workspaceId, input.nombre.trim(), input.color],
    );
    const fila = rows[0];
    return fila ? { id: fila.id, nombre: fila.name, color: fila.color } : null;
  });
}

// ── Notas internas ───────────────────────────────────────────────────────────

/**
 * Una nota interna. Escribe en `notes` y en ninguna otra tabla.
 *
 * Que esta función no reciba ni canal ni política de envío no es un descuido:
 * es la garantía. No hay forma de que una nota llegue al cliente porque no
 * existe el camino.
 */
export async function crearNota(
  ctx: Contexto,
  input: { texto: string; menciones: readonly string[] },
): Promise<ResultadoAccion> {
  const texto = input.texto.trim();
  if (!texto) return { ok: false, mensaje: "La nota está vacía." };

  return conEspacio(ctx.workspaceId, async (scope) => {
    const { rows } = await scope.query<{ contact_id: string }>(
      `select contact_id from public.conversations where workspace_id = $1 and id = $2`,
      [ctx.workspaceId, ctx.conversacionId],
    );
    const contacto = rows[0]?.contact_id;
    if (!contacto) return { ok: false, mensaje: "Esa conversación ya no existe." };

    const { rows: creadas } = await scope.query<{ id: string }>(
      `insert into public.notes
         (workspace_id, conversation_id, contact_id, author_user_id, body, mentions)
       values ($1, $2, $3, $4, $5, $6::uuid[])
       returning id`,
      [ctx.workspaceId, ctx.conversacionId, contacto, ctx.usuarioId, texto, [...input.menciones]],
    );
    return { ok: true, datos: { id: creadas[0]?.id ?? "" } };
  });
}

// ── Mensajes al cliente ──────────────────────────────────────────────────────

/**
 * Escribir al cliente. Los dos candados se comprueban aquí, contra la base,
 * no contra lo que el navegador crea que está pasando.
 */
export async function enviarAlCliente(
  ctx: Contexto,
  texto: string,
): Promise<ResultadoAccion> {
  const limpio = texto.trim();
  if (!limpio) return { ok: false, mensaje: "El mensaje está vacío." };

  return conEspacio(ctx.workspaceId, async (scope) => {
    const mando = await leerMando(scope, ctx);
    if (!mando) return { ok: false, mensaje: "Esa conversación ya no existe." };

    // Candado 1: el mando. Se relee AHORA, no se confía en lo que pintó la
    // pantalla hace un minuto.
    const estado = resolverMando(mando, ctx.usuarioId);
    if (estado !== "tuyo") {
      return {
        ok: false,
        mensaje:
          estado === "ia"
            ? "La IA está atendiendo esta conversación. Toma el control para escribir."
            : "Otra persona tiene el control de esta conversación.",
      };
    }

    // Candado 2: el canal. Decide él y su texto se devuelve tal cual.
    const politica = await politicaDeEnvio(scope, {
      workspaceId: ctx.workspaceId,
      canalTipo: mando.canal_tipo,
      canalId: mando.channel_id,
      conversacionId: ctx.conversacionId,
    });
    if (!politica.permitido && politica.restriccion) {
      return { ok: false, mensaje: politica.restriccion.mensaje, restriccion: politica.restriccion };
    }

    const { rows } = await scope.query<{ id: string }>(
      `insert into public.messages
         (workspace_id, conversation_id, contact_id, channel_id, direction, author_type,
          author_user_id, content_type, content, status, sent_at)
       values ($1, $2, $3, $4, 'outbound', 'human', $5, 'text', $6::jsonb, 'pending', clock_timestamp())
       returning id`,
      [
        ctx.workspaceId,
        ctx.conversacionId,
        mando.contact_id,
        mando.channel_id,
        ctx.usuarioId,
        JSON.stringify({ text: limpio }),
      ],
    );
    const id = rows[0]?.id;
    if (!id) return { ok: false, mensaje: "No se pudo guardar el mensaje." };

    // El simulador no tiene proveedor al que esperar: lo que se escribe, se
    // entrega. En un canal real el mensaje queda `pending` y el transporte lo
    // pasa a `sent`; la bandeja enseña ese estado en vez de fingirlo.
    if (mando.canal_tipo === "simulador") {
      await scope.query(
        `update public.messages set status = 'delivered', delivered_at = now()
          where workspace_id = $1 and id = $2`,
        [ctx.workspaceId, id],
      );
    }

    return { ok: true, datos: { id } };
  });
}

// ── Respuestas rápidas ───────────────────────────────────────────────────────

export async function guardarRespuestaRapida(input: {
  workspaceId: string;
  usuarioId: string;
  atajo: string;
  titulo: string;
  cuerpo: string;
}): Promise<{ id: string; atajo: string; titulo: string; cuerpo: string } | null> {
  const atajo = input.atajo.trim().replace(/^\//, "").toLowerCase();
  if (!atajo) return null;
  return conEspacio(input.workspaceId, async (scope) => {
    const { rows } = await scope.query<{ id: string; shortcut: string; title: string; body: string }>(
      `insert into public.quick_replies (workspace_id, shortcut, title, body, created_by)
       values ($1, $2, $3, $4, $5)
       on conflict (workspace_id, shortcut)
         do update set title = excluded.title, body = excluded.body, updated_at = now()
       returning id, shortcut, title, body`,
      [input.workspaceId, atajo, input.titulo.trim() || atajo, input.cuerpo, input.usuarioId],
    );
    const fila = rows[0];
    return fila ? { id: fila.id, atajo: fila.shortcut, titulo: fila.title, cuerpo: fila.body } : null;
  });
}

export async function usarRespuestaRapida(input: {
  workspaceId: string;
  id: string;
}): Promise<void> {
  await conEspacio(input.workspaceId, async (scope) => {
    await scope.query(
      `update public.quick_replies set usage_count = usage_count + 1
        where workspace_id = $1 and id = $2`,
      [input.workspaceId, input.id],
    );
  });
}

// ── Resumen para la IA ───────────────────────────────────────────────────────

/**
 * «Resumir lo que pasó para la IA».
 *
 * Resuelve el problema real de devolver el control: el agente retoma sin saber
 * qué se habló mientras una persona atendía, y vuelve a preguntar lo que el
 * cliente ya contestó. Se escribe en el MISMO sitio que el resumen rodante del
 * motor —`conversations.summary` más su metadato— para que el próximo turno lo
 * lea sin ninguna rama especial.
 */
export async function resumirParaLaIA(ctx: Contexto): Promise<ResultadoAccion> {
  return conEspacio(ctx.workspaceId, async (scope) => {
    const puertos = await crearPuertos(scope, { run: { trigger: "manual" } });
    const anterior = await puertos.conversations.loadSummary(ctx.conversacionId);
    const mensajes = await puertos.conversations.listMessagesForSummary({
      conversationId: ctx.conversacionId,
      ...(anterior ? { sinceMessageId: anterior.throughMessageId } : {}),
      limit: 120,
    });
    if (mensajes.length === 0) {
      return { ok: false, mensaje: "No hay nada nuevo que resumir." };
    }

    const resumidor = crearResumidor(puertos.modelTable, "lite");
    const texto = await resumidor.summarize({
      ...(anterior ? { previousSummary: anterior.text } : {}),
      messages: mensajes,
      language: "español",
    });

    const ultimo = mensajes[mensajes.length - 1];
    if (ultimo) {
      await puertos.conversations.saveSummary(ctx.conversacionId, {
        text: texto,
        throughMessageId: ultimo.id,
        messageCount: (anterior?.messageCount ?? 0) + mensajes.length,
      });
    }
    await registrarEvento(scope, ctx, "resumen_para_la_ia");
    return { ok: true, datos: { resumen: texto } };
  });
}

/** Guarda un resumen escrito o corregido a mano, sin pasar por el modelo. */
async function guardarResumenManual(
  scope: TenantScope,
  ctx: Contexto,
  texto: string,
): Promise<void> {
  await scope.query(
    `update public.conversations set summary = $3, updated_at = now()
      where workspace_id = $1 and id = $2`,
    [ctx.workspaceId, ctx.conversacionId, texto],
  );
  await registrarEvento(scope, ctx, "resumen_para_la_ia", { manual: true });
}
