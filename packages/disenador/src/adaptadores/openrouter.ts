/**
 * La cartera de modelos, generando imágenes.
 *
 * Mismo principio que en el resto de Strappy: **el identificador del modelo no
 * está aquí**. Llega ya resuelto desde `model_tiers` (tarea `imagen`), igual
 * que el de texto llega para la tarea `negocio`. Cambiar de modelo o de
 * proveedor es cambiar una fila, no desplegar código.
 *
 * La ruta es la de imágenes de OpenRouter (`/api/v1/images`), que devuelve los
 * bytes en base64. Se eligió sobre la de chat porque no obliga a interpretar un
 * mensaje con partes mezcladas para sacar la imagen.
 *
 * Aviso honesto: esto no se ha probado contra la API real —hacerlo gasta
 * dinero del cliente y la clave vive en el servidor—, así que el primer encargo
 * real es el que lo estrena. Por eso los errores dicen qué pasó en vez de
 * romperse en silencio.
 */
import type { ImagenGenerada, ImagenesPort, Medida } from "../ports.js";

export type OpcionesOpenRouter = {
  /** El modelo, resuelto desde `model_tiers`. Nunca un valor por defecto aquí. */
  readonly modelo: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  /** Cabeceras de atribución, como en el resto de la cartera. */
  readonly referer?: string;
  readonly titulo?: string;
};

type RespuestaImagenes = {
  readonly data?: readonly {
    readonly b64_json?: unknown;
    readonly media_type?: unknown;
    readonly url?: unknown;
  }[];
  readonly error?: { readonly message?: unknown };
};

const BASE_POR_DEFECTO = "https://openrouter.ai/api/v1";

export function crearImagenesOpenRouter(o: OpcionesOpenRouter): ImagenesPort {
  const f = o.fetch ?? globalThis.fetch;
  const base = (o.baseUrl ?? BASE_POR_DEFECTO).replace(/\/+$/, "");
  const timeoutMs = o.timeoutMs ?? 120_000;

  return {
    modelo: o.modelo,
    async generar(input: { prompt: string; medida: Medida }): Promise<ImagenGenerada> {
      const res = await f(`${base}/images`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${o.apiKey}`,
          "content-type": "application/json",
          ...(o.referer ? { "HTTP-Referer": o.referer } : {}),
          ...(o.titulo ? { "X-Title": o.titulo } : {}),
        },
        body: JSON.stringify({
          model: o.modelo,
          prompt: input.prompt,
          n: 1,
          // La medida se pide como texto porque cada proveedor la nombra a su
          // manera; los que no la entienden la ignoran y respetan el prompt,
          // donde también va escrita.
          size: `${input.medida.ancho}x${input.medida.alto}`,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const cuerpo = (await res.json().catch(() => ({}))) as RespuestaImagenes;
      if (!res.ok) {
        const detalle =
          typeof cuerpo.error?.message === "string" ? cuerpo.error.message : `HTTP ${res.status}`;
        throw new Error(`No pude dibujar la imagen: ${detalle}`);
      }

      const primera = cuerpo.data?.[0];
      const base64 = typeof primera?.b64_json === "string" ? primera.b64_json : null;
      if (!base64) {
        throw new Error(
          "El generador de imágenes respondió sin imagen. Si vuelve a pasar, díselo al cliente en el RESUMEN.",
        );
      }
      const mimeType =
        typeof primera?.media_type === "string" && primera.media_type.startsWith("image/")
          ? primera.media_type
          : "image/png";

      return { base64, mimeType, modelo: o.modelo };
    },
  };
}
