/**
 * El simulador de punta a punta.
 *
 * Aquí no hay ninguna rama especial de «modo prueba»: se persiste en las mismas
 * tablas, se ejecuta el mismo motor y se cobran créditos de verdad. Lo único que
 * cambia es el canal —el simulador en lugar de WhatsApp— y que sus efectos
 * externos van en seco, que es lo que el propio canal declara.
 *
 * Si algún día esto necesitara preguntar «¿estoy en el simulador?» para que el
 * motor se comporte distinto, la abstracción de canal se habría roto.
 */
import { runConversationTurn, type TurnResult } from "@strappy/core";
import { crearPuertos, type TenantScope } from "@strappy/db";
import { conEspacio } from "../db/pool";
import { asegurarRegistros, CANAL_SIMULADOR, simulador } from "./registro";
import { resolveLanguageModel } from "./modelo";
import { crearResumidor } from "./resumidor";
import { crearToolContext, crearToolsFor } from "./herramientas";
import { crearCerebro } from "./conocimiento";

export type MensajeSimulado = {
  id: string;
  autor: "contacto" | "agente" | "sistema";
  texto: string;
  fecha: string;
};

export type ResultadoSimulacion = {
  estado: TurnResult["status"];
  motivo?: string;
  respuesta?: string;
  creditos: number;
  pasos: number;
  saldo: number;
  agentRunId?: string;
};

const CONTACTO_SIMULADO = "simulador:visitante";

/**
 * Abre (o recupera) la sesión de prueba de un agente.
 *
 * Una por agente: quien prueba quiere retomar la conversación donde la dejó, no
 * empezar de cero cada vez que recarga la página.
 */
export async function asegurarSesion(input: {
  workspaceId: string;
  agentId: string;
}): Promise<string> {
  return conEspacio(input.workspaceId, async (scope) => {
    const canalId = await asegurarCanal(scope);
    const contactoId = await asegurarContacto(scope);

    const clave = `simulador:${input.agentId}`;
    const { rows } = await scope.query<{ id: string }>(
      `insert into public.conversations
         (workspace_id, contact_id, channel_id, agent_id, external_key, status, handover_state)
       values ($1, $2, $3, $4, $5, 'open', 'bot')
       on conflict (workspace_id, channel_id, external_key)
         where external_key is not null
         do update set updated_at = now()
       returning id`,
      [scope.workspaceId, contactoId, canalId, input.agentId, clave],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("No se pudo abrir la conversación de prueba.");
    return id;
  });
}

/** Borra el historial de la sesión de prueba sin tocar nada más del espacio. */
export async function reiniciarSesion(input: {
  workspaceId: string;
  conversationId: string;
}): Promise<void> {
  await conEspacio(input.workspaceId, async (scope) => {
    await scope.query(
      `delete from public.messages where workspace_id = $1 and conversation_id = $2`,
      [scope.workspaceId, input.conversationId],
    );
    await scope.query(
      `update public.conversations
          set summary = null, variables = '{}'::jsonb, handover_state = 'bot',
              bot_enabled = true, status = 'open', closed_at = null,
              unread_count = 0, engine_lock_until = null, updated_at = now()
        where workspace_id = $1 and id = $2`,
      [scope.workspaceId, input.conversationId],
    );
  });
}

export async function leerHistorial(input: {
  workspaceId: string;
  conversationId: string;
}): Promise<MensajeSimulado[]> {
  return conEspacio(input.workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      id: string;
      direction: string;
      author_type: string;
      content: { text?: string } | null;
      created_at: string;
    }>(
      `select id, direction, author_type, content, created_at
         from public.messages
        where workspace_id = $1 and conversation_id = $2
        order by created_at asc, direction asc, id asc
        limit 200`,
      [scope.workspaceId, input.conversationId],
    );
    return rows.map((r) => ({
      id: r.id,
      autor:
        r.direction === "inbound"
          ? ("contacto" as const)
          : r.author_type === "system"
            ? ("sistema" as const)
            : ("agente" as const),
      texto: r.content?.text ?? "",
      fecha: new Date(r.created_at).toISOString(),
    }));
  });
}

/**
 * Un turno completo: entra el mensaje de la persona, sale la respuesta del
 * agente. Todo en una transacción, porque el lock por conversación es un
 * `pg_try_advisory_xact_lock` y solo vive mientras la transacción viva.
 */
export async function enviarMensaje(input: {
  workspaceId: string;
  agentId: string;
  conversationId: string;
  texto: string;
}): Promise<ResultadoSimulacion> {
  asegurarRegistros();

  return conEspacio(input.workspaceId, async (scope) => {
    await registrarEntrante(scope, input.conversationId, input.texto);

    const puertos = await crearPuertos(scope, { run: { trigger: "manual" } });
    const cerebro = crearCerebro(scope, puertos);
    const conversacion = await puertos.conversations.load(input.conversationId);
    if (!conversacion) throw new Error("La conversación de prueba no existe.");

    const agente = await puertos.agents.load(input.agentId);
    const modo = agente?.mode ?? "lite";

    const contexto = crearToolContext({
      workspaceId: scope.workspaceId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      channelSlug: CANAL_SIMULADOR,
      // Lo declara el canal, no esta función.
      dryRun: simulador().execution.sideEffects === "dry_run",
      ports: {
        knowledge: cerebro,
        contacts: puertos.herramientas.contacts,
        handover: puertos.herramientas.handover,
        scheduling: puertos.herramientas.scheduling,
        secrets: puertos.herramientas.secrets,
        http: puertos.herramientas.http,
      },
      timezone: conversacion.timezone ?? "America/Bogota",
    });

    const resultado = await runConversationTurn(
      {
        conversations: puertos.conversations,
        agents: puertos.agents,
        runs: puertos.runs,
        outbound: puertos.outbound,
        ledger: puertos.ledger,
        lock: puertos.lock,
        rates: puertos.rates,
        modelTable: puertos.modelTable,
        resolveLanguageModel,
        promptSpecFor: puertos.promptSpecFor,
        toolsFor: crearToolsFor({ scope, ports: contexto.ports }),
        knowledge: cerebro,
        summarizer: crearResumidor(puertos.modelTable, modo),
        estimatedCredits: 1,
      },
      {
        conversationId: input.conversationId,
        agentId: input.agentId,
        channelCredentials: {},
        toolContext: contexto,
        query: input.texto,
        owner: `simulador:${input.conversationId}`,
      },
    );

    const saldo = await puertos.ledger.balance(scope.workspaceId);

    if (resultado.status === "replied") {
      // El simulador «entrega» en el acto: no hay proveedor al que esperar.
      await scope.query(
        `update public.messages set status = 'delivered', delivered_at = now()
          where workspace_id = $1 and id = $2`,
        [scope.workspaceId, resultado.queuedId],
      );
      return {
        estado: "replied",
        respuesta: resultado.text,
        creditos: resultado.credits,
        pasos: resultado.steps,
        saldo,
        agentRunId: resultado.agentRunId,
      };
    }

    if (resultado.status === "skipped") {
      return {
        estado: "skipped",
        motivo: explicarMotivo(resultado.reason),
        creditos: 0,
        pasos: 0,
        saldo,
        ...(resultado.agentRunId ? { agentRunId: resultado.agentRunId } : {}),
      };
    }

    throw resultado.error;
  });
}

const EXPLICACIONES: Record<string, string> = {
  taken_over: "Una persona del equipo tomó el control de esta conversación.",
  bot_disabled: "El agente no está publicado, así que no responde.",
  paused: "El agente está en pausa en esta conversación.",
  contact_blocked: "El contacto está bloqueado.",
  no_credits: "No quedan créditos en el espacio de trabajo.",
  channel_restricted: "El canal no permite escribir ahora mismo.",
  lock_busy: "Ya hay otra respuesta en marcha para esta conversación.",
  superseded: "El agente resolvió el turno sin nada que decir.",
};

function explicarMotivo(reason: string): string {
  return EXPLICACIONES[reason] ?? `El motor omitió la respuesta (${reason}).`;
}

async function registrarEntrante(
  scope: TenantScope,
  conversationId: string,
  texto: string,
): Promise<void> {
  await scope.query(
    `insert into public.messages
       (workspace_id, conversation_id, contact_id, channel_id, external_id,
        direction, author_type, content_type, content, status, sent_at, provider_timestamp)
     select $1, c.id, c.contact_id, c.channel_id, $3,
            'inbound', 'contact', 'text', jsonb_build_object('text', $4::text),
            'delivered', clock_timestamp(), clock_timestamp()
       from public.conversations c
      where c.workspace_id = $1 and c.id = $2`,
    [scope.workspaceId, conversationId, `sim_in_${crypto.randomUUID()}`, texto],
  );
}

async function asegurarCanal(scope: TenantScope): Promise<string> {
  const { rows } = await scope.query<{ id: string }>(
    `with existente as (
       select id from public.channels
        where workspace_id = $1 and kind = $2 limit 1
     ), creado as (
       insert into public.channels (workspace_id, kind, name, status, connected_at)
       select $1, $2, 'Simulador', 'connected', now()
        where not exists (select 1 from existente)
       returning id
     )
     select id from existente union all select id from creado`,
    [scope.workspaceId, CANAL_SIMULADOR],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("No se pudo preparar el canal simulador.");
  return id;
}

async function asegurarContacto(scope: TenantScope): Promise<string> {
  const { rows } = await scope.query<{ id: string }>(
    `insert into public.contacts (workspace_id, external_id, name, source)
     values ($1, $2, 'Visitante de prueba', 'simulador')
     on conflict (workspace_id, external_id) where external_id is not null
       do update set updated_at = now()
     returning id`,
    [scope.workspaceId, CONTACTO_SIMULADO],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("No se pudo preparar el contacto de prueba.");
  return id;
}
