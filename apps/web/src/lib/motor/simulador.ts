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

/**
 * Un paso del trabajo del agente, contado como lo diría una persona.
 *
 * Nunca lleva la entrada ni la salida en crudo: solo una etiqueta y un detalle
 * corto que no enseñe nada que no se haya dicho ya en la conversación.
 */
export type PasoSimulado = {
  id: string;
  etiqueta: string;
  estado: "hecho" | "error";
  detalle: string | null;
  /** ISO 8601. */
  en: string | null;
};

export type MensajeSimulado = {
  id: string;
  autor: "contacto" | "agente" | "sistema";
  texto: string;
  fecha: string;
  /** Lo que hizo el agente antes de escribir este mensaje. */
  pasos?: PasoSimulado[];
};

export type SesionSimulada = {
  id: string;
  /** El primer mensaje del cliente, recortado. */
  titulo: string;
  /** ISO 8601 del último movimiento. */
  fecha: string;
  mensajes: number;
};

export type ResultadoSimulacion = {
  estado: TurnResult["status"];
  motivo?: string;
  respuesta?: string;
  creditos: number;
  pasos: number;
  /** Las herramientas que usó en este turno, en orden. */
  trabajo: PasoSimulado[];
  saldo: number;
  agentRunId?: string;
};

const CONTACTO_SIMULADO = "simulador:visitante";
const SIN_MENSAJES = "Prueba sin mensajes";

/**
 * Abre (o recupera) la sesión de prueba fija de un agente.
 *
 * La usa el autojuego, que la vacía antes de cada partida. Las pruebas de la
 * persona van cada una en su propia sesión: ver `abrirSesion`.
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

/**
 * Empieza una prueba nueva sin borrar las anteriores.
 *
 * Si ya hay una vacía se reutiliza: pulsar «Nueva prueba» tres veces seguidas
 * no debería dejar tres «Prueba sin mensajes» en el historial.
 */
export async function abrirSesion(input: {
  workspaceId: string;
  agentId: string;
}): Promise<string> {
  return conEspacio(input.workspaceId, async (scope) => {
    const canalId = await asegurarCanal(scope);

    const { rows: vacias } = await scope.query<{ id: string }>(
      `select c.id
         from public.conversations c
        where c.workspace_id = $1 and c.agent_id = $2 and c.channel_id = $3
          and c.external_key like 'simulador:%'
          and c.external_key <> 'simulador:' || $2::text
          and not exists (
            select 1 from public.messages m
             where m.workspace_id = c.workspace_id and m.conversation_id = c.id
          )
        order by c.created_at desc
        limit 1`,
      [scope.workspaceId, input.agentId, canalId],
    );
    if (vacias[0]) return vacias[0].id;

    const contactoId = await asegurarContacto(scope);
    const { rows } = await scope.query<{ id: string }>(
      `insert into public.conversations
         (workspace_id, contact_id, channel_id, agent_id, external_key, status, handover_state)
       values ($1, $2, $3, $4, $5, 'open', 'bot')
       returning id`,
      [scope.workspaceId, contactoId, canalId, input.agentId, `simulador:${input.agentId}:${crypto.randomUUID()}`],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("No se pudo empezar otra prueba.");
    return id;
  });
}

/** Las pruebas de un agente, la más reciente primero. */
export async function listarSesiones(input: {
  workspaceId: string;
  agentId: string;
}): Promise<SesionSimulada[]> {
  return conEspacio(input.workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      id: string;
      creada: string;
      primero: string | null;
      total: string;
      ultimo: string | null;
    }>(
      `select c.id, c.created_at as creada, primero.texto as primero, cuenta.total, cuenta.ultimo
         from public.conversations c
         join public.channels ch on ch.id = c.channel_id and ch.workspace_id = c.workspace_id
         left join lateral (
           select m.content->>'text' as texto
             from public.messages m
            where m.workspace_id = c.workspace_id and m.conversation_id = c.id and m.direction = 'inbound'
            order by m.created_at asc, m.id asc
            limit 1
         ) primero on true
         left join lateral (
           select count(*) as total, max(m.created_at) as ultimo
             from public.messages m
            where m.workspace_id = c.workspace_id and m.conversation_id = c.id
         ) cuenta on true
        where c.workspace_id = $1 and c.agent_id = $2 and ch.kind = $3
          and c.external_key like 'simulador:%'
        order by coalesce(cuenta.ultimo, c.created_at) desc
        limit 50`,
      [scope.workspaceId, input.agentId, CANAL_SIMULADOR],
    );
    return rows.map((r) => ({
      id: r.id,
      titulo: tituloDeSesion(r.primero),
      fecha: new Date(r.ultimo ?? r.creada).toISOString(),
      mensajes: Number(r.total),
    }));
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

    // Cada turno es una transacción: sus herramientas y sus mensajes comparten
    // `now()`. Un paso cuelga de la primera respuesta que sale a partir de su
    // inicio, y solo si su mensaje de entrada sigue ahí —tras un reinicio, los
    // pasos viejos no deben colarse en la conversación nueva—.
    const { rows: herramientas } = await scope.query<{
      id: string;
      tool_slug: string;
      input: unknown;
      output: unknown;
      status: string;
      finished_at: string | null;
      mensaje_id: string | null;
    }>(
      `select t.id, t.tool_slug, t.input, t.output, t.status, t.finished_at,
              (select m.id from public.messages m
                where m.workspace_id = t.workspace_id and m.conversation_id = t.conversation_id
                  and m.direction = 'outbound' and m.created_at >= t.started_at
                order by m.created_at asc, m.id asc
                limit 1) as mensaje_id
         from public.tool_runs t
        where t.workspace_id = $1 and t.conversation_id = $2
          and exists (
            select 1 from public.messages i
             where i.workspace_id = t.workspace_id and i.conversation_id = t.conversation_id
               and i.direction = 'inbound' and i.created_at <= t.started_at
          )
        order by t.started_at asc, t.finished_at asc nulls last
        limit 400`,
      [scope.workspaceId, input.conversationId],
    );

    const pasosPorMensaje = new Map<string, PasoSimulado[]>();
    for (const h of herramientas) {
      if (!h.mensaje_id) continue;
      const paso = describirPaso({
        id: h.id,
        slug: h.tool_slug,
        entrada: h.input,
        salida: h.output,
        fallo: h.status !== "succeeded",
        en: h.finished_at ? new Date(h.finished_at).toISOString() : null,
      });
      pasosPorMensaje.set(h.mensaje_id, [...(pasosPorMensaje.get(h.mensaje_id) ?? []), paso]);
    }

    return rows.map((r) => {
      const autor =
        r.direction === "inbound"
          ? ("contacto" as const)
          : r.author_type === "system"
            ? ("sistema" as const)
            : ("agente" as const);
      return {
        id: r.id,
        autor,
        texto: r.content?.text ?? "",
        fecha: new Date(r.created_at).toISOString(),
        ...(autor === "agente" ? { pasos: pasosPorMensaje.get(r.id) ?? [] } : {}),
      };
    });
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
  /** Avisa de cada herramienta en cuanto termina, para enseñar el trabajo en vivo. */
  alPaso?: (paso: PasoSimulado) => void;
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

    const trabajo: PasoSimulado[] = [];

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
        toolsFor: crearToolsFor({
          scope,
          ports: contexto.ports,
          alInvocar: (log) => {
            const paso = describirPaso({
              id: `paso-${trabajo.length + 1}`,
              slug: log.slug,
              entrada: log.input,
              salida: log.output,
              fallo: Boolean(log.error),
              en: new Date().toISOString(),
            });
            trabajo.push(paso);
            input.alPaso?.(paso);
          },
        }),
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
        trabajo,
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
        trabajo,
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

const RESULTADOS_CIERRE: Record<string, string> = {
  resuelto: "Quedó resuelta",
  sin_interes: "Sin interés",
  duplicado: "Duplicada",
  spam: "Spam",
  sin_respuesta: "Sin respuesta",
};

/**
 * Traduce una invocación a lo que vería el dueño del negocio.
 *
 * El detalle se queda en lo que ya se habló —la búsqueda con las palabras del
 * cliente, qué dato guardó— y nunca copia valores ni errores internos.
 */
export function describirPaso(p: {
  id: string;
  slug: string;
  entrada: unknown;
  salida: unknown;
  fallo: boolean;
  en: string | null;
}): PasoSimulado {
  const entrada = comoObjeto(p.entrada);
  const salida = comoObjeto(p.salida);
  const paso = (etiqueta: string, detalle: string | null): PasoSimulado => ({
    id: p.id,
    etiqueta,
    estado: p.fallo ? "error" : "hecho",
    detalle: p.fallo ? "No salió bien; siguió sin este paso." : detalle,
    en: p.en,
  });

  switch (p.slug) {
    case "buscar_conocimiento": {
      const consulta = recortar(comoTexto(entrada.consulta), 60);
      const n = Number(salida.encontrados ?? 0);
      const hallazgo = n === 0 ? "no encontró nada" : n === 1 ? "1 fragmento" : `${n} fragmentos`;
      return paso("Buscó en tu conocimiento", consulta ? `«${consulta}» · ${hallazgo}` : hallazgo);
    }
    case "guardar_dato_contacto": {
      const clave = comoTexto(entrada.clave);
      if (/^(nombre|nombre_completo|nombres|name)$/.test(clave)) return paso("Guardó el nombre del cliente", null);
      return paso("Guardó un dato del cliente", clave ? humanizar(clave) : null);
    }
    case "etiquetar": {
      const etiquetas = Array.isArray(entrada.etiquetas) ? entrada.etiquetas.map(comoTexto).filter(Boolean) : [];
      return paso("Etiquetó la conversación", etiquetas.length ? recortar(etiquetas.join(", "), 80) : null);
    }
    case "escalar_a_humano": {
      const motivo = recortar(comoTexto(entrada.motivo), 80);
      const nota = salida.simulado ? "en prueba no se avisa a nadie" : null;
      return paso("Pasó la conversación a tu equipo", [motivo, nota].filter(Boolean).join(" · ") || null);
    }
    case "cerrar_conversacion":
      return paso("Cerró la conversación", RESULTADOS_CIERRE[comoTexto(entrada.resultado)] ?? null);
    case "agendar": {
      if (entrada.accion === "reservar") {
        return paso("Reservó una cita", salida.simulado ? "De prueba: no se creó en tu agenda" : null);
      }
      const huecos = Array.isArray(salida.huecos) ? salida.huecos.length : 0;
      return paso("Miró huecos libres en la agenda", `${huecos} ${huecos === 1 ? "hueco" : "huecos"}`);
    }
    default:
      return paso(`Usó «${humanizar(p.slug)}»`, null);
  }
}

function tituloDeSesion(primero: string | null): string {
  const limpio = (primero ?? "").replace(/\s+/g, " ").trim();
  return limpio ? recortar(limpio, 60) : SIN_MENSAJES;
}

function recortar(texto: string, maximo: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1).trimEnd()}…` : limpio;
}

function humanizar(clave: string): string {
  const texto = clave.replace(/_/g, " ").trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function comoObjeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

function comoTexto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
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
