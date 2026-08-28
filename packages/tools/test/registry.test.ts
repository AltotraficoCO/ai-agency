import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createMcpDispatcher,
  defineTool,
  executeToolDef,
  toAiTool,
  toMcpDescriptor,
  toPromptContracts,
  ToolDefinitionError,
  ToolRegistry,
  type ToolDef,
} from "../src/registry.js";
import { redactSecrets, ToolScopeError, type ToolContext } from "../src/context.js";

function contexto(over: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceId: "ws_1",
    conversationId: "conv_1",
    dryRun: false,
    scopes: ["demo:read", "demo:write"],
    ports: {},
    now: () => new Date("2026-08-27T12:00:00Z"),
    ...over,
  };
}

const leer = defineTool({
  slug: "demo_leer",
  label: "Leer",
  description: "Lee algo.",
  inputSchema: z.object({ q: z.string().min(1) }),
  sensitive: false,
  creditCost: 1,
  scopes: ["demo:read"],
  effect: "read",
  async execute(ctx, input) {
    return { workspace: ctx.workspaceId, q: input.q };
  },
});

const escribirFuera = defineTool({
  slug: "demo_externo",
  label: "Escribir fuera",
  description: "Crea algo en un sistema de terceros.",
  inputSchema: z.object({ titulo: z.string() }),
  sensitive: true,
  creditCost: 3,
  scopes: ["demo:write"],
  effect: "write_external",
  async execute(_ctx, input) {
    return { creado: true, id: "real_1", titulo: input.titulo };
  },
  simulate(_ctx, input) {
    return { creado: true, id: "sim_1", titulo: input.titulo, simulado: true, nota: "no se creó nada" };
  },
});

describe("definición de herramientas", () => {
  it("rechaza que workspaceId sea un parámetro del modelo", () => {
    expect(() =>
      defineTool({
        slug: "mala",
        label: "Mala",
        description: "x",
        inputSchema: z.object({ workspaceId: z.string() }),
        sensitive: false,
        creditCost: 0,
        scopes: [],
        effect: "read",
        async execute() {
          return null;
        },
      }),
    ).toThrow(ToolDefinitionError);
  });

  it("rechaza también tenantId, apiKey y demás campos que inyecta el runtime", () => {
    for (const campo of ["tenant_id", "apiKey", "token", "secret"]) {
      expect(() =>
        defineTool({
          slug: "mala",
          label: "Mala",
          description: "x",
          inputSchema: z.object({ [campo]: z.string() }),
          sensitive: false,
          creditCost: 0,
          scopes: [],
          effect: "read",
          async execute() {
            return null;
          },
        }),
      ).toThrow(/nunca puede venir del modelo/);
    }
  });

  it("exige simulate() a toda herramienta con efecto externo", () => {
    expect(() =>
      defineTool({
        slug: "sin_simulacion",
        label: "x",
        description: "x",
        inputSchema: z.object({}),
        sensitive: false,
        creditCost: 0,
        scopes: [],
        effect: "write_external",
        async execute() {
          return null;
        },
      }),
    ).toThrow(/simulate/);
  });

  it("valida el slug", () => {
    expect(() =>
      defineTool({ ...leer, slug: "Mala-Cosa" } as unknown as ToolDef<unknown, unknown>),
    ).toThrow(/Slug/);
  });
});

describe("ejecución", () => {
  it("valida la entrada con el mismo Zod que se expone al modelo", async () => {
    await expect(executeToolDef(leer, contexto(), { q: "" })).rejects.toThrow(/Entrada inválida/);
  });

  it("el workspaceId sale del contexto, no de la entrada", async () => {
    const r = await executeToolDef(leer, contexto({ workspaceId: "ws_9" }), { q: "hola" });
    expect(r).toEqual({ workspace: "ws_9", q: "hola" });
  });

  it("deny by default: sin el permiso, no se ejecuta", async () => {
    await expect(executeToolDef(leer, contexto({ scopes: [] }), { q: "hola" })).rejects.toThrow(
      ToolScopeError,
    );
  });

  it("en seco: lo de efecto externo se simula y lo de lectura se ejecuta de verdad", async () => {
    const ctx = contexto({ dryRun: true });
    expect(await executeToolDef(escribirFuera, ctx, { titulo: "Cita" })).toMatchObject({
      id: "sim_1",
      simulado: true,
    });
    // La lectura NO se simula: un simulador que inventa el catálogo no prueba nada.
    expect(await executeToolDef(leer, ctx, { q: "precio" })).toEqual({ workspace: "ws_1", q: "precio" });
  });

  it("fuera del modo seco se ejecuta el efecto real", async () => {
    expect(await executeToolDef(escribirFuera, contexto(), { titulo: "Cita" })).toMatchObject({
      id: "real_1",
    });
  });

  it("registra la invocación con los secretos filtrados", async () => {
    const onInvocation = vi.fn();
    const conSecreto = defineTool({
      slug: "demo_secreto",
      label: "x",
      description: "x",
      inputSchema: z.object({ nombre: z.string() }),
      sensitive: false,
      creditCost: 0,
      scopes: [],
      effect: "read",
      async execute() {
        return { ok: true, access_token: "abc123", anidado: { password: "hunter2" } };
      },
    });
    await executeToolDef(conSecreto, contexto({ scopes: [] }), { nombre: "x" }, { onInvocation });
    const log = onInvocation.mock.calls[0]![0];
    expect(JSON.stringify(log.output)).not.toContain("abc123");
    expect(JSON.stringify(log.output)).not.toContain("hunter2");
  });

  it("redactSecrets no rompe estructuras normales", () => {
    expect(redactSecrets({ a: 1, b: [{ c: "x" }] })).toEqual({ a: 1, b: [{ c: "x" }] });
  });
});

describe("los dos adaptadores salen de la misma definición", () => {
  const registry = new ToolRegistry().registerAll([leer, escribirFuera] as never[]);

  it("el registro no admite duplicados", () => {
    expect(() => registry.register(leer as never)).toThrow(/ya está registrada/);
  });

  it("el adaptador de AI SDK exige el ToolContext por experimental_context", async () => {
    const t = toAiTool(leer);
    await expect(
      (t.execute as (i: unknown, o: unknown) => Promise<unknown>)(
        { q: "hola" },
        { toolCallId: "1", messages: [] },
      ),
    ).rejects.toThrow(/sin ToolContext/);
  });

  it("el adaptador de AI SDK ejecuta con el contexto inyectado", async () => {
    const t = toAiTool(leer);
    const r = await (t.execute as (i: unknown, o: unknown) => Promise<unknown>)(
      { q: "hola" },
      { toolCallId: "1", messages: [], experimental_context: contexto() },
    );
    expect(r).toEqual({ workspace: "ws_1", q: "hola" });
  });

  it("el adaptador de AI SDK traslada `sensitive` a needsApproval", () => {
    expect(toAiTool(escribirFuera).needsApproval).toBe(true);
    expect(toAiTool(leer).needsApproval).toBe(false);
  });

  it("el adaptador MCP publica el mismo esquema", () => {
    const d = toMcpDescriptor(leer as never);
    expect(d.name).toBe("demo_leer");
    expect(d.inputSchema).toMatchObject({ type: "object", properties: { q: { type: "string" } } });
    expect(d.annotations.readOnlyHint).toBe(true);
    expect(toMcpDescriptor(escribirFuera as never).annotations.destructiveHint).toBe(true);
  });

  it("ningún esquema MCP expone workspaceId", () => {
    for (const d of registry.list().map(toMcpDescriptor)) {
      expect(Object.keys((d.inputSchema.properties ?? {}) as object)).not.toContain("workspaceId");
    }
  });

  it("MCP y AI SDK dan el mismo resultado para la misma entrada", async () => {
    const dispatcher = createMcpDispatcher(registry, () => contexto());
    const porMcp = await dispatcher.call("demo_leer", { q: "hola" });
    const porAi = await (toAiTool(leer).execute as (i: unknown, o: unknown) => Promise<unknown>)(
      { q: "hola" },
      { toolCallId: "1", messages: [], experimental_context: contexto() },
    );
    expect(porMcp.structuredContent).toEqual(porAi);
  });

  it("MCP devuelve isError en vez de reventar el servidor", async () => {
    const dispatcher = createMcpDispatcher(registry, () => contexto());
    expect(await dispatcher.call("no_existe", {})).toMatchObject({ isError: true });
    expect(await dispatcher.call("demo_leer", { q: "" })).toMatchObject({ isError: true });
  });

  it("los contratos del prompt salen de la misma definición", () => {
    const contratos = toPromptContracts(registry.list());
    expect(contratos.map((c) => c.slug)).toEqual(["demo_externo", "demo_leer"]);
    expect(contratos.find((c) => c.slug === "demo_externo")?.requiresApproval).toBe(true);
  });
});
