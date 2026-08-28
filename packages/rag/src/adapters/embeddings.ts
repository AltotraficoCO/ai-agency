/**
 * Embeddings con el AI SDK a través del AI Gateway.
 *
 * El modelo NO está escrito aquí: se resuelve desde `model_tiers` (tarea
 * `embed`), que hoy devuelve `openai/text-embedding-3-small`. Cambiar de
 * proveedor tiene que ser un UPDATE en una tabla, no un despliegue. La única
 * constante real del sistema es la dimensión 1536, y esa sí está clavada en el
 * esquema: cambiarla obliga a reindexar todo.
 */
import { embedMany } from "ai";
import type { EmbeddingsPort, ModelTiersPort } from "../ports.js";

export const MODELO_EMBED_POR_DEFECTO = "openai/text-embedding-3-small";
export const DIMENSION_ESPERADA = 1536;

export type OpcionesEmbeddings = {
  /** Se consulta una vez y se memoriza: no se pide el modelo por cada lote. */
  readonly modelTiers?: ModelTiersPort;
  readonly modo?: "lite" | "max";
  /** Sustituye la llamada real. Solo para pruebas. */
  readonly embedMany?: typeof embedMany;
  readonly maxReintentos?: number;
};

export function crearEmbeddings(opciones: OpcionesEmbeddings = {}): EmbeddingsPort & {
  resolverModelo(): Promise<string>;
} {
  const llamar = opciones.embedMany ?? embedMany;
  let modeloResuelto: string | undefined;

  const resolverModelo = async (): Promise<string> => {
    if (modeloResuelto !== undefined) return modeloResuelto;
    if (!opciones.modelTiers) {
      modeloResuelto = MODELO_EMBED_POR_DEFECTO;
      return modeloResuelto;
    }
    try {
      const elegido = await opciones.modelTiers.resolver({
        tarea: "embed",
        ...(opciones.modo ? { modo: opciones.modo } : {}),
      });
      modeloResuelto = elegido.primary;
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
    resolverModelo,
    async incrustar(textos: readonly string[]): Promise<readonly (readonly number[])[]> {
      if (textos.length === 0) return [];
      const model = await resolverModelo();
      const { embeddings } = await llamar({
        model,
        values: [...textos],
        maxRetries: opciones.maxReintentos ?? 2,
      });
      const primera = embeddings[0];
      if (primera && primera.length !== DIMENSION_ESPERADA) {
        throw new Error(
          `El modelo «${model}» devuelve vectores de ${primera.length} dimensiones y el índice espera ${DIMENSION_ESPERADA}. ` +
            `Cambiar de modelo de embeddings obliga a reindexar todos los Cerebros.`,
        );
      }
      return embeddings;
    },
  };
}
