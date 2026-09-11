/**
 * Selección de modelo: (modo, tarea) → modelo.
 *
 * La tabla es un dato inyectable. Nunca se codifica un identificador de modelo
 * dentro de la lógica: cambiar de proveedor tiene que ser cambiar una fila, no
 * tocar el motor. `DEFAULT_MODEL_TABLE` es solo un punto de partida razonable.
 */

/** Modo comercial del workspace. `lite` es barato, `max` es frontera. */
export type ModelMode = "lite" | "max";

/** Para qué se pide el modelo. Cada tarea tiene exigencias distintas. */
export type ModelTask =
  | "conversation"
  | "summary"
  | "extraction"
  | "classification"
  | "builder"
  | "title"
  /**
   * Agentes del negocio que ejecutan encargos en el worker (Webmaster…). Van
   * aparte de `builder` porque viven en otra máquina con otra clave de la
   * cartera, que no tiene por qué permitir los mismos modelos que la web.
   */
  | "business_agent";

export type ModelChoice = {
  readonly primary: string;
  /** Cadena de respaldo en orden. Se prueba en secuencia ante fallo del proveedor. */
  readonly fallbacks: readonly string[];
  /** primary + fallbacks, en orden. Útil para iterar. */
  readonly chain: readonly string[];
  readonly mode: ModelMode;
  readonly task: ModelTask;
};

export type ModelTable = {
  /** Cadenas por modo y tarea. La primera entrada es la preferida. */
  readonly chains: Readonly<Record<ModelMode, Partial<Record<ModelTask, readonly string[]>>>>;
  /** Cadena usada cuando (modo, tarea) no tiene entrada propia. */
  readonly defaults: Readonly<Record<ModelMode, readonly string[]>>;
};

export const DEFAULT_MODEL_TABLE: ModelTable = {
  chains: {
    lite: {
      conversation: ["zai/glm-4.7-flash", "deepseek/deepseek-v4-flash"],
      summary: ["deepseek/deepseek-v4-flash", "zai/glm-4.7-flash"],
      extraction: ["deepseek/deepseek-v4-flash", "zai/glm-4.7-flash"],
      classification: ["zai/glm-4.7-flash"],
      title: ["zai/glm-4.7-flash"],
      // Construir un agente en lite usa la familia economica, igual que el
      // resto de tareas: si construir costara como max, el plan gratuito se
      // quedaria sin suelo, que es justo lo que el modo lite existe para
      // sostener. Que modelo economico construye mejor en espanol se decide
      // con evaluaciones sobre conversaciones reales, no por intuicion.
      builder: ["zai/glm-4.7-flash", "deepseek/deepseek-v4-flash"],
      business_agent: ["openai/gpt-5.6-luna"],
    },
    max: {
      conversation: ["anthropic/claude-sonnet-5", "anthropic/claude-opus-5"],
      summary: ["anthropic/claude-sonnet-5"],
      extraction: ["anthropic/claude-sonnet-5"],
      classification: ["anthropic/claude-sonnet-5"],
      title: ["anthropic/claude-sonnet-5"],
      builder: ["anthropic/claude-opus-5", "anthropic/claude-sonnet-5"],
      business_agent: ["openai/gpt-5.6-luna"],
    },
  },
  defaults: {
    lite: ["zai/glm-4.7-flash", "deepseek/deepseek-v4-flash"],
    max: ["anthropic/claude-sonnet-5", "anthropic/claude-opus-5"],
  },
};

export function resolveModel(
  table: ModelTable,
  input: { mode: ModelMode; task: ModelTask },
): ModelChoice {
  const chain = table.chains[input.mode]?.[input.task] ?? table.defaults[input.mode];
  const [primary, ...fallbacks] = chain;
  if (!primary) {
    throw new Error(
      `La tabla de modelos no tiene ninguna entrada para modo "${input.mode}" y tarea "${input.task}".`,
    );
  }
  return { primary, fallbacks, chain, mode: input.mode, task: input.task };
}

/**
 * Recorre la cadena de respaldo hasta que una llamada tenga éxito.
 * Si todas fallan, se propaga el último error con el detalle de lo intentado.
 */
export async function withModelFallback<T>(
  choice: ModelChoice,
  run: (modelId: string) => Promise<T>,
  onFallback?: (failed: string, error: unknown, next: string) => void,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < choice.chain.length; i++) {
    const modelId = choice.chain[i]!;
    try {
      return await run(modelId);
    } catch (error) {
      lastError = error;
      const next = choice.chain[i + 1];
      if (next) onFallback?.(modelId, error, next);
    }
  }
  throw new Error(
    `Todos los modelos fallaron para ${choice.mode}/${choice.task} (${choice.chain.join(" → ")}): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    { cause: lastError },
  );
}
