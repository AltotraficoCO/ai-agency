import { describe, expect, it } from "vitest";
import { crearClienteWhatsApp } from "../src/client.js";
import {
  extraerVariables,
  normalizarPlantilla,
  sincronizarPlantillas,
  validarBorrador,
  validarEnvio,
  type BorradorPlantilla,
} from "../src/templates.js";
import { fixture } from "./fixtures.js";

const base: BorradorPlantilla = {
  nombre: "recordatorio_cita",
  idioma: "es",
  categoria: "UTILITY",
  cuerpo: "Hola {{1}}, te recordamos tu cita del {{2}} a las {{3}}. Gracias.",
  ejemplos: ["María", "12 de agosto", "10:00"],
};

const errores = (b: BorradorPlantilla) =>
  validarBorrador(b).hallazgos.filter((h) => h.severidad === "error");
const avisos = (b: BorradorPlantilla) =>
  validarBorrador(b).hallazgos.filter((h) => h.severidad === "aviso");

describe("sincronización de plantillas desde Meta", () => {
  it("normaliza estado, categoría y variables", async () => {
    const api = crearClienteWhatsApp({
      accessToken: "t",
      dormir: async () => {},
      fetch: async () =>
        new Response(JSON.stringify(fixture("plantillas")), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const plantillas = await sincronizarPlantillas(api, "102290129340398");
    expect(plantillas).toHaveLength(3);

    const aprobada = plantillas.find((p) => p.nombre === "recordatorio_cita");
    expect(aprobada?.utilizable).toBe(true);
    expect(aprobada?.variables).toEqual(["1", "2", "3"]);

    const rechazada = plantillas.find((p) => p.nombre === "promo_agosto");
    expect(rechazada?.utilizable).toBe(false);
    expect(rechazada?.motivoRechazo).toBe("ABUSIVE_CONTENT");

    // PAUSED existe pero Meta rechaza los envíos: no es utilizable.
    expect(plantillas.find((p) => p.nombre === "pausada_por_calidad")?.utilizable).toBe(false);
  });

  it("descarta plantillas sin id o sin nombre", () => {
    expect(normalizarPlantilla({ name: "sin_id" })).toBeNull();
    expect(normalizarPlantilla({ id: "1" })).toBeNull();
  });

  it("extrae variables posicionales y con nombre", () => {
    expect(extraerVariables("Hola {{1}} y {{2}}")).toEqual(["1", "2"]);
    expect(extraerVariables("Hola {{ nombre }}")).toEqual(["nombre"]);
    expect(extraerVariables("sin variables")).toEqual([]);
  });
});

describe("validador previo: avisar antes de que Meta rechace", () => {
  it("acepta una plantilla correcta", () => {
    expect(validarBorrador(base).ok).toBe(true);
    expect(errores(base)).toHaveLength(0);
  });

  it("rechaza nombres con mayúsculas, tildes o espacios", () => {
    for (const nombre of ["Recordatorio", "recordatorio cita", "cotización"]) {
      expect(errores({ ...base, nombre })).not.toHaveLength(0);
    }
  });

  it("rechaza un cuerpo vacío o más largo que el límite de Meta", () => {
    expect(errores({ ...base, cuerpo: "   ", ejemplos: [] })).not.toHaveLength(0);
    const largo = { ...base, cuerpo: "a".repeat(1025), ejemplos: [] };
    expect(errores(largo).some((e) => e.mensaje.includes("1024"))).toBe(true);
  });

  it("exige variables numeradas y en orden desde {{1}}", () => {
    const salteadas = { ...base, cuerpo: "Hola {{1}} el {{3}}.", ejemplos: ["a", "b"] };
    expect(errores(salteadas).some((e) => e.campo === "cuerpo")).toBe(true);
  });

  it("no admite mezclar variables posicionales y con nombre", () => {
    const mezcla = { ...base, cuerpo: "Hola {{1}}, cita el {{fecha}}.", ejemplos: ["a", "b"] };
    expect(errores(mezcla)).not.toHaveLength(0);
  });

  it("exige un ejemplo por variable", () => {
    const faltan = { ...base, ejemplos: ["María"] };
    expect(errores(faltan).some((e) => e.campo === "ejemplos")).toBe(true);
    const sinEjemplos: BorradorPlantilla = {
      nombre: base.nombre,
      idioma: base.idioma,
      categoria: base.categoria,
      cuerpo: base.cuerpo,
    };
    expect(avisos(sinEjemplos).some((a) => a.campo === "ejemplos")).toBe(true);
  });

  it("rechaza un cuerpo que es solo variables", () => {
    expect(errores({ ...base, cuerpo: "{{1}} {{2}}", ejemplos: ["a", "b"] })).not.toHaveLength(0);
  });

  it("avisa si el cuerpo empieza o termina con una variable", () => {
    const inicio = { ...base, cuerpo: "{{1}}, tu cita es mañana.", ejemplos: ["María"] };
    expect(avisos(inicio).some((a) => a.campo === "cuerpo")).toBe(true);
  });

  it("valida los límites de encabezado, pie y botones", () => {
    expect(
      errores({ ...base, encabezado: { tipo: "TEXT", texto: "x".repeat(61) } }),
    ).not.toHaveLength(0);
    expect(errores({ ...base, pie: "x".repeat(61) })).not.toHaveLength(0);
    expect(errores({ ...base, pie: "Escribe a {{1}}" })).not.toHaveLength(0);
    expect(
      errores({ ...base, botones: [{ tipo: "URL", texto: "Ver" }] }).some((e) =>
        e.mensaje.includes("URL"),
      ),
    ).toBe(true);
    expect(
      errores({ ...base, botones: [{ tipo: "QUICK_REPLY", texto: "x".repeat(26) }] }),
    ).not.toHaveLength(0);
  });

  it("avisa de una UTILITY con lenguaje promocional: Meta la recategoriza y cambia el precio", () => {
    const promocional = {
      ...base,
      cuerpo: "Hola {{1}}, aprovecha nuestro descuento de agosto en todos los servicios.",
      ejemplos: ["María"],
    };
    const aviso = avisos(promocional).find((a) => a.campo === "categoria");
    expect(aviso?.mensaje).toContain("MARKETING");
  });

  it("una plantilla de autenticación necesita la variable del código", () => {
    const auth: BorradorPlantilla = {
      nombre: "codigo_acceso",
      idioma: "es",
      categoria: "AUTHENTICATION",
      cuerpo: "Tu código de verificación es válido por 10 minutos.",
    };
    expect(errores(auth).some((e) => e.campo === "categoria")).toBe(true);
  });

  it("todos los mensajes van en español", () => {
    const roto: BorradorPlantilla = { nombre: "Mal Nombre", idioma: "", categoria: "UTILITY", cuerpo: "" };
    for (const h of validarBorrador(roto).hallazgos) {
      expect(h.mensaje).toMatch(/[a-záéíóúñ]/i);
      expect(h.mensaje).not.toMatch(/\b(must|cannot|invalid|required)\b/i);
    }
  });
});

describe("validación en el momento del envío", () => {
  const plantilla = {
    id: "1",
    nombre: "recordatorio_cita",
    idioma: "es",
    estado: "APPROVED" as const,
    categoria: "UTILITY" as const,
    variables: ["1", "2", "3"],
    utilizable: true,
  };

  it("acepta el número exacto de valores", () => {
    expect(validarEnvio({ plantilla, valores: ["María", "12 de agosto", "10:00"] }).ok).toBe(true);
  });

  it("evita el 132000 antes de llamar a Meta", () => {
    const r = validarEnvio({ plantilla, valores: ["María"] });
    expect(r.ok).toBe(false);
    expect(r.hallazgos[0]?.mensaje).toContain("3 valor(es)");
  });

  it("rechaza valores con saltos de línea o espacios repetidos", () => {
    expect(validarEnvio({ plantilla, valores: ["a\nb", "x", "y"] }).ok).toBe(false);
    expect(validarEnvio({ plantilla, valores: ["a      b", "x", "y"] }).ok).toBe(false);
  });

  it("rechaza una plantilla no aprobada", () => {
    const pausada = { ...plantilla, estado: "PAUSED" as const, utilizable: false };
    expect(validarEnvio({ plantilla: pausada, valores: ["a", "b", "c"] }).ok).toBe(false);
  });
});
