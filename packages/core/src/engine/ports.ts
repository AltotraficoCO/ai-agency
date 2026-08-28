/**
 * Puertos del motor.
 *
 * El esquema de base de datos lo escribe otra corriente, así que aquí no hay
 * un solo nombre de tabla ni de columna: solo la forma de lo que el motor
 * necesita pedir y guardar. Cambiar el esquema no debería tocar este archivo.
 */
import type { MessageContent, OutboundMessage } from "../types/message.js";
import type { SendRestriction } from "../registry/channel.js";
import type { ModelMode } from "./model-tier.js";

/** Quién manda en la conversación ahora mismo. */
export type HandoverState = "bot" | "human" | "paused";

export type StoredMessage = {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: MessageContent;
  readonly sentAt: Date;
  /** Un mensaje escrito por una persona del equipo, no por el agente. */
  readonly byHuman?: boolean;
};

export type ConversationSnapshot = {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentId: string;
  readonly channelId: string;
  readonly channelSlug: string;
  readonly externalContactId: string;
  readonly handoverState: HandoverState;
  readonly contactBlocked: boolean;
  /** Total histórico de mensajes. Dispara la regeneración del resumen. */
  readonly messageCount: number;
  readonly contact?: { readonly name?: string; readonly notes?: string };
  /** Datos ya averiguados de esta conversación. */
  readonly collected?: Readonly<Record<string, string | number | boolean | null>>;
  readonly timezone?: string;
};

export type RollingSummary = {
  readonly text: string;
  /** Hasta qué mensaje resume. Lo posterior va en la ventana reciente. */
  readonly throughMessageId: string;
  readonly messageCount: number;
};

export type SkipReason =
  | "taken_over"
  | "bot_disabled"
  | "paused"
  | "contact_blocked"
  | "no_credits"
  | "channel_restricted"
  | "lock_busy"
  | "superseded";

export interface ConversationStore {
  load(conversationId: string): Promise<ConversationSnapshot | null>;
  /**
   * Se vuelve a leer DENTRO del lock justo antes de enviar. Es la única
   * defensa real contra que el bot escriba encima de un agente humano.
   */
  readHandoverState(conversationId: string): Promise<HandoverState>;
  /** Los `limit` mensajes más recientes, en orden cronológico ascendente. */
  listRecentMessages(conversationId: string, limit: number): Promise<readonly StoredMessage[]>;
  /** Mensajes entre el corte del resumen anterior y la ventana reciente. */
  listMessagesForSummary(input: {
    conversationId: string;
    sinceMessageId?: string;
    limit: number;
  }): Promise<readonly StoredMessage[]>;
  loadSummary(conversationId: string): Promise<RollingSummary | null>;
  saveSummary(conversationId: string, summary: RollingSummary): Promise<void>;
  /** Registra por qué el motor decidió no responder. Sin esto no hay forma de depurar. */
  recordSkip(input: {
    conversationId: string;
    agentRunId: string;
    reason: SkipReason;
    detail?: string;
  }): Promise<void>;
}

export type AgentConfig = {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentTypeSlug: string;
  readonly enabled: boolean;
  readonly mode: ModelMode;
  /** Espera del debounce para este agente. */
  readonly debounceMs?: number;
  readonly temperature?: number;
  /** Spec ya validado por el `specSchema` de su tipo de agente. */
  readonly promptSpecRaw: unknown;
};

export interface AgentStore {
  load(agentId: string): Promise<AgentConfig | null>;
}

/** Cola de envío. El motor encola; quien envía de verdad es el canal. */
export interface OutboundQueue {
  enqueue(input: {
    message: OutboundMessage;
    workspaceId: string;
    channelId: string;
    agentRunId: string;
    /** Clave de idempotencia: reintentar no duplica el mensaje. */
    idempotencyKey: string;
  }): Promise<{ queuedId: string }>;
}

/** Registro de la ejecución, para trazas y para la factura. */
export interface AgentRunStore {
  start(input: {
    workspaceId: string;
    agentId: string;
    conversationId: string;
    promptHash: string;
    model: string;
  }): Promise<{ id: string }>;
  finish(input: {
    agentRunId: string;
    status: "ok" | "skipped" | "error";
    steps: number;
    credits: number;
    detail?: string;
    restriction?: SendRestriction;
  }): Promise<void>;
}

/** Búsqueda en el conocimiento de la empresa. La implementa `@strappy/rag`. */
export interface KnowledgePort {
  search(input: {
    workspaceId: string;
    agentId: string;
    query: string;
    limit: number;
  }): Promise<readonly { title: string; text: string; source?: string }[]>;
}

/** Genera el resumen rodante. Usa un modelo barato: no es una tarea difícil. */
export interface SummarizerPort {
  summarize(input: {
    previousSummary?: string;
    messages: readonly StoredMessage[];
    language: string;
  }): Promise<string>;
}
