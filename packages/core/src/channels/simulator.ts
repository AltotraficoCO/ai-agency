/**
 * Canal simulador.
 *
 * No es un "modo de prueba": es un canal de pleno derecho que implementa el
 * mismo `ChannelAdapter` que WhatsApp. Su transporte es un callback en
 * memoria, su `canSend` siempre permite y sus efectos externos se ejecutan en
 * seco. Nada más.
 *
 * Que el motor funcione contra este canal sin una sola rama especial es la
 * prueba de que la abstracción de canal es honesta. Si algún día el motor
 * necesita preguntar "¿estoy en el simulador?", la abstracción se rompió.
 */
import type {
  ChannelAdapter,
  ChannelCapability,
  ChannelContext,
  SendPolicy,
} from "../registry/channel.js";
import type { DeliveryReceipt, InboundMessage, OutboundMessage } from "../types/message.js";

/**
 * Cómo trata este canal los efectos externos de las herramientas.
 * Lo lee el runtime al construir el `ToolContext`; el motor no lo mira.
 */
export type ChannelExecutionMode = {
  /** `dry_run`: las herramientas de escritura devuelven un resultado plausible. */
  readonly sideEffects: "real" | "dry_run";
};

export type SimulatorChannel = ChannelAdapter & {
  readonly execution: ChannelExecutionMode;
  /** Inyecta un mensaje entrante como si lo hubiera escrito una persona. */
  emit(input: { text: string; contactId?: string; contactName?: string; at?: Date }): InboundMessage;
  /** Todo lo enviado en esta sesión, en orden. */
  readonly sent: readonly SimulatorSentMessage[];
  reset(): void;
};

export type SimulatorSentMessage = {
  readonly externalId: string;
  readonly message: OutboundMessage;
  readonly at: Date;
};

export type SimulatorOptions = {
  /** El transporte: se llama con cada mensaje saliente. La UI escucha aquí. */
  onOutbound?: (sent: SimulatorSentMessage) => void;
  /** Se llama con cada mensaje entrante generado por `emit`. */
  onInbound?: (message: InboundMessage) => void;
  /** Recibos simulados. Por defecto marca `delivered` al instante. */
  onReceipt?: (receipt: DeliveryReceipt) => void;
  now?: () => Date;
  slug?: string;
  label?: string;
};

const CAPABILITIES: readonly ChannelCapability[] = [
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

export function createSimulatorChannel(options: SimulatorOptions = {}): SimulatorChannel {
  const now = options.now ?? (() => new Date());
  const sent: SimulatorSentMessage[] = [];
  let contador = 0;
  const nextId = (prefix: string) => `${prefix}_${(++contador).toString().padStart(6, "0")}`;

  return {
    slug: options.slug ?? "simulador",
    label: options.label ?? "Simulador",
    capabilities: CAPABILITIES,
    execution: { sideEffects: "dry_run" },

    async parseInbound(raw: unknown): Promise<InboundMessage[]> {
      // El simulador ya habla el formato normalizado; solo valida la forma.
      if (Array.isArray(raw)) return raw as InboundMessage[];
      return raw ? [raw as InboundMessage] : [];
    },

    async send(message: OutboundMessage, _ctx: ChannelContext) {
      const registro: SimulatorSentMessage = { externalId: nextId("sim_out"), message, at: now() };
      sent.push(registro);
      options.onOutbound?.(registro);
      options.onReceipt?.({ externalId: registro.externalId, status: "delivered", at: registro.at });
      return { externalId: registro.externalId };
    },

    async parseReceipts(raw: unknown): Promise<DeliveryReceipt[]> {
      if (Array.isArray(raw)) return raw as DeliveryReceipt[];
      return raw ? [raw as DeliveryReceipt] : [];
    },

    // Sin ventanas, sin plantillas, sin horarios: aquí siempre se puede escribir.
    async canSend(): Promise<SendPolicy> {
      return { allowed: true };
    },

    async setTyping() {},
    async markRead() {},

    emit(input) {
      const message: InboundMessage = {
        externalId: nextId("sim_in"),
        externalContactId: input.contactId ?? "sim_contacto_1",
        ...(input.contactName ? { contactName: input.contactName } : {}),
        content: { kind: "text", text: input.text },
        sentAt: input.at ?? now(),
        raw: { simulated: true, text: input.text },
      };
      options.onInbound?.(message);
      return message;
    },

    get sent() {
      return sent;
    },

    reset() {
      sent.length = 0;
      contador = 0;
    },
  };
}

/**
 * Resultado de una herramienta ejecutada en seco.
 *
 * Va marcado explícitamente: un resultado simulado que se confunde con uno
 * real es peor que no simular nada, porque el usuario cree que su agente ya
 * agendó una cita que no existe.
 */
export type SimulatedResult<T> = T & {
  readonly simulado: true;
  readonly nota: string;
};

export function marcarSimulado<T extends object>(value: T, nota: string): SimulatedResult<T> {
  return { ...value, simulado: true, nota } as SimulatedResult<T>;
}
