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
import {
  detectarModoConocimiento,
  hayProveedorDeEmbeddings,
  type Entorno,
} from "../modo.js";
import type { EmbeddingsPort, ModelTiersPort } from "../ports.js";

export const MODELO_EMBED_POR_DEFECTO = "openai/text-embedding-3-small";
export const DIMENSION_ESPERADA = 1536;

export type OpcionesEmbeddings = {
  /** Entorno a inspeccionar. Por defecto, `process.env`. */
  readonly entorno?: Entorno;
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

/**
 * El gancho para encender el modo completo sin tocar código.
 *
 * Devuelve `null` cuando no hay clave de embeddings, y entonces el Cerebro se
 * monta sin proveedor y trabaja en modo solo texto (ver `modo.ts`: la cartera
 * del proyecto es OpenRouter y OpenRouter no tiene endpoint de embeddings).
 * El día que se ponga `OPENAI_API_KEY` esta misma función devuelve un puerto
 * real, la ingesta empieza a vectorizar y `completarPendientes()` rellena lo
 * anterior. Nada más que cambiar: ni un despliegue de código, ni una migración.
 *
 * `text-embedding-3-small` cuesta 0,02 USD por millón de tokens: indexar el
 * catálogo entero de un cliente cuesta céntimos.
 */
export function crearEmbeddingsSiHayProveedor(
  opciones: OpcionesEmbeddings = {},
): (EmbeddingsPort & { resolverModelo(): Promise<string> }) | null {
  const entorno = opciones.entorno;
  const hay = entorno ? hayProveedorDeEmbeddings(entorno) : hayProveedorDeEmbeddings();
  return hay ? crearEmbeddings(opciones) : null;
}

/** Diagnóstico del modo tal como lo ve este adaptador. Útil para registrarlo. */
export function diagnosticoEmbeddings(entorno?: Entorno): ReturnType<
  typeof detectarModoConocimiento
> {
  return entorno ? detectarModoConocimiento(entorno) : detectarModoConocimiento();
}
