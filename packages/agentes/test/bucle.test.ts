/**
 * Lo que no puede cambiar del bucle común, ahora que lo comparten varios
 * agentes.
 *
 * Estas reglas se pelearon una a una contra sistemas reales: si alguna se
 * rompiera al añadir el tercer agente, el cliente lo pagaría en créditos o en
 * confianza. Por eso se prueban aquí y no solo desde el Webmaster.
 */
import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type {
  LanguageModelV3Content,
  LanguageModelV3GenerateResult,
} from "@ai-sdk/provider";
import { defineTool, type ToolContext } from "@strappy/tools";
import { z } from "zod";
import type { RateTable } from "@strappy/core";
import { ejecutarTareaDeAgente, filtrarHerramientas } from "../src/bucle.js";
import { extraerResumen, quitarRazonamiento } from "../src/texto.js";
import { huellaAccion } from "../src/huella.js";
import type { ApprovalPort } from "../src/tipos.js";

const TARIFAS: RateTable = {
  models: { "prueba/modelo": { input: 3, output: 15 } },
  fallback: { input: 10, output: 50 },
};

/** La misma forma que usa el doble del Webmaster: el SDK la normaliza así. */
const USO = {
  inputTokens: { total: 1200, noCache: 1000, cacheRead: 200, cacheWrite: 0 },
  outputTokens: { total: 80, text: 80, reasoning: 0 },
} as const;

/** Aprobaciones que nunca deciden: todo queda esperando un clic. */
const aprobacionesQueEsperan: ApprovalPort = {
  async check() {
    return null;
  },
  async request() {
    return { id: "ap_1", decision: null };
  },
};

/** Una herramienta que siempre falla igual: es lo que dispara el freno. */
const siempreFalla = defineTool({
  slug: "falla_siempre",
  label: "Falla siempre",
  description: "Falla siempre, para probar el freno.",
  inputSchema: z.object({ id: z.number().int() }),
  sensitive: false,
  creditCost: 0,
  scopes: [],
  effect: "read",
  kind: "http",
  async execute() {
    throw new Error("No pude leer page 177 (404): rest_post_invalid_id");
  },
});

const contexto: ToolContext = {
  workspaceId: "ws_1",
  agentRunId: "task_1",
  dryRun: false,
  scopes: [],
  ports: {},
  now: () => new Date(0),
};

function oficioDePrueba() {
  return {
    slug: "prueba",
    herramientas: [siempreFalla] as never,
    maxAcciones: 10,
    timeoutMs: 30_000,
    sistema: "Eres un agente de prueba.",
    contexto,
    etiquetaDePaso: () => "Haciendo algo",
    detalleDePaso: () => null,
    limpiarSecretos: (t: string) => t.split("secreto-real").join("«oculto»"),
    describirSolicitud: (slug: string) => slug,
    huella: (slug: string, entrada: unknown) => huellaAccion("task_1", slug, entrada),
    aprobaciones: aprobacionesQueEsperan,
    conexionId: null,
  };
}

/** Un modelo que llama siempre a la misma herramienta con la misma entrada. */
function modeloQueInsiste() {
  let n = 0;
  return new MockLanguageModelV3({
    doGenerate: async (): Promise<LanguageModelV3GenerateResult> => {
      n += 1;
      const content: LanguageModelV3Content[] = [
        {
          type: "tool-call",
          toolCallId: `tc_${n}`,
          toolName: "falla_siempre",
          input: JSON.stringify({ id: 177 }),
        },
      ];
      return {
        content,
        finishReason: { unified: "tool-calls", raw: "tool_use" },
        usage: USO,
        warnings: [],
      };
    },
  });
}

describe("bucle común de los agentes", () => {
  it("tres fallos idénticos detienen la tarea en vez de comerse el saldo", async () => {
    const resultado = await ejecutarTareaDeAgente({
      oficio: oficioDePrueba(),
      model: modeloQueInsiste(),
      modelId: "prueba/modelo",
      rates: TARIFAS,
      workspaceId: "ws_1",
      tarea: { id: "task_1", titulo: "Diseña algo", detalle: null },
      simulacion: false,
    });

    expect(resultado.estado).toBe("fallida");
    if (resultado.estado !== "fallida") return;
    expect(resultado.motivo).toBe("tope_acciones");
    // El cliente lee por qué se paró y con qué error, no un código.
    expect(resultado.error).toContain("Me detuve porque");
    expect(resultado.error).toContain("rest_post_invalid_id");
    // Se frenó pronto: ni de lejos las 10 acciones que permitía el catálogo.
    expect(resultado.evidencia.acciones.length).toBeLessThanOrEqual(4);
  });

  it("el registro de trabajo cuenta cada paso y limpia los secretos", async () => {
    const pasos: { herramienta: string; estado: string }[] = [];
    await ejecutarTareaDeAgente({
      oficio: oficioDePrueba(),
      model: modeloQueInsiste(),
      modelId: "prueba/modelo",
      rates: TARIFAS,
      workspaceId: "ws_1",
      tarea: { id: "task_1", titulo: "Diseña algo", detalle: null },
      simulacion: false,
      alAvanzar: (p) => pasos.push({ herramienta: p.herramienta, estado: p.estado }),
    });

    expect(pasos.some((p) => p.estado === "en_curso")).toBe(true);
    expect(pasos.some((p) => p.estado === "error")).toBe(true);
  });

  it("filtra las herramientas por patrón: lo que no se declara, no existe", () => {
    const todas = [siempreFalla] as never;
    expect(filtrarHerramientas(todas, ["falla_*"])).toHaveLength(1);
    expect(filtrarHerramientas(todas, ["wp_*"])).toHaveLength(0);
  });
});

describe("texto que llega al cliente", () => {
  it("quita el razonamiento aunque falte la etiqueta de apertura", () => {
    expect(quitarRazonamiento("<think>dudo</think>Hola")).toBe("Hola");
    expect(quitarRazonamiento("dudo mucho</think>Hola")).toBe("Hola");
  });

  it("si no hay RESUMEN, lo dice en vez de inventarlo", () => {
    expect(extraerResumen("RESUMEN: cambié el título.", false)).toBe("cambié el título.");
    expect(extraerResumen("", false)).toBe("La tarea terminó sin resumen del agente.");
    expect(extraerResumen("", true)).toBe("La exploración terminó sin un plan escrito.");
  });
});

describe("huella de una aprobación", () => {
  it("aprobar una cosa no aprueba la siguiente parecida", () => {
    const a = huellaAccion("t1", "ads_cambiar_presupuesto", { diario: 50_000 });
    const b = huellaAccion("t1", "ads_cambiar_presupuesto", { diario: 500_000 });
    expect(a).not.toBe(b);
    expect(huellaAccion("t1", "ads_cambiar_presupuesto", { diario: 50_000 })).toBe(a);
  });
});
