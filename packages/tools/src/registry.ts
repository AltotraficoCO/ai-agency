/**
 * Registro único de herramientas.
 *
 * UNA definición por herramienta, con Zod, y dos adaptadores encima: uno al
 * AI SDK y otro a servidor MCP. En el proyecto anterior la misma herramienta
 * estaba escrita dos veces —`executor.ts` y `mcp/server.ts`, 1300 y 625
 * líneas— y las dos copias divergieron. Esa es la deuda que este archivo
 * existe para no volver a contraer: si hay que tocar una herramienta, hay
 * exactamente un sitio donde tocarla.
 */
import { z, type ZodType } from "zod";
import type { FlexibleSchema, Tool, ToolExecutionOptions, ToolSet } from "ai";
import { assertScopes, assertToolContext, redactSecrets, type ToolContext } from "./context.js";

/**
 * Qué efecto tiene la herramienta en el mundo.
 * `write_external` es la única que se ejecuta en seco cuando el canal lo pide:
 * escribir en la base de datos del propio workspace no es un efecto externo.
 */
export type ToolEffect = "read" | "write_internal" | "write_external";

export type ToolKind = "system" | "http";

export type ToolDef<I = unknown, O = unknown> = {
  readonly slug: string;
  readonly label: string;
  readonly description: string;
  readonly inputSchema: ZodType<I>;
  /** Exige aprobación humana antes de ejecutarse. */
  readonly sensitive: boolean;
  /** Créditos de venta por invocación, además del coste de tokens. */
  readonly creditCost: number;
  readonly scopes: readonly string[];
  readonly effect: ToolEffect;
  readonly kind?: ToolKind;
  /** Cuándo debe usarla el agente. Va al prompt, no al esquema. */
  readonly whenToUse?: string;
  execute(ctx: ToolContext, input: I): Promise<O>;
  /**
   * Resultado plausible para ejecución en seco. Sin esto, una herramienta de
   * efecto externo no se puede probar en el simulador.
   */
  simulate?(ctx: ToolContext, input: I): Promise<O> | O;
};

/**
 * Campos que el modelo NUNCA puede elegir. `workspaceId` a la cabeza: es la
 * frontera de aislamiento entre clientes y lo inyecta el runtime.
 */
const CAMPOS_PROHIBIDOS = [
  "workspaceId",
  "workspace_id",
  "tenantId",
  "tenant_id",
  "accountId",
  "account_id",
  "apiKey",
  "api_key",
  "token",
  "secret",
];

export class ToolDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolDefinitionError";
  }
}

/** Valida una definición y la devuelve tipada. Falla al arrancar, no en producción. */
export function defineTool<I, O>(def: ToolDef<I, O>): ToolDef<I, O> {
  if (!/^[a-z][a-z0-9_]*$/.test(def.slug)) {
    throw new ToolDefinitionError(
      `Slug de herramienta inválido: "${def.slug}". Solo minúsculas, dígitos y guion bajo.`,
    );
  }
  if (def.creditCost < 0) {
    throw new ToolDefinitionError(`"${def.slug}" declara un coste negativo.`);
  }
  const prohibido = camposDelEsquema(def.inputSchema).find((k) => CAMPOS_PROHIBIDOS.includes(k));
  if (prohibido) {
    throw new ToolDefinitionError(
      `La herramienta "${def.slug}" declara "${prohibido}" como parámetro del modelo. ` +
        `Ese dato lo inyecta el runtime en el ToolContext y nunca puede venir del modelo.`,
    );
  }
  if (def.effect === "write_external" && !def.simulate) {
    throw new ToolDefinitionError(
      `La herramienta "${def.slug}" tiene efecto externo y no define simulate(): no se podría probar en el simulador.`,
    );
  }
  return def;
}

function camposDelEsquema(schema: ZodType<unknown>): string[] {
  if (schema instanceof z.ZodObject) return Object.keys(schema.shape as Record<string, unknown>);
  return [];
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

export class ToolRegistry {
  readonly #tools = new Map<string, ToolDef<never, unknown>>();

  register<I, O>(def: ToolDef<I, O>): this {
    const validada = defineTool(def);
    if (this.#tools.has(validada.slug)) {
      throw new ToolDefinitionError(`La herramienta "${validada.slug}" ya está registrada.`);
    }
    this.#tools.set(validada.slug, validada as unknown as ToolDef<never, unknown>);
    return this;
  }

  registerAll(defs: readonly ToolDef<never, unknown>[]): this {
    for (const d of defs) this.register(d);
    return this;
  }

  get(slug: string): ToolDef<never, unknown> {
    const def = this.#tools.get(slug);
    if (!def) {
      throw new ToolDefinitionError(
        `Herramienta desconocida: "${slug}". Registradas: ${[...this.#tools.keys()].join(", ") || "ninguna"}.`,
      );
    }
    return def;
  }

  has(slug: string): boolean {
    return this.#tools.has(slug);
  }

  list(): readonly ToolDef<never, unknown>[] {
    return [...this.#tools.values()].sort((a, b) => a.slug.localeCompare(b.slug, "en"));
  }
}

export const systemToolRegistry = new ToolRegistry();

// ---------------------------------------------------------------------------
// Ejecución compartida por los dos adaptadores
// ---------------------------------------------------------------------------

export type ToolInvocationLog = {
  readonly slug: string;
  /** Ya filtrado de secretos: esto es lo que se puede persistir. */
  readonly input: unknown;
  readonly output?: unknown;
  readonly simulated: boolean;
  readonly durationMs: number;
  readonly error?: string;
};

export type ExecuteOptions = {
  onInvocation?: (log: ToolInvocationLog) => void;
};

/**
 * El único camino de ejecución. Los dos adaptadores llaman aquí, así que las
 * reglas —permisos, validación, dry run, filtrado de secretos— existen una
 * sola vez y no pueden divergir entre AI SDK y MCP.
 */
export async function executeToolDef<I, O>(
  def: ToolDef<I, O>,
  ctx: ToolContext,
  rawInput: unknown,
  options: ExecuteOptions = {},
): Promise<O> {
  const t0 = Date.now();
  const parsed = def.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Entrada inválida para "${def.slug}": ${detalle}`);
  }
  const input = parsed.data;

  assertScopes(ctx, def.slug, def.scopes);

  // Solo el efecto externo se ejecuta en seco. Leer siempre es de verdad:
  // un simulador que inventa el catálogo no prueba nada.
  const enSeco = ctx.dryRun && def.effect === "write_external";

  try {
    const output = enSeco ? await def.simulate!(ctx, input) : await def.execute(ctx, input);
    options.onInvocation?.({
      slug: def.slug,
      input: redactSecrets(input),
      output: redactSecrets(output),
      simulated: enSeco,
      durationMs: Date.now() - t0,
    });
    return output;
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    options.onInvocation?.({
      slug: def.slug,
      input: redactSecrets(input),
      simulated: enSeco,
      durationMs: Date.now() - t0,
      error: mensaje,
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Adaptador 1 · AI SDK v6
// ---------------------------------------------------------------------------

/**
 * El `ToolContext` llega por `experimental_context` de generateText/streamText,
 * no por el argumento del modelo. Es la mitad del runtime de la regla de
 * aislamiento; la otra mitad es el rechazo de `workspaceId` en el esquema.
 */
export function toAiTool<I, O>(def: ToolDef<I, O>, options: ExecuteOptions = {}): Tool {
  // Se construye el objeto `Tool` directamente en vez de pasar por el helper
  // `tool()`: aquí no hace falta inferencia (el tipo real vive en la ToolDef)
  // y sus sobrecargas no resuelven bien un ZodType genérico.
  const definicion: Tool = {
    description: def.whenToUse ? `${def.description} Úsala ${def.whenToUse}.` : def.description,
    inputSchema: def.inputSchema as FlexibleSchema<unknown>,
    needsApproval: def.sensitive,
    execute: async (input: unknown, callOptions: ToolExecutionOptions) => {
      const ctx = assertToolContext(callOptions.experimental_context, def.slug);
      return executeToolDef(
        def,
        callOptions.abortSignal ? { ...ctx, abortSignal: callOptions.abortSignal } : ctx,
        input,
        options,
      );
    },
  };
  return definicion;
}

export function toAiToolSet(
  defs: readonly ToolDef<never, unknown>[],
  options: ExecuteOptions = {},
): ToolSet {
  const set: ToolSet = {};
  for (const def of defs) set[def.slug] = toAiTool(def, options);
  return set;
}

/** Descriptores para la capa 5 del prompt, derivados de la misma definición. */
export function toPromptContracts(defs: readonly ToolDef<never, unknown>[]) {
  return defs.map((d) => ({
    slug: d.slug,
    label: d.label,
    whenToUse: d.whenToUse ?? d.description,
    requiresApproval: d.sensitive,
  }));
}

// ---------------------------------------------------------------------------
// Adaptador 2 · servidor MCP
// ---------------------------------------------------------------------------

export type McpToolDescriptor = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** JSON Schema derivado del mismo Zod que valida en ejecución. */
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: {
    readonly title: string;
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly openWorldHint: boolean;
  };
};

export function toMcpDescriptor(def: ToolDef<never, unknown>): McpToolDescriptor {
  return {
    name: def.slug,
    title: def.label,
    description: def.whenToUse ? `${def.description} Úsala ${def.whenToUse}.` : def.description,
    inputSchema: z.toJSONSchema(def.inputSchema, { io: "input" }) as Record<string, unknown>,
    annotations: {
      title: def.label,
      readOnlyHint: def.effect === "read",
      destructiveHint: def.effect === "write_external",
      openWorldHint: def.kind === "http" || def.effect === "write_external",
    },
  };
}

export type McpCallResult = {
  readonly content: readonly { type: "text"; text: string }[];
  readonly isError?: boolean;
  readonly structuredContent?: unknown;
};

/**
 * Despachador MCP. Se le pasa cómo obtener el contexto (del entorno del
 * proceso, del token de la sesión…) porque el servidor MCP no lo sabe: lo que
 * no puede pasar nunca es que llegue en los argumentos de la llamada.
 */
export function createMcpDispatcher(
  registry: ToolRegistry,
  getContext: () => ToolContext | Promise<ToolContext>,
  options: ExecuteOptions = {},
) {
  return {
    list(): readonly McpToolDescriptor[] {
      return registry.list().map(toMcpDescriptor);
    },
    async call(name: string, args: unknown): Promise<McpCallResult> {
      try {
        const def = registry.get(name);
        const ctx = await getContext();
        const output = await executeToolDef(def, ctx, args ?? {}, options);
        return {
          content: [{ type: "text", text: JSON.stringify(redactSecrets(output), null, 2) }],
          structuredContent: redactSecrets(output),
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  };
}

/** Lo mínimo que este paquete necesita de un servidor MCP, sin depender de su SDK. */
export type McpServerLike = {
  registerTool(
    name: string,
    config: { title?: string; description?: string; inputSchema?: unknown; annotations?: unknown },
    handler: (args: unknown) => Promise<McpCallResult>,
  ): unknown;
};

export function mountOnMcpServer(
  server: McpServerLike,
  registry: ToolRegistry,
  getContext: () => ToolContext | Promise<ToolContext>,
  options: ExecuteOptions = {},
): void {
  const dispatcher = createMcpDispatcher(registry, getContext, options);
  for (const descriptor of dispatcher.list()) {
    server.registerTool(
      descriptor.name,
      {
        title: descriptor.title,
        description: descriptor.description,
        inputSchema: descriptor.inputSchema,
        annotations: descriptor.annotations,
      },
      (args) => dispatcher.call(descriptor.name, args),
    );
  }
}
