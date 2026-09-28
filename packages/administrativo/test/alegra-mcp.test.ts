/**
 * Alegra entero por su servidor MCP, contra un servidor de mentira.
 *
 * Lo que se comprueba es lo que le prometemos al dueño: que la nómina y el
 * resto de Alegra se pueden consultar, que por aquí nunca se cambia nada, que
 * lo que viaja al modelo es solo lo que hace falta y que, sin la cuenta
 * conectada, el agente sabe decir qué falta.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "@strappy/tools";
import {
  crearAlegraMcp,
  necesitaRenovar,
  pkce,
  renovarTokens,
  urlDeAutorizacion,
  MCP_ALEGRA,
  type AlegraMcpPort,
} from "../src/adaptadores/alegra-mcp.js";
import { adminAlegraBuscar, adminAlegraConsultar, elegirCampos, esDeLectura } from "../src/tools/alegra.js";
import { SCOPES_ADMINISTRATIVO } from "../src/context.js";
import type { LibrosContext } from "../src/ports.js";
import { AprobacionesEnMemoria } from "../src/testing/dobles.js";

const HERRAMIENTAS = [
  { name: "payroll_list-payrolls", description: "[payroll] Lista nóminas de un periodo de liquidación (solo lectura).", inputSchema: { type: "object", properties: { startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, endDate: { type: "string" } } } },
  { name: "payroll_list-employees", description: "[payroll] Lista empleados de nómina.", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["active", "inactive"] } } } },
  { name: "invoice_getInvoices", description: "Lista facturas de venta.", inputSchema: { type: "object", properties: {} } },
  { name: "invoice_createInvoicesExportable", description: "Genera un archivo exportable de facturas.", inputSchema: { type: "object" } },
  { name: "invoice_createInvoice", description: "Crea una factura.", inputSchema: { type: "object" } },
  { name: "items_deleteItem", description: "Borra un producto.", inputSchema: { type: "object" }, annotations: { readOnlyHint: false } },
];

/** Tres liquidaciones con todo lo que Alegra trae de verdad: pesa mucho. */
function nominas() {
  const empleado = (nombre: string, neto: number) => ({
    employee: { name: nombre, identification: "123456789", address: "Calle 1", salary: neto * 2 },
    startDate: "2026-09-01",
    endDate: "2026-09-15",
    payrollStatus: "calculated",
    totals: { amountToPay: neto, totalCost: neto * 1.4 },
    concepts: { incomes: Array.from({ length: 60 }, (_, i) => ({ id: i, name: `concepto ${i}`, description: "x".repeat(120) })) },
  });
  return {
    data: {
      totals: { amountToPay: 4514058.8 },
      payrolls: [empleado("Pedro Soto", 2079547.5), empleado("Victor Sandoval", 1504547.5), empleado("Lina Jiménez", 929963.8)],
    },
  };
}

function servidorFalso(o: { sse?: boolean } = {}) {
  const peticiones: { metodo: string; sesion: string | null; auth: string | null }[] = [];
  const fetchFalso: typeof globalThis.fetch = async (_url, init) => {
    const cuerpo = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: { name?: string; cursor?: string } };
    const h = new Headers(init?.headers);
    peticiones.push({ metodo: cuerpo.method, sesion: h.get("mcp-session-id"), auth: h.get("authorization") });
    if (h.get("authorization") !== "Bearer tok_valido") return new Response("no", { status: 401 });
    const responder = (result: unknown, extra: Record<string, string> = {}) => {
      const msg = JSON.stringify({ jsonrpc: "2.0", id: cuerpo.id, result });
      return o.sse
        ? new Response(`event: message\ndata: ${msg}\n\n`, { status: 200, headers: { "content-type": "text/event-stream", ...extra } })
        : new Response(msg, { status: 200, headers: { "content-type": "application/json", ...extra } });
    };
    switch (cuerpo.method) {
      case "initialize":
        return responder({ protocolVersion: "2025-06-18", capabilities: {} }, { "mcp-session-id": "ses_1" });
      case "notifications/initialized":
        return new Response(null, { status: 202 });
      case "tools/list":
        // Dos páginas, para que la paginación se pruebe de verdad.
        return cuerpo.params?.cursor
          ? responder({ tools: HERRAMIENTAS.slice(3) })
          : responder({ tools: HERRAMIENTAS.slice(0, 3), nextCursor: "p2" });
      case "tools/call": {
        const n = cuerpo.params?.name;
        if (n === "payroll_list-payrolls") return responder({ content: [{ type: "text", text: JSON.stringify(nominas()) }] });
        return responder({ content: [{ type: "text", text: "herramienta sin datos" }], isError: true });
      }
      default:
        return new Response("?", { status: 400 });
    }
  };
  return { fetch: fetchFalso, peticiones };
}

function montar(alegra?: AlegraMcpPort) {
  const libros: LibrosContext = {
    conexionId: "con_1",
    taskId: "task_1",
    approvals: new AprobacionesEnMemoria(),
    ...(alegra ? { alegra } : {}),
  };
  return {
    workspaceId: "ws_1",
    dryRun: false,
    scopes: SCOPES_ADMINISTRATIVO,
    ports: {},
    now: () => new Date("2026-09-28T12:00:00Z"),
    libros,
  } as unknown as ToolContext;
}

describe("el cliente MCP de Alegra", () => {
  it("inicia sesión una vez, pagina el catálogo y reutiliza la sesión", async () => {
    const s = servidorFalso({ sse: true });
    const mcp = crearAlegraMcp({ token: "tok_valido", fetch: s.fetch });
    const todas = await mcp.herramientas();
    expect(todas.map((h) => h.nombre)).toEqual(HERRAMIENTAS.map((h) => h.name));
    await mcp.herramientas();
    const r = await mcp.llamar("payroll_list-payrolls", {});
    expect((r.datos as ReturnType<typeof nominas>).data.payrolls).toHaveLength(3);
    expect(s.peticiones.filter((p) => p.metodo === "initialize")).toHaveLength(1);
    expect(s.peticiones.filter((p) => p.metodo === "tools/list")).toHaveLength(2);
    expect(s.peticiones.at(-1)?.sesion).toBe("ses_1");
  });

  it("un token caducado se explica con dónde reconectar", async () => {
    const s = servidorFalso();
    const mcp = crearAlegraMcp({ token: "tok_viejo", fetch: s.fetch });
    await expect(mcp.herramientas()).rejects.toThrow(/reconectar Alegra/);
  });
});

describe("OAuth con Alegra", () => {
  it("PKCE con S256 y el recurso del MCP en la autorización", () => {
    const { verificador, desafio } = pkce();
    expect(desafio).toBe(createHash("sha256").update(verificador).digest("base64url"));
    const url = new URL(urlDeAutorizacion({ clientId: "c1", redirectUri: "https://app/x", state: "s", desafio }));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("resource")).toBe(MCP_ALEGRA);
    expect(url.searchParams.get("scope")).toBe("owner");
  });

  it("si Alegra no rota el token de renovación, se conserva el anterior", async () => {
    const f: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ access_token: "nuevo", expires_in: 3600 }), { status: 200 });
    const t = await renovarTokens({ clientId: "c1", refreshToken: "ref_1" }, f);
    expect(t).toMatchObject({ accessToken: "nuevo", refreshToken: "ref_1" });
    expect(necesitaRenovar(t)).toBe(false);
    expect(necesitaRenovar({ ...t, expiraEn: Date.now() + 30_000 })).toBe(true);
  });
});

describe("las herramientas que abren Alegra", () => {
  it("solo se ofrecen las que leen", () => {
    const h = (name: string, soloLectura: boolean | null = null) => ({ nombre: name, descripcion: "", esquema: {}, soloLectura });
    expect(esDeLectura(h("payroll_list-payrolls"))).toBe(true);
    expect(esDeLectura(h("invoice_getInvoices"))).toBe(true);
    expect(esDeLectura(h("invoice_createInvoicesExportable"))).toBe(true);
    expect(esDeLectura(h("invoice_createInvoice"))).toBe(false);
    expect(esDeLectura(h("items_deleteItem", false))).toBe(false);
  });

  it("«nómina» encuentra las consultas de nómina aunque Alegra las llame payroll", async () => {
    const ctx = montar(crearAlegraMcp({ token: "tok_valido", fetch: servidorFalso().fetch }));
    const r = (await adminAlegraBuscar.execute(ctx, { que: "nómina de septiembre", max: 5 })) as {
      encontradas: { herramienta: string; parametros: Record<string, string> }[];
    };
    expect(r.encontradas[0]?.herramienta).toMatch(/^payroll_/);
    expect(r.encontradas.map((e) => e.herramienta)).not.toContain("invoice_createInvoice");
    expect(r.encontradas.find((e) => e.herramienta === "payroll_list-payrolls")?.parametros.startDate).toMatch(/formato/);
  });

  it("con «campos» trae solo lo pedido: ni identificaciones ni direcciones", async () => {
    const ctx = montar(crearAlegraMcp({ token: "tok_valido", fetch: servidorFalso().fetch }));
    const r = (await adminAlegraConsultar.execute(ctx, {
      herramienta: "payroll_list-payrolls",
      argumentos: { startDate: "2026-09-01", endDate: "2026-09-15" },
      campos: ["data.totals", "data.payrolls.employee.name", "data.payrolls.totals.amountToPay", "data.payrolls.payrollStatus"],
      max_filas: 50,
    })) as { datos: unknown };
    const texto = JSON.stringify(r.datos);
    expect(texto).toContain("Pedro Soto");
    expect(texto).toContain("2079547.5");
    expect(texto).not.toContain("123456789");
    expect(texto).not.toContain("Calle 1");
  });

  it("sin «campos», una respuesta enorme vuelve como estructura para elegir", async () => {
    const ctx = montar(crearAlegraMcp({ token: "tok_valido", fetch: servidorFalso().fetch }));
    const r = (await adminAlegraConsultar.execute(ctx, {
      herramienta: "payroll_list-payrolls",
      argumentos: {},
      max_filas: 50,
    })) as { demasiado_grande?: boolean; estructura?: unknown };
    expect(r.demasiado_grande).toBe(true);
    expect(JSON.stringify(r.estructura)).toContain("amountToPay");
  });

  it("nunca ejecuta una que escribe, aunque el modelo la nombre", async () => {
    const ctx = montar(crearAlegraMcp({ token: "tok_valido", fetch: servidorFalso().fetch }));
    await expect(
      adminAlegraConsultar.execute(ctx, { herramienta: "invoice_createInvoice", argumentos: {}, max_filas: 50 }),
    ).rejects.toThrow(/solo se consulta/);
  });

  it("sin la cuenta conectada, dice dónde se conecta", async () => {
    await expect(adminAlegraBuscar.execute(montar(), { que: "nómina", max: 5 })).rejects.toThrow(/Conectar con mi cuenta de Alegra/);
  });

  it("elegirCampos recorre las listas solas", () => {
    expect(elegirCampos({ a: [{ b: 1, c: 2 }, { b: 3, c: 4 }] }, ["a.b"])).toEqual({ a: [{ b: 1 }, { b: 3 }] });
  });
});
