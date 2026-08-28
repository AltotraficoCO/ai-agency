/**
 * La cartera de modelos.
 *
 * Compramos el consumo al por mayor a un agregador y lo revendemos en
 * creditos. Hoy la cartera es OpenRouter; ayer era otra y manana puede volver
 * a cambiar, asi que el proveedor se resuelve por configuracion y los
 * identificadores de modelo viven en datos (`model_tiers`), nunca en la logica.
 *
 * Ambos agregadores hablan el protocolo de OpenAI, de modo que cambiar de uno
 * a otro es cambiar una URL base y una clave.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export type Cartera = "openrouter" | "vercel-gateway";

type ConfigCartera = {
  readonly baseURL: string;
  readonly envKey: string;
  readonly nombre: string;
  /** Cabeceras que el agregador pide para atribuir el trafico. */
  readonly headers?: Record<string, string>;
};

const CARTERAS: Record<Cartera, ConfigCartera> = {
  openrouter: {
    nombre: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    // OpenRouter usa estas dos para atribuir el consumo y aparecer en su
    // ranking publico. No son obligatorias, pero cuestan cero.
    headers: {
      "HTTP-Referer": "https://strappy.ai",
      "X-Title": "Strappy",
    },
  },
  "vercel-gateway": {
    nombre: "Vercel AI Gateway",
    baseURL: "https://ai-gateway.vercel.sh/v1",
    envKey: "AI_GATEWAY_API_KEY",
  },
};

/**
 * Los agregadores no nombran igual al mismo modelo: OpenRouter usa
 * `z-ai/glm-4.7-flash` y el Gateway de Vercel `zai/glm-4.7-flash`. Guardamos un
 * identificador canonico en la base de datos y traducimos aqui, para que
 * cambiar de cartera no obligue a reescribir `model_tiers`.
 */
const ALIAS: Record<Cartera, Record<string, string>> = {
  openrouter: {
    "zai/glm-4.7-flash": "z-ai/glm-4.7-flash",
    "zai/glm-5": "z-ai/glm-5",
    "google/gemini-3-flash": "google/gemini-3-flash-preview",
  },
  "vercel-gateway": {},
};

export function traducirId(modelo: string, cartera: Cartera): string {
  return ALIAS[cartera][modelo] ?? modelo;
}

export type OpcionesCartera = {
  readonly cartera?: Cartera;
  readonly apiKey?: string;
  /** Inyectable en tests para no salir a la red. */
  readonly fetch?: typeof globalThis.fetch;
};

/**
 * Devuelve el resolvedor que el motor usa para convertir un identificador de
 * `model_tiers` en un modelo ejecutable.
 */
export function crearResolvedorDeModelo(opciones: OpcionesCartera = {}) {
  const cartera: Cartera =
    opciones.cartera ?? (process.env.MODEL_WALLET as Cartera | undefined) ?? "openrouter";

  const config = CARTERAS[cartera];
  if (!config) {
    throw new Error(`Cartera de modelos desconocida: "${cartera}".`);
  }

  const apiKey = opciones.apiKey ?? process.env[config.envKey];
  if (!apiKey) {
    throw new Error(
      `Falta ${config.envKey}: es la clave de ${config.nombre}, la cartera de modelos configurada.`,
    );
  }

  const proveedor = createOpenAICompatible({
    name: cartera,
    baseURL: config.baseURL,
    apiKey,
    ...(config.headers ? { headers: config.headers } : {}),
    ...(opciones.fetch ? { fetch: opciones.fetch } : {}),
  });

  return {
    cartera,
    resolver(modelo: string): LanguageModel {
      return proveedor(traducirId(modelo, cartera));
    },
  };
}
