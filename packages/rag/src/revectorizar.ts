/**
 * Reindexado posterior: poner vector a lo que se indexó en modo solo texto.
 *
 * POR QUÉ EXISTE: los Cerebros ingeridos sin proveedor de embeddings quedan
 * completos y buscables por palabras, pero sin vector. El día que aparezca una
 * clave (`OPENAI_API_KEY`) hay dos caminos: volver a descargar, trocear e
 * ingerir el conocimiento de todos los clientes, o recorrer los trozos con
 * `embedding IS NULL` y vectorizarlos donde están. Esto es lo segundo. Es la
 * diferencia entre encender la búsqueda por significado en un minuto y rehacer
 * la ingesta entera.
 *
 * No trocea, no descarga, no toca el contenido ni el hash: solo escribe el
 * vector que faltaba. Un trozo que ya lo tiene no se mira siquiera.
 */
import { incrustarPorLotes, LOTE_EMBEDDINGS } from "./indexar.js";
import type { EmbeddingsPort, RegistroPort, RevectorizadoDbPort } from "./ports.js";
import type { IdCerebro } from "./types.js";

export type DepsRevectorizado = {
  readonly db: RevectorizadoDbPort;
  readonly embeddings: EmbeddingsPort;
  readonly registro?: RegistroPort;
};

export type ResultadoRevectorizado = {
  /** Trozos que tenían `embedding IS NULL` y ahora tienen vector. */
  readonly trozosVectorizados: number;
  readonly lotes: number;
  readonly modelo: string;
  /** Quedan más pendientes: hay que volver a llamar. */
  readonly quedanPendientes: boolean;
  readonly aviso?: string;
};

/**
 * Vectoriza los trozos pendientes de un espacio (o de un solo Cerebro).
 *
 * `maximo` acota el trabajo de una llamada: esto se ejecuta en segundo plano y
 * no debe monopolizar ni el proceso ni la cuota del proveedor. Si al terminar
 * `quedanPendientes` es true, basta con volver a llamarlo.
 */
export async function revectorizarPendientes(
  deps: DepsRevectorizado,
  input: {
    workspaceId: string;
    cerebroId?: IdCerebro;
    /** Tope de trozos en esta pasada. */
    maximo?: number;
    loteEmbeddings?: number;
  },
): Promise<ResultadoRevectorizado> {
  const tamañoLote = input.loteEmbeddings ?? LOTE_EMBEDDINGS;
  const maximo = input.maximo ?? tamañoLote * 10;
  const modelo = deps.embeddings.modelo;

  let vectorizados = 0;
  let lotes = 0;
  let quedanPendientes = false;

  while (vectorizados < maximo) {
    const pedir = Math.min(tamañoLote, maximo - vectorizados);
    const pendientes = await deps.db.trozosSinVector({
      workspaceId: input.workspaceId,
      ...(input.cerebroId ? { cerebroId: input.cerebroId } : {}),
      limite: pedir,
    });
    if (pendientes.length === 0) break;

    const vectores = await incrustarPorLotes(
      deps.embeddings,
      pendientes.map((t) => t.contenido),
      tamañoLote,
    );

    // Si el proveedor devolviera de menos, se escribe solo lo que casó: dejar
    // trozos sin vector es recuperable —vuelven a salir en la siguiente
    // pasada—; escribir el vector equivocado en el trozo equivocado no lo es.
    const aEscribir = pendientes.flatMap((trozo, i) => {
      const embedding = vectores[i];
      return embedding ? [{ id: trozo.id, embedding }] : [];
    });

    await deps.db.guardarVectores({
      workspaceId: input.workspaceId,
      modelo: deps.embeddings.modelo,
      vectores: aEscribir,
    });

    vectorizados += aEscribir.length;
    lotes += 1;
    deps.registro?.aviso("conocimiento.revectorizado_lote", {
      workspaceId: input.workspaceId,
      trozos: aEscribir.length,
      modelo,
    });

    // Menos trozos de los pedidos = ya no queda nada pendiente.
    if (pendientes.length < pedir) break;
    quedanPendientes = vectorizados >= maximo;
  }

  return {
    trozosVectorizados: vectorizados,
    lotes,
    modelo,
    quedanPendientes,
    ...(vectorizados === 0
      ? { aviso: "No había contenido pendiente de completar: todo el conocimiento ya está indexado." }
      : {}),
  };
}
