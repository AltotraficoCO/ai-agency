import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Tool, ToolSet } from "ai";
import { allowsTool, registerAgentType } from "../src/registry/agent-type.js";
import { filterToolsByAgentType } from "../src/engine/run.js";
import type { ToolContract } from "../src/prompt/index.js";

registerAgentType({
  slug: "conversacional_test",
  label: "Conversacional",
  description: "Atiende clientes finales.",
  runtime: "conversational",
  specSchema: z.object({}),
  allowedToolPatterns: ["buscar_conocimiento", "guardar_dato_contacto", "etiquetar", "http_*"],
  channels: ["simulador"],
  maxToolSteps: 4,
  timeoutMs: 30_000,
  requiresApprovalForSensitive: false,
});

registerAgentType({
  slug: "tarea_test",
  label: "Tarea por encargo",
  description: "Trabaja para la empresa.",
  runtime: "task",
  specSchema: z.object({}),
  allowedToolPatterns: ["wp_*", "navegador_*"],
  channels: [],
  maxToolSteps: 25,
  timeoutMs: 540_000,
  requiresApprovalForSensitive: true,
});

const falsa = {} as Tool;
const tools: ToolSet = {
  buscar_conocimiento: falsa,
  guardar_dato_contacto: falsa,
  agendar: falsa,
  http_crm_buscar: falsa,
  wp_crear_pagina: falsa,
};
const contracts: ToolContract[] = Object.keys(tools).map((slug) => ({
  slug,
  label: slug,
  whenToUse: "cuando toque",
}));

describe("filtrado de herramientas por tipo de agente", () => {
  it("acepta coincidencias exactas y patrones con comodín", () => {
    expect(allowsTool("conversacional_test", "buscar_conocimiento")).toBe(true);
    expect(allowsTool("conversacional_test", "http_crm_buscar")).toBe(true);
    expect(allowsTool("conversacional_test", "agendar")).toBe(false);
    expect(allowsTool("tarea_test", "wp_crear_pagina")).toBe(true);
    expect(allowsTool("tarea_test", "buscar_conocimiento")).toBe(false);
  });

  it("un comodín no se salta la frontera del prefijo", () => {
    expect(allowsTool("tarea_test", "otro_wp_crear")).toBe(false);
  });

  it("el modelo solo ve las herramientas permitidas por su tipo", () => {
    const r = filterToolsByAgentType("conversacional_test", tools, contracts);
    expect(Object.keys(r.tools).sort()).toEqual([
      "buscar_conocimiento",
      "guardar_dato_contacto",
      "http_crm_buscar",
    ]);
    expect(r.contracts.map((c) => c.slug).sort()).toEqual([
      "buscar_conocimiento",
      "guardar_dato_contacto",
      "http_crm_buscar",
    ]);
  });

  it("un tipo de agente sin canales tampoco ve las herramientas de conversación", () => {
    const r = filterToolsByAgentType("tarea_test", tools, contracts);
    expect(Object.keys(r.tools)).toEqual(["wp_crear_pagina"]);
  });

  it("el contrato del prompt nunca menciona una herramienta que el modelo no tiene", () => {
    const r = filterToolsByAgentType("tarea_test", tools, contracts);
    for (const c of r.contracts) expect(r.tools[c.slug]).toBeDefined();
  });
});
