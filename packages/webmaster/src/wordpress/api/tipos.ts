/**
 * Formas de la API que usamos. Solo los campos que leemos.
 */


export type Renderizado = { rendered?: string; raw?: string };

export type WpPostRaw = {
  id: number;
  title?: Renderizado;
  content?: Renderizado;
  excerpt?: Renderizado;
  featured_media?: number;
  link?: string;
  status?: string;
  slug?: string;
  meta?: Record<string, unknown>;
};

/** El texto de un campo renderizado, sin etiquetas: `excerpt` viene con `<p>`. */
export function textoPlano(r: Renderizado | undefined): string {
  const crudo = r?.raw ?? r?.rendered ?? "";
  return crudo
    .replace(/<[^>]*>/g, " ")
    .replace(/&(nbsp|#160);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type WpContent = {
  readonly id: number;
  readonly tipo: "page" | "post";
  readonly titulo: string;
  readonly link: string;
  readonly status: string;
  readonly slug: string;
};

export type WpContentDetalle = {
  readonly id: number;
  readonly titulo: string;
  readonly contenido: string;
  readonly link: string;
  readonly slug: string;
  readonly status: string;
  /** `excerpt` sin etiquetas. Es de lo que vive la tarjeta del listado del blog. */
  readonly extracto: string;
  /** `featured_media`: 0 cuando no tiene imagen destacada. */
  readonly imagenDestacada: number;
};

export type WpMedio = {
  readonly id: number;
  readonly titulo: string;
  readonly url: string;
  readonly tipo: string;
  readonly mime: string;
  readonly alt: string;
};

export type WpPlugin = {
  readonly plugin: string;
  readonly name: string;
  readonly status: string;
  readonly version: string;
};

export type TipoContenido = "page" | "post";

export const NOMBRE_TIPO: Readonly<Record<TipoContenido, string>> = {
  page: "una página",
  post: "una entrada (post)",
};
