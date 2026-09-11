/**
 * Embeddings con el AI SDK.
 *
 * El modelo NO está escrito aquí: se resuelve desde `model_tiers` (tarea
 * `embed`), que hoy devuelve `openai/text-embedding-3-small`. Cambiar de
 * modelo tiene que ser un UPDATE en una tabla, no un despliegue. La única
 * constante real del sistema es la dimensión 1536, y esa sí está clavada en el
 * esquema: cambiarla obliga a reindexar todo.
 *
 * El proveedor sí se decide aquí, por configuración (ver `modo.ts`):
 *  · OpenRouter, la cartera del proyecto: protocolo OpenAI contra
 *    `openrouter.ai/api/v1`, con el mismo identificador canónico que guarda la
 *    tabla (`openai/text-embedding-3-small`).
 *  · OpenAI directo: el mismo protocolo sin el prefijo `openai/`.
 *  · Vercel AI Gateway: el identificador tal cual, que es lo que el AI SDK
 *    resuelve contra la pasarela.
 *
 * La clave no sale nunca de este archivo: no se registra y, si aparece en el
 * mensaje de un error del proveedor, se tapa antes de relanzarlo.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embedMany, type EmbeddingModel } from "ai";
import {
  URL_OPENAI,
  URL_OPENROUTER,
  detectarModoConocimiento,
  entornoDelProceso,
  hayProveedorDeEmbeddings,
  proveedorDeEmbeddings,
  type Entorno,
  type ProveedorEmbeddings,
} from "../modo.js";
import type { EmbeddingsPort, ModelTiersPort } from "../ports.js";

export const MODELO_EMBED_POR_DEFECTO = "openai/text-embedding-3-small";
export const DIMENSION_ESPERADA = 1536;

/** Las mismas cabeceras de atribución que usa la cartera del chat (`@strappy/core`). */
const CABECERAS_OPENROUTER: Record<string, string> = {
  "HTTP-Referer": "https://strappy.ai",
  "X-Title": "Strappy",
};

export type OpcionesEmbeddings = {
  /** Entorno a inspeccionar. Por defecto, `process.env`. */
  readonly entorno?: Entorno;
  /** Se consulta una vez y se memoriza: no se pide el modelo por cada lote. */
  readonly modelTiers?: ModelTiersPort;
  readonly modo?: "lite" | "max";
  /** Sustituye la llamada real. Solo para pruebas. */
  readonly embedMany?: typeof embedMany;
  /** `fetch` del proveedor OpenAI-compatible. Solo para pruebas. */
  readonly fetch?: typeof globalThis.fetch;
  readonly maxReintentos?: number;
};

/** De un id canónico de `model_tiers` al modelo que entiende cada proveedor. */
function modeloEjecutable(
  id: string,
  elegido: ReturnType<typeof proveedorDeEmbeddings>,
  fetch: typeof globalThis.fetch | undefined,
): EmbeddingModel {
  if (elegido?.proveedor === "openrouter") {
    return createOpenAICompatible({
      name: "openrouter",
      baseURL: URL_OPENROUTER,
      apiKey: elegido.valor,
      headers: CABECERAS_OPENROUTER,
      ...(fetch ? { fetch } : {}),
    }).embeddingModel(id);
  }
  if (elegido?.proveedor === "openai") {
    return createOpenAICompatible({
      name: "openai",
      baseURL: URL_OPENAI,
      apiKey: elegido.valor,
      ...(fetch ? { fetch } : {}),
    }).embeddingModel(id.replace(/^openai\//, ""));
  }
  // Pasarela de Vercel (o sin proveedor): el AI SDK resuelve la cadena.
  return id;
}

/** Quita la clave de cualquier texto que vaya a salir de aquí. */
function taparClave(texto: string, clave: string | undefined): string {
  return clave ? texto.split(clave).join("***") : texto;
}

export function crearEmbeddings(opciones: OpcionesEmbeddings = {}): EmbeddingsPort & {
  resolverModelo(): Promise<string>;
  readonly proveedor: ProveedorEmbeddings | null;
} {
  const llamar = opciones.embedMany ?? embedMany;
  const elegido = proveedorDeEmbeddings(opciones.entorno ?? entornoDelProceso());
  let modeloResuelto: string | undefined;
  let ejecutable: EmbeddingModel | undefined;

  const resolverModelo = async (): Promise<string> => {
    if (modeloResuelto !== undefined) return modeloResuelto;
    if (!opciones.modelTiers) {
      modeloResuelto = MODELO_EMBED_POR_DEFECTO;
      return modeloResuelto;
    }
    try {
      const fila = await opciones.modelTiers.resolver({
        tarea: "embed",
        ...(opciones.modo ? { modo: opciones.modo } : {}),
      });
      modeloResuelto = fila.primary;
    } catch {
      // Si la tabla no responde, el conocimiento no puede quedarse parado: se
      // usa el modelo de la fila semilla, que es el mismo con el que se indexó.
      modeloResuelto = MODELO_EMBED_POR_DEFECTO;
    }
    return modeloResuelto;
  };

  return {
    get modelo(): string {
      return modeloResuelto ?? MODELO_EMBED_POR_DEFECTO;
    },
    proveedor: elegido?.proveedor ?? null,
    resolverModelo,
    async incrustar(textos: readonly string[]): Promise<readonly (readonly number[])[]> {
      if (textos.length === 0) return [];
      const id = await resolverModelo();
      ejecutable ??= modeloEjecutable(id, elegido, opciones.fetch);

      let embeddings: number[][];
      try {
        ({ embeddings } = await llamar({
          model: ejecutable,
          values: [...textos],
          maxRetries: opciones.maxReintentos ?? 2,
        }));
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error);
        throw new Error(taparClave(`No se pudieron calcular los embeddings (${id}): ${mensaje}`, elegido?.valor));
      }

      const primera = embeddings[0];
      if (primera && primera.length !== DIMENSION_ESPERADA) {
        throw new Error(
          `El modelo «${id}» devuelve vectores de ${primera.length} dimensiones y el índice espera ${DIMENSION_ESPERADA}. ` +
            `Cambiar de modelo de embeddings obliga a reindexar todos los Cerebros.`,
        );
      }
      return embeddings;
    },
  };
}

/**
 * El puerto de embeddings, o `null` si esta instalación no tiene proveedor.
 *
 * Con `null` el Cerebro se monta sin embeddings y trabaja en modo solo texto
 * (ver `modo.ts`). En cuanto hay clave —en producción basta la de OpenRouter,
 * la misma del chat— esta función devuelve un puerto real, la ingesta empieza
 * a vectorizar y `revectorizarPendientes()` rellena lo que se indexó antes.
 */
export function crearEmbeddingsSiHayProveedor(
  opciones: OpcionesEmbeddings = {},
): ReturnType<typeof crearEmbeddings> | null {
  const entorno = opciones.entorno ?? entornoDelProceso();
  return hayProveedorDeEmbeddings(entorno) ? crearEmbeddings(opciones) : null;
}

/** Diagnóstico del modo tal como lo ve este adaptador. Útil para registrarlo. */
export function diagnosticoEmbeddings(entorno?: Entorno): ReturnType<
  typeof detectarModoConocimiento
> {
  return entorno ? detectarModoConocimiento(entorno) : detectarModoConocimiento();
}
