/**
 * Contexto de la conversación en cuatro capas.
 *
 *   1. Prompt del sistema compilado (estable, cacheado).
 *   2. Resumen rodante de todo lo anterior.
 *   3. Ventana de mensajes recientes, literales.
 *   4. Bloque dinámico del turno (fecha, contacto, datos, conocimiento).
 *
 * El resumen rodante es lo que evita que una conversación de meses infle el
 * prompt hasta que cada respuesta cueste una fortuna y tarde una eternidad.
 */
import type { ModelMessage } from "ai";
import type { MessageContent } from "../types/message.js";
import type { ConversationStore, RollingSummary, StoredMessage, SummarizerPort } from "./ports.js";

/** A partir de aquí la conversación se resume en vez de arrastrarse entera. */
export const SUMMARY_THRESHOLD = 30;
/** Mensajes literales que se conservan siempre, aunque haya resumen. */
export const RECENT_WINDOW = 12;

export type TurnContext = {
  readonly summary: string | null;
  readonly window: readonly StoredMessage[];
  readonly messages: readonly ModelMessage[];
};

export type BuildContextOptions = {
  readonly recentWindow?: number;
  readonly summaryThreshold?: number;
  readonly language?: string;
};

export async function buildTurnContext(
  deps: { conversations: ConversationStore; summarizer?: SummarizerPort },
  input: {
    conversationId: string;
    messageCount: number;
    /** Mensajes que acaban de llegar y aún no están en el histórico persistido. */
    pending?: readonly StoredMessage[];
  },
  options: BuildContextOptions = {},
): Promise<TurnContext> {
  const recentWindow = options.recentWindow ?? RECENT_WINDOW;
  const threshold = options.summaryThreshold ?? SUMMARY_THRESHOLD;

  const window = await deps.conversations.listRecentMessages(input.conversationId, recentWindow);
  let summary = await deps.conversations.loadSummary(input.conversationId);

  const needsSummary =
    input.messageCount > threshold &&
    deps.summarizer !== undefined &&
    (summary === null || input.messageCount - summary.messageCount >= recentWindow);

  if (needsSummary) {
    summary = await regenerateSummary(
      { conversations: deps.conversations, summarizer: deps.summarizer! },
      {
        conversationId: input.conversationId,
        previous: summary,
        messageCount: input.messageCount,
        excludeFromEnd: recentWindow,
        language: options.language ?? "español",
      },
    );
  }

  const pending = input.pending ?? [];
  const historia = dedupe([...window, ...pending]);

  const messages: ModelMessage[] = [];
  if (summary) {
    messages.push({
      role: "system",
      content: `Resumen de lo hablado antes de los últimos mensajes:\n${summary.text}`,
    });
  }
  for (const m of historia) {
    if (m.role === "system") continue;
    messages.push({ role: m.role, content: renderContent(m.content) });
  }

  return { summary: summary?.text ?? null, window: historia, messages };
}

/**
 * Regenera el resumen a partir del anterior más los mensajes que van a salir
 * de la ventana. Es incremental a propósito: releer la conversación entera en
 * cada regeneración es exactamente el coste que este mecanismo evita.
 */
export async function regenerateSummary(
  deps: { conversations: ConversationStore; summarizer: SummarizerPort },
  input: {
    conversationId: string;
    previous: RollingSummary | null;
    messageCount: number;
    excludeFromEnd: number;
    language: string;
  },
): Promise<RollingSummary | null> {
  const porResumir = await deps.conversations.listMessagesForSummary({
    conversationId: input.conversationId,
    ...(input.previous ? { sinceMessageId: input.previous.throughMessageId } : {}),
    limit: Math.max(0, input.messageCount - input.excludeFromEnd),
  });
  const ultimo = porResumir.at(-1);
  if (!ultimo) return input.previous;

  const text = await deps.summarizer.summarize({
    ...(input.previous ? { previousSummary: input.previous.text } : {}),
    messages: porResumir,
    language: input.language,
  });

  const summary: RollingSummary = {
    text,
    throughMessageId: ultimo.id,
    messageCount: (input.previous?.messageCount ?? 0) + porResumir.length,
  };
  await deps.conversations.saveSummary(input.conversationId, summary);
  return summary;
}

/**
 * Traduce el contenido normalizado a texto para el modelo.
 * Un adjunto que el modelo no puede ver se describe en vez de omitirse: si no
 * aparece, el agente responde como si el cliente no hubiera enviado nada.
 */
export function renderContent(content: MessageContent): string {
  switch (content.kind) {
    case "text":
      return content.text;
    case "image":
      return content.caption ? `[imagen adjunta] ${content.caption}` : "[imagen adjunta]";
    case "audio":
      return content.transcript
        ? `[nota de voz, transcrita] ${content.transcript}`
        : "[nota de voz que no se pudo transcribir]";
    case "video":
      return content.caption ? `[video adjunto] ${content.caption}` : "[video adjunto]";
    case "document":
      return `[documento adjunto${content.filename ? `: ${content.filename}` : ""}]`;
    case "location":
      return `[ubicación compartida${content.label ? `: ${content.label}` : ""}] ${content.latitude}, ${content.longitude}`;
    case "buttons":
      return `${content.text}\n${content.options.map((o) => `- ${o.label}`).join("\n")}`;
    case "unsupported":
      return `[contenido no soportado: ${content.describedAs}]`;
  }
}

function dedupe(messages: readonly StoredMessage[]): StoredMessage[] {
  const vistos = new Set<string>();
  const out: StoredMessage[] = [];
  for (const m of messages) {
    if (vistos.has(m.id)) continue;
    vistos.add(m.id);
    out.push(m);
  }
  return out.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
}
