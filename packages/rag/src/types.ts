/**
 * Tipos del Cerebro.
 *
 * Vocabulario: de puertas afuera esto es un «Cerebro» con «Documentos» y
 * «pedacitos de información». De puertas adentro son fuentes y trozos con su
 * vector. Los nombres técnicos no salen nunca de este paquete.
 */

export type IdCerebro = string;
export type IdFuente = string;
export type IdTrozo = string;

/** De dónde salió el contenido. Coincide con `brain_sources.kind`. */
export type TipoFuente = "text" | "file" | "url" | "sitemap" | "faq" | "table" | "notion" | "gdrive";

/** Estados de `brain_sources.status`. `stale` = «conviene revisar». */
export type EstadoFuente = "pending" | "indexing" | "indexed" | "error" | "stale";

/**
 * «¿Cuánta información consulta antes de responder?» en la interfaz.
 * Traduce a cuántos trozos se piden y se devuelven.
 */
export type Amplitud = "poca" | "normal" | "mucha";

/** «¿Qué tan exigente es al buscar?» en la interfaz. */
export type Exigencia = "estricto" | "equilibrado" | "amplio";

export type AjustesRecuperacion = {
  readonly amplitud: Amplitud;
  readonly exigencia: Exigencia;
};

export const AJUSTES_POR_DEFECTO: AjustesRecuperacion = {
  amplitud: "normal",
  exigencia: "equilibrado",
};

/** Cuántos trozos finales se devuelven por cada opción de amplitud. */
export const TROZOS_POR_AMPLITUD: Readonly<Record<Amplitud, number>> = {
  poca: 3,
  normal: 5,
  mucha: 8,
};

/**
 * Umbrales por exigencia.
 *
 * `distanciaMaxima` es distancia coseno (0 = idéntico). `fraccionDelMejor`
 * descarta lo que puntúe muy por debajo del mejor resultado: con RRF la
 * puntuación absoluta no significa nada, pero la relativa sí separa «esto
 * responde» de «esto salió porque había que rellenar la lista».
 */
export type UmbralExigencia = {
  readonly distanciaMaxima: number | null;
  readonly fraccionDelMejor: number;
};

export const UMBRALES: Readonly<Record<Exigencia, UmbralExigencia>> = {
  estricto: { distanciaMaxima: 0.45, fraccionDelMejor: 0.6 },
  equilibrado: { distanciaMaxima: 0.62, fraccionDelMejor: 0.35 },
  amplio: { distanciaMaxima: null, fraccionDelMejor: 0.15 },
};

/** Un documento tal como llega antes de trocearse. */
export type DocumentoCrudo = {
  readonly tipo: TipoFuente;
  readonly titulo: string;
  /** URL o nombre de archivo. Sirve de identidad estable de la fuente. */
  readonly uri?: string;
  readonly mimeType?: string;
  /** Markdown ya limpio. Es lo único que se trocea. */
  readonly markdown: string;
  /**
   * El contenido está vacío o es ilegible y hace falta una pasada de OCR.
   * Un PDF escaneado entra por aquí: se indexa igual (sin trozos) pero queda
   * marcado, porque una fuente silenciosamente vacía es el peor fallo posible.
   */
  readonly necesitaOcr?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

/** Un trozo listo para indexar. */
export type Trozo = {
  readonly posicion: number;
  /** Texto que se indexa: lleva la ruta de encabezados antepuesta. */
  readonly contenido: string;
  /** Texto sin la ruta antepuesta. Es lo que se le enseña a una persona. */
  readonly texto: string;
  /** ["Precios", "Plan Pro"] */
  readonly rutaEncabezados: readonly string[];
  readonly tokensEstimados: number;
  /** Hash del contenido indexado. Es la unidad del reindexado incremental. */
  readonly hash: string;
};

/** Trozo ya guardado, tal como lo devuelve el puerto de base de datos. */
export type TrozoGuardado = {
  readonly id: IdTrozo;
  readonly posicion: number;
  readonly hash: string;
};

/** Fila cruda de `search_knowledge`. */
export type FilaBusqueda = {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly brainId: string;
  readonly contenido: string;
  readonly puntuacion: number;
  readonly rangoVectorial: number | null;
  readonly rangoLexico: number | null;
  readonly distancia: number | null;
  readonly metadata: Readonly<Record<string, unknown>>;
};

/** Lo que se le entrega al motor: texto con su fuente citada. */
export type FragmentoRecuperado = {
  readonly title: string;
  readonly text: string;
  readonly source?: string;
  readonly score?: number;
};

/** Resultado de ingerir una fuente. */
export type ResultadoIngesta = {
  readonly fuenteId: IdFuente;
  readonly titulo: string;
  /** True si el contenido no cambió y no se hizo absolutamente nada. */
  readonly sinCambios: boolean;
  readonly trozosTotales: number;
  readonly trozosNuevos: number;
  readonly trozosReutilizados: number;
  readonly trozosEliminados: number;
  /** Llamadas de embedding realmente hechas. En una repetición debe ser 0. */
  readonly textosIncrustados: number;
  readonly estado: EstadoFuente;
  readonly necesitaOcr: boolean;
  readonly aviso?: string;
};

/** Diagnóstico del botón «Pruébalo». */
export type ExplicacionBusqueda = {
  readonly consultaUsada: string;
  readonly ajustes: AjustesRecuperacion;
  readonly cerebrosConsultados: readonly IdCerebro[];
  readonly candidatos: readonly {
    readonly documento: string;
    readonly fuente?: string;
    readonly extracto: string;
    readonly puntuacion: number;
    readonly usado: boolean;
    readonly motivo: string;
  }[];
  readonly degradado: boolean;
  readonly milisegundos: number;
};
