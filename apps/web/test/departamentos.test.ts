/**
 * En qué departamento sale cada agente.
 *
 * Es lo que decide si un agente contratado aparece en el menú o se queda
 * invisible, así que se prueba con los agentes reales del catálogo.
 */
import { describe, expect, it } from "vitest";
import {
  categoriasPorSlug,
  departamentoDeAgente,
  esDeWhatsapp,
} from "@/lib/negocio/departamentos";

// Las categorías de la semilla (0010_seed.sql).
const catalogo = categoriasPorSlug([
  { slug: "recepcionista", categoria: "ventas" },
  { slug: "webmaster", categoria: "operaciones" },
  { slug: "marketing", categoria: "crecimiento" },
]);

describe("departamento de un agente", () => {
  it("el Webmaster trabaja en Desarrollo", () => {
    expect(departamentoDeAgente({ tipo: "task", catalogo: "webmaster" }, catalogo)).toBe("desarrollo");
  });

  it("el de Marketing, en Marketing", () => {
    expect(departamentoDeAgente({ tipo: "task", catalogo: "marketing" }, catalogo)).toBe("marketing");
  });

  it("uno de WhatsApp creado con Strap es de Comunicaciones aunque no venga del catálogo", () => {
    expect(departamentoDeAgente({ tipo: "conversational", catalogo: null }, catalogo)).toBe(
      "comunicaciones",
    );
  });

  it("uno del catálogo que atiende por WhatsApp también es de Comunicaciones", () => {
    expect(departamentoDeAgente({ tipo: "conversational", catalogo: "recepcionista" }, catalogo)).toBe(
      "comunicaciones",
    );
  });

  it("un agente por encargo sin ficha del catálogo no desaparece: cae en Otros", () => {
    expect(departamentoDeAgente({ tipo: "task", catalogo: null }, catalogo)).toBe("otros");
  });

  it("un agente de un catálogo que ya no conocemos tampoco desaparece", () => {
    expect(departamentoDeAgente({ tipo: "task", catalogo: "disenador" }, catalogo)).toBe("otros");
  });
});

describe("quién es de WhatsApp", () => {
  it("solo los conversacionales", () => {
    expect(esDeWhatsapp("conversational")).toBe(true);
    expect(esDeWhatsapp("task")).toBe(false);
  });
});
