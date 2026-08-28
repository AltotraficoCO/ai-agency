import { describe, expect, it } from "vitest";
import {
  construirEsquemaDeAnalisis,
  variableDesdeFila,
  type VariableDeAgente,
} from "../src/variables.js";

const VARS: readonly VariableDeAgente[] = [
  { clave: "nombre_del_lead", tipo: "texto", obligatoria: true },
  { clave: "presupuesto", tipo: "numero" },
  { clave: "presupuesto_confirmado", tipo: "booleano" },
  { clave: "estado_del_lead", tipo: "seleccion", opciones: ["frio", "tibio", "caliente"] },
  { clave: "fecha_de_seguimiento", tipo: "fecha" },
];

describe("esquema dinámico desde variables", () => {
  it("construye un campo por tipo y admite null en todos", () => {
    const { esquema, usadas } = construirEsquemaDeAnalisis(VARS);
    expect(usadas.map((v) => v.clave)).toEqual([
      "nombre_del_lead",
      "presupuesto",
      "presupuesto_confirmado",
      "estado_del_lead",
      "fecha_de_seguimiento",
    ]);

    const valido = esquema.parse({
      resumen: "r",
      objetivo_logrado: true,
      objetivo_score: 80,
      objetivo_razon: "porque sí",
      sentimiento: "positivo",
      objeciones: [],
      nombre_del_lead: "Ana",
      presupuesto: 350_000_000,
      presupuesto_confirmado: true,
      estado_del_lead: "caliente",
      fecha_de_seguimiento: "2026-09-01",
    });
    expect(valido["presupuesto"]).toBe(350_000_000);

    const conNulos = esquema.parse({
      resumen: "r",
      objetivo_logrado: false,
      objetivo_score: 0,
      objetivo_razon: "-",
      sentimiento: "neutro",
      objeciones: ["el precio le parece alto"],
      nombre_del_lead: null,
      presupuesto: null,
      presupuesto_confirmado: null,
      estado_del_lead: null,
      fecha_de_seguimiento: null,
    });
    expect(conNulos["nombre_del_lead"]).toBeNull();
  });

  it("rechaza tipos equivocados y opciones fuera del selector", () => {
    const { esquema } = construirEsquemaDeAnalisis(VARS);
    const base = {
      resumen: "r",
      objetivo_logrado: true,
      objetivo_score: 10,
      objetivo_razon: "-",
      sentimiento: "neutro",
      objeciones: [],
      nombre_del_lead: null,
      presupuesto: null,
      presupuesto_confirmado: null,
      estado_del_lead: null,
      fecha_de_seguimiento: null,
    };
    expect(() => esquema.parse({ ...base, presupuesto: "mucho" })).toThrow();
    expect(() => esquema.parse({ ...base, estado_del_lead: "ardiendo" })).toThrow();
    expect(() => esquema.parse({ ...base, objetivo_score: 140 })).toThrow();
  });

  it("descarta claves reservadas, repetidas, inválidas y selectores sin opciones", () => {
    const { usadas, descartadas } = construirEsquemaDeAnalisis([
      { clave: "resumen", tipo: "texto" },
      { clave: "presupuesto", tipo: "numero" },
      { clave: "presupuesto", tipo: "texto" },
      { clave: "no válida", tipo: "texto" },
      { clave: "sin_opciones", tipo: "seleccion" },
    ]);
    expect(usadas.map((v) => v.clave)).toEqual(["presupuesto"]);
    expect(descartadas.map((d) => d.clave).sort()).toEqual([
      "no válida",
      "presupuesto",
      "resumen",
      "sin_opciones",
    ]);
  });

  it("nunca extrae un secreto de una conversación", () => {
    expect(variableDesdeFila({ key: "api_key", value_type: "secret" })).toBeNull();
    expect(variableDesdeFila({ key: "ciudad", value_type: "text", is_required: true })).toMatchObject({
      clave: "ciudad",
      tipo: "texto",
      obligatoria: true,
    });
    expect(
      variableDesdeFila({ key: "estado", value_type: "text", options: ["frio", "caliente"] }),
    ).toMatchObject({ tipo: "seleccion", opciones: ["frio", "caliente"] });
  });
});
