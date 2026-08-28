import { describe, it, expect } from "vitest";
import { crearResolvedorDeModelo, traducirId } from "../src/engine/cartera.js";
import { resolveModel, DEFAULT_MODEL_TABLE } from "../src/engine/model-tier.js";

describe("cartera de modelos", () => {
  it("traduce los identificadores al nombre de cada agregador", () => {
    // El mismo modelo se llama distinto en cada cartera. Guardamos uno canonico
    // y traducimos, para que cambiar de cartera no obligue a reescribir datos.
    expect(traducirId("zai/glm-4.7-flash", "openrouter")).toBe("z-ai/glm-4.7-flash");
    expect(traducirId("zai/glm-4.7-flash", "vercel-gateway")).toBe("zai/glm-4.7-flash");
  });

  it("deja intactos los identificadores que ambos nombran igual", () => {
    expect(traducirId("anthropic/claude-sonnet-5", "openrouter")).toBe("anthropic/claude-sonnet-5");
  });

  it("exige la clave de la cartera configurada y lo dice con claridad", () => {
    expect(() => crearResolvedorDeModelo({ cartera: "openrouter", apiKey: "" }))
      .toThrow(/OPENROUTER_API_KEY/);
  });

  it("apunta a OpenRouter por defecto", () => {
    const r = crearResolvedorDeModelo({ apiKey: "sk-prueba" });
    expect(r.cartera).toBe("openrouter");
  });
});

describe("seleccion automatica de modelo", () => {
  // Lo que decide el modelo es la TAREA, no la persona: el usuario solo elige
  // entre lite y max. Estas pruebas fijan esa regla.
  it("elige modelo distinto segun la tarea dentro del mismo modo", () => {
    const conversar = resolveModel(DEFAULT_MODEL_TABLE, { mode: "max", task: "conversation" });
    const construir = resolveModel(DEFAULT_MODEL_TABLE, { mode: "max", task: "builder" });
    expect(construir.primary).not.toBe(conversar.primary);
  });

  it("en modo lite ninguna tarea usa un modelo de frontera", () => {
    // Si lite escalara a frontera, el plan gratuito perderia su suelo de coste.
    const frontera = ["anthropic/claude-opus-5", "anthropic/claude-sonnet-5"];
    const tareas = ["conversation", "summary", "extraction", "classification", "builder", "title"] as const;
    for (const tarea of tareas) {
      const elegido = resolveModel(DEFAULT_MODEL_TABLE, { mode: "lite", task: tarea });
      expect(frontera, `la tarea ${tarea} en lite`).not.toContain(elegido.primary);
    }
  });

  it("toda eleccion trae cadena de respaldo o al menos el primario", () => {
    const c = resolveModel(DEFAULT_MODEL_TABLE, { mode: "lite", task: "conversation" });
    expect(c.chain[0]).toBe(c.primary);
    expect(c.chain.length).toBeGreaterThan(0);
  });
});
