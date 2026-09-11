/**
 * El contrato de la pantalla de Conocimiento.
 *
 * Conocimiento NO crea agentes: crea bases de conocimiento (tabla `brains`) y
 * las alimenta con fuentes —un sitio web, archivos, datos pegados— que se
 * trocean e indexan con `@strappy/rag`. Los agentes de WhatsApp las usan a
 * través de `agent_brains`.
 *
 * Este archivo es solo tipos: lo importan tanto el servidor como la interfaz.
 */

/** Cómo lo ve la persona, no cómo lo guarda la base (`pending|indexing|indexed|error|stale`). */
export type EstadoFuente = "pendiente" | "aprendiendo" | "lista" | "revisar" | "error";

/** De dónde salió: `url|sitemap` → web, `file` → archivo, `text|faq|table` → texto. */
export type TipoFuenteVista = "web" | "archivo" | "texto";

export type AgenteVinculado = {
  readonly id: string;
  readonly nombre: string;
};

export type ResumenCerebro = {
  readonly id: string;
  readonly nombre: string;
  readonly descripcion: string | null;
  readonly fuentes: number;
  readonly fragmentos: number;
  /** Fuentes pendientes o aprendiendo ahora mismo. */
  readonly aprendiendo: number;
  /** Fuentes en error o que hay que revisar. */
  readonly conProblemas: number;
  readonly agentes: readonly AgenteVinculado[];
  /** ISO 8601. */
  readonly actualizado: string;
};

export type FuenteVista = {
  readonly id: string;
  readonly tipo: TipoFuenteVista;
  readonly titulo: string;
  readonly uri: string | null;
  /** «PDF», «Word», «Excel», «CSV», «Texto», «Página web»… */
  readonly formato: string | null;
  readonly estado: EstadoFuente;
  /** Explicación legible del error o de por qué hay que revisarla. */
  readonly detalle: string | null;
  readonly fragmentos: number;
  /** ISO 8601. */
  readonly actualizado: string;
};

export type AgenteConectable = {
  readonly id: string;
  readonly nombre: string;
  readonly publicado: boolean;
  readonly conectado: boolean;
};

export type FichaCerebro = ResumenCerebro & {
  readonly fuentesDetalle: readonly FuenteVista[];
  /** Los agentes de WhatsApp del espacio, conectados o no a esta base. */
  readonly agentesDisponibles: readonly AgenteConectable[];
};

export type FragmentoEncontrado = {
  readonly texto: string;
  readonly titulo: string | null;
  readonly fuente: string | null;
  /** 0..1, solo orientativo. */
  readonly puntuacion: number;
};

export type ResultadoAccion<T = undefined> =
  | ({ readonly ok: true } & (T extends undefined ? { readonly datos?: undefined } : { readonly datos: T }))
  | { readonly ok: false; readonly error: string };

/** Respuesta de `POST /api/conocimiento/[id]/archivos` (multipart, campo `archivos`). */
export type RespuestaSubida = {
  readonly recibidos: number;
  readonly rechazados: readonly { readonly nombre: string; readonly motivo: string }[];
};

/** Formatos que acepta la subida. La interfaz los usa para `accept` y para la ayuda. */
export const FORMATOS_ACEPTADOS = [".pdf", ".docx", ".xlsx", ".csv", ".txt", ".md"] as const;

/** Tope por archivo. */
export const TAMANO_MAXIMO_MB = 20;
