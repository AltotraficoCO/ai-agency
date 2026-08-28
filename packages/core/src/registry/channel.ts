/**
 * Registro de canales.
 *
 * Regla que sostiene todo el producto: el motor de conversación NO conoce
 * WhatsApp. No sabe qué es una ventana de 24 horas, ni una plantilla HSM, ni
 * un phone_number_id. Todo eso vive dentro del adaptador del canal.
 *
 * Si algún día el motor necesita importar algo de `@strappy/whatsapp`, la
 * abstracción se rompió y añadir el segundo canal costará una reescritura.
 */
import type { InboundMessage, OutboundMessage, DeliveryReceipt } from "../types/message.js";

/** Qué sabe transportar un canal. El motor consulta esto antes de componer una respuesta. */
export type ChannelCapability =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "location"
  | "buttons"
  | "list"
  | "typing_indicator"
  | "read_receipt"
  | "voice_call";

/**
 * Motivo por el que un canal puede impedir un envío ahora mismo.
 * El canal decide; el motor y la bandeja solo muestran lo que el canal dice.
 * Así la ventana de 24h de WhatsApp no contamina el núcleo.
 */
export type SendRestriction = {
  /** Identificador estable para lógica de UI, p.ej. "whatsapp.service_window_closed". */
  code: string;
  /** Texto ya redactado para la persona, en español. */
  message: string;
  /** Cuándo dejará de aplicar, si se sabe. Permite pintar cuentas atrás sin conocer el motivo. */
  expiresAt?: Date;
  /** Alternativa permitida, p.ej. enviar una plantilla aprobada. */
  alternative?: { kind: string; label: string };
};

export type SendPolicy =
  | { allowed: true }
  | { allowed: false; restriction: SendRestriction };

export type ChannelAdapter = {
  /** Identificador del canal, coincide con `channels.kind` en la base de datos. */
  readonly slug: string;
  /** Nombre visible, en español. */
  readonly label: string;
  readonly capabilities: readonly ChannelCapability[];

  /**
   * Traduce la carga cruda del proveedor a mensajes normalizados.
   * Debe ser pura: sin escrituras en base de datos ni efectos.
   */
  parseInbound(raw: unknown, ctx: ChannelContext): Promise<InboundMessage[]>;

  /** Envía un mensaje ya compuesto. Devuelve el id del proveedor para conciliar recibos. */
  send(message: OutboundMessage, ctx: ChannelContext): Promise<{ externalId: string }>;

  /** Traduce recibos de entrega del proveedor. Opcional: no todo canal los tiene. */
  parseReceipts?(raw: unknown, ctx: ChannelContext): Promise<DeliveryReceipt[]>;

  /**
   * ¿Se puede escribir ahora en esta conversación?
   * Aquí es donde WhatsApp implementa la ventana de 24h, y donde el simulador
   * responde siempre que sí. El motor solo pregunta.
   */
  canSend(ctx: ChannelContext & { conversationId: string }): Promise<SendPolicy>;

  /** Señales de presencia opcionales, si el canal las soporta. */
  setTyping?(ctx: ChannelContext & { conversationId: string }, on: boolean): Promise<void>;
  markRead?(ctx: ChannelContext & { conversationId: string }, externalId: string): Promise<void>;
};

/** Contexto que el runtime inyecta. `workspaceId` nunca llega desde el modelo. */
export type ChannelContext = {
  readonly workspaceId: string;
  readonly channelId: string;
  /** Credenciales ya descifradas por el runtime; el adaptador jamás las persiste. */
  readonly credentials: Readonly<Record<string, string>>;
};

const adapters = new Map<string, ChannelAdapter>();

export function registerChannel(adapter: ChannelAdapter): void {
  if (adapters.has(adapter.slug)) {
    throw new Error(`El canal "${adapter.slug}" ya está registrado.`);
  }
  adapters.set(adapter.slug, adapter);
}

export function getChannel(slug: string): ChannelAdapter {
  const adapter = adapters.get(slug);
  if (!adapter) {
    throw new Error(
      `Canal desconocido: "${slug}". Canales registrados: ${[...adapters.keys()].join(", ") || "ninguno"}.`,
    );
  }
  return adapter;
}

export function listChannels(): readonly ChannelAdapter[] {
  return [...adapters.values()];
}

export function supports(slug: string, capability: ChannelCapability): boolean {
  return getChannel(slug).capabilities.includes(capability);
}
