import { describe, expect, it, vi } from "vitest";
import {
  agendar,
  buscarConocimiento,
  escalarAHumano,
  guardarDatoContacto,
  SYSTEM_TOOLS,
} from "../src/system/index.js";
import { buildHttpTool } from "../src/http.js";
import { executeToolDef, toMcpDescriptor } from "../src/registry.js";
import type { ToolContext } from "../src/context.js";
import type { ToolPorts } from "../src/ports.js";

function contexto(ports: ToolPorts, over: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceId: "ws_1",
    conversationId: "conv_1",
    dryRun: false,
    scopes: [
      "knowledge:read",
      "contacts:write",
      "handover:write",
      "scheduling:write",
      "http:crm_buscar",
    ],
    ports,
    now: () => new Date("2026-08-27T12:00:00Z"),
    ...over,
  };
}

describe("herramientas de sistema de la v1", () => {
  it("son exactamente las seis previstas", () => {
    expect(SYSTEM_TOOLS.map((t) => t.slug)).toEqual([
      "agendar",
      "buscar_conocimiento",
      "cerrar_conversacion",
      "escalar_a_humano",
      "etiquetar",
      "guardar_dato_contacto",
    ]);
  });

  it("ninguna acepta workspaceId como parámetro del modelo", () => {
    for (const t of SYSTEM_TOOLS) {
      const props = Object.keys((toMcpDescriptor(t).inputSchema.properties ?? {}) as object);
      expect(props).not.toContain("workspaceId");
    }
  });

  it("buscar_conocimiento pasa el workspace del contexto al puerto", async () => {
    const search = vi.fn().mockResolvedValue([{ title: "Envíos", text: "48 horas" }]);
    const r = await executeToolDef(buscarConocimiento, contexto({ knowledge: { search } }, { workspaceId: "ws_7" }), {
      consulta: "cuánto tarda el envío",
    });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws_7", limit: 4 }));
    expect(r).toMatchObject({ encontrados: 1 });
  });

  it("falla con un mensaje claro si el puerto no está montado", async () => {
    await expect(
      executeToolDef(buscarConocimiento, contexto({}), { consulta: "hola" }),
    ).rejects.toThrow(/necesita el puerto "knowledge"/);
  });

  it("guardar_dato_contacto obliga a claves normalizadas", async () => {
    const contacts = { saveField: vi.fn(), addTags: vi.fn() };
    await expect(
      executeToolDef(guardarDatoContacto, contexto({ contacts }), { clave: "Correo Electrónico", valor: "a@b.co" }),
    ).rejects.toThrow(/Entrada inválida/);
    await executeToolDef(guardarDatoContacto, contexto({ contacts }), {
      clave: "correo_electronico",
      valor: "a@b.co",
    });
    expect(contacts.saveField).toHaveBeenCalledOnce();
  });

  it("escalar_a_humano no notifica a nadie en modo seco", async () => {
    const escalate = vi.fn();
    const r = await executeToolDef(
      escalarAHumano,
      contexto({ handover: { escalate, close: vi.fn() } }, { dryRun: true }),
      { motivo: "cliente molesto", urgencia: "alta" },
    );
    expect(escalate).not.toHaveBeenCalled();
    expect(r).toMatchObject({ simulado: true, notificado: false });
  });

  it("agendar consulta de verdad y reserva en seco con un resultado marcado", async () => {
    const scheduling = {
      availability: vi.fn().mockResolvedValue([]),
      book: vi.fn(),
    };
    const ctx = contexto({ scheduling }, { dryRun: true });
    const consulta = await executeToolDef(agendar, ctx, { accion: "consultar", duracion_minutos: 30 });
    expect(consulta).toMatchObject({ accion: "consultar", simulado: true });
    // Ni siquiera se consulta la agenda real: agendar tiene efecto externo.
    expect(scheduling.availability).not.toHaveBeenCalled();

    const reserva = await executeToolDef(agendar, ctx, {
      accion: "reservar",
      inicio: "2026-08-28T15:00:00.000Z",
      duracion_minutos: 30,
    });
    expect(reserva).toMatchObject({ agendado: true, simulado: true });
    expect(scheduling.book).not.toHaveBeenCalled();
  });
});

describe("herramientas HTTP definidas por el cliente", () => {
  const spec = {
    slug: "http_crm_buscar",
    label: "Buscar en el CRM",
    description: "Busca un cliente en el CRM.",
    method: "GET" as const,
    urlTemplate: "https://crm.ejemplo.com/api/clientes/{id}",
    params: [
      { name: "id", in: "path" as const, type: "string" as const, description: "Id del cliente" },
      { name: "detalle", in: "query" as const, type: "boolean" as const, description: "Incluir detalle", required: false },
    ],
    auth: { kind: "bearer" as const, secretRef: "crm_token" },
    scopes: ["http:crm_buscar"],
  };

  it("construye una ToolDef normal a partir de datos de base de datos", () => {
    const tool = buildHttpTool(spec);
    expect(tool.kind).toBe("http");
    expect(tool.effect).toBe("read");
    const props = Object.keys((toMcpDescriptor(tool as never).inputSchema.properties ?? {}) as object);
    expect(props.sort()).toEqual(["detalle", "id"]);
  });

  it("resuelve la credencial por referencia y nunca la expone al modelo", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, headers: {}, body: '{"nombre":"Ana"}' });
    const ports: ToolPorts = {
      http: { allowedHosts: ["crm.ejemplo.com"], fetch: fetchMock },
      secrets: { resolve: vi.fn().mockResolvedValue("tok_secreto") },
    };
    const r = await executeToolDef(buildHttpTool(spec), contexto(ports), { id: "42", detalle: true });
    expect(r).toEqual({ estado: 200, datos: { nombre: "Ana" } });
    const req = fetchMock.mock.calls[0]![0];
    expect(req.url).toBe("https://crm.ejemplo.com/api/clientes/42?detalle=true");
    expect(req.headers.authorization).toBe("Bearer tok_secreto");
  });

  it("deny by default: un host no declarado no se llama", async () => {
    const ports: ToolPorts = {
      http: { allowedHosts: ["otro.ejemplo.com"], fetch: vi.fn() },
      secrets: { resolve: vi.fn().mockResolvedValue("t") },
    };
    await expect(
      executeToolDef(buildHttpTool(spec), contexto(ports), { id: "42" }),
    ).rejects.toThrow(/no está en la lista de hosts permitidos/);
  });

  it("una herramienta HTTP que muta se simula en el simulador", async () => {
    const mutante = buildHttpTool({ ...spec, slug: "http_crm_crear", method: "POST", mutates: true, scopes: ["http:http_crm_crear"] });
    const fetchMock = vi.fn();
    const r = await executeToolDef(
      mutante,
      contexto({ http: { allowedHosts: ["crm.ejemplo.com"], fetch: fetchMock } }, { dryRun: true, scopes: ["http:http_crm_crear"] }),
      { id: "42" },
    );
    expect(r).toMatchObject({ simulado: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
