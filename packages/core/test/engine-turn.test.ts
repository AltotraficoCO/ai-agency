import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { registerAgentType } from "../src/registry/agent-type.js";
import { createSimulatorChannel } from "../src/channels/simulator.js";
import { runConversationTurn, type EngineDeps } from "../src/engine/run.js";
import type {
  AgentConfig,
  ConversationSnapshot,
  ConversationStore,
  HandoverState,
} from "../src/engine/ports.js";
import type { RateTable } from "../src/credits/index.js";
import { DEFAULT_MODEL_TABLE } from "../src/engine/model-tier.js";
import type { SendPolicy, SendRestriction } from "../src/registry/channel.js";

registerAgentType({
  slug: "conversacional_turno",
  label: "Conversacional",
  description: "x",
  runtime: "conversational",
  specSchema: z.object({}),
  allowedToolPatterns: [],
  channels: ["simulador"],
  maxToolSteps: 3,
  timeoutMs: 20_000,
  requiresApprovalForSensitive: false,
});

const conversacionBase: ConversationSnapshot = {
  id: "conv_1",
  workspaceId: "ws_1",
  agentId: "ag_1",
  channelId: "ch_1",
  channelSlug: "simulador",
  externalContactId: "c_1",
  handoverState: "bot",
  contactBlocked: false,
  messageCount: 3,
  timezone: "America/Bogota",
};

const agenteBase: AgentConfig = {
  id: "ag_1",
  workspaceId: "ws_1",
  agentTypeSlug: "conversacional_turno",
  enabled: true,
  mode: "lite",
  promptSpecRaw: {},
};

const tarifas: RateTable = {
  models: { "zai/glm-4.7-flash": { input: 0.1, output: 0.4 } },
  fallback: { input: 1, output: 2 },
};

function modeloQueResponde(texto: string, alGenerar?: () => void) {
  return new MockLanguageModelV3({
    doGenerate: async (): Promise<LanguageModelV3GenerateResult> => {
      alGenerar?.();
      return {
        content: [{ type: "text" as const, text: texto }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: 1200, noCache: 1000, cacheRead: 200, cacheWrite: 0 },
          outputTokens: { total: 40, text: 40, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

type Escenario = {
  conversacion?: Partial<ConversationSnapshot>;
  agente?: Partial<AgentConfig>;
  /** handover leído DESPUÉS de generar, dentro del lock. */
  handoverDespues?: HandoverState;
  saldo?: number;
  canSend?: SendPolicy;
  lockLibre?: boolean;
  alGenerar?: () => void;
};

function montar(e: Escenario = {}) {
  const conversacion = { ...conversacionBase, ...e.conversacion };
  const skips: { reason: string; detail?: string }[] = [];
  const encolados: unknown[] = [];
  const cobros: string[] = [];

  const conversations: ConversationStore = {
    load: async () => conversacion,
    readHandoverState: async () => e.handoverDespues ?? conversacion.handoverState,
    listRecentMessages: async () => [
      {
        id: "m1",
        role: "user" as const,
        content: { kind: "text" as const, text: "hola, ¿tienen talla 40?" },
        sentAt: new Date("2026-08-27T12:00:00Z"),
      },
    ],
    listMessagesForSummary: async () => [],
    loadSummary: async () => null,
    saveSummary: async () => {},
    recordSkip: async (i) => void skips.push({ reason: i.reason, detail: i.detail }),
  };

  const simulador = createSimulatorChannel();
  const canSend = e.canSend;

  const deps: EngineDeps = {
    conversations,
    agents: { load: async () => ({ ...agenteBase, ...e.agente }) },
    runs: {
      start: async () => ({ id: "run_1" }),
      finish: async () => {},
    },
    outbound: {
      enqueue: async (i) => {
        encolados.push(i);
        return { queuedId: "q_1" };
      },
    },
    ledger: {
      balance: async () => e.saldo ?? 10_000,
      charge: async (entry) => {
        cobros.push(entry.idempotencyKey);
        return { applied: true, balance: 10_000 };
      },
    },
    lock: {
      tryAdvisoryLock: async () => e.lockLibre ?? true,
      acquireLease: async () => true,
      releaseLease: async () => {},
    },
    rates: tarifas,
    modelTable: DEFAULT_MODEL_TABLE,
    resolveLanguageModel: () => modeloQueResponde("Sí, nos queda talla 40.", e.alGenerar),
    promptSpecFor: () => ({
      agent: { name: "Sofía", language: "español", tone: "cercana", purpose: "vender" },
      instructions: "Atiende bien.",
    }),
    toolsFor: async () => ({ tools: {}, contracts: [] }),
    getChannelAdapter: () =>
      canSend ? { ...simulador, canSend: async () => canSend } : simulador,
    estimatedCredits: 20,
    now: () => new Date("2026-08-27T12:00:05Z"),
  };

  return { deps, skips, encolados, cobros };
}

const entrada = {
  conversationId: "conv_1",
  agentId: "ag_1",
  channelCredentials: {},
  toolContext: { workspaceId: "ws_1" },
  query: "talla 40",
};

describe("turno de conversación", () => {
  it("responde y encola el envío", async () => {
    const { deps, encolados, cobros } = montar();
    const r = await runConversationTurn(deps, entrada);
    expect(r.status).toBe("replied");
    if (r.status !== "replied") return;
    expect(r.text).toBe("Sí, nos queda talla 40.");
    expect(r.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(encolados).toHaveLength(1);
    // El cobro es idempotente por paso del run.
    expect(cobros).toEqual(["run_1:0"]);
  });

  it("descarta la respuesta si una persona tomó la conversación mientras el modelo pensaba", async () => {
    const { deps, encolados, skips } = montar({ handoverDespues: "human" });
    const r = await runConversationTurn(deps, entrada);
    expect(r).toMatchObject({ status: "skipped", reason: "taken_over" });
    // Lo importante: nada se encoló. El bot no escribe encima del humano.
    expect(encolados).toHaveLength(0);
    expect(skips).toContainEqual({ reason: "taken_over", detail: undefined });
  });

  it("no llama al modelo si el bot está apagado, pausado o el contacto bloqueado", async () => {
    for (const escenario of [
      { agente: { enabled: false }, esperado: "bot_disabled" },
      { conversacion: { handoverState: "paused" as const }, esperado: "paused" },
      { conversacion: { contactBlocked: true }, esperado: "contact_blocked" },
      { conversacion: { handoverState: "human" as const }, esperado: "taken_over" },
    ]) {
      const alGenerar = vi.fn();
      const { deps, encolados } = montar({ ...escenario, alGenerar });
      const r = await runConversationTurn(deps, entrada);
      expect(r).toMatchObject({ status: "skipped", reason: escenario.esperado });
      expect(alGenerar).not.toHaveBeenCalled();
      expect(encolados).toHaveLength(0);
    }
  });

  it("sin créditos no se gasta un token", async () => {
    const alGenerar = vi.fn();
    const { deps } = montar({ saldo: 0, alGenerar });
    expect(await runConversationTurn(deps, entrada)).toMatchObject({
      status: "skipped",
      reason: "no_credits",
    });
    expect(alGenerar).not.toHaveBeenCalled();
  });

  it("si otro proceso tiene el lock, se descarta el turno sin error", async () => {
    const { deps } = montar({ lockLibre: false });
    expect(await runConversationTurn(deps, entrada)).toMatchObject({
      status: "skipped",
      reason: "lock_busy",
    });
  });

  it("expone la restricción del canal tal cual, sin interpretarla", async () => {
    const restriction: SendRestriction = {
      code: "whatsapp.service_window_closed",
      message: "Han pasado más de 24 horas desde el último mensaje del cliente.",
      alternative: { kind: "template", label: "Enviar una plantilla aprobada" },
    };
    const { deps, encolados } = montar({ canSend: { allowed: false, restriction } });
    const r = await runConversationTurn(deps, entrada);
    expect(r).toMatchObject({ status: "skipped", reason: "channel_restricted" });
    if (r.status !== "skipped") return;
    // El motor no sabe qué es una ventana de 24 horas: la copia y ya.
    expect(r.restriction).toEqual(restriction);
    expect(encolados).toHaveLength(0);
  });
});
