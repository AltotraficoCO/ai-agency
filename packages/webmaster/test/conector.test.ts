/**
 * Las diez herramientas del conector estándar contra su doble.
 *
 * El contrato es del sitio, no nuestro: declara capacidades y el agente solo
 * puede hacer lo que se declara. Estas pruebas comprueban que cada herramienta
 * habla el contrato tal como está escrito, incluida la parte que más cuesta
 * acertar: actualizar UNA sección sin tocar las demás.
 */
import { describe, expect, it } from "vitest";
import { executeToolDef, type ToolContext } from "@strappy/tools";
import {
  SCOPES_CONECTOR,
  ejecutarTareaWebmaster,
  webmasterConector,
  webmasterToolRegistry,
  type SitioContext,
} from "../src/index.js";
import {
  AprobacionesEnMemoria,
  BackupsEnMemoria,
  BASE_CONECTOR,
  crearDobleConector,
  modeloGuionizado,
  type DobleConector,
} from "../src/testing/index.js";

const ENTRADAS: Record<string, unknown> = {
  conector_salud: {},
  conector_listar_paginas: {},
  conector_leer_pagina: { id: "inicio" },
  conector_leer_ajustes: {},
  conector_crear_pagina: {
    titulo: "Servicios",
    ruta: "/servicios",
    secciones: [{ id: "s1", tipo: "hero", props: { titulo: "Lo que hacemos" } }],
  },
  conector_actualizar_pagina: {
    id: "inicio",
    titulo: "Inicio renovado",
    secciones: [{ id: "s1", tipo: "hero", props: { titulo: "Otro gancho" } }],
  },
  conector_actualizar_seccion: {
    pagina_id: "inicio",
    seccion_id: "s2",
    props: { html: "<p>Desde 2011, en Ribera del Duero.</p>" },
  },
  conector_borrar_pagina: { id: "inicio" },
  conector_actualizar_ajustes: { cambios: { telefono: "600 111 222" } },
  conector_publicar: {},
};

function montar() {
  const con: DobleConector = crearDobleConector();
  const backups = new BackupsEnMemoria();
  const aprobaciones = new AprobacionesEnMemoria();
  const sitio: SitioContext = {
    siteId: "site_2",
    taskId: "task_c",
    tipo: "custom",
    conector: { baseUrl: BASE_CONECTOR, token: con.estado.token },
    backups,
    approvals: aprobaciones,
    fetch: con.fetch,
  };
  const ctx = {
    workspaceId: "ws_1",
    dryRun: false,
    scopes: SCOPES_CONECTOR,
    ports: {},
    now: () => new Date(),
    sitio,
  } as unknown as ToolContext;
  return { con, backups, aprobaciones, sitio, ctx };
}

describe("herramientas del conector estándar", () => {
  it("la lista de entradas cubre las diez", () => {
    const slugs = webmasterToolRegistry
      .list()
      .map((t) => t.slug)
      .filter((s) => s.startsWith("conector_"));
    expect(slugs).toHaveLength(10);
    expect(slugs.filter((s) => !(s in ENTRADAS))).toEqual([]);
  });

  for (const slug of Object.keys(ENTRADAS)) {
    it(`${slug} habla el contrato`, async () => {
      const { ctx } = montar();
      const salida = await executeToolDef(
        webmasterToolRegistry.get(slug),
        ctx,
        ENTRADAS[slug] as never,
      );
      expect(salida, slug).toBeTypeOf("object");
      expect((salida as Record<string, unknown>).requiere_aprobacion, slug).toBeUndefined();
    });
  }

  it("actualizar una sección deja las demás intactas y guarda backup", async () => {
    const { con, ctx, backups } = montar();
    const salida = (await executeToolDef(
      webmasterToolRegistry.get("conector_actualizar_seccion"),
      ctx,
      ENTRADAS.conector_actualizar_seccion as never,
    )) as { backup_id: string };

    const inicio = con.estado.paginas.find((p) => p.id === "inicio")!;
    expect(inicio.secciones).toHaveLength(2);
    expect(inicio.secciones[0]?.props).toEqual({ titulo: "Diseñamos espacios" });
    expect(inicio.secciones[1]?.props).toEqual({
      html: "<p>Desde 2011, en Ribera del Duero.</p>",
    });
    expect(backups.guardados.find((b) => b.id === salida.backup_id)).toBeDefined();
  });

  it("un token que no vale se nota y se explica", async () => {
    const { con, ctx } = montar();
    con.estado.token = "otro";
    await expect(
      executeToolDef(webmasterToolRegistry.get("conector_leer_pagina"), ctx, {
        id: "inicio",
      } as never),
    ).rejects.toThrow(/401/);
  });

  it("el sitio que habla un contrato futuro se rechaza en vez de improvisar", async () => {
    const con = crearDobleConector();
    con.estado.info = { ...con.estado.info, contrato: 99 };
    const ctx = {
      workspaceId: "ws_1",
      dryRun: false,
      scopes: SCOPES_CONECTOR,
      ports: {},
      now: () => new Date(),
      sitio: {
        siteId: "s",
        taskId: "t",
        tipo: "custom",
        conector: { baseUrl: BASE_CONECTOR, token: con.estado.token },
        backups: new BackupsEnMemoria(),
        approvals: new AprobacionesEnMemoria(),
        fetch: con.fetch,
      },
    } as unknown as ToolContext;

    const salud = (await executeToolDef(
      webmasterToolRegistry.get("conector_salud"),
      ctx,
      {} as never,
    )) as { ok: boolean; error?: string };
    expect(salud.ok).toBe(false);
    expect(salud.error).toMatch(/contrato v99/);
  });

  it("de extremo a extremo: explora, cambia una sección y publica", async () => {
    const m = montar();
    const { modelo } = modeloGuionizado([
      { llama: "conector_salud" },
      { llama: "conector_listar_paginas" },
      { llama: "conector_leer_pagina", con: { id: "inicio" } },
      { llama: "conector_actualizar_seccion", con: ENTRADAS.conector_actualizar_seccion },
      { llama: "conector_publicar" },
      { dice: "RESUMEN: actualicé el texto de inicio y publiqué." },
    ]);

    const resultado = await ejecutarTareaWebmaster({
      agent: webmasterConector,
      model: modelo,
      modelId: "prueba/modelo",
      rates: { models: {}, fallback: { input: 1, output: 2 } },
      workspaceId: "ws_1",
      agentName: "Max",
      sitio: m.sitio,
      tarea: { id: "task_c", titulo: "Actualiza el texto de inicio", detalle: null },
    });

    expect(resultado.estado).toBe("completada");
    if (resultado.estado !== "completada") return;
    expect(m.con.estado.publicaciones).toBe(1);
    expect(resultado.evidencia.backups).toHaveLength(1);
    expect(resultado.resumen).toBe("actualicé el texto de inicio y publiqué.");
  });
});
