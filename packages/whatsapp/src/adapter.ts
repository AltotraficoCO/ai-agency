/**
 * Adaptador de canal para WhatsApp.
 *
 * Todo lo que WhatsApp tiene de particular vive dentro de este archivo y sus
 * vecinos: la ventana de 24h, las plantillas, el `phone_number_id`, el ritmo
 * de envío por nivel de mensajería. Hacia arriba solo se ven los tipos de
 * `@strappy/core`. Si al añadir este paquete hiciera falta tocar
 * `packages/core`, la abstracción de canal estaría rota.
 */
import type {
  ChannelAdapter,
  ChannelCapability,
  ChannelContext,
  DeliveryReceipt,
  DeliveryStatus,
  InboundMessage,
  MessageContent,
  OutboundMessage,
  SendPolicy,
} from "@strappy/core";
import { isProgress } from "@strappy/core";
import { crearClienteWhatsApp, type ClienteWhatsApp } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import {
  crearLimitadorRitmo,
  type LimitadorRitmo,
} from "./rate-limit.js";
import type {
  MessagingTier,
  SendResult,
  TemplateComponent,
  WhatsAppCredentials,
  WhatsAppInboundRaw,
  WhatsAppStatusRaw,
  WhatsAppWebhookPayload,
} from "./types.js";
import {
  calcularFinDeVentana,
  restriccionNumeroPausado,
  restriccionVentanaCerrada,
  ventanaAbierta,
} from "./window.js";

export const SLUG_WHATSAPP = "whatsapp";

const CAPACIDADES: readonly ChannelCapability[] = [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "location",
  "buttons",
  "list",
  "typing_indicator",
  "read_receipt",
];

/**
 * Estado de la conversación que el adaptador necesita y no puede deducir de la
 * carga de Meta. Lo sirve el runtime, que es quien habla con la base de datos:
 * así el adaptador sigue siendo puro y comprobable sin base de datos.
 */
export type EstadoConversacion = {
  /** `conversations.send_restriction_until`. Nulo si nunca escribió el contacto. */
  readonly enviarLibreHasta: Date | null;
  /** Estado del número emisor: `whatsapp_numbers.status`. */
  readonly estadoNumero?: "active" | "paused" | "disconnected";
};

export type PuertosAdaptador = {
  leerEstadoConversacion(conversationId: string): Promise<EstadoConversacion | null>;
  /** Nivel de mensajería del número, para el ritmo de envío. */
  leerNivelMensajeria?(phoneNumberId: string): Promise<MessagingTier>;
  /**
   * Se llama cuando Meta dice que el token murió (código 190). El runtime marca
   * `whatsapp_accounts` como revocada y para la cola de ese cliente.
   */
  alRevocarseElToken?(input: { ctx: ChannelContext; error: WhatsAppApiError }): Promise<void>;
  /** Se llama cuando hay que parar la cola del cliente sin que el token esté muerto. */
  alPausarLaCola?(input: { ctx: ChannelContext; error: WhatsAppApiError }): Promise<void>;
  now?: () => Date;
  limitador?: LimitadorRitmo;
  /** Fábrica del cliente; los tests inyectan uno con `fetch` grabado. */
  crearCliente?: (credenciales: WhatsAppCredentials) => ClienteWhatsApp;
};

/** Mensaje saliente que además puede ser una plantilla (reenganche fuera de ventana). */
export type OutboundWhatsApp = OutboundMessage & {
  plantilla?: { nombre: string; idioma: string; componentes?: TemplateComponent[] };
};

export function crearAdaptadorWhatsApp(puertos: PuertosAdaptador): ChannelAdapter {
  const now = puertos.now ?? (() => new Date());
  const limitador = puertos.limitador ?? crearLimitadorRitmo();

  const cliente = (ctx: ChannelContext): ClienteWhatsApp => {
    const cred = leerCredenciales(ctx);
    return puertos.crearCliente
      ? puertos.crearCliente(cred)
      : crearClienteWhatsApp({ accessToken: cred.accessToken });
  };

  /** Traduce un fallo de Meta a los efectos de cuenta que el runtime debe aplicar. */
  async function propagarFallo(ctx: ChannelContext, error: unknown): Promise<never> {
    if (error instanceof WhatsAppApiError) {
      if (error.decision.marcarCuentaRevocada) {
        await puertos.alRevocarseElToken?.({ ctx, error });
      } else if (error.decision.pausarCola) {
        await puertos.alPausarLaCola?.({ ctx, error });
      }
    }
    throw error;
  }

  return {
    slug: SLUG_WHATSAPP,
    label: "WhatsApp",
    capabilities: CAPACIDADES,

    async parseInbound(raw: unknown): Promise<InboundMessage[]> {
      return normalizarEntrantes(raw);
    },

    async parseReceipts(raw: unknown): Promise<DeliveryReceipt[]> {
      return normalizarRecibos(raw);
    },

    /**
     * LA VENTANA DE 24 HORAS ESTÁ AQUÍ.
     * El motor solo recibe un `SendPolicy`; nunca aprende qué es una ventana.
     */
    async canSend(ctx): Promise<SendPolicy> {
      const estado = await puertos.leerEstadoConversacion(ctx.conversationId);

      if (estado?.estadoNumero === "paused") {
        return {
          allowed: false,
          restriction: restriccionNumeroPausado(
            "El envío por WhatsApp está pausado para este número. Revisa el estado de tu cuenta de WhatsApp.",
          ),
        };
      }
      if (estado?.estadoNumero === "disconnected") {
        return {
          allowed: false,
          restriction: restriccionNumeroPausado(
            "Este número de WhatsApp está desconectado. Vuelve a conectarlo para poder escribir.",
          ),
        };
      }

      if (ventanaAbierta(estado?.enviarLibreHasta ?? null, now())) {
        return { allowed: true };
      }
      // Cerrada (o nunca abierta): solo cabe reenganchar con plantilla.
      return {
        allowed: false,
        restriction: restriccionVentanaCerrada(estado?.enviarLibreHasta ?? undefined),
      };
    },

    async send(message: OutboundMessage, ctx: ChannelContext): Promise<{ externalId: string }> {
      const cred = leerCredenciales(ctx);
      const api = cliente(ctx);

      // Ritmo por número emisor: el límite de Meta es por phone_number_id, no
      // por espacio de trabajo, y superarlo devuelve 130429 en cascada.
      const nivel = (await puertos.leerNivelMensajeria?.(cred.phoneNumberId)) ?? "TIER_UNKNOWN";
      await limitador.adquirir(cred.phoneNumberId, nivel);

      const plantilla = (message as OutboundWhatsApp).plantilla;
      try {
        const resultado = plantilla
          ? await api.enviarPlantilla({
              phoneNumberId: cred.phoneNumberId,
              to: message.externalContactId,
              nombre: plantilla.nombre,
              idioma: plantilla.idioma,
              ...(plantilla.componentes ? { componentes: plantilla.componentes } : {}),
            })
          : await enviarContenido(api, cred.phoneNumberId, message);
        return { externalId: idDeResultado(resultado) };
      } catch (error) {
        return propagarFallo(ctx, error);
      }
    },

    async setTyping(ctx, on): Promise<void> {
      // WhatsApp no tiene "dejar de escribir": el indicador caduca solo a los
      // 25 s o al enviar el mensaje. Apagarlo es, literalmente, no hacer nada.
      if (!on) return;
      const ultimo = ctx.credentials.lastInboundMessageId;
      if (!ultimo) return;
      try {
        await cliente(ctx).marcarEscribiendo({
          phoneNumberId: leerCredenciales(ctx).phoneNumberId,
          messageId: ultimo,
        });
      } catch {
        // Señal de cortesía: que falle no debe romper el turno del agente.
      }
    },

    async markRead(ctx, externalId): Promise<void> {
      try {
        await cliente(ctx).marcarLeido({
          phoneNumberId: leerCredenciales(ctx).phoneNumberId,
          messageId: externalId,
        });
      } catch {
        // Ídem: un recibo de lectura perdido no justifica fallar el envío.
      }
    },
  };
}

// --- Credenciales ------------------------------------------------------------

export function leerCredenciales(ctx: ChannelContext): WhatsAppCredentials {
  const { accessToken, phoneNumberId } = ctx.credentials;
  if (!accessToken) throw new Error("Falta el token de acceso de WhatsApp en el contexto del canal.");
  if (!phoneNumberId) throw new Error("Falta el phone_number_id de WhatsApp en el contexto del canal.");
  const cred: WhatsAppCredentials = {
    accessToken,
    phoneNumberId,
    ...(ctx.credentials.wabaId ? { wabaId: ctx.credentials.wabaId } : {}),
    ...(ctx.credentials.appSecret ? { appSecret: ctx.credentials.appSecret } : {}),
    ...(ctx.credentials.businessId ? { businessId: ctx.credentials.businessId } : {}),
  };
  return cred;
}

// --- Envío por tipo de contenido ---------------------------------------------

async function enviarContenido(
  api: ClienteWhatsApp,
  phoneNumberId: string,
  message: OutboundMessage,
): Promise<SendResult> {
  const to = message.externalContactId;
  const replyTo = message.replyToExternalId;
  const c = message.content;

  switch (c.kind) {
    case "text":
      return api.enviarTexto({ phoneNumberId, to, text: c.text, ...(replyTo ? { replyTo } : {}) });
    case "image":
      return api.enviarMedia({
        phoneNumberId,
        to,
        tipo: "image",
        mediaId: c.mediaId,
        ...(c.caption ? { caption: c.caption } : {}),
        ...(replyTo ? { replyTo } : {}),
      });
    case "audio":
      return api.enviarMedia({
        phoneNumberId,
        to,
        tipo: "audio",
        mediaId: c.mediaId,
        ...(replyTo ? { replyTo } : {}),
      });
    case "video":
      return api.enviarMedia({
        phoneNumberId,
        to,
        tipo: "video",
        mediaId: c.mediaId,
        ...(c.caption ? { caption: c.caption } : {}),
        ...(replyTo ? { replyTo } : {}),
      });
    case "document":
      return api.enviarMedia({
        phoneNumberId,
        to,
        tipo: "document",
        mediaId: c.mediaId,
        ...(c.filename ? { filename: c.filename } : {}),
        ...(replyTo ? { replyTo } : {}),
      });
    case "location":
      return api.enviarUbicacion({
        phoneNumberId,
        to,
        latitude: c.latitude,
        longitude: c.longitude,
        ...(c.label ? { name: c.label } : {}),
      });
    case "buttons":
      // WhatsApp admite 3 botones de respuesta rápida; con más hay que usar
      // lista. El motor no conoce ese límite, así que se decide aquí.
      return c.options.length > 3
        ? api.enviarInteractivo({
            phoneNumberId,
            to,
            texto: c.text,
            lista: {
              boton: "Ver opciones",
              secciones: [
                {
                  title: "Opciones",
                  rows: c.options.slice(0, 10).map((o) => ({
                    id: o.id,
                    title: o.label.slice(0, 24),
                  })),
                },
              ],
            },
            ...(replyTo ? { replyTo } : {}),
          })
        : api.enviarInteractivo({
            phoneNumberId,
            to,
            texto: c.text,
            botones: c.options.map((o) => ({ id: o.id, label: o.label.slice(0, 20) })),
            ...(replyTo ? { replyTo } : {}),
          });
    case "unsupported":
      return api.enviarTexto({ phoneNumberId, to, text: c.describedAs });
    default: {
      const _exhaustivo: never = c;
      throw new Error(`Contenido no soportado por WhatsApp: ${JSON.stringify(_exhaustivo)}`);
    }
  }
}

function idDeResultado(resultado: SendResult): string {
  const id = resultado.messages?.[0]?.id;
  if (!id) throw new Error("WhatsApp aceptó el envío pero no devolvió el identificador del mensaje.");
  return id;
}

// --- Normalización de entrantes ----------------------------------------------

export function normalizarEntrantes(raw: unknown): InboundMessage[] {
  const carga = raw as WhatsAppWebhookPayload | null;
  const salida: InboundMessage[] = [];

  for (const entry of carga?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages?.length) continue;

      // `contacts` viene en paralelo a `messages`, emparejado por wa_id.
      const nombres = new Map<string, string>();
      for (const contacto of value.contacts ?? []) {
        if (contacto.wa_id && contacto.profile?.name) nombres.set(contacto.wa_id, contacto.profile.name);
      }

      for (const mensaje of value.messages) {
        if (!mensaje.id || !mensaje.from) continue;
        const nombre = nombres.get(mensaje.from);
        const normalizado: InboundMessage = {
          externalId: mensaje.id,
          externalContactId: mensaje.from,
          ...(nombre ? { contactName: nombre } : {}),
          content: contenidoDeEntrante(mensaje),
          sentAt: fechaDeMarca(mensaje.timestamp),
          ...(mensaje.context?.id ? { replyToExternalId: mensaje.context.id } : {}),
          raw: mensaje,
        };
        salida.push(normalizado);
      }
    }
  }

  return salida;
}

function contenidoDeEntrante(m: WhatsAppInboundRaw): MessageContent {
  switch (m.type) {
    case "text":
      return { kind: "text", text: m.text?.body ?? "" };

    case "image":
      return {
        kind: "image",
        mediaId: m.image?.id ?? "",
        ...(m.image?.caption ? { caption: m.image.caption } : {}),
      };

    case "audio":
      // Nota de voz y audio adjunto comparten tipo; `voice` distingue.
      return { kind: "audio", mediaId: m.audio?.id ?? "" };

    case "video":
      return {
        kind: "video",
        mediaId: m.video?.id ?? "",
        ...(m.video?.caption ? { caption: m.video.caption } : {}),
      };

    case "document":
      return {
        kind: "document",
        mediaId: m.document?.id ?? "",
        ...(m.document?.filename ? { filename: m.document.filename } : {}),
      };

    case "sticker":
      // Un sticker es una imagen sin texto; el motor no necesita otro tipo.
      return { kind: "image", mediaId: m.sticker?.id ?? "", caption: "(sticker)" };

    case "location": {
      const etiqueta = m.location?.name ?? m.location?.address;
      return {
        kind: "location",
        latitude: m.location?.latitude ?? 0,
        longitude: m.location?.longitude ?? 0,
        ...(etiqueta ? { label: etiqueta } : {}),
      };
    }

    case "contacts": {
      const nombres = (m.contacts ?? [])
        .map((c) => c.name?.formatted_name ?? c.phones?.[0]?.phone ?? "")
        .filter(Boolean);
      return {
        kind: "unsupported",
        describedAs: nombres.length
          ? `El contacto compartió una tarjeta de contacto: ${nombres.join(", ")}.`
          : "El contacto compartió una tarjeta de contacto.",
      };
    }

    case "interactive": {
      const respuesta = m.interactive?.button_reply ?? m.interactive?.list_reply;
      if (respuesta) {
        // Se normaliza como texto: el motor lee lo que la persona vio pulsado,
        // y el id queda en `raw` para quien necesite el identificador exacto.
        return { kind: "text", text: respuesta.title ?? respuesta.id ?? "" };
      }
      if (m.interactive?.nfm_reply) {
        return {
          kind: "unsupported",
          describedAs: `El contacto completó un formulario de WhatsApp: ${m.interactive.nfm_reply.response_json ?? ""}`,
        };
      }
      return { kind: "unsupported", describedAs: "El contacto respondió con un elemento interactivo." };
    }

    case "button":
      // Botón de una plantilla: llega con el texto visible del botón.
      return { kind: "text", text: m.button?.text ?? m.button?.payload ?? "" };

    case "reaction":
      return {
        kind: "unsupported",
        describedAs: `El contacto reaccionó con ${m.reaction?.emoji ?? "un emoji"} a un mensaje anterior.`,
      };

    case "order":
      return { kind: "unsupported", describedAs: "El contacto envió un pedido del catálogo." };

    case "system":
      return { kind: "unsupported", describedAs: m.system?.body ?? "Aviso del sistema de WhatsApp." };

    case "unsupported":
      return {
        kind: "unsupported",
        describedAs: "El contacto envió un tipo de mensaje que WhatsApp no permite recibir.",
      };

    default:
      return {
        kind: "unsupported",
        describedAs: `El contacto envió un mensaje de tipo "${m.type ?? "desconocido"}".`,
      };
  }
}

/** Meta manda segundos epoch en texto. En milisegundos daría el año 56 000. */
function fechaDeMarca(marca: string | undefined): Date {
  const segundos = Number(marca);
  return Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000) : new Date(0);
}

// --- Normalización de recibos -------------------------------------------------

const ESTADOS: Record<string, DeliveryStatus> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
  // `warning` no es un cambio de entrega; se ignora abajo.
};

export function normalizarRecibos(raw: unknown): DeliveryReceipt[] {
  const carga = raw as WhatsAppWebhookPayload | null;
  const salida: DeliveryReceipt[] = [];

  for (const entry of carga?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const estado of change.value?.statuses ?? []) {
        const normalizado = reciboDeEstado(estado);
        if (normalizado) salida.push(normalizado);
      }
    }
  }
  return salida;
}

function reciboDeEstado(s: WhatsAppStatusRaw): DeliveryReceipt | null {
  if (!s.id) return null;
  const status = ESTADOS[s.status ?? ""];
  if (!status) return null;

  const error = s.errors?.[0];
  return {
    externalId: s.id,
    status,
    at: fechaDeMarca(s.timestamp),
    ...(error
      ? {
          error: {
            code: String(error.code ?? "desconocido"),
            message: error.error_data?.details ?? error.message ?? "WhatsApp no entregó el mensaje.",
          },
        }
      : {}),
  };
}

/**
 * Aplica recibos desordenados con monotonía.
 *
 * Meta no garantiza el orden: `read` puede llegar antes que `delivered`. Sin
 * esto, la bandeja mostraría un mensaje "enviado" que el contacto ya leyó.
 * La regla de progreso es la del núcleo (`isProgress`), no una propia.
 */
export function aplicarRecibos(
  estadoActual: DeliveryStatus | null,
  recibos: readonly DeliveryReceipt[],
): { estado: DeliveryStatus | null; aplicados: DeliveryReceipt[] } {
  let estado = estadoActual;
  const aplicados: DeliveryReceipt[] = [];
  // Se ordenan por reloj del proveedor antes de aplicar, pero el orden por sí
  // solo no basta: dos recibos pueden compartir el mismo segundo exacto.
  const ordenados = [...recibos].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const recibo of ordenados) {
    if (isProgress(estado, recibo.status)) {
      estado = recibo.status;
      aplicados.push(recibo);
    }
  }
  return { estado, aplicados };
}

/**
 * Extrae el nuevo fin de ventana de un mensaje entrante.
 * El runtime lo escribe en `conversations.send_restriction_until`, que sigue
 * siendo un campo genérico: el nombre no menciona WhatsApp a propósito.
 */
export function finDeVentanaTras(mensaje: InboundMessage): Date {
  return calcularFinDeVentana(mensaje.sentAt);
}
