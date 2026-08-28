import "server-only";

/**
 * Conversaciones de ejemplo para desarrollo.
 *
 * Una bandeja vacía no se puede juzgar: los estados que hay que ver de un
 * vistazo —quién manda, qué está en rojo, qué canal dice que no se puede
 * escribir— solo existen con datos. Esto siembra los siete casos que la
 * pantalla tiene que resolver bien, incluida la ventana de envío cerrada, que
 * es la que más fácil se rompe.
 *
 * Es idempotente y solo corre con `STRAPPY_USUARIO_DEV` puesto (o sea, nunca en
 * producción, donde la autenticación real está configurada).
 */
import { randomUUID } from "node:crypto";
import { conEspacio, consultar } from "../db/pool";
import { PALETA_ETIQUETAS } from "./tipos";

const MINUTO = 60_000;

type Guion = {
  clave: string;
  contacto: string;
  telefono: string;
  handover: "bot" | "human" | "pending_human";
  botActivo: boolean;
  asignado: "yo" | "otro" | null;
  estado: "open" | "snoozed" | "closed";
  /** Minutos hacia atrás del último mensaje entrante. */
  haceEntrante: number;
  sinLeer: number;
  etiquetas: string[];
  mensajes: { de: "cliente" | "ia" | "humano"; texto: string; hace: number }[];
  notas?: { texto: string; hace: number }[];
  pospuestaHoras?: number;
};

const GUIONES: Guion[] = [
  {
    clave: "573001112233",
    contacto: "Marcela Ríos",
    telefono: "573001112233",
    handover: "bot",
    botActivo: true,
    asignado: null,
    estado: "open",
    haceEntrante: 4,
    sinLeer: 2,
    etiquetas: ["Pedido"],
    mensajes: [
      { de: "cliente", texto: "Buenas, ¿tienen pan de yuca hoy?", hace: 12 },
      { de: "ia", texto: "¡Hola! Sí, tenemos pan de yuca recién horneado hasta las 6 de la tarde. ¿Cuántos te separo?", hace: 11 },
      { de: "cliente", texto: "Separame 20 porfa", hace: 5 },
      { de: "cliente", texto: "y 2 almojábanas", hace: 4 },
    ],
  },
  {
    clave: "573002223344",
    contacto: "Julián Pérez",
    telefono: "573002223344",
    handover: "human",
    botActivo: false,
    asignado: "yo",
    estado: "open",
    haceEntrante: 9,
    sinLeer: 0,
    etiquetas: ["Reclamo"],
    mensajes: [
      { de: "cliente", texto: "El domicilio de ayer llegó incompleto, faltaron dos roscones.", hace: 40 },
      { de: "ia", texto: "Lamento mucho lo ocurrido. Voy a pasar tu caso a una persona del equipo.", hace: 38 },
      { de: "humano", texto: "Hola Julián, soy del equipo de la panadería. Te repongo los dos roscones hoy sin costo, ¿te sirve a las 4?", hace: 20 },
      { de: "cliente", texto: "Perfecto, gracias por resolverlo tan rápido.", hace: 9 },
    ],
    notas: [{ texto: "Cliente de todos los sábados. Repuse el pedido sin cobrar el domicilio.", hace: 18 }],
  },
  {
    clave: "573003334455",
    contacto: "Camila Ospina",
    telefono: "573003334455",
    handover: "human",
    botActivo: false,
    asignado: "otro",
    estado: "open",
    haceEntrante: 15,
    sinLeer: 1,
    etiquetas: ["Mayorista"],
    mensajes: [
      { de: "cliente", texto: "Buenas tardes, necesito cotización para 300 panes de bono.", hace: 60 },
      { de: "humano", texto: "Claro que sí, Camila. Te armo la cotización y te la mando en un momento.", hace: 45 },
      { de: "cliente", texto: "¿Alguna novedad con la cotización?", hace: 15 },
    ],
  },
  {
    clave: "573004445566",
    contacto: "Andrés Gil",
    telefono: "573004445566",
    handover: "bot",
    botActivo: true,
    asignado: null,
    estado: "open",
    haceEntrante: 190,
    sinLeer: 1,
    etiquetas: [],
    mensajes: [
      { de: "cliente", texto: "¿Hacen tortas personalizadas para 40 personas?", hace: 190 },
    ],
  },
  {
    clave: "573005556677",
    contacto: "Doña Lucía",
    telefono: "573005556677",
    handover: "human",
    botActivo: false,
    asignado: "yo",
    estado: "open",
    haceEntrante: 30 * 60,
    sinLeer: 0,
    etiquetas: ["VIP"],
    mensajes: [
      { de: "cliente", texto: "Mijo, ¿me guarda el pan aliñado del domingo?", hace: 30 * 60 },
      { de: "humano", texto: "Claro que sí, doña Lucía. Se lo dejo apartado.", hace: 30 * 60 - 20 },
    ],
  },
  {
    clave: "573006667788",
    contacto: "Tienda El Trigal",
    telefono: "573006667788",
    handover: "bot",
    botActivo: true,
    asignado: "yo",
    estado: "snoozed",
    haceEntrante: 300,
    sinLeer: 0,
    etiquetas: ["Mayorista", "VIP"],
    pospuestaHoras: 3,
    mensajes: [
      { de: "cliente", texto: "Confirmamos el pedido del martes, mismo volumen.", hace: 300 },
      { de: "ia", texto: "Anotado: mismo volumen para el martes. Te confirmo el lunes por la tarde.", hace: 299 },
    ],
  },
  {
    clave: "573007778899",
    contacto: "Óscar Mahecha",
    telefono: "573007778899",
    handover: "bot",
    botActivo: true,
    asignado: null,
    estado: "closed",
    haceEntrante: 2000,
    sinLeer: 0,
    etiquetas: [],
    mensajes: [
      { de: "cliente", texto: "¿A qué hora abren los domingos?", hace: 2000 },
      { de: "ia", texto: "Los domingos abrimos de 7 de la mañana a 2 de la tarde. ¡Te esperamos!", hace: 1999 },
      { de: "cliente", texto: "Gracias", hace: 1998 },
    ],
  },
];

const ETIQUETAS = [
  { nombre: "Pedido", color: PALETA_ETIQUETAS[5]?.hex ?? "#5F8A7C" },
  { nombre: "Reclamo", color: PALETA_ETIQUETAS[3]?.hex ?? "#9A7B6C" },
  { nombre: "Mayorista", color: PALETA_ETIQUETAS[6]?.hex ?? "#5E7E97" },
  { nombre: "VIP", color: PALETA_ETIQUETAS[1]?.hex ?? "#7C77A8" },
];

const RESPUESTAS = [
  {
    atajo: "horario",
    titulo: "Horario de la panadería",
    cuerpo: "Hola {{contacto.nombre}}, abrimos de lunes a sábado de 6 a. m. a 8 p. m. y los domingos de 7 a. m. a 2 p. m.",
  },
  {
    atajo: "envio",
    titulo: "Tiempo de envío",
    cuerpo: "{{contacto.nombre}}, tu pedido sale de la panadería en menos de 40 minutos. Te aviso apenas vaya en camino.",
  },
  {
    atajo: "gracias",
    titulo: "Cierre amable",
    cuerpo: "¡Gracias por escribirnos, {{contacto.nombre}}! Cualquier cosa por aquí estamos.",
  },
];

export type ResultadoSemilla = {
  conversaciones: number;
  compañero: string;
};

export async function sembrarBandeja(input: {
  workspaceId: string;
  usuarioId: string;
}): Promise<ResultadoSemilla> {
  const otroId = await asegurarCompanero(input.workspaceId);

  return conEspacio(input.workspaceId, async (scope) => {
    const ws = input.workspaceId;

    const { rows: agentes } = await scope.query<{ id: string }>(
      `select id from public.agents where workspace_id = $1 order by created_at limit 1`,
      [ws],
    );
    const agenteId = agentes[0]?.id ?? null;

    // Canal de WhatsApp con su número: el trigger de `whatsapp_numbers`
    // rellena `channel_routing`, que es lo que resuelve el tenant del webhook.
    const { rows: canales } = await scope.query<{ id: string }>(
      `insert into public.channels (workspace_id, kind, name, status, connected_at)
       select $1, 'whatsapp', 'WhatsApp · La Espiga', 'connected', now()
        where not exists (select 1 from public.channels
                           where workspace_id = $1 and kind = 'whatsapp')
       returning id`,
      [ws],
    );
    let canalId = canales[0]?.id;
    if (!canalId) {
      const { rows } = await scope.query<{ id: string }>(
        `select id from public.channels where workspace_id = $1 and kind = 'whatsapp' limit 1`,
        [ws],
      );
      canalId = rows[0]?.id;
    }
    if (!canalId) throw new Error("No se pudo crear el canal de WhatsApp de ejemplo.");

    const { rows: cuentas } = await scope.query<{ id: string }>(
      `insert into public.whatsapp_accounts (workspace_id, channel_id, waba_id, name)
       values ($1, $2, $3, 'La Espiga')
       on conflict (waba_id) do update set channel_id = excluded.channel_id
       returning id`,
      [ws, canalId, `waba-dev-${ws.slice(0, 8)}`],
    );
    const cuentaId = cuentas[0]?.id;
    if (cuentaId) {
      await scope.query(
        `insert into public.whatsapp_numbers
           (workspace_id, account_id, channel_id, phone_number_id, display_phone_number,
            verified_name, is_default, agent_id, status)
         values ($1, $2, $3, $4, '+57 300 000 0000', 'Panadería La Espiga', true, $5, 'active')
         on conflict (phone_number_id) do update set channel_id = excluded.channel_id,
                                                     agent_id = excluded.agent_id`,
        [ws, cuentaId, canalId, `pnid-dev-${ws.slice(0, 8)}`, agenteId],
      );
    }

    for (const etiqueta of ETIQUETAS) {
      await scope.query(
        `insert into public.tags (workspace_id, name, color) values ($1, $2, $3)
         on conflict (workspace_id, name) do update set color = excluded.color`,
        [ws, etiqueta.nombre, etiqueta.color],
      );
    }

    for (const respuesta of RESPUESTAS) {
      await scope.query(
        `insert into public.quick_replies (workspace_id, shortcut, title, body, created_by)
         values ($1, $2, $3, $4, $5)
         on conflict (workspace_id, shortcut) do update set body = excluded.body`,
        [ws, respuesta.atajo, respuesta.titulo, respuesta.cuerpo, input.usuarioId],
      );
    }

    const ahora = Date.now();
    let creadas = 0;

    for (const guion of GUIONES) {
      const { rows: contactos } = await scope.query<{ id: string }>(
        `insert into public.contacts (workspace_id, phone, name, source)
         values ($1, $2, $3, 'whatsapp')
         on conflict (workspace_id, phone) where phone is not null
           do update set name = excluded.name, updated_at = now()
         returning id`,
        [ws, guion.telefono, guion.contacto],
      );
      const contactoId = contactos[0]?.id;
      if (!contactoId) continue;

      const asignado =
        guion.asignado === "yo" ? input.usuarioId : guion.asignado === "otro" ? otroId : null;

      const { rows: conversaciones } = await scope.query<{ id: string }>(
        `insert into public.conversations
           (workspace_id, contact_id, channel_id, agent_id, external_key, status,
            handover_state, bot_enabled, assignee_user_id, snoozed_until)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 case when $10::int is null then null
                      else now() + make_interval(hours => $10::int) end)
         on conflict (workspace_id, channel_id, external_key) where external_key is not null
           do update set status = excluded.status,
                         handover_state = excluded.handover_state,
                         bot_enabled = excluded.bot_enabled,
                         assignee_user_id = excluded.assignee_user_id,
                         snoozed_until = excluded.snoozed_until,
                         updated_at = now()
         returning id`,
        [
          ws,
          contactoId,
          canalId,
          agenteId,
          guion.clave,
          guion.estado,
          guion.handover,
          guion.botActivo,
          asignado,
          guion.pospuestaHoras ?? null,
        ],
      );
      const conversacionId = conversaciones[0]?.id;
      if (!conversacionId) continue;
      creadas += 1;

      // Se rehacen los mensajes en cada siembra: es un guion, no un histórico.
      await scope.query(
        `delete from public.messages where workspace_id = $1 and conversation_id = $2`,
        [ws, conversacionId],
      );
      await scope.query(
        `delete from public.notes where workspace_id = $1 and conversation_id = $2`,
        [ws, conversacionId],
      );
      await scope.query(
        `delete from public.conversation_events where workspace_id = $1 and conversation_id = $2`,
        [ws, conversacionId],
      );

      for (const [indice, mensaje] of guion.mensajes.entries()) {
        const fecha = new Date(ahora - mensaje.hace * MINUTO).toISOString();
        const entrante = mensaje.de === "cliente";
        await scope.query(
          `insert into public.messages
             (workspace_id, conversation_id, contact_id, channel_id, external_id, direction,
              author_type, author_user_id, agent_id, content_type, content, status,
              sent_at, delivered_at, read_at, provider_timestamp, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'text', $10::jsonb, $11,
                   $12::timestamptz, $12::timestamptz, $12::timestamptz, $12::timestamptz, $12::timestamptz)`,
          [
            ws,
            conversacionId,
            contactoId,
            canalId,
            `semilla-${guion.clave}-${indice}`,
            entrante ? "inbound" : "outbound",
            entrante ? "contact" : mensaje.de === "ia" ? "bot" : "human",
            mensaje.de === "humano" ? input.usuarioId : null,
            mensaje.de === "ia" ? agenteId : null,
            JSON.stringify({ text: mensaje.texto }),
            entrante ? "delivered" : "read",
            fecha,
          ],
        );
      }

      for (const nota of guion.notas ?? []) {
        await scope.query(
          `insert into public.notes
             (workspace_id, conversation_id, contact_id, author_user_id, body, created_at)
           values ($1, $2, $3, $4, $5, $6::timestamptz)`,
          [ws, conversacionId, contactoId, input.usuarioId, nota.texto, new Date(ahora - nota.hace * MINUTO).toISOString()],
        );
      }

      if (guion.handover === "human" && asignado) {
        await scope.query(
          `insert into public.conversation_events
             (workspace_id, conversation_id, type, actor_type, actor_user_id, payload, created_at)
           values ($1, $2, 'control_tomado', 'human', $3, '{}'::jsonb, $4::timestamptz)`,
          [ws, conversacionId, asignado, new Date(ahora - 25 * MINUTO).toISOString()],
        );
      }

      for (const nombre of guion.etiquetas) {
        await scope.query(
          `insert into public.taggings (workspace_id, tag_id, entity_type, entity_id, created_by)
           select $1, t.id, 'conversation', $2, $3 from public.tags t
            where t.workspace_id = $1 and t.name = $4
           on conflict (tag_id, entity_type, entity_id) do nothing`,
          [ws, conversacionId, input.usuarioId, nombre],
        );
      }

      // El trigger de mensajes ya movió los relojes; aquí se fijan los que la
      // bandeja usa para el SLA y para la ventana de envío del canal.
      // El estado se fija DESPUÉS de los mensajes: el disparador de `messages`
      // reabre cualquier conversación cerrada al insertar un entrante, así que
      // ponerlo antes daría siete conversaciones abiertas y ninguna cerrada.
      const ultimoEntrante = new Date(ahora - guion.haceEntrante * MINUTO).toISOString();
      await scope.query(
        `update public.conversations
            set unread_count = $3,
                last_inbound_at = $4::timestamptz,
                send_restriction_until = $4::timestamptz + interval '24 hours',
                status = $5,
                closed_at = case when $5 = 'closed' then now() else null end,
                updated_at = now()
          where workspace_id = $1 and id = $2`,
        [ws, conversacionId, guion.sinLeer, ultimoEntrante, guion.estado],
      );
    }

    return { conversaciones: creadas, compañero: otroId };
  });
}

/**
 * Un segundo par de manos en el espacio.
 *
 * Sin él no se puede ver el estado «otra persona tiene el control», que es
 * justo el que la bandeja tiene que dejar claro para que nadie escriba encima
 * de un compañero.
 */
async function asegurarCompanero(workspaceId: string): Promise<string> {
  const correo = "sofia@strappy.test";
  const existentes = await consultar<{ id: string }>(
    `select id from auth.users where email = $1`,
    [correo],
  );
  let id = existentes[0]?.id;
  if (!id) {
    id = randomUUID();
    await consultar(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1, $2, jsonb_build_object('full_name', 'Sofía Cardona'))`,
      [id, correo],
    );
  }
  await consultar(
    `insert into public.profiles (user_id, full_name) values ($1, 'Sofía Cardona')
     on conflict (user_id) do update set full_name = excluded.full_name`,
    [id],
  );
  await consultar(
    `insert into public.memberships (workspace_id, user_id, role, status)
     values ($1, $2, 'agent', 'active')
     on conflict do nothing`,
    [workspaceId, id],
  );
  return id;
}
