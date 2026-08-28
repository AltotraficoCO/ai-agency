/**
 * Un turno de conversación, de principio a fin.
 *
 * El orden de las comprobaciones no es negociable:
 *   guardas baratas → lock → contexto → modelo → RE-LEER handover → canSend → encolar.
 *
 * Releer `handover_state` después de generar y antes de encolar es lo que
 * evita el bug clásico: el modelo tardó tres segundos, en esos tres segundos
 * una persona del equipo tomó la conversación, y el bot escribió encima.
 */
import { generateText, stepCountIs, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { ChannelAdapter, SendRestriction } from "../registry/channel.js";
import { getChannel } from "../registry/channel.js";
import { allowsTool, getAgentType, type AgentTypeDef } from "../registry/agent-type.js";
import { compilePrompt, type PromptSpec, type ToolContract } from "../prompt/index.js";
import {
  creditsForUsage,
  normalizeUsage,
  precheckCredits,
  stepIdempotencyKey,
  type CreditLedgerPort,
  type RateTable,
} from "../credits/index.js";
import { buildTurnContext } from "./context.js";
import { withConversationLock, type ConversationLockPort } from "./lock.js";
import { resolveModel, withModelFallback, type ModelTable } from "./model-tier.js";
import type {
  AgentStore,
  AgentRunStore,
  ConversationSnapshot,
  ConversationStore,
  KnowledgePort,
  OutboundQueue,
  SkipReason,
  StoredMessage,
  SummarizerPort,
} from "./ports.js";

export type EngineDeps = {
  readonly conversations: ConversationStore;
  readonly agents: AgentStore;
  readonly runs: AgentRunStore;
  readonly outbound: OutboundQueue;
  readonly ledger: CreditLedgerPort;
  readonly lock: ConversationLockPort;
  readonly rates: RateTable;
  readonly modelTable: ModelTable;
  /** Traduce un identificador de la tabla a un modelo del AI SDK. */
  readonly resolveLanguageModel: (modelId: string) => LanguageModel;
  /** Construye el spec de prompt del agente. Valida quien lo implemente. */
  readonly promptSpecFor: (
    agent: { promptSpecRaw: unknown; id: string },
    conversation: ConversationSnapshot,
  ) => PromptSpec | Promise<PromptSpec>;
  /** Herramientas ya construidas por `@strappy/tools`, sin filtrar por tipo de agente. */
  readonly toolsFor: (input: {
    workspaceId: string;
    agentId: string;
    conversationId: string;
  }) => Promise<{ tools: ToolSet; contracts: readonly ToolContract[] }>;
  readonly knowledge?: KnowledgePort;
  readonly summarizer?: SummarizerPort;
  readonly getChannelAdapter?: (slug: string) => ChannelAdapter;
  readonly getAgentTypeDef?: (slug: string) => AgentTypeDef<never>;
  readonly now?: () => Date;
  /** Estimación conservadora para la reserva previa de créditos. */
  readonly estimatedCredits?: number;
};

export type TurnInput = {
  readonly conversationId: string;
  readonly agentId: string;
  /** Credenciales del canal ya descifradas por el runtime. */
  readonly channelCredentials: Readonly<Record<string, string>>;
  /** Contexto inyectado a las herramientas. Lleva `workspaceId` inmutable. */
  readonly toolContext: unknown;
  /** Mensajes recién llegados que aún no están persistidos, si los hay. */
  readonly pending?: readonly StoredMessage[];
  /** Consulta para recuperar conocimiento. Normalmente el último mensaje. */
  readonly query?: string;
  readonly owner?: string;
  readonly abortSignal?: AbortSignal;
};

export type TurnResult =
  | {
      readonly status: "replied";
      readonly agentRunId: string;
      readonly text: string;
      readonly steps: number;
      readonly credits: number;
      readonly queuedId: string;
      readonly promptHash: string;
    }
  | {
      readonly status: "skipped";
      readonly reason: SkipReason;
      readonly agentRunId?: string;
      /** Se expone tal cual la dio el canal. El motor no la interpreta. */
      readonly restriction?: SendRestriction;
      readonly detail?: string;
    }
  | { readonly status: "error"; readonly agentRunId?: string; readonly error: Error };

export async function runConversationTurn(deps: EngineDeps, input: TurnInput): Promise<TurnResult> {
  const now = deps.now ?? (() => new Date());
  const getAdapter = deps.getChannelAdapter ?? getChannel;
  const getType = deps.getAgentTypeDef ?? getAgentType;

  // --- Guardas baratas: todo lo que se puede descartar sin lock ni modelo ---
  const conversation = await deps.conversations.load(input.conversationId);
  if (!conversation) {
    return { status: "error", error: new Error(`Conversación desconocida: ${input.conversationId}`) };
  }
  const agent = await deps.agents.load(input.agentId);
  if (!agent) {
    return { status: "error", error: new Error(`Agente desconocido: ${input.agentId}`) };
  }
  if (!agent.enabled) return skip(deps, conversation, "bot_disabled");
  if (conversation.contactBlocked) return skip(deps, conversation, "contact_blocked");
  if (conversation.handoverState === "paused") return skip(deps, conversation, "paused");
  if (conversation.handoverState === "human") return skip(deps, conversation, "taken_over");

  const precheck = await precheckCredits(deps.ledger, {
    workspaceId: conversation.workspaceId,
    estimatedCredits: deps.estimatedCredits ?? 0,
    idempotencyKey: `precheck:${input.conversationId}:${now().getTime()}`,
  });
  if (!precheck.ok) return skip(deps, conversation, "no_credits");

  const owner = input.owner ?? `turn:${input.conversationId}`;

  const locked = await withConversationLock(deps.lock, input.conversationId, { owner }, () =>
    ejecutarTurno(deps, input, conversation, agent, getAdapter, getType, now),
  );

  if (!locked.acquired) {
    // Que otro proceso lo tenga no es un error: el debounce garantiza que el
    // último mensaje tendrá su propio turno.
    return { status: "skipped", reason: "lock_busy", detail: locked.reason };
  }
  const result = locked.value;

  if (precheck.reservation) {
    if (result.status === "replied" && deps.ledger.settle) {
      await deps.ledger.settle({ reservationId: precheck.reservation.id, credits: result.credits });
    } else {
      await deps.ledger.release?.(precheck.reservation.id);
    }
  }
  return result;
}

async function ejecutarTurno(
  deps: EngineDeps,
  input: TurnInput,
  conversation: ConversationSnapshot,
  agent: NonNullable<Awaited<ReturnType<AgentStore["load"]>>>,
  getAdapter: (slug: string) => ChannelAdapter,
  getType: (slug: string) => AgentTypeDef<never>,
  now: () => Date,
): Promise<TurnResult> {
  const agentType = getType(agent.agentTypeSlug);
  const spec = await deps.promptSpecFor(agent, conversation);

  const { tools, contracts } = await deps.toolsFor({
    workspaceId: conversation.workspaceId,
    agentId: agent.id,
    conversationId: conversation.id,
  });
  const permitidas = filterToolsByAgentType(agent.agentTypeSlug, tools, contracts);

  const contexto = await buildTurnContext(
    { conversations: deps.conversations, ...(deps.summarizer ? { summarizer: deps.summarizer } : {}) },
    {
      conversationId: conversation.id,
      messageCount: conversation.messageCount,
      ...(input.pending ? { pending: input.pending } : {}),
    },
    { language: spec.agent.language },
  );

  const knowledge = input.query && deps.knowledge
    ? await deps.knowledge.search({
        workspaceId: conversation.workspaceId,
        agentId: agent.id,
        query: input.query,
        limit: 5,
      })
    : [];

  const compiled = compilePrompt(
    { ...spec, tools: permitidas.contracts },
    {
      now: now(),
      timezone: conversation.timezone ?? "UTC",
      ...(conversation.contact ? { contact: conversation.contact } : {}),
      ...(conversation.collected ? { collected: conversation.collected } : {}),
      ...(knowledge.length > 0 ? { knowledge } : {}),
      ...(contexto.summary ? { summary: contexto.summary } : {}),
    },
  );

  const choice = resolveModel(deps.modelTable, { mode: agent.mode, task: "conversation" });
  const run = await deps.runs.start({
    workspaceId: conversation.workspaceId,
    agentId: agent.id,
    conversationId: conversation.id,
    promptHash: compiled.hash,
    model: choice.primary,
  });

  // El bloque dinámico va como mensaje de sistema aparte, después del prompt
  // estable: así el prefijo cacheable no cambia entre turnos.
  const messages: ModelMessage[] = compiled.dynamic
    ? [{ role: "system", content: compiled.dynamic }, ...contexto.messages]
    : [...contexto.messages];

  try {
    const generated = await withModelFallback(choice, (modelId) =>
      generateText({
        model: deps.resolveLanguageModel(modelId),
        system: compiled.system,
        messages,
        tools: permitidas.tools,
        stopWhen: stepCountIs(agentType.maxToolSteps),
        experimental_context: input.toolContext,
        ...(agent.temperature !== undefined ? { temperature: agent.temperature } : {}),
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        timeout: agentType.timeoutMs,
      }),
    );

    const credits = await cobrarPasos(deps, {
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      agentRunId: run.id,
      model: choice.primary,
      steps: generated.steps,
    });

    // --- Anti-colisión: una persona pudo tomar la conversación mientras el
    // modelo pensaba. Se relee dentro del lock, antes de encolar nada. ---
    const handover = await deps.conversations.readHandoverState(conversation.id);
    if (handover !== "bot") {
      const reason: SkipReason = handover === "human" ? "taken_over" : "paused";
      await deps.conversations.recordSkip({ conversationId: conversation.id, agentRunId: run.id, reason });
      await deps.runs.finish({ agentRunId: run.id, status: "skipped", steps: generated.steps.length, credits, detail: reason });
      return { status: "skipped", reason, agentRunId: run.id };
    }

    const texto = generated.text.trim();
    if (!texto) {
      // El modelo resolvió todo con herramientas y no hay nada que decir.
      await deps.runs.finish({ agentRunId: run.id, status: "ok", steps: generated.steps.length, credits });
      return { status: "skipped", reason: "superseded", agentRunId: run.id, detail: "respuesta vacía" };
    }

    const adapter = getAdapter(conversation.channelSlug);
    const policy = await adapter.canSend({
      workspaceId: conversation.workspaceId,
      channelId: conversation.channelId,
      credentials: input.channelCredentials,
      conversationId: conversation.id,
    });
    if (!policy.allowed) {
      await deps.conversations.recordSkip({
        conversationId: conversation.id,
        agentRunId: run.id,
        reason: "channel_restricted",
        detail: policy.restriction.code,
      });
      await deps.runs.finish({
        agentRunId: run.id,
        status: "skipped",
        steps: generated.steps.length,
        credits,
        restriction: policy.restriction,
      });
      return {
        status: "skipped",
        reason: "channel_restricted",
        agentRunId: run.id,
        restriction: policy.restriction,
      };
    }

    const queued = await deps.outbound.enqueue({
      workspaceId: conversation.workspaceId,
      channelId: conversation.channelId,
      agentRunId: run.id,
      idempotencyKey: `${run.id}:reply`,
      message: {
        conversationId: conversation.id,
        externalContactId: conversation.externalContactId,
        content: { kind: "text", text: texto },
      },
    });

    await deps.runs.finish({ agentRunId: run.id, status: "ok", steps: generated.steps.length, credits });
    return {
      status: "replied",
      agentRunId: run.id,
      text: texto,
      steps: generated.steps.length,
      credits,
      queuedId: queued.queuedId,
      promptHash: compiled.hash,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await deps.runs.finish({ agentRunId: run.id, status: "error", steps: 0, credits: 0, detail: err.message });
    return { status: "error", agentRunId: run.id, error: err };
  }
}

/**
 * Cobra un asiento por paso. La clave `agentRunId:step` hace que un reintento
 * del worker vuelva a producir las mismas claves y no cobre dos veces.
 */
async function cobrarPasos(
  deps: EngineDeps,
  input: {
    workspaceId: string;
    conversationId: string;
    agentRunId: string;
    model: string;
    steps: readonly { usage: Parameters<typeof normalizeUsage>[0] }[];
  },
): Promise<number> {
  let total = 0;
  for (let i = 0; i < input.steps.length; i++) {
    const quote = creditsForUsage(deps.rates, input.model, normalizeUsage(input.steps[i]!.usage));
    if (quote.credits === 0) continue;
    const result = await deps.ledger.charge({
      workspaceId: input.workspaceId,
      kind: "model",
      credits: quote.credits,
      idempotencyKey: stepIdempotencyKey(input.agentRunId, i),
      agentRunId: input.agentRunId,
      conversationId: input.conversationId,
      metadata: { model: input.model, usd: quote.usd, fallback: quote.usedFallback },
    });
    if (result.applied) total += quote.credits;
  }
  return total;
}

/**
 * Deja fuera lo que el tipo de agente no permite. Se filtra aquí, antes de
 * exponer nada al modelo: una herramienta que el modelo no ve es una
 * herramienta que no puede llamar por error.
 */
export function filterToolsByAgentType(
  agentTypeSlug: string,
  tools: ToolSet,
  contracts: readonly ToolContract[],
): { tools: ToolSet; contracts: readonly ToolContract[] } {
  const permitidos = new Set(Object.keys(tools).filter((slug) => allowsTool(agentTypeSlug, slug)));
  const filtradas: ToolSet = {};
  for (const slug of permitidos) filtradas[slug] = tools[slug]!;
  return {
    tools: filtradas,
    contracts: contracts.filter((c) => permitidos.has(c.slug)),
  };
}

async function skip(
  deps: EngineDeps,
  conversation: ConversationSnapshot,
  reason: SkipReason,
): Promise<TurnResult> {
  await deps.conversations.recordSkip({ conversationId: conversation.id, agentRunId: "", reason });
  return { status: "skipped", reason };
}
