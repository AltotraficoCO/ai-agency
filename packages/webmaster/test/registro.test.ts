/**
 * Invariantes del registro de herramientas y del cifrado.
 *
 * Son las reglas que, si se rompen, no fallan en un test sino en el sitio de
 * un cliente: una herramienta de efecto externo sin `simulate()` hace
 * imposible el modo de simulación, y una sensible sin marcar se ejecuta sin
 * que nadie pulse nada.
 */
import { describe, expect, it } from "vitest";
import { toAiToolSet, toMcpDescriptor } from "@strappy/tools";
import { allowsTool, getAgentType } from "@strappy/core";
import {
  HERRAMIENTAS_WEBMASTER,
  SIEMPRE_SENSIBLES,
  TIPO_TAREA_POR_ENCARGO,
  asegurarTipoTareaPorEncargo,
  deriveKey,
  decryptJson,
  encryptJson,
  evaluarSensibilidad,
  herramientasDe,
  huellaAccion,
  masterKeyFromEnv,
  webmaster,
  webmasterConector,
  webmasterToolRegistry,
} from "../src/index.js";

describe("registro de herramientas", () => {
  it("están las 45 herramientas y ninguna repetida", () => {
    expect(HERRAMIENTAS_WEBMASTER).toHaveLength(45);
    const slugs = HERRAMIENTAS_WEBMASTER.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(webmasterToolRegistry.list()).toHaveLength(45);
  });

  it("porta las familias del proyecto anterior", () => {
    const slugs = HERRAMIENTAS_WEBMASTER.map((t) => t.slug);
    const cuenta = (p: string) => slugs.filter((s) => s.startsWith(p)).length;
    // 21 del proyecto anterior + 3 de plantillas de Elementor.
    expect(cuenta("wp_")).toBe(24);
    expect(cuenta("conector_")).toBe(10);
    expect(cuenta("navegador_")).toBe(5);
    for (const suelta of ["sitio_salud", "verificar_http", "ver_referencia"]) {
      expect(slugs).toContain(suelta);
    }
    // Las tres del original que se echaban de menos en el servidor MCP y que
    // sí estaban en el ejecutor: gestión de usuarios y su listado.
    for (const s of ["wp_listar_usuarios", "wp_crear_usuario", "wp_cambiar_rol_usuario"]) {
      expect(slugs).toContain(s);
    }
  });

  it("toda herramienta de efecto externo sabe simularse", () => {
    const sinSimulacion = HERRAMIENTAS_WEBMASTER.filter(
      (t) => t.effect === "write_external" && !t.simulate,
    );
    expect(sinSimulacion.map((t) => t.slug)).toEqual([]);
  });

  it("las de administración exigen aprobación desde el esquema", () => {
    for (const slug of SIEMPRE_SENSIBLES) {
      const def = HERRAMIENTAS_WEBMASTER.find((t) => t.slug === slug);
      expect(def, slug).toBeDefined();
      expect(def?.sensitive, slug).toBe(true);
    }
    // Y ninguna de lectura lo es: pedir un clic para leer entrena a la gente
    // a pulsar sin mirar, que es la forma de que la aprobación deje de servir.
    // La excepción es `pedir_aprobacion`: no lee el sitio, le pregunta algo al
    // cliente, y ahí el clic ES la respuesta.
    for (const t of HERRAMIENTAS_WEBMASTER.filter(
      (x) => x.effect === "read" && x.slug !== "pedir_aprobacion",
    )) {
      expect(t.sensitive, t.slug).toBe(false);
    }
  });

  it("cada agente solo ve las herramientas de su tipo de sitio", () => {
    const wp = herramientasDe(webmaster).map((t) => t.slug);
    const conector = herramientasDe(webmasterConector).map((t) => t.slug);
    expect(wp.some((s) => s.startsWith("conector_"))).toBe(false);
    expect(conector.some((s) => s.startsWith("wp_"))).toBe(false);
    expect(wp).toContain("navegador_ver_pagina");
    expect(conector).toContain("navegador_ver_pagina");
  });

  it("los prompts conservan las reglas que costaron fallos reales", () => {
    const p = webmaster.prompt({ agentName: "Max", siteUrl: "x", modoSimulacion: false });
    expect(p).toContain("wp_crear_pagina_elementor");
    expect(p).toContain("Un header NUNCA es una página");
    expect(p).toContain("Máximo 25 acciones");
    expect(p).toContain('RESUMEN:');
    expect(p).toContain("No la reintentes");
    expect(p).not.toContain("MODO SIMULACIÓN");
  });
});

describe("qué se considera sensible", () => {
  const casos: [string, Parameters<typeof evaluarSensibilidad>[0], boolean][] = [
    ["portada por id", { toolSlug: "wp_editar_contenido", contenidoId: 2, portadaId: 2 }, true],
    ["página de precios", { toolSlug: "wp_editar_contenido", slug: "planes-y-precios" }, true],
    ["checkout", { toolSlug: "wp_crear_contenido", titulo: "Carrito de compra" }, true],
    [
      "ajuste de portada",
      { toolSlug: "wp_actualizar_ajustes", clavesAjustes: ["page_on_front"] },
      true,
    ],
    [
      "sección de precios en una landing",
      { toolSlug: "wp_crear_pagina_elementor", titulo: "Landing", tiposSeccion: ["hero", "precios"] },
      true,
    ],
    [
      "importes en el contenido nuevo",
      { toolSlug: "wp_editar_contenido", titulo: "Aviso", contenido: "El plan sube a 35 €" },
      true,
    ],
    [
      "un post que menciona el precio sin cifras no lo es",
      { toolSlug: "wp_editar_contenido", titulo: "Blog", contenido: "hablamos del precio del pan" },
      false,
    ],
    ["cambiar el texto de una página normal no lo es", { toolSlug: "wp_editar_contenido", slug: "nuestra-historia" }, false],
  ];

  for (const [nombre, entrada, esperado] of casos) {
    it(nombre, () => {
      expect(evaluarSensibilidad(entrada).sensible).toBe(esperado);
    });
  }

  it("la huella distingue acciones que se parecen", () => {
    const a = huellaAccion("t1", "wp_editar_contenido", { id: 11, texto: "35 €" });
    const b = huellaAccion("t1", "wp_editar_contenido", { id: 11, texto: "95 €" });
    const c = huellaAccion("t2", "wp_editar_contenido", { id: 11, texto: "35 €" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    // Y no depende del orden de las claves: si dependiera, una aprobación
    // dejaría de valer por un detalle de serialización.
    expect(huellaAccion("t1", "wp_editar_contenido", { texto: "35 €", id: 11 })).toBe(a);
  });
});

describe("cifrado de credenciales", () => {
  const clave = deriveKey("una-clave-maestra-de-prueba-suficientemente-larga");

  it("va y vuelve", () => {
    const creds = { url: "https://x.test", user: "admin", appPassword: "abcd EFGH ijkl" };
    const sobre = encryptJson(creds, clave);
    expect(sobre).not.toContain("abcd");
    expect(decryptJson(sobre, clave)).toEqual(creds);
  });

  it("cada cifrado es distinto: el vector de inicialización no se reutiliza", () => {
    expect(encryptJson({ a: 1 }, clave)).not.toBe(encryptJson({ a: 1 }, clave));
  });

  it("un sobre manipulado no se descifra", () => {
    const sobre = encryptJson({ secreto: "sí" }, clave);
    const roto = Buffer.from(sobre, "base64");
    roto[roto.length - 1] = (roto[roto.length - 1]! ^ 0xff) & 0xff;
    expect(() => decryptJson(roto.toString("base64"), clave)).toThrow();
  });

  it("sin clave maestra el proceso se niega a arrancar", () => {
    expect(() => masterKeyFromEnv({} as NodeJS.ProcessEnv)).toThrow(/APP_ENCRYPTION_KEY/);
    expect(() => masterKeyFromEnv({ APP_ENCRYPTION_KEY: "corta" } as NodeJS.ProcessEnv)).toThrow(
      /16 caracteres/,
    );
  });
});

describe("los dos adaptadores salen de la misma definición", () => {
  it("el descriptor MCP se deriva del mismo Zod que valida en ejecución", () => {
    const descriptores = webmasterToolRegistry.list().map(toMcpDescriptor);
    expect(descriptores).toHaveLength(45);

    const editar = descriptores.find((d) => d.name === "wp_editar_contenido");
    expect(editar?.annotations.readOnlyHint).toBe(false);
    expect(editar?.annotations.destructiveHint).toBe(true);
    const esquema = editar?.inputSchema as { properties?: Record<string, unknown> };
    expect(Object.keys(esquema.properties ?? {})).toEqual(
      expect.arrayContaining(["tipo", "id", "nuevo_titulo", "nuevo_contenido_html"]),
    );

    const leer = descriptores.find((d) => d.name === "wp_leer_contenido");
    expect(leer?.annotations.readOnlyHint).toBe(true);
  });

  it("el conjunto para el AI SDK tiene needsApproval donde la ficha lo pide", () => {
    const set = toAiToolSet(HERRAMIENTAS_WEBMASTER);
    expect(Object.keys(set)).toHaveLength(45);
    expect(set.wp_instalar_plugin?.needsApproval).toBe(true);
    expect(set.wp_listar_contenido?.needsApproval).toBe(false);
  });
});

describe("tipo de agente en el registro de @strappy/core", () => {
  it("se registra una vez y deja pasar solo las herramientas del Webmaster", () => {
    asegurarTipoTareaPorEncargo();
    asegurarTipoTareaPorEncargo(); // idempotente: el orden de carga no decide

    const tipo = getAgentType(TIPO_TAREA_POR_ENCARGO);
    expect(tipo.runtime).toBe("task");
    expect(tipo.requiresApprovalForSensitive).toBe(true);
    expect(tipo.maxToolSteps).toBe(webmaster.maxAcciones);
    expect(tipo.timeoutMs).toBe(9 * 60 * 1000);

    expect(allowsTool(TIPO_TAREA_POR_ENCARGO, "wp_editar_contenido")).toBe(true);
    expect(allowsTool(TIPO_TAREA_POR_ENCARGO, "navegador_ver_pagina")).toBe(true);
    expect(allowsTool(TIPO_TAREA_POR_ENCARGO, "buscar_conocimiento")).toBe(false);
  });
});
