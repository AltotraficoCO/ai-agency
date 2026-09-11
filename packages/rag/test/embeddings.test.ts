/**
 * El proveedor de embeddings sale de la cartera.
 *
 * En producción la única clave de modelos es la de OpenRouter, y OpenRouter
 * sirve embeddings con el protocolo de OpenAI. Si estos tests se rompen, el
 * conocimiento vuelve a buscar solo por palabras en producción sin que nadie
 * lo note. Todo sin red: el `fetch` del proveedor se sustituye.
 */
import { describe, expect, it } from "vitest";
import { crearEmbeddings, crearEmbeddingsSiHayProveedor } from "../src/adapters/embeddings.js";
import { detectarModoConocimiento, proveedorDeEmbeddings } from "../src/modo.js";

const CLAVE = "sk-or-v1-no-la-ensenes";
const VECTOR = Array.from({ length: 1536 }, (_, i) => ((i % 7) - 3) / 10);

type Llamada = { url: string; cuerpo: { model: string; input: string[] }; cabeceras: Headers };

function proveedorFalso(respuesta: (cuerpo: Llamada["cuerpo"]) => Response) {
  const llamadas: Llamada[] = [];
  const fetch: typeof globalThis.fetch = async (entrada, init) => {
    const cuerpo = JSON.parse(String(init?.body)) as Llamada["cuerpo"];
    llamadas.push({ url: String(entrada), cuerpo, cabeceras: new Headers(init?.headers) });
    return respuesta(cuerpo);
  };
  return { fetch, llamadas };
}

const vectoresOk = (cuerpo: Llamada["cuerpo"]) =>
  new Response(
    JSON.stringify({
      object: "list",
      data: cuerpo.input.map((_, index) => ({ object: "embedding", index, embedding: VECTOR })),
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 4, total_tokens: 4 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("elección del proveedor", () => {
  it("con la clave de OpenRouter el modo es completo: no hace falta otra clave", () => {
    const diagnostico = detectarModoConocimiento({ OPENROUTER_API_KEY: CLAVE });
    expect(diagnostico.modo).toBe("completo");
    expect(diagnostico.proveedor).toBe("openrouter");
    expect(diagnostico.variable).toBe("OPENROUTER_API_KEY");
  });

  it("la cartera manda: con la pasarela de Vercel la clave de OpenRouter no vectoriza", () => {
    expect(proveedorDeEmbeddings({ MODEL_WALLET: "vercel-gateway", OPENROUTER_API_KEY: CLAVE })).toBeNull();
    expect(
      proveedorDeEmbeddings({ MODEL_WALLET: "vercel-gateway", AI_GATEWAY_API_KEY: "gw" })?.proveedor,
    ).toBe("pasarela");
  });

  it("OpenRouter va antes que OpenAI si la cartera es OpenRouter", () => {
    expect(proveedorDeEmbeddings({ OPENROUTER_API_KEY: CLAVE, OPENAI_API_KEY: "sk-openai" })?.proveedor).toBe(
      "openrouter",
    );
    expect(proveedorDeEmbeddings({ OPENAI_API_KEY: "sk-openai" })?.proveedor).toBe("openai");
  });

  it("sin ninguna clave no hay puerto", () => {
    expect(crearEmbeddingsSiHayProveedor({ entorno: {} })).toBeNull();
  });
});

describe("OpenRouter como proveedor", () => {
  it("llama a /embeddings de OpenRouter con el id canónico y la clave en la cabecera", async () => {
    const { fetch, llamadas } = proveedorFalso(vectoresOk);
    const embeddings = crearEmbeddings({ entorno: { OPENROUTER_API_KEY: CLAVE }, fetch, maxReintentos: 0 });

    const vectores = await embeddings.incrustar(["¿hacen domicilios?", "entregas a casa"]);

    expect(embeddings.proveedor).toBe("openrouter");
    expect(vectores).toHaveLength(2);
    expect(vectores[0]).toHaveLength(1536);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(llamadas[0]?.cuerpo.model).toBe("openai/text-embedding-3-small");
    expect(llamadas[0]?.cuerpo.input).toEqual(["¿hacen domicilios?", "entregas a casa"]);
    expect(llamadas[0]?.cabeceras.get("authorization")).toBe(`Bearer ${CLAVE}`);
    expect(llamadas[0]?.cabeceras.get("x-title")).toBe("Strappy");
  });

  it("OpenAI directo quita el prefijo openai/ del modelo", async () => {
    const { fetch, llamadas } = proveedorFalso(vectoresOk);
    const embeddings = crearEmbeddings({ entorno: { OPENAI_API_KEY: "sk-openai" }, fetch, maxReintentos: 0 });
    await embeddings.incrustar(["hola"]);
    expect(llamadas[0]?.url).toBe("https://api.openai.com/v1/embeddings");
    expect(llamadas[0]?.cuerpo.model).toBe("text-embedding-3-small");
  });

  it("si el proveedor falla, el error no enseña la clave", async () => {
    const { fetch } = proveedorFalso(
      () =>
        new Response(JSON.stringify({ error: { message: `Clave inválida: ${CLAVE}`, code: 401 } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    const embeddings = crearEmbeddings({ entorno: { OPENROUTER_API_KEY: CLAVE }, fetch, maxReintentos: 0 });

    const error = await embeddings.incrustar(["hola"]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(CLAVE);
    expect((error as Error).message).toContain("No se pudieron calcular los embeddings");
  });

  it("rechaza un modelo con otra dimensión: mezclarla rompería el índice", async () => {
    const { fetch } = proveedorFalso(
      (cuerpo) =>
        new Response(
          JSON.stringify({
            object: "list",
            data: cuerpo.input.map((_, index) => ({ object: "embedding", index, embedding: [0.1, 0.2] })),
            model: "otro",
            usage: { prompt_tokens: 1, total_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const embeddings = crearEmbeddings({ entorno: { OPENROUTER_API_KEY: CLAVE }, fetch, maxReintentos: 0 });
    await expect(embeddings.incrustar(["hola"])).rejects.toThrow(/1536/);
  });
});
