import "server-only";

/**
 * Encargos al Webmaster.
 *
 * El Webmaster no conversa: trabaja. Lo que la persona escribe se convierte en
 * una fila de `agent_tasks` sobre su sitio conectado, y el worker la ejecuta con
 * las herramientas de WordPress (backup antes de cada cambio, aprobación en lo
 * delicado). Crear el encargo no gasta ni un token: quien interpreta el pedido
 * es el propio Webmaster cuando lo ejecuta.
 *
 * Por qué no pasa por el motor conversacional: su prompt base es el de un
 * agente de atención por mensajería («si algo se sale de lo que puedes
 * resolver, escalas a una persona»), y con esas reglas el Webmaster derivaba
 * cada cambio a un humano en vez de hacerlo.
 */
import type { ToolApprovalResponse } from "ai";
import { huellaAccion } from "@strappy/webmaster/aprobacion";
import { conEspacio } from "@/lib/db/pool";

export type EstadoEncargo = "queued" | "running" | "esperando_aprobacion" | "done" | "failed" | "cancelled";

export type AprobacionVista = { id: string; herramienta: string; motivo: string; resumen: string };

export type EncargoVista = {
  id: string;
  titulo: string;
  detalle: string | null;
  estado: EstadoEncargo;
  resumen: string | null;
  error: string | null;
  creditos: number;
  creadoEl: string;
  aprobaciones: AprobacionVista[];
};

type ResultadoEncargo = { ok: true } | { ok: false; error: string };

/** ¿Este agente es un Webmaster contratado? Solo a esos se les encargan cambios en el sitio. */
export async function esWebmaster(workspaceId: string, agentId: string): Promise<boolean> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{ es: boolean }>(
      `select exists (
         select 1 from public.agent_subscriptions
          where workspace_id = $1 and agent_id = $2
            and catalog_slug = 'webmaster' and status <> 'cancelled'
       ) as es`,
      [workspaceId, agentId],
    );
    return rows[0]?.es === true;
  });
}

/** Los últimos encargos, del más antiguo al más reciente, como se lee un chat. */
export async function encargosDelAgente(workspaceId: string, agentId: string): Promise<EncargoVista[]> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      id: string;
      titulo: string;
      detalle: string | null;
      estado: EstadoEncargo;
      resumen: string | null;
      error: string | null;
      creditos: string;
      created_at: Date;
      aprobaciones: AprobacionVista[];
    }>(
      `select t.id, t.titulo, t.detalle, t.estado, t.resumen, t.error,
              t.creditos::text as creditos, t.created_at,
              coalesce((
                select json_agg(json_build_object(
                         'id', a.id, 'herramienta', a.tool_slug,
                         'motivo', a.motivo, 'resumen', a.resumen)
                       order by a.created_at)
                  from public.task_approvals a
                 where a.workspace_id = t.workspace_id and a.task_id = t.id and a.decision is null
              ), '[]'::json) as aprobaciones
         from public.agent_tasks t
        where t.workspace_id = $1 and t.agent_id = $2
        order by t.created_at desc
        limit 30`,
      [workspaceId, agentId],
    );
    return rows.reverse().map((r) => ({
      id: r.id,
      titulo: r.titulo,
      detalle: r.detalle,
      estado: r.estado,
      resumen: r.resumen,
      error: r.error,
      creditos: Number(r.creditos),
      creadoEl: new Date(r.created_at).toISOString(),
      aprobaciones: r.aprobaciones,
    }));
  });
}

export async function crearEncargo(input: {
  workspaceId: string;
  agentId: string;
  usuarioId: string;
  texto: string;
}): Promise<ResultadoEncargo> {
  const texto = input.texto.trim();
  if (texto.length < 3) return { ok: false, error: "Cuéntale al Webmaster qué quieres cambiar en tu sitio." };
  if (texto.length > 4000) {
    return { ok: false, error: "El encargo es demasiado largo. Divídelo en cambios más pequeños." };
  }

  return conEspacio(input.workspaceId, async (scope) => {
    const sitio = await scope.query<{ id: string }>(
      `select id from public.connections
        where workspace_id = $1 and provider = 'wordpress' and status = 'active'
        order by updated_at desc
        limit 1`,
      [input.workspaceId],
    );
    const siteId = sitio.rows[0]?.id;
    if (!siteId) {
      return {
        ok: false,
        error: "Primero conecta tu sitio en Ajustes → Sitio web: sin acceso a tu WordPress no puedo hacer cambios.",
      };
    }

    await scope.query(
      `insert into public.agent_tasks (workspace_id, agent_id, site_id, titulo, detalle, created_by)
       values ($1, $2, $3, $4, $5, $6)`,
      [input.workspaceId, input.agentId, siteId, tituloDe(texto), texto, input.usuarioId],
    );
    return { ok: true };
  });
}

/**
 * Registra la decisión de una persona y, si ya no queda nada pendiente en la
 * tarea, la devuelve a la cola para que el worker la reanude.
 *
 * Hay dos caminos de aprobación y los dos acaban en `task_approvals`:
 *  · El de la propia herramienta (portada, precios): al reanudar, la acción se
 *    repite y la herramienta encuentra la decisión por su huella.
 *  · El del AI SDK (plugins, usuarios): la conversación guardada tiene una
 *    petición de aprobación que hay que contestar con su `approvalId`.
 */
export async function decidirAprobacion(input: {
  workspaceId: string;
  usuarioId: string;
  aprobacionId: string;
  aprobada: boolean;
}): Promise<ResultadoEncargo> {
  return conEspacio(input.workspaceId, async (scope) => {
    const decidida = await scope.query<{ task_id: string }>(
      `update public.task_approvals
          set decision = $3, decidida_por = $4, decidida_en = now()
        where workspace_id = $1 and id = $2 and decision is null
        returning task_id`,
      [input.workspaceId, input.aprobacionId, input.aprobada ? "aprobada" : "rechazada", input.usuarioId],
    );
    const taskId = decidida.rows[0]?.task_id;
    if (!taskId) return { ok: false, error: "Esta aprobación ya se había decidido." };

    const pendientes = await scope.query<{ n: string }>(
      `select count(*)::text as n from public.task_approvals
        where workspace_id = $1 and task_id = $2 and decision is null`,
      [input.workspaceId, taskId],
    );
    if (Number(pendientes.rows[0]?.n ?? 0) > 0) return { ok: true };

    const tarea = await scope.query<{ mensajes: unknown }>(
      `select mensajes from public.agent_tasks
        where workspace_id = $1 and id = $2 and estado = 'esperando_aprobacion'
        for update`,
      [input.workspaceId, taskId],
    );
    const fila = tarea.rows[0];
    if (!fila) return { ok: true };

    const decisiones = await scope.query<{ huella: string; decision: string | null }>(
      `select huella, decision from public.task_approvals where workspace_id = $1 and task_id = $2`,
      [input.workspaceId, taskId],
    );
    const respuestas = respuestasDeAprobacion(
      taskId,
      fila.mensajes,
      new Map(decisiones.rows.map((d) => [d.huella, d.decision])),
    );

    await scope.query(
      `update public.agent_tasks
          set estado = 'queued', aprobaciones = $3::jsonb, lease_until = null
        where workspace_id = $1 and id = $2`,
      [input.workspaceId, taskId, JSON.stringify(respuestas)],
    );
    return { ok: true };
  });
}

type Parte = {
  type?: string;
  approvalId?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  toolCall?: { toolName?: string; input?: unknown };
};

/**
 * Contesta las peticiones de aprobación del AI SDK que siguen abiertas en la
 * conversación guardada. La decisión se busca por la misma huella con la que
 * el worker registró la petición: (tarea + herramienta + entrada).
 */
export function respuestasDeAprobacion(
  taskId: string,
  mensajes: unknown,
  decisiones: ReadonlyMap<string, string | null>,
): ToolApprovalResponse[] {
  if (!Array.isArray(mensajes)) return [];
  const partes: Parte[] = mensajes.flatMap((m) => {
    const contenido = (m as { content?: unknown }).content;
    return Array.isArray(contenido) ? (contenido as Parte[]) : [];
  });

  const llamadas = new Map<string, Parte>();
  for (const p of partes) if (p.type === "tool-call" && p.toolCallId) llamadas.set(p.toolCallId, p);
  const respondidas = new Set(
    partes.filter((p) => p.type === "tool-approval-response").map((p) => p.approvalId),
  );

  const respuestas: ToolApprovalResponse[] = [];
  for (const p of partes) {
    if (p.type !== "tool-approval-request" || !p.approvalId || respondidas.has(p.approvalId)) continue;
    const llamada = p.toolCall ?? (p.toolCallId ? llamadas.get(p.toolCallId) : undefined);
    if (!llamada?.toolName) continue;
    const aprobada = decisiones.get(huellaAccion(taskId, llamada.toolName, llamada.input)) === "aprobada";
    respuestas.push({
      type: "tool-approval-response",
      approvalId: p.approvalId,
      approved: aprobada,
      ...(aprobada ? {} : { reason: "La persona no aprobó esta acción." }),
    });
  }
  return respuestas;
}

/** La primera línea, recortada: es lo que el worker registra como título. */
function tituloDe(texto: string): string {
  const primera = (texto.split("\n")[0] ?? texto).trim();
  return primera.length > 80 ? `${primera.slice(0, 77)}…` : primera;
}
