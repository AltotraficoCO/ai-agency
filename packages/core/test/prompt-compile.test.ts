import { describe, expect, it } from "vitest";
import { compilePrompt, computePromptHash, type PromptSpec } from "../src/prompt/index.js";

const spec: PromptSpec = {
  agent: { name: "Sofía", language: "español", tone: "cercana y breve", purpose: "atender ventas" },
  company: { name: "Zapatos Lina", policies: ["Devoluciones en 30 días"] },
  instructions: "Saluda por el nombre de la tienda: {{tienda}}.",
  variables: { tienda: "Zapatos Lina" },
  tools: [
    { slug: "buscar_conocimiento", label: "Buscar", whenToUse: "antes de responder por precios" },
    { slug: "agendar", label: "Agendar", whenToUse: "cuando pidan cita", requiresApproval: true },
  ],
  goal: "Conseguir una cita.",
  collect: [{ key: "ciudad", label: "ciudad de entrega" }],
};

describe("compilador de prompt", () => {
  it("es determinista: mismo spec ⇒ mismo prompt y mismo hash", () => {
    const a = compilePrompt(spec);
    const b = compilePrompt(structuredClone(spec));
    expect(a.system).toBe(b.system);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("el hash no depende del orden en que se declaran las herramientas", () => {
    const invertido: PromptSpec = { ...spec, tools: [...spec.tools!].reverse() };
    expect(computePromptHash(invertido)).toBe(computePromptHash(spec));
  });

  it("cambiar las instrucciones cambia el hash", () => {
    const otro: PromptSpec = { ...spec, instructions: "Otra cosa." };
    expect(computePromptHash(otro)).not.toBe(computePromptHash(spec));
  });

  it("el bloque dinámico no entra en el hash ni en la parte estable", () => {
    const sinDinamico = compilePrompt(spec);
    const conDinamico = compilePrompt(spec, {
      now: new Date("2026-08-27T19:30:00Z"),
      timezone: "America/Bogota",
      contact: { name: "Pedro" },
      collected: { ciudad: "Cali" },
    });
    expect(conDinamico.system).toBe(sinDinamico.system);
    expect(conDinamico.hash).toBe(sinDinamico.hash);
    expect(conDinamico.system).not.toContain("Pedro");
    expect(conDinamico.dynamic).toContain("Pedro");
    expect(conDinamico.dynamic).toContain("ciudad: Cali");
    expect(conDinamico.cacheBreakpoint).toBe(sinDinamico.system.length);
  });

  it("resuelve variables y deja intactas las que no tienen valor", () => {
    const compilado = compilePrompt(spec);
    expect(compilado.system).toContain("Saluda por el nombre de la tienda: Zapatos Lina.");
    const roto = compilePrompt({ ...spec, variables: {} });
    expect(roto.system).toContain("{{tienda}}");
  });

  it("los datos a recoger se piden en lenguaje natural, nunca como JSON", () => {
    const { system } = compilePrompt(spec);
    expect(system).toContain("Durante la charla averigua de forma natural");
    expect(system).toContain("ciudad de entrega");
    expect(system).toMatch(/Nunca escribas estos datos como lista ni como JSON/);
  });

  it("marca qué herramientas piden aprobación", () => {
    const { system } = compilePrompt(spec);
    expect(system).toContain("`agendar`");
    expect(system).toContain("requiere aprobación");
  });

  it("la fecha local se formatea en la zona pedida y sin depender de la locale del sistema", () => {
    const { dynamic } = compilePrompt(spec, {
      now: new Date("2026-08-27T19:30:00Z"),
      timezone: "America/Bogota",
    });
    expect(dynamic).toContain("jueves 27 de agosto de 2026, 14:30");
  });
});
