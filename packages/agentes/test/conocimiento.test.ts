/**
 * El conocimiento del negocio llega a TODOS los agentes por el montaje común.
 */
import { describe, expect, it } from "vitest";
import { executeToolDef, type ToolContext } from "@strappy/tools";
import { oficioComun, type ConocimientoPort, type EntradaComunDeAgente } from "../src/index.js";

const conocimiento: ConocimientoPort = {
  bases: 1,
  async buscar({ pregunta }) {
    return pregunta.includes("servicios")
      ? [{ texto: "Agencia de marketing con IA: SEO, pauta y agentes de WhatsApp.", fuente: "Servicios | Altotrafico", uri: "https://altotrafico.co/servicios" }]
      : [];
  },
};

function montar(con?: ConocimientoPort) {
  return oficioComun({
    agent: { slug: "webmaster", scopes: [], maxAcciones: 10, timeoutMs: 1000 },
    herramientas: [],
    sistema: "Eres el Webmaster.",
    contexto: {} as ToolContext,
    etiquetaDePaso: () => "",
    detalleDePaso: () => null,
    comun: { ...(con ? { conocimiento: con } : {}) } as unknown as EntradaComunDeAgente,
  });
}

describe("conocimiento para todos los agentes", () => {
  it("con bases, el agente tiene la herramienta y la instrucción", () => {
    const o = montar(conocimiento);
    expect(o.herramientas.map((h) => h.slug)).toContain("consultar_conocimiento");
    expect(o.sistema).toMatch(/CONOCIMIENTO DEL NEGOCIO/);
  });

  it("sin bases no se le ofrece nada", () => {
    expect(montar({ ...conocimiento, bases: 0 }).herramientas).toHaveLength(0);
    expect(montar().sistema).not.toMatch(/CONOCIMIENTO/);
  });

  it("devuelve lo encontrado con su fuente, y si no hay nada pide no inventar", async () => {
    const h = montar(conocimiento).herramientas[0]!;
    const ctx = { workspaceId: "ws", dryRun: false, scopes: [], ports: {}, now: () => new Date() } as ToolContext;
    const si = (await executeToolDef(h, ctx, { pregunta: "qué servicios ofrece" } as never)) as { fragmentos: { fuente: string }[] };
    expect(si.fragmentos[0]?.fuente).toBe("Servicios | Altotrafico");
    const no = (await executeToolDef(h, ctx, { pregunta: "horario de los domingos" } as never)) as { nota: string };
    expect(no.nota).toMatch(/No lo inventes/);
  });
});
