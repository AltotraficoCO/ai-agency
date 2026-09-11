/**
 * Modo del conocimiento: «completo» o «solo texto».
 *
 * POR QUÉ EXISTE ESTE ARCHIVO (no es un apaño, no lo borres):
 *
 * Buscar por significado necesita un proveedor de embeddings. La cartera de
 * modelos del proyecto es OpenRouter, y OpenRouter SÍ los sirve
 * (`POST /api/v1/embeddings`, mismo protocolo que OpenAI): con la clave que ya
 * usa el chat, el conocimiento funciona en modo completo sin configurar nada
 * más. Probado contra `openai/text-embedding-3-small`: 1536 dimensiones.
 *
 * Aun así, una instalación puede no tener ninguna clave (desarrollo, un
 * despliegue a medio configurar). Entonces no se apaga el conocimiento: se
 * apaga SOLO la mitad semántica. La mitad léxica (`to_tsvector` + `ts_rank_cd`
 * en español) es gratis y encuentra nombres de producto, precios y referencias
 * literales. Ese modo solo texto se decide ANTES de intentar nada —no por
 * atrapar un 401— y se dice.
 *
 * Proveedores, por orden:
 *  1. OpenRouter (`OPENROUTER_API_KEY`), si la cartera es OpenRouter, que es la
 *     de por defecto (`MODEL_WALLET`).
 *  2. OpenAI directo (`OPENAI_API_KEY`).
 *  3. Vercel AI Gateway (`AI_GATEWAY_API_KEY`).
 *
 * Los embeddings de `text-embedding-3-small` cuestan 0,02 USD por millón de
 * tokens: indexar el catálogo entero de un cliente cuesta céntimos.
 */

export type ModoConocimiento = "completo" | "solo-texto";

export type ProveedorEmbeddings = "openrouter" | "openai" | "pasarela";

/** Variables que habilitan el modo completo. El orden real lo decide `proveedorDeEmbeddings`. */
export const VARIABLES_DE_EMBEDDINGS = ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "AI_GATEWAY_API_KEY"] as const;

export const URL_OPENROUTER = "https://openrouter.ai/api/v1";
export const URL_OPENAI = "https://api.openai.com/v1";

export type Entorno = Readonly<Record<string, string | undefined>>;

export type DiagnosticoModo = {
  readonly modo: ModoConocimiento;
  /** Qué variable de entorno habilitó el modo completo, si alguna. */
  readonly variable: string | null;
  /** Qué proveedor vectoriza, si alguno. */
  readonly proveedor: ProveedorEmbeddings | null;
  /** Explicación técnica, para registros y para la consola. */
  readonly motivo: string;
  /** Explicación para el cliente, sin una sola palabra de jerga. */
  readonly explicacion: string;
};

/**
 * Lee `process.env` sin depender de los tipos de Node: este paquete se compila
 * con `lib: ES2023` a secas y no debe arrastrar `@types/node`.
 */
export function entornoDelProceso(): Entorno {
  const global = globalThis as { process?: { env?: Entorno } };
  return global.process?.env ?? {};
}

function valorNoVacio(entorno: Entorno, clave: string): string | null {
  const valor = entorno[clave];
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/**
 * El proveedor de embeddings de esta instalación, o `null` si no hay ninguno.
 *
 * La cartera manda: con `MODEL_WALLET=vercel-gateway` la clave de OpenRouter no
 * se usa para vectorizar, igual que no se usa para conversar.
 */
export function proveedorDeEmbeddings(entorno: Entorno = entornoDelProceso()): {
  proveedor: ProveedorEmbeddings;
  variable: (typeof VARIABLES_DE_EMBEDDINGS)[number];
  valor: string;
} | null {
  const cartera = valorNoVacio(entorno, "MODEL_WALLET") ?? "openrouter";

  const openrouter = valorNoVacio(entorno, "OPENROUTER_API_KEY");
  if (cartera === "openrouter" && openrouter) {
    return { proveedor: "openrouter", variable: "OPENROUTER_API_KEY", valor: openrouter };
  }
  const openai = valorNoVacio(entorno, "OPENAI_API_KEY");
  if (openai) return { proveedor: "openai", variable: "OPENAI_API_KEY", valor: openai };
  const pasarela = valorNoVacio(entorno, "AI_GATEWAY_API_KEY");
  if (pasarela) return { proveedor: "pasarela", variable: "AI_GATEWAY_API_KEY", valor: pasarela };
  return null;
}

/** Primera variable de embeddings utilizable, o `null` si no hay ninguna. */
export function claveDeEmbeddings(entorno: Entorno = entornoDelProceso()): {
  variable: string;
  valor: string;
} | null {
  const elegido = proveedorDeEmbeddings(entorno);
  return elegido ? { variable: elegido.variable, valor: elegido.valor } : null;
}

/**
 * ¿Hay proveedor de embeddings? Es la única pregunta que decide el modo, y se
 * hace ANTES de intentar nada: el modo solo texto es una decisión, no el
 * resultado de atrapar un 401.
 */
export function hayProveedorDeEmbeddings(entorno: Entorno = entornoDelProceso()): boolean {
  return proveedorDeEmbeddings(entorno) !== null;
}

/** Texto para el cliente. Prohibido: «embedding», «vector», «similitud coseno». */
export function explicacionDelModo(modo: ModoConocimiento): string {
  return modo === "completo"
    ? "El cerebro entiende el significado de la pregunta: encuentra la respuesta aunque esté escrita con otras palabras."
    : "El cerebro está buscando por coincidencia de palabras, no por significado. " +
        "Acierta cuando la pregunta usa las mismas palabras que tus documentos: nombres de producto, precios y referencias exactas. " +
        "Puede no encontrar nada si la misma cosa se pregunta de otra manera.";
}

const NOMBRE_PROVEEDOR: Record<ProveedorEmbeddings, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  pasarela: "Vercel AI Gateway",
};

export function detectarModoConocimiento(entorno: Entorno = entornoDelProceso()): DiagnosticoModo {
  const elegido = proveedorDeEmbeddings(entorno);
  if (elegido) {
    return {
      modo: "completo",
      variable: elegido.variable,
      proveedor: elegido.proveedor,
      motivo: `Hay proveedor de embeddings: ${NOMBRE_PROVEEDOR[elegido.proveedor]} (${elegido.variable}). Búsqueda por significado y por palabras.`,
      explicacion: explicacionDelModo("completo"),
    };
  }
  return {
    modo: "solo-texto",
    variable: null,
    proveedor: null,
    motivo:
      `No hay proveedor de embeddings (falta ${VARIABLES_DE_EMBEDDINGS.join(", ")}). ` +
      "Modo solo texto: se indexa y se busca únicamente por coincidencia de palabras. " +
      "Con OPENROUTER_API_KEY (la cartera de modelos) u OPENAI_API_KEY el modo completo se activa sin tocar código, " +
      "y lo ya indexado se completa sin reingerir.",
    explicacion: explicacionDelModo("solo-texto"),
  };
}

/**
 * Modo efectivo de una operación concreta.
 *
 * Quien monta el sistema decide inyectando o no el puerto de embeddings, y esa
 * ausencia se respeta tal cual: sin proveedor, solo texto. `forzarSoloTexto`
 * existe para las pruebas y para poder apagar la mitad semántica a mano.
 */
export function modoEfectivo(input: {
  embeddings?: unknown;
  forzarSoloTexto?: boolean;
}): ModoConocimiento {
  if (input.forzarSoloTexto === true) return "solo-texto";
  return input.embeddings ? "completo" : "solo-texto";
}
