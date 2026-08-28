/**
 * Puertos del conocimiento.
 *
 * Ni un nombre de driver ni un cliente concreto: el paquete declara qué
 * necesita y quien lo monta decide con qué. `packages/db` ya expone
 * `searchKnowledge()` sobre la función SQL; el adaptador de la app enchufa esa
 * función aquí. La búsqueda NO se reimplementa en TypeScript.
 */
import type {
  DocumentoCrudo,
  EstadoFuente,
  FilaBusqueda,
  IdCerebro,
  IdFuente,
  TipoFuente,
  IdTrozo,
  Trozo,
  TrozoGuardado,
} from "./types.js";

/** Datos mínimos de un Cerebro que necesita el motor de ingesta. */
export type CerebroRef = {
  readonly id: IdCerebro;
  readonly workspaceId: string;
  readonly nombre: string;
  /** Configuración de texto de Postgres. `spanish` por defecto. */
  readonly idioma: string;
  readonly modeloEmbedding: string;
};

export type FuenteRef = {
  readonly id: IdFuente;
  readonly cerebroId: IdCerebro;
  readonly titulo: string;
  readonly uri: string | null;
  readonly hashContenido: string | null;
  readonly estado: EstadoFuente;
};

/** Trozo a escribir. `embedding` ausente = se conserva el que ya había. */
export type TrozoAEscribir = {
  readonly posicion: number;
  readonly contenido: string;
  readonly hash: string;
  readonly tokens: number;
  readonly embedding?: readonly number[];
  readonly metadata: Readonly<Record<string, unknown>>;
};

/**
 * Plan de escritura del reindexado incremental.
 *
 * `conservar` son trozos que ya existen con el mismo hash: no se tocan y, sobre
 * todo, no se vuelven a incrustar. `eliminar` es todo lo que sobra. Separarlo
 * así es lo que permite que pulsar «Revisar si cambió» sobre 400 URL que no
 * cambiaron cueste cero llamadas al proveedor.
 */
export type PlanEscritura = {
  readonly fuenteId: IdFuente;
  readonly conservar: readonly TrozoGuardado[];
  readonly escribir: readonly TrozoAEscribir[];
  readonly eliminar: readonly string[];
};

export interface ConocimientoDbPort {
  /** Cerebros conectados a un agente (tabla `agent_brains`). */
  cerebrosDeAgente(input: {
    workspaceId: string;
    agentId: string;
  }): Promise<readonly CerebroRef[]>;

  cerebro(input: { workspaceId: string; cerebroId: IdCerebro }): Promise<CerebroRef | null>;

  /** Crea o localiza la fuente por (cerebro, uri) o por título. Devuelve su estado previo. */
  registrarFuente(input: {
    workspaceId: string;
    cerebroId: IdCerebro;
    tipo: TipoFuente;
    titulo: string;
    uri?: string;
    mimeType?: string;
    metadata?: Readonly<Record<string, unknown>>;
  }): Promise<FuenteRef>;

  marcarEstadoFuente(input: {
    workspaceId: string;
    fuenteId: IdFuente;
    estado: EstadoFuente;
    hashContenido?: string | null;
    detalle?: string | null;
    metadata?: Readonly<Record<string, unknown>>;
    indexadoEn?: Date;
  }): Promise<void>;

  /** Hashes de los trozos ya guardados de una fuente. Base del plan incremental. */
  trozosDeFuente(input: {
    workspaceId: string;
    fuenteId: IdFuente;
  }): Promise<readonly TrozoGuardado[]>;

  aplicarPlan(input: { workspaceId: string; plan: PlanEscritura }): Promise<void>;

  /**
   * Llama a `public.search_knowledge(brain_ids, query, qvec, k)`. La fusión
   * híbrida vive en SQL; aquí solo se transporta el resultado.
   */
  buscar(input: {
    workspaceId: string;
    cerebroIds: readonly IdCerebro[];
    /**
     * Texto para la mitad léxica. Llega ya reescrito como `or` de términos:
     * `websearch_to_tsquery` une con AND y una pregunta natural no casaría con
     * nada. Se pasa tal cual al tercer argumento de `search_knowledge`.
     */
    consulta: string;
    /**
     * Vector de la pregunta, o `null` en modo solo texto.
     *
     * `search_knowledge` acepta `qvec = null` sin error: su rama vectorial
     * lleva `and qvec is not null`, así que se queda vacía y la fusión RRF
     * devuelve solo la mitad léxica. Por eso el modo solo texto no necesita ni
     * una línea de SQL nueva: basta con no mandar vector.
     */
    embedding: readonly number[] | null;
    k: number;
    signal?: AbortSignal;
  }): Promise<readonly FilaBusqueda[]>;

  /** Título y URI de cada fuente, para citar en la bandeja. */
  fuentesPorId(input: {
    workspaceId: string;
    ids: readonly IdFuente[];
  }): Promise<ReadonlyMap<IdFuente, { titulo: string; uri: string | null }>>;
}

/**
 * Generación de vectores. Su única implementación real usa `embedMany` del AI
 * SDK; el modelo lo resuelve `ModelTiersPort`, nunca está escrito en el código.
 */
export interface EmbeddingsPort {
  /** Identificador del modelo que se está usando. Se guarda con la fuente. */
  readonly modelo: string;
  /** Orden de salida = orden de entrada. */
  incrustar(textos: readonly string[]): Promise<readonly (readonly number[])[]>;
}

/** Un trozo guardado que todavía no tiene vector. Materia prima del reindexado. */
export type TrozoSinVector = {
  readonly id: IdTrozo;
  readonly fuenteId: IdFuente;
  readonly cerebroId: IdCerebro;
  readonly contenido: string;
};

/**
 * Puerto del reindexado posterior.
 *
 * Va aparte de `ConocimientoDbPort` a propósito: solo hace falta el día que
 * aparezca un proveedor de embeddings, y separarlo permite montarlo entonces
 * sin tocar nada de lo que ya funciona.
 */
export interface RevectorizadoDbPort {
  /** Trozos con `embedding IS NULL`, en lotes. El orden debe ser estable. */
  trozosSinVector(input: {
    workspaceId: string;
    cerebroId?: IdCerebro;
    limite: number;
  }): Promise<readonly TrozoSinVector[]>;

  /** Escribe SOLO el vector (y el modelo en la metadata). No re-trocea nada. */
  guardarVectores(input: {
    workspaceId: string;
    modelo: string;
    vectores: readonly { id: IdTrozo; embedding: readonly number[] }[];
  }): Promise<void>;
}

/** Resuelve el modelo de la tarea `embed` desde `model_tiers`. */
export interface ModelTiersPort {
  resolver(input: {
    tarea: "embed";
    modo?: "lite" | "max";
  }): Promise<{ primary: string; fallbacks: readonly string[] }>;
}

export type RespuestaHttp = {
  readonly status: number;
  readonly finalUrl: string;
  readonly contentType: string;
  readonly body: string;
};

/** Salida HTTP para el rastreo web. Inyectable para poder probar sin red. */
export interface FetchPort {
  obtener(input: { url: string; timeoutMs?: number; signal?: AbortSignal }): Promise<RespuestaHttp>;
}

/**
 * Extracción de binarios (PDF, DOCX). Se deja fuera a propósito: meter un
 * parser de PDF dentro de este paquete lo ata a una librería nativa concreta.
 */
export interface ExtractorDocumentosPort {
  extraer(input: {
    bytes: Uint8Array;
    mimeType: string;
    nombreArchivo: string;
  }): Promise<{ markdown: string; paginas?: number }>;
}

/**
 * Gancho de OCR con visión para PDF escaneados. Sin implementar a propósito:
 * la fuente se marca «conviene revisar» y aquí es donde se enchufará.
 */
export interface OcrPort {
  transcribir(input: {
    bytes: Uint8Array;
    mimeType: string;
    nombreArchivo: string;
  }): Promise<{ markdown: string }>;
}

/**
 * Genera preguntas sintéticas para la verificación posterior a la ingesta.
 * Si no se inyecta, se usa una heurística barata sobre los encabezados.
 */
export interface GeneradorPreguntasPort {
  generar(input: {
    documento: DocumentoCrudo;
    trozos: readonly Trozo[];
    cuantas: number;
  }): Promise<readonly string[]>;
}

/** Últimos turnos del usuario. La consulta se compone con los DOS últimos. */
export interface TurnosPort {
  ultimosTurnosUsuario(input: {
    workspaceId: string;
    conversationId: string;
    cuantos: number;
  }): Promise<readonly string[]>;
}

/** Observabilidad mínima: sin esto, una degradación por timeout es invisible. */
export interface RegistroPort {
  aviso(evento: string, datos?: Readonly<Record<string, unknown>>): void;
}
