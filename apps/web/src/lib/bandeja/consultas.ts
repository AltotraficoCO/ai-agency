import "server-only";

/**
 * Lecturas de la bandeja.
 *
 * Todo pasa por `conEspacio()`, que baja al rol `strappy_worker` y declara
 * `app.workspace_id`: si una de estas consultas tuviera un join mal escrito,
 * devuelve cero filas en lugar de la conversación de otro cliente.
 *
 * Los índices en los que se apoya cada consulta están anotados donde toca. No
 * es decoración: la lista de la bandeja es la pantalla que más se abre del
 * producto y es la primera que se degrada cuando un cliente pasa de mil hilos.
 */
import { conEspacio, consultar } from "../db/pool";
import type { TenantScope } from "@strappy/db";
import { politicaDeEnvio } from "./canales";
import {
  esUrgente,
  ordenarElementos,
  type Catalogos,
  type ConversacionResumen,
  type ElementoHilo,
  type EstadoEnvio,
  type EstadoMando,
  type Filtros,
  type Hilo,
  type Persona,
  type QuienHabla,
} from "./tipos";

/** Cuántas conversaciones trae la lista de una vez. */
const TAMANO_PAGINA = 60;
/** Cuántos elementos trae el hilo. Suficiente para una conversación de meses. */
const TAMANO_HILO = 300;

// ── Mando ────────────────────────────────────────────────────────────────────

/**
 * De las cuatro señales del esquema al único dato que la barra de control
 * entiende. Es la misma regla que aplica el motor en `estadoDeMando`, más la
 * pregunta que el motor no se hace: ¿el que tiene el control soy yo?
 */
export function resolverMando(
  fila: {
    handover_state: string;
    bot_enabled: boolean;
    bot_paused_until: string | Date | null;
    assignee_user_id: string | null;
  },
  yo: string,
): EstadoMando {
  if (fila.handover_state === "human" || fila.handover_state === "pending_human") {
    if (fila.assignee_user_id === yo) return "tuyo";
    if (fila.assignee_user_id) return "otro";
    return "pausado";
  }
  if (!fila.bot_enabled) return "pausado";
  if (fila.bot_paused_until && new Date(fila.bot_paused_until).getTime() > Date.now()) {
    return "pausado";
  }
  return "ia";
}

/** Quién habló, a partir de la dirección y el tipo de autor del mensaje. */
export function quienHabla(direccion: string, autor: string): QuienHabla {
  if (autor === "system") return "sistema";
  if (direccion === "inbound") return "cliente";
  return autor === "human" ? "humano" : "ia";
}

// ── Quién es quién ───────────────────────────────────────────────────────────

/**
 * Los nombres del equipo, por identificador.
 *
 * `profiles` no es visible para el rol `strappy_worker` —sus políticas son de
 * `authenticated`— así que estos nombres se leen por la vía transversal, con el
 * espacio puesto a mano en el `where`. Es el mismo caso que resolver a qué
 * espacio pertenece un usuario: hay que saber quién es alguien ANTES de poder
 * acotarlo a un espacio.
 */
export async function directorioDeMiembros(
  workspaceId: string,
): Promise<Map<string, Persona>> {
  const filas = await consultar<{ user_id: string; full_name: string | null; avatar_url: string | null }>(
    `select m.user_id, p.full_name, p.avatar_url
       from public.memberships m
       left join public.profiles p on p.user_id = m.user_id
      where m.workspace_id = $1 and m.status = 'active'
      order by p.full_name nulls last`,
    [workspaceId],
  );
  return new Map(
    filas.map((fila) => [
      fila.user_id,
      {
        id: fila.user_id,
        nombre: fila.full_name ?? "Compañero",
        ...(fila.avatar_url ? { avatar: fila.avatar_url } : {}),
      },
    ]),
  );
}

// ── Lista ────────────────────────────────────────────────────────────────────

type FilaLista = {
  id: string;
  status: string;
  handover_state: string;
  bot_enabled: boolean;
  bot_paused_until: string | null;
  assignee_user_id: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  send_restriction_until: string | null;
  snoozed_until: string | null;
  contacto_id: string;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  contacto_avatar: string | null;
  canal_id: string;
  canal_tipo: string;
  canal_nombre: string;
  agente_id: string | null;
  agente_nombre: string | null;
  ultimo_texto: string | null;
  ultimo_tipo: string | null;
  ultima_direccion: string | null;
  ultimo_autor: string | null;
  etiquetas: { id: string; nombre: string; color: string }[] | null;
};

/** Vista previa legible de un mensaje que puede no ser texto. */
function vistaPrevia(tipo: string | null, contenido: string | null): string {
  if (tipo === "text" || tipo === "system") return contenido ?? "";
  const nombres: Record<string, string> = {
    image: "Envió una imagen",
    audio: "Envió una nota de voz",
    video: "Envió un video",
    document: "Envió un documento",
    sticker: "Envió un sticker",
    location: "Compartió su ubicación",
    template: "Se envió una plantilla",
    interactive: contenido ?? "Envió opciones",
    contacts: "Compartió un contacto",
  };
  return nombres[tipo ?? ""] ?? contenido ?? "Mensaje sin texto";
}

function aResumen(fila: FilaLista, yo: string, equipo: Map<string, Persona>): ConversacionResumen {
  const contacto: ConversacionResumen["contacto"] = {
    id: fila.contacto_id,
    nombre: fila.contacto_nombre ?? fila.contacto_telefono ?? "Contacto sin nombre",
    ...(fila.contacto_telefono ? { telefono: fila.contacto_telefono } : {}),
    ...(fila.contacto_avatar ? { avatar: fila.contacto_avatar } : {}),
  };

  return {
    id: fila.id,
    contacto,
    canal: { id: fila.canal_id, tipo: fila.canal_tipo, nombre: fila.canal_nombre },
    agente: fila.agente_id ? { id: fila.agente_id, nombre: fila.agente_nombre ?? "Agente" } : null,
    asignado: fila.assignee_user_id
      ? (equipo.get(fila.assignee_user_id) ?? { id: fila.assignee_user_id, nombre: "Compañero" })
      : null,
    mando: resolverMando(fila, yo),
    estado: (fila.status as ConversacionResumen["estado"]) ?? "open",
    sinLeer: Number(fila.unread_count ?? 0),
    etiquetas: (fila.etiquetas ?? []).map((e) => ({ id: e.id, nombre: e.nombre, color: e.color })),
    ultimo: fila.ultima_direccion
      ? {
          texto: vistaPrevia(fila.ultimo_tipo, fila.ultimo_texto),
          quien: quienHabla(fila.ultima_direccion, fila.ultimo_autor ?? "contact"),
        }
      : null,
    ultimaFecha: fila.last_message_at,
    ultimoEntrante: fila.last_inbound_at,
    ultimoSaliente: fila.last_outbound_at,
    pospuestaHasta: fila.snoozed_until,
    envioLibreHasta: fila.send_restriction_until,
    urgente: esUrgente({
      ultimoEntrante: fila.last_inbound_at,
      ultimoSaliente: fila.last_outbound_at,
      estado: fila.status,
    }),
  };
}

/**
 * La lista de la bandeja.
 *
 * Un solo viaje a la base: el último mensaje entra por un `lateral` que usa
 * `messages_ws_conv_created_idx` (una lectura del índice por conversación, no un
 * escaneo), y las etiquetas se agregan a jsonb para no multiplicar filas.
 */
export async function listarConversaciones(input: {
  workspaceId: string;
  usuarioId: string;
  filtros: Filtros;
}): Promise<ConversacionResumen[]> {
  const { filtros: f } = input;

  // Los parámetros se numeran según se van necesitando: declarar uno «por si
  // acaso» y no usarlo hace que Postgres rechace la consulta entera.
  const condiciones: string[] = ["c.workspace_id = $1"];
  const valores: unknown[] = [input.workspaceId];

  const parametro = (valor: unknown): string => {
    valores.push(valor);
    return `$${valores.length}`;
  };

  if (f.estado === "abiertas") condiciones.push("c.status = 'open'");
  else if (f.estado === "pospuestas") condiciones.push("c.status = 'snoozed'");
  else if (f.estado === "cerradas") condiciones.push("c.status = 'closed'");

  if (f.pestana === "mias")
    condiciones.push(`c.assignee_user_id = ${parametro(input.usuarioId)}::uuid`);
  if (f.pestana === "sin-asignar") condiciones.push("c.assignee_user_id is null");
  if (f.pestana === "sin-leer") condiciones.push("c.unread_count > 0");

  if (f.canalId) condiciones.push(`c.channel_id = ${parametro(f.canalId)}::uuid`);
  if (f.asignadoId) condiciones.push(`c.assignee_user_id = ${parametro(f.asignadoId)}::uuid`);
  if (f.agenteId) condiciones.push(`c.agent_id = ${parametro(f.agenteId)}::uuid`);
  if (f.desde) condiciones.push(`c.last_message_at >= ${parametro(f.desde)}::timestamptz`);
  if (f.hasta)
    condiciones.push(
      `c.last_message_at < (${parametro(f.hasta)}::timestamptz + interval '1 day')`,
    );

  if (f.etiquetaId) {
    condiciones.push(
      `exists (select 1 from public.taggings tg
                where tg.workspace_id = c.workspace_id
                  and tg.entity_type = 'conversation' and tg.entity_id = c.id
                  and tg.tag_id = ${parametro(f.etiquetaId)}::uuid)`,
    );
  }

  // El mismo predicado que `esUrgente`, pero en SQL: el chip filtra en la base
  // para que no dependa de cuántas conversaciones cupieron en la página.
  if (f.soloUrgentes) {
    condiciones.push(
      `(c.status = 'open'
        and c.last_inbound_at is not null
        and coalesce(c.last_outbound_at, 'epoch'::timestamptz) < c.last_inbound_at
        and c.last_inbound_at < now() - make_interval(mins => ${parametro(30)}::int))`,
    );
  }

  const busqueda = f.busqueda.trim();
  if (busqueda) {
    const p = parametro(`%${busqueda}%`);
    condiciones.push(
      `(ct.name ilike ${p} or ct.phone ilike ${p}
        or exists (select 1 from public.messages mb
                    where mb.workspace_id = c.workspace_id and mb.conversation_id = c.id
                      and mb.content->>'text' ilike ${p}))`,
    );
  }

  const [equipo, filas] = await Promise.all([
    directorioDeMiembros(input.workspaceId),
    conEspacio(input.workspaceId, async (scope) => {
    const { rows } = await scope.query<FilaLista>(
      `select c.id, c.status, c.handover_state, c.bot_enabled, c.bot_paused_until,
              c.assignee_user_id, c.unread_count, c.last_message_at, c.last_inbound_at,
              c.last_outbound_at, c.send_restriction_until, c.snoozed_until,
              ct.id as contacto_id, ct.name as contacto_nombre, ct.phone as contacto_telefono,
              ct.avatar_url as contacto_avatar,
              ch.id as canal_id, ch.kind as canal_tipo, ch.name as canal_nombre,
              a.id as agente_id, a.name as agente_nombre,
              m.content->>'text' as ultimo_texto,
              m.content_type as ultimo_tipo,
              m.direction as ultima_direccion,
              m.author_type as ultimo_autor,
              (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nombre', t.name, 'color', t.color)
                                         order by t.name), '[]'::jsonb)
                 from public.taggings tg
                 join public.tags t on t.workspace_id = tg.workspace_id and t.id = tg.tag_id
                where tg.workspace_id = c.workspace_id
                  and tg.entity_type = 'conversation' and tg.entity_id = c.id) as etiquetas
         from public.conversations c
         join public.contacts ct on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
         join public.channels ch on ch.workspace_id = c.workspace_id and ch.id = c.channel_id
         left join public.agents a on a.workspace_id = c.workspace_id and a.id = c.agent_id
         left join lateral (
              select mm.content, mm.content_type, mm.direction, mm.author_type
                from public.messages mm
               where mm.workspace_id = c.workspace_id and mm.conversation_id = c.id
                 and mm.status <> 'deleted'
               order by mm.created_at desc, mm.direction desc, mm.id desc
               limit 1) m on true
        where ${condiciones.join("\n          and ")}
        order by c.last_message_at desc nulls last, c.id desc
        limit ${TAMANO_PAGINA}`,
        valores,
      );
      return rows;
    }),
  ]);

  return filas.map((fila) => aResumen(fila, input.usuarioId, equipo));
}

// ── Hilo ─────────────────────────────────────────────────────────────────────

const TEXTOS_EVENTO: Record<string, string> = {
  control_tomado: "tomó el control de la conversación",
  control_devuelto: "devolvió la conversación a la IA",
  control_solicitado: "pidió el control de la conversación",
  bot_pausado: "puso la IA en pausa",
  conversacion_asignada: "cambió la persona asignada",
  conversacion_pospuesta: "pospuso la conversación",
  conversacion_reabierta: "reabrió la conversación",
  conversacion_cerrada: "cerró la conversación",
  escalado_a_humano: "el agente pidió ayuda de una persona",
  motor_omitio: "la IA no respondió",
  resumen_para_la_ia: "dejó un resumen para la IA",
  etiqueta_puesta: "etiquetó la conversación",
  etiqueta_quitada: "quitó una etiqueta",
};

function textoDeEvento(tipo: string, payload: Record<string, unknown> | null): string {
  const base = TEXTOS_EVENTO[tipo] ?? tipo.replaceAll("_", " ");
  const detalle = payload?.["detalle"] ?? payload?.["motivo"] ?? payload?.["nota"];
  return typeof detalle === "string" && detalle ? `${base} · ${detalle}` : base;
}

/** El hilo completo: mensajes, notas internas y eventos, en un solo orden. */
export async function leerHilo(input: {
  workspaceId: string;
  usuarioId: string;
  conversacionId: string;
}): Promise<Hilo | null> {
  const equipo = await directorioDeMiembros(input.workspaceId);

  return conEspacio(input.workspaceId, async (scope) => {
    const { rows } = await scope.query<
      FilaLista & {
        summary: string | null;
        contacto_correo: string | null;
        contacto_creado: string;
        contacto_propiedades: Record<string, unknown> | null;
      }
    >(
      `select c.id, c.status, c.handover_state, c.bot_enabled, c.bot_paused_until,
              c.assignee_user_id, c.unread_count, c.last_message_at, c.last_inbound_at,
              c.last_outbound_at, c.send_restriction_until, c.snoozed_until, c.summary,
              ct.id as contacto_id, ct.name as contacto_nombre, ct.phone as contacto_telefono,
              ct.avatar_url as contacto_avatar, ct.email as contacto_correo,
              ct.created_at as contacto_creado, ct.properties as contacto_propiedades,
              ch.id as canal_id, ch.kind as canal_tipo, ch.name as canal_nombre,
              a.id as agente_id, a.name as agente_nombre,
              null::text as ultimo_texto, null::text as ultimo_tipo,
              null::text as ultima_direccion, null::text as ultimo_autor,
              (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nombre', t.name, 'color', t.color)
                                         order by t.name), '[]'::jsonb)
                 from public.taggings tg
                 join public.tags t on t.workspace_id = tg.workspace_id and t.id = tg.tag_id
                where tg.workspace_id = c.workspace_id
                  and tg.entity_type = 'conversation' and tg.entity_id = c.id) as etiquetas
         from public.conversations c
         join public.contacts ct on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
         join public.channels ch on ch.workspace_id = c.workspace_id and ch.id = c.channel_id
         left join public.agents a on a.workspace_id = c.workspace_id and a.id = c.agent_id
        where c.workspace_id = $1 and c.id = $2`,
      [input.workspaceId, input.conversacionId],
    );
    const cabecera = rows[0];
    if (!cabecera) return null;

    const [mensajes, notas, eventos, control] = await Promise.all([
      scope.query<{
        id: string;
        direction: string;
        author_type: string;
        content_type: string;
        content: Record<string, unknown> | null;
        status: string;
        error_detail: string | null;
        author_user_id: string | null;
        fecha: string;
      }>(
        // Orden descendente para aprovechar messages_ws_conv_created_idx y traer
        // los últimos N; se invierte en memoria.
        `select m.id, m.direction, m.author_type, m.content_type, m.content, m.status,
                m.error_detail, m.author_user_id,
                coalesce(m.provider_timestamp, m.sent_at, m.created_at) as fecha
           from public.messages m
          where m.workspace_id = $1 and m.conversation_id = $2 and m.status <> 'deleted'
          order by m.created_at desc, m.direction desc, m.id desc
          limit ${TAMANO_HILO}`,
        [input.workspaceId, input.conversacionId],
      ),
      scope.query<{
        id: string;
        body: string;
        mentions: string[] | null;
        author_user_id: string | null;
        created_at: string;
      }>(
        `select n.id, n.body, n.mentions, n.author_user_id, n.created_at
           from public.notes n
          where n.workspace_id = $1 and n.conversation_id = $2
          order by n.created_at desc
          limit ${TAMANO_HILO}`,
        [input.workspaceId, input.conversacionId],
      ),
      scope.query<{
        id: string;
        type: string;
        actor_type: string;
        payload: Record<string, unknown> | null;
        actor_user_id: string | null;
        created_at: string;
      }>(
        `select e.id::text as id, e.type, e.actor_type, e.payload,
                e.actor_user_id, e.created_at
           from public.conversation_events e
          where e.workspace_id = $1 and e.conversation_id = $2
          order by e.created_at desc
          limit ${TAMANO_HILO}`,
        [input.workspaceId, input.conversacionId],
      ),
      scope.query<{ created_at: string; actor_user_id: string | null }>(
        `select e.created_at, e.actor_user_id
           from public.conversation_events e
          where e.workspace_id = $1 and e.conversation_id = $2 and e.type = 'control_tomado'
          order by e.created_at desc
          limit 1`,
        [input.workspaceId, input.conversacionId],
      ),
    ]);

    const elementos: ElementoHilo[] = [
      ...mensajes.rows.map((m): ElementoHilo => {
        const quien = quienHabla(m.direction, m.author_type);
        const texto = vistaPrevia(m.content_type, textoDe(m.content));
        return {
          clase: "mensaje",
          id: m.id,
          quien,
          texto,
          tipo: m.content_type,
          fecha: fechaISO(m.fecha),
          estado: (m.status as EstadoEnvio) ?? "sent",
          autor: m.author_user_id ? (equipo.get(m.author_user_id)?.nombre ?? null) : null,
          error: m.error_detail,
        };
      }),
      ...notas.rows.map(
        (n): ElementoHilo => ({
          clase: "nota",
          id: n.id,
          texto: n.body,
          fecha: fechaISO(n.created_at),
          autor: n.author_user_id ? (equipo.get(n.author_user_id)?.nombre ?? null) : null,
          menciones: n.mentions ?? [],
        }),
      ),
      ...eventos.rows.map(
        (e): ElementoHilo => ({
          clase: "evento",
          id: `evento:${e.id}`,
          tipo: e.type,
          texto: `${
            (e.actor_user_id ? equipo.get(e.actor_user_id)?.nombre : null) ??
            etiquetaActor(e.actor_type)
          } ${textoDeEvento(e.type, e.payload)}`,
          fecha: fechaISO(e.created_at),
          quien: e.actor_type === "human" ? "humano" : e.actor_type === "bot" ? "ia" : "sistema",
        }),
      ),
    ];

    const conversacion = aResumen(cabecera, input.usuarioId, equipo);
    const politica = await politicaDeEnvio(scope, {
      canalTipo: cabecera.canal_tipo,
      canalId: cabecera.canal_id,
      conversacionId: cabecera.id,
      workspaceId: input.workspaceId,
    });

    const filaControl = control.rows[0];
    const propiedades: Record<string, string> = {};
    for (const [clave, valor] of Object.entries(cabecera.contacto_propiedades ?? {})) {
      if (typeof valor === "string" || typeof valor === "number") propiedades[clave] = String(valor);
    }

    return {
      conversacion,
      elementos: ordenarElementos(elementos),
      control: {
        desde: filaControl ? fechaISO(filaControl.created_at) : null,
        quien:
          conversacion.asignado ??
          (filaControl?.actor_user_id
            ? (equipo.get(filaControl.actor_user_id) ?? {
                id: filaControl.actor_user_id,
                nombre: "Compañero",
              })
            : null),
      },
      envio: politica,
      resumen: cabecera.summary,
      contacto: {
        id: cabecera.contacto_id,
        nombre: conversacion.contacto.nombre,
        ...(cabecera.contacto_telefono ? { telefono: cabecera.contacto_telefono } : {}),
        ...(cabecera.contacto_correo ? { correo: cabecera.contacto_correo } : {}),
        creadoEl: fechaISO(cabecera.contacto_creado),
        propiedades,
      },
    };
  });
}

function etiquetaActor(actor: string): string {
  if (actor === "bot") return "La IA";
  if (actor === "contact") return "El cliente";
  if (actor === "automation") return "Una automatización";
  return "El sistema";
}

function textoDe(contenido: Record<string, unknown> | null): string | null {
  const texto = contenido?.["text"];
  if (typeof texto === "string") return texto;
  const caption = contenido?.["caption"];
  if (typeof caption === "string") return caption;
  return null;
}

function fechaISO(valor: string | Date): string {
  return valor instanceof Date ? valor.toISOString() : new Date(valor).toISOString();
}

// ── Catálogos ────────────────────────────────────────────────────────────────

/** Todo lo que los menús de la bandeja necesitan, en una sola llamada. */
export async function leerCatalogos(input: {
  workspaceId: string;
  usuario: Persona;
}): Promise<Catalogos> {
  return conEspacio(input.workspaceId, async (scope) => {
    const [etiquetas, miembros, respuestas, canales, agentes] = await Promise.all([
      scope.query<{ id: string; name: string; color: string }>(
        `select id, name, color from public.tags where workspace_id = $1 order by name`,
        [input.workspaceId],
      ),
      directorioDeMiembros(input.workspaceId),
      scope.query<{ id: string; shortcut: string; title: string; body: string }>(
        `select id, shortcut, title, body from public.quick_replies
          where workspace_id = $1 order by usage_count desc, shortcut`,
        [input.workspaceId],
      ),
      scope.query<{ id: string; kind: string; name: string }>(
        `select id, kind, name from public.channels where workspace_id = $1 order by name`,
        [input.workspaceId],
      ),
      scope.query<{ id: string; name: string }>(
        `select id, name from public.agents where workspace_id = $1 and status <> 'archived' order by name`,
        [input.workspaceId],
      ),
    ]);

    return {
      etiquetas: etiquetas.rows.map((t) => ({ id: t.id, nombre: t.name, color: t.color })),
      miembros: [...miembros.values()],
      respuestas: respuestas.rows.map((r) => ({
        id: r.id,
        atajo: r.shortcut,
        titulo: r.title,
        cuerpo: r.body,
      })),
      canales: canales.rows.map((c) => ({ id: c.id, tipo: c.kind, nombre: c.name })),
      agentes: agentes.rows.map((a) => ({ id: a.id, nombre: a.name })),
      yo: input.usuario,
      // «Primera vez» significa que no hay ningún canal REAL: el simulador no
      // cuenta, porque tenerlo no implica que nadie te esté escribiendo.
      hayCanal: canales.rows.some((c) => c.kind !== "simulador"),
    };
  });
}

/** Contadores de las pestañas. Cinco `count(*)` sobre el mismo índice. */
export async function contarPestanas(input: {
  workspaceId: string;
  usuarioId: string;
}): Promise<Record<"todas" | "mias" | "sin-asignar" | "sin-leer" | "urgentes", number>> {
  return conEspacio(input.workspaceId, async (scope: TenantScope) => {
    const { rows } = await scope.query<{
      todas: string;
      mias: string;
      sin_asignar: string;
      sin_leer: string;
      urgentes: string;
    }>(
      `select count(*) filter (where true) as todas,
              count(*) filter (where assignee_user_id = $2) as mias,
              count(*) filter (where assignee_user_id is null) as sin_asignar,
              count(*) filter (where unread_count > 0) as sin_leer,
              count(*) filter (where last_inbound_at is not null
                                 and coalesce(last_outbound_at, 'epoch'::timestamptz) < last_inbound_at
                                 and last_inbound_at < now() - interval '30 minutes') as urgentes
         from public.conversations
        where workspace_id = $1 and status = 'open'`,
      [input.workspaceId, input.usuarioId],
    );
    const f = rows[0];
    return {
      todas: Number(f?.todas ?? 0),
      mias: Number(f?.mias ?? 0),
      "sin-asignar": Number(f?.sin_asignar ?? 0),
      "sin-leer": Number(f?.sin_leer ?? 0),
      urgentes: Number(f?.urgentes ?? 0),
    };
  });
}
