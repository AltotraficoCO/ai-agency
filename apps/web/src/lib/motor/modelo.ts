/**
 * `resolveLanguageModel`: de un identificador de la tabla de modelos al modelo
 * del AI SDK.
 *
 * Cartera única, hoy OpenRouter: un saldo, una factura y respaldo automático
 * entre modelos. Cuál cartera se usa lo decide `MODEL_WALLET`, y la traducción
 * de identificadores la hace `@strappy/core`, porque cada agregador nombra al
 * mismo modelo de forma distinta (`z-ai/glm-4.7-flash` en OpenRouter,
 * `zai/glm-4.7-flash` en el gateway de Vercel). Cambiar de modelo sigue siendo
 * cambiar una fila de `model_tiers`.
 *
 * Sin clave de cartera la aplicación no se queda muda: entra un modelo de
 * ENSAYO, local y determinista, que responde en español y declara un consumo de
 * tokens realista. Sirve para probar el circuito completo —motor, persistencia,
 * cobro de créditos— sin gastar dinero, y va marcado como tal en la interfaz
 * para que nadie confunda un ensayo con un agente de verdad.
 */
import type { LanguageModel } from "ai";
import { crearResolvedorDeModelo } from "@strappy/core";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
} from "@ai-sdk/provider";

/** Clave que corresponde a la cartera configurada. */
function claveDeCartera(): string | undefined {
  const cartera = process.env.MODEL_WALLET ?? "openrouter";
  return cartera === "vercel-gateway"
    ? process.env.AI_GATEWAY_API_KEY
    : process.env.OPENROUTER_API_KEY;
}

export function hayModeloReal(): boolean {
  return Boolean(claveDeCartera());
}

/** Se construye una vez: crearlo por turno abriría un cliente en cada mensaje. */
let resolvedor: ReturnType<typeof crearResolvedorDeModelo> | null = null;

export function resolveLanguageModel(modelId: string): LanguageModel {
  if (!hayModeloReal()) return new ModeloDeEnsayo(modelId);
  // La clave la lee `crearResolvedorDeModelo` del entorno: no pasa por aquí y
  // por tanto no puede acabar en un registro ni en un mensaje de error.
  resolvedor ??= crearResolvedorDeModelo();
  return resolvedor.resolver(modelId);
}

/**
 * Modelo de ensayo.
 *
 * No intenta parecer listo: reconoce el último mensaje, contesta con una frase
 * útil y declara el consumo de tokens que habría tenido. Lo que se prueba con
 * él no es la calidad de la respuesta, es que el turno entero funciona.
 */
export class ModeloDeEnsayo implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "strappy-ensayo";
  readonly supportedUrls = {};

  constructor(readonly modelId: string) {}

  async doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    const ultimo = ultimoTextoDelUsuario(options.prompt);
    const texto = redactarRespuesta(ultimo);
    const entrada = estimarTokens(JSON.stringify(options.prompt));
    const salida = estimarTokens(texto);

    return {
      content: [{ type: "text", text: texto }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: entrada, noCache: entrada, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: salida, text: salida, reasoning: 0 },
      },
      warnings: [
        {
          type: "other",
          message:
            "Respuesta generada por el modelo de ensayo local: no hay AI_GATEWAY_API_KEY configurada.",
        },
      ],
    };
  }

  async doStream(): Promise<never> {
    throw new Error("El modelo de ensayo no admite streaming; el motor usa generateText.");
  }
}

function ultimoTextoDelUsuario(prompt: LanguageModelV3Prompt): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const mensaje = prompt[i];
    if (!mensaje || mensaje.role !== "user") continue;
    const partes = Array.isArray(mensaje.content) ? mensaje.content : [];
    const texto = partes
      .map((p) => (p.type === "text" ? p.text : ""))
      .join(" ")
      .trim();
    if (texto) return texto;
  }
  return "";
}

function redactarRespuesta(mensaje: string): string {
  const limpio = mensaje.trim();
  if (!limpio) {
    return "¡Hola! Cuéntame en qué te puedo ayudar y lo miramos ahora mismo.";
  }
  if (/^(hola|buenas|buenos días|buenas tardes|qué tal)/i.test(limpio)) {
    return "¡Hola! Encantado de saludarte. ¿En qué te puedo ayudar hoy?";
  }
  if (limpio.includes("?") || /^(cuánto|cuando|cuándo|dónde|donde|qué|que|cómo|como)/i.test(limpio)) {
    return `Buena pregunta. Sobre «${recortar(limpio)}»: déjame confirmarlo con la información del negocio y te respondo enseguida. ¿Me dices tu nombre para dejarlo anotado?`;
  }
  return `Entendido: «${recortar(limpio)}». Lo anoto y seguimos desde ahí. ¿Hay algo más que deba tener en cuenta?`;
}

function recortar(texto: string, max = 120): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1)}…`;
}

/** Aproximación suficiente para tarifar un ensayo: cuatro caracteres por token. */
function estimarTokens(texto: string): number {
  return Math.max(1, Math.ceil(texto.length / 4));
}
