/**
 * Dobles de prueba: una base de datos en memoria y un proveedor de embeddings
 * que cuenta cuántos textos ha incrustado. Ese contador es la prueba de que el
 * reindexado incremental hace lo que promete.
 */
import type {
  ConocimientoDbPort,
  EmbeddingsPort,
  FetchPort,
  PlanEscritura,
  RespuestaHttp,
  RevectorizadoDbPort,
  TrozoSinVector,
} from "../src/ports.js";
import type { FilaBusqueda } from "../src/types.js";

type FilaFuente = {
  id: string;
  cerebroId: string;
  titulo: string;
  uri: string | null;
  hashContenido: string | null;
  estado: "pending" | "indexing" | "indexed" | "error" | "stale";
  detalle: string | null;
  metadata: Record<string, unknown>;
};

type FilaTrozo = {
  id: string;
  fuenteId: string;
  posicion: number;
  hash: string;
  contenido: string;
  /** `null` = indexado en modo solo texto. Es exactamente lo que hay en la tabla. */
  embedding: readonly number[] | null;
  metadata: Record<string, unknown>;
};

export class DbFalsa implements ConocimientoDbPort, RevectorizadoDbPort {
  readonly fuentes = new Map<string, FilaFuente>();
  readonly trozos = new Map<string, FilaTrozo>();
  private secuencia = 0;
  /** Se puede sustituir para simular latencia o error en la búsqueda. */
  respuestaBusqueda: (input: {
    consulta: string;
    k: number;
    embedding: readonly number[] | null;
  }) => Promise<readonly FilaBusqueda[]> = async () => [];
  /** Vectores tal como llegaron a `search_knowledge`, en orden de llamada. */
  readonly vectoresRecibidos: (readonly number[] | null)[] = [];
  /** Modelos con los que se completaron trozos pendientes. */
  readonly modelosDeRevectorizado: string[] = [];

  async cerebrosDeAgente(): Promise<readonly { id: string; workspaceId: string; nombre: string; idioma: string; modeloEmbedding: string }[]> {
    return [{ id: "cerebro-1", workspaceId: "ws", nombre: "Cerebro", idioma: "spanish", modeloEmbedding: "openai/text-embedding-3-small" }];
  }

  async cerebro(): Promise<null> {
    return null;
  }

  async registrarFuente(input: {
    cerebroId: string;
    titulo: string;
    uri?: string;
  }): Promise<{ id: string; cerebroId: string; titulo: string; uri: string | null; hashContenido: string | null; estado: FilaFuente["estado"] }> {
    const clave = `${input.cerebroId}::${input.uri ?? input.titulo}`;
    const existente = [...this.fuentes.values()].find(
      (f) => `${f.cerebroId}::${f.uri ?? f.titulo}` === clave,
    );
    if (existente) return { ...existente };
    this.secuencia += 1;
    const fila: FilaFuente = {
      id: `fuente-${this.secuencia}`,
      cerebroId: input.cerebroId,
      titulo: input.titulo,
      uri: input.uri ?? null,
      hashContenido: null,
      estado: "pending",
      detalle: null,
      metadata: {},
    };
    this.fuentes.set(fila.id, fila);
    return { ...fila };
  }

  async marcarEstadoFuente(input: {
    fuenteId: string;
    estado: FilaFuente["estado"];
    hashContenido?: string | null;
    detalle?: string | null;
    metadata?: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    const fila = this.fuentes.get(input.fuenteId);
    if (!fila) throw new Error(`fuente desconocida ${input.fuenteId}`);
    fila.estado = input.estado;
    if (input.hashContenido !== undefined) fila.hashContenido = input.hashContenido;
    if (input.detalle !== undefined) fila.detalle = input.detalle;
    if (input.metadata) fila.metadata = { ...fila.metadata, ...input.metadata };
  }

  async trozosDeFuente(input: { fuenteId: string }): Promise<readonly { id: string; posicion: number; hash: string }[]> {
    return [...this.trozos.values()]
      .filter((t) => t.fuenteId === input.fuenteId)
      .sort((a, b) => a.posicion - b.posicion)
      .map((t) => ({ id: t.id, posicion: t.posicion, hash: t.hash }));
  }

  async aplicarPlan(input: { plan: PlanEscritura }): Promise<void> {
    const { plan } = input;
    for (const id of plan.eliminar) this.trozos.delete(id);
    for (const conservado of plan.conservar) {
      const fila = this.trozos.get(conservado.id);
      if (fila) fila.posicion = conservado.posicion;
    }
    for (const nuevo of plan.escribir) {
      this.secuencia += 1;
      const id = `trozo-${this.secuencia}`;
      this.trozos.set(id, {
        id,
        fuenteId: plan.fuenteId,
        posicion: nuevo.posicion,
        hash: nuevo.hash,
        contenido: nuevo.contenido,
        embedding: nuevo.embedding ?? null,
        metadata: { ...nuevo.metadata },
      });
    }
  }

  async buscar(input: {
    consulta: string;
    k: number;
    embedding: readonly number[] | null;
  }): Promise<readonly FilaBusqueda[]> {
    this.vectoresRecibidos.push(input.embedding);
    return this.respuestaBusqueda({ consulta: input.consulta, k: input.k, embedding: input.embedding });
  }

  async trozosSinVector(input: { limite: number }): Promise<readonly TrozoSinVector[]> {
    return [...this.trozos.values()]
      .filter((t) => t.embedding === null)
      .sort((a, b) => a.posicion - b.posicion)
      .slice(0, input.limite)
      .map((t) => ({
        id: t.id,
        fuenteId: t.fuenteId,
        cerebroId: "cerebro-1",
        contenido: t.contenido,
      }));
  }

  async guardarVectores(input: {
    modelo: string;
    vectores: readonly { id: string; embedding: readonly number[] }[];
  }): Promise<void> {
    this.modelosDeRevectorizado.push(input.modelo);
    for (const v of input.vectores) {
      const fila = this.trozos.get(v.id);
      if (!fila) throw new Error(`trozo desconocido ${v.id}`);
      fila.embedding = v.embedding;
      fila.metadata = { ...fila.metadata, modelo: input.modelo, sinVectorizar: false };
    }
  }

  async fuentesPorId(input: { ids: readonly string[] }): Promise<ReadonlyMap<string, { titulo: string; uri: string | null }>> {
    const salida = new Map<string, { titulo: string; uri: string | null }>();
    for (const id of input.ids) {
      const f = this.fuentes.get(id);
      if (f) salida.set(id, { titulo: f.titulo, uri: f.uri });
    }
    return salida;
  }
}

export class EmbeddingsFalsos implements EmbeddingsPort {
  readonly modelo = "modelo-de-prueba";
  /** Cuántos textos se han incrustado en total. Debe ser 0 al reindexar igual. */
  textosIncrustados = 0;
  llamadas = 0;
  retraso = 0;

  async incrustar(textos: readonly string[]): Promise<readonly (readonly number[])[]> {
    this.llamadas += 1;
    this.textosIncrustados += textos.length;
    if (this.retraso > 0) await new Promise((r) => setTimeout(r, this.retraso));
    // Vector determinista y estable por texto: no hace falta que signifique nada.
    return textos.map((t) => {
      const v = new Array<number>(8).fill(0);
      for (let i = 0; i < t.length; i++) {
        const idx = t.charCodeAt(i) % 8;
        v[idx] = (v[idx] ?? 0) + 1;
      }
      return v;
    });
  }
}

export function fetchFalso(paginas: Readonly<Record<string, { body: string; contentType?: string; status?: number }>>): FetchPort & { pedidas: string[] } {
  const pedidas: string[] = [];
  return {
    pedidas,
    async obtener(input): Promise<RespuestaHttp> {
      pedidas.push(input.url);
      const pagina = paginas[input.url];
      if (!pagina) return { status: 404, finalUrl: input.url, contentType: "text/html", body: "" };
      return {
        status: pagina.status ?? 200,
        finalUrl: input.url,
        contentType: pagina.contentType ?? "text/html; charset=utf-8",
        body: pagina.body,
      };
    },
  };
}

export function filaBusqueda(parcial: Partial<FilaBusqueda> & { chunkId: string }): FilaBusqueda {
  return {
    sourceId: "fuente-1",
    brainId: "cerebro-1",
    contenido: "contenido",
    puntuacion: 0.03,
    rangoVectorial: 1,
    rangoLexico: null,
    distancia: 0.2,
    metadata: {},
    ...parcial,
  };
}
