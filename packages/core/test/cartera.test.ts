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

describe("razonamiento", () => {
  it("lo desactiva por defecto e inyecta el parametro en el cuerpo", async () => {
    // Medido contra GLM-4.7-flash: razonando gasta 60 tokens de salida en una
    // frase y llega vacia si se agota el tope; sin razonar gasta 16. Cuatro
    // veces mas barato y sin respuestas cortadas.
    let cuerpoEnviado: unknown = null;
    const fetchEspia = (async (_url: unknown, init: { body?: string }) => {
      cuerpoEnviado = JSON.parse(init.body ?? "{}");
      return new Response(JSON.stringify({ choices: [], usage: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;

    const r = crearResolvedorDeModelo({ apiKey: "sk-prueba", fetch: fetchEspia });
    expect(r.razonamiento).toBe(false);

    // `LanguageModel` admite tambien un identificador suelto; aqui sabemos que
    // es un modelo construido, asi que se estrecha el tipo para poder llamarlo.
    const modelo = r.resolver("zai/glm-4.7-flash") as Exclude<
      ReturnType<typeof r.resolver>,
      string
    >;
    // La respuesta vacia del espia hace fallar el parseo; da igual, para cuando
    // eso ocurre ya hemos capturado el cuerpo que se envio, que es lo que se mide.
    try {
      await modelo.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hola" }] }],
      });
    } catch {
      // esperado
    }

    expect((cuerpoEnviado as { reasoning?: unknown })?.reasoning).toEqual({ enabled: false });
  });

  it("se puede activar a proposito para construir agentes", () => {
    const r = crearResolvedorDeModelo({ apiKey: "sk-prueba", razonamiento: true });
    expect(r.razonamiento).toBe(true);
  });
});
