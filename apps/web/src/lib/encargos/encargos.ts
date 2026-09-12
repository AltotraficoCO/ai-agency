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
import type { TenantScope } from "@strappy/db";
import { huellaAccion } from "@strappy/webmaster/aprobacion";
import { esPasoTrabajo, pasosDesdeMensajes } from "@strappy/webmaster/pasos";
import { conEspacio } from "@/lib/db/pool";

export type EstadoEncargo = "queued" | "running" | "esperando_aprobacion" | "done" | "failed" | "cancelled";

/** La herramienta con la que el agente hace preguntas de elegir o escribir. */
const PREGUNTA = "preguntar_al_cliente";

export type AprobacionVista = {
  id: string;
  herramienta: string;
  motivo: string;
  resumen: string;
  /** `aprobacion` se contesta con Aprobar/Rechazar; `pregunta`, eligiendo o escribiendo. */
  tipo: "aprobacion" | "pregunta";
  opciones: string[];
  permiteTexto: boolean;
};

/**
 * Un paso del registro de trabajo: lo que el Webmaster hizo (o está haciendo)
 * dentro de un encargo, contado para la persona y no para un programador.
 */
export type PasoTrabajo = {
  /** Estable dentro del encargo: sirve de `key` y para no duplicar al refrescar. */
  id: string;
  /** Slug de la herramienta, p. ej. `wp_leer_plantilla_elementor`. */
  herramienta: string;
  /** «Leyendo el pie de página», «Haciendo copia de seguridad»… */
  etiqueta: string;
  estado: "en_curso" | "hecho" | "error" | "esperando";
  /** Una línea de contexto: qué página, qué plugin, el motivo del error. */
  detalle: string | null;
  /** ISO 8601. */
  en: string;
};

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
  /** Registro de trabajo, del primero al último. Vacío si todavía no empezó. */
  pasos: PasoTrabajo[];
};

type ResultadoEncargo = { ok: true } | { ok: false; error: string };

/**
 * Los agentes que trabajan por encargo y no conversando.
 *
 * El Webmaster fue el primero; Marketing es el segundo y no se prueba en un
 * chat: se le encargan revisiones de campañas y propone cambios que una persona
 * aprueba. La lista vive aquí y no repartida por la interfaz para que añadir el
 * tercero (el administrativo) sea una línea.
 */
export const AGENTES_POR_ENCARGO = ["webmaster", "marketing"] as const;

export type AgenteDeEncargos = (typeof AGENTES_POR_ENCARGO)[number];

/**
 * Qué agente por encargo es este agente contratado, o null si conversa.
 *
 * Es el mismo slug del catálogo que guarda `agent_subscriptions`, y el mismo
 * que el worker lee de `agent_tasks.agente` para saber qué bucle ejecutar: un
 * solo vocabulario de punta a punta.
 */
export async function agenteDeEncargos(
  workspaceId: string,
  agentId: string,
): Promise<AgenteDeEncargos | null> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{ slug: string }>(
      `select catalog_slug as slug from public.agent_subscriptions
        where workspace_id = $1 and agent_id = $2
          and catalog_slug = any($3::text[]) and status <> 'cancelled'
        limit 1`,
      [workspaceId, agentId, [...AGENTES_POR_ENCARGO]],
    );
    const slug = rows[0]?.slug;
    return AGENTES_POR_ENCARGO.includes(slug as AgenteDeEncargos)
      ? (slug as AgenteDeEncargos)
      : null;
  });
}

/** ¿Este agente es un Webmaster contratado? Solo a esos se les encargan cambios en el sitio. */
export async function esWebmaster(workspaceId: string, agentId: string): Promise<boolean> {
  return (await agenteDeEncargos(workspaceId, agentId)) === "webmaster";
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
      pasos: unknown;
      mensajes: unknown;
    }>(
      // `to_jsonb(t)->'pasos'` y no `t.pasos`: si la migración 0018 aún no
      // está aplicada, la columna no existe y la página tiene que seguir viva.
      // La conversación solo se trae cuando no hay registro guardado: es el
      // plan B de los encargos anteriores al registro en vivo, y pesa.
      `select t.id, t.titulo, t.detalle, t.estado, t.resumen, t.error,
              t.creditos::text as creditos, t.created_at,
              coalesce(to_jsonb(t)->'pasos', '[]'::jsonb) as pasos,
              case when coalesce(jsonb_array_length(to_jsonb(t)->'pasos'), 0) = 0
                   then t.mensajes end as mensajes,
              coalesce((
                select json_agg(json_build_object(
                         'id', a.id,
                         'herramienta', a.tool_slug,
                         'motivo', a.motivo,
                         'resumen', a.resumen,
                         'tipo', case when a.tool_slug = $3 then 'pregunta' else 'aprobacion' end,
                         'opciones', coalesce(a.entrada->'opciones', '[]'::jsonb),
                         'permiteTexto', coalesce((a.entrada->>'permite_texto')::boolean, true))
                       order by a.created_at)
                  from public.task_approvals a
                 where a.workspace_id = t.workspace_id and a.task_id = t.id and a.decision is null
              ), '[]'::json) as aprobaciones
         from public.agent_tasks t
        where t.workspace_id = $1 and t.agent_id = $2
        order by t.created_at desc
        limit 30`,
      [workspaceId, agentId, PREGUNTA],
    );
    return rows.reverse().map((r) => {
      const creadoEl = new Date(r.created_at).toISOString();
      const guardados = Array.isArray(r.pasos) ? r.pasos.filter(esPasoTrabajo) : [];
      return {
        id: r.id,
        titulo: r.titulo,
        detalle: r.detalle,
        estado: r.estado,
        resumen: r.resumen,
        error: r.error,
        creditos: Number(r.creditos),
        creadoEl,
        aprobaciones: r.aprobaciones,
        pasos: guardados.length > 0 ? guardados : pasosDesdeMensajes(r.mensajes, creadoEl),
      };
    });
  });
}

export async function crearEncargo(input: {
  workspaceId: string;
  agentId: string;
  usuarioId: string;
  texto: string;
  /** Quién lo ejecutará. Sin valor, el Webmaster: era el único que había. */
  agente?: AgenteDeEncargos;
}): Promise<ResultadoEncargo> {
  const texto = input.texto.trim();
  if (texto.length < 3) return { ok: false, error: "Cuéntale al Webmaster qué quieres cambiar en tu sitio." };
  if (texto.length > 4000) {
    return { ok: false, error: "El encargo es demasiado largo. Divídelo en cambios más pequeños." };
  }

  return conEspacio(input.workspaceId, async (scope) => {
    const quien = input.agente ?? "webmaster";
    // Cada oficio trabaja sobre lo suyo: el Webmaster sobre el WordPress
    // conectado, Marketing sobre las cuentas de anuncios.
    const proveedores = quien === "marketing" ? ["google_ads", "meta_ads"] : ["wordpress"];
    const conexion = await scope.query<{ id: string }>(
      `select id from public.connections
        where workspace_id = $1 and provider = any($2::text[]) and status = 'active'
        order by updated_at desc
        limit 1`,
      [input.workspaceId, proveedores],
    );
    const siteId = conexion.rows[0]?.id ?? null;
    // El Webmaster sin sitio no puede hacer nada: mejor decirlo antes de cobrar
    // un encargo. Marketing sí puede: mira lo que haya y explica qué le falta.
    if (!siteId && quien === "webmaster") {
      return {
        ok: false,
        error: "Primero conecta tu sitio en Ajustes → Sitio web: sin acceso a tu WordPress no puedo hacer cambios.",
      };
    }

    const valores = [
      input.workspaceId,
      input.agentId,
      siteId,
      tituloDe(texto),
      texto,
      input.usuarioId,
    ];
    try {
      await scope.query(
        `insert into public.agent_tasks (workspace_id, agent_id, site_id, titulo, detalle, created_by, agente)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [...valores, quien],
      );
    } catch (error) {
      // Si la migración 0029 todavía no está aplicada, la columna `agente` no
      // existe: el encargo se crea igual y el worker lo trata como Webmaster,
      // que es lo que era antes de que hubiera más de un agente por encargo.
      if (!esColumnaInexistente(error)) throw error;
      await scope.query(
        `insert into public.agent_tasks (workspace_id, agent_id, site_id, titulo, detalle, created_by)
         values ($1, $2, $3, $4, $5, $6)`,
        valores,
      );
    }
    return { ok: true };
  });
}

/** `undefined_column` de Postgres: la migración que la añade aún no corrió. */
function esColumnaInexistente(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42703";
}

/**
 * Registra la decisión de una persona sobre una aprobación (Aprobar/Rechazar)
 * y, si ya no queda nada pendiente en la tarea, la devuelve a la cola.
 *
 * Hay dos caminos de aprobación y los dos acaban en `task_approvals`:
 *  · El de la propia herramienta (portada, precios): al reanudar, la acción se
 *    repite y la herramienta encuentra la decisión por su huella.
 *  · El del AI SDK (plugins, usuarios): la conversación guardada tiene una
 *    petición de aprobación que hay que contestar con su `approvalId`.
 * Las preguntas no se deciden aquí: se contestan con `responderPregunta`.
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
        where workspace_id = $1 and id = $2 and decision is null and tool_slug <> $5
        returning task_id`,
      [input.workspaceId, input.aprobacionId, input.aprobada ? "aprobada" : "rechazada", input.usuarioId, PREGUNTA],
    );
    const taskId = decidida.rows[0]?.task_id;
    if (!taskId) return { ok: false, error: "Esta aprobación ya se había decidido." };
    return reanudarSiNoQuedaNada(scope, input.workspaceId, taskId);
  });
}

/**
 * Contesta una pregunta del agente. La respuesta entra en la conversación
 * guardada como un mensaje del cliente, que es exactamente lo que el modelo lee
 * al reanudar; no hace falta que la herramienta la vuelva a buscar.
 */
export async function responderPregunta(input: {
  workspaceId: string;
  usuarioId: string;
  aprobacionId: string;
  respuesta: string;
}): Promise<ResultadoEncargo> {
  const respuesta = input.respuesta.trim();
  if (!respuesta) return { ok: false, error: "Elige una opción o escribe tu respuesta." };
  if (respuesta.length > 1000) return { ok: false, error: "La respuesta es demasiado larga." };

  return conEspacio(input.workspaceId, async (scope) => {
    const contestada = await scope.query<{ task_id: string; pregunta: string }>(
      `update public.task_approvals
          set decision = 'aprobada', decidida_por = $3, decidida_en = now(),
              entrada = entrada || jsonb_build_object('respuesta', $4::text)
        where workspace_id = $1 and id = $2 and decision is null and tool_slug = $5
        returning task_id, resumen as pregunta`,
      [input.workspaceId, input.aprobacionId, input.usuarioId, respuesta, PREGUNTA],
    );
    const fila = contestada.rows[0];
    if (!fila) return { ok: false, error: "Esta pregunta ya se había respondido." };

    await scope.query(
      `update public.agent_tasks
          set mensajes = coalesce(mensajes, '[]'::jsonb)
                         || jsonb_build_array(jsonb_build_object('role', 'user', 'content', $3::text))
        where workspace_id = $1 and id = $2 and estado = 'esperando_aprobacion'`,
      [input.workspaceId, fila.task_id, `RESPUESTA DEL CLIENTE a «${fila.pregunta}»: ${respuesta}`],
    );
    return reanudarSiNoQuedaNada(scope, input.workspaceId, fila.task_id);
  });
}

/** Si la tarea ya no espera nada, vuelve a la cola con las respuestas para el AI SDK. */
async function reanudarSiNoQuedaNada(
  scope: TenantScope,
  workspaceId: string,
  taskId: string,
): Promise<ResultadoEncargo> {
  const pendientes = await scope.query<{ n: string }>(
    `select count(*)::text as n from public.task_approvals
      where workspace_id = $1 and task_id = $2 and decision is null`,
    [workspaceId, taskId],
  );
  if (Number(pendientes.rows[0]?.n ?? 0) > 0) return { ok: true };

  const tarea = await scope.query<{ mensajes: unknown }>(
    `select mensajes from public.agent_tasks
      where workspace_id = $1 and id = $2 and estado = 'esperando_aprobacion'
      for update`,
    [workspaceId, taskId],
  );
  const fila = tarea.rows[0];
  if (!fila) return { ok: true };

  const decisiones = await scope.query<{ huella: string; decision: string | null }>(
    `select huella, decision from public.task_approvals where workspace_id = $1 and task_id = $2`,
    [workspaceId, taskId],
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
    [workspaceId, taskId, JSON.stringify(respuestas)],
  );
  return { ok: true };
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

/**
 * Borra un encargo del historial. Nunca uno que esté `running`: el worker lo
 * tiene tomado y seguiría tocando el sitio aunque la fila desapareciera. Sus
 * aprobaciones se van en cascada; los backups se conservan, sin la tarea.
 */
export async function eliminarEncargo(input: {
  workspaceId: string;
  agentId: string;
  taskId: string;
}): Promise<ResultadoEncargo> {
  return conEspacio(input.workspaceId, async (scope) => {
    const { rows } = await scope.query<{ estado: EstadoEncargo }>(
      `select estado from public.agent_tasks where workspace_id = $1 and agent_id = $2 and id = $3`,
      [input.workspaceId, input.agentId, input.taskId],
    );
    const estado = rows[0]?.estado;
    if (!estado) return { ok: false, error: "Ese encargo ya no existe." };
    if (estado === "running") {
      return { ok: false, error: "Está trabajando en tu sitio ahora mismo. Espera a que termine para borrarlo." };
    }
    await scope.query(
      `delete from public.agent_tasks
        where workspace_id = $1 and agent_id = $2 and id = $3 and estado <> 'running'`,
      [input.workspaceId, input.agentId, input.taskId],
    );
    return { ok: true };
  });
}

/** Vacía el historial del agente. Lo que está trabajando se queda. */
export async function vaciarEncargos(input: {
  workspaceId: string;
  agentId: string;
}): Promise<{ borrados: number; enCurso: number }> {
  return conEspacio(input.workspaceId, async (scope) => {
    const borrados = await scope.query<{ id: string }>(
      `delete from public.agent_tasks
        where workspace_id = $1 and agent_id = $2 and estado <> 'running'
        returning id`,
      [input.workspaceId, input.agentId],
    );
    const enCurso = await scope.query<{ n: string }>(
      `select count(*)::text as n from public.agent_tasks
        where workspace_id = $1 and agent_id = $2 and estado = 'running'`,
      [input.workspaceId, input.agentId],
    );
    return { borrados: borrados.rows.length, enCurso: Number(enCurso.rows[0]?.n ?? 0) };
  });
}

/** La primera línea, recortada: es lo que el worker registra como título. */
function tituloDe(texto: string): string {
  const primera = (texto.split("\n")[0] ?? texto).trim();
  return primera.length > 80 ? `${primera.slice(0, 77)}…` : primera;
}
