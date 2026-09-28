/**
 * Lectura y diagnóstico.
 */
import type { WpCreds } from "../../ports.js";
import { type WpClientOptions, baseUrl, señal, WpError, wp, exigirOk } from "./http.js";
import { type Renderizado, type WpPostRaw, textoPlano, type WpContent, type WpContentDetalle, type WpMedio, type WpPlugin, type TipoContenido, NOMBRE_TIPO } from "./tipos.js";

export type SaludSitio = {
  readonly ok: boolean;
  readonly writable: boolean;
  readonly siteName?: string;
  readonly error?: string;
};

export async function health(c: WpCreds, o: WpClientOptions = {}): Promise<SaludSitio> {
  const f = o.fetch ?? globalThis.fetch;
  try {
    const pub = await f(`${baseUrl(c)}/wp-json`, { signal: señal(10_000, o.abortSignal) });
    if (!pub.ok) return { ok: false, writable: false, error: `REST API no accesible (${pub.status})` };
    const info = (await pub.json()) as { name?: string };
    // /users/me exige autenticación: es la prueba de que las credenciales sirven.
    const me = await wp(c, o, "/wp/v2/users/me");
    return {
      ok: true,
      writable: me.ok,
      ...(info.name ? { siteName: info.name } : {}),
      ...(me.ok ? {} : { error: `Credenciales inválidas (${me.status})` }),
    };
  } catch (e) {
    return { ok: false, writable: false, error: e instanceof Error ? e.message : "sin conexión" };
  }
}

export async function listarContenido(c: WpCreds, o: WpClientOptions = {}): Promise<WpContent[]> {
  const campos = "id,title,link,status,slug";
  const traer = async (tipo: "pages" | "posts"): Promise<WpPostRaw[]> => {
    const r = await wp(c, o, `/wp/v2/${tipo}?per_page=30&_fields=${campos}`);
    return r.ok ? ((await r.json()) as WpPostRaw[]) : [];
  };
  const [pages, posts] = await Promise.all([traer("pages"), traer("posts")]);
  const map = (arr: WpPostRaw[], tipo: "page" | "post"): WpContent[] =>
    arr.map((p) => ({
      id: p.id,
      tipo,
      titulo: p.title?.rendered ?? p.title?.raw ?? "",
      link: p.link ?? "",
      status: p.status ?? "",
      slug: p.slug ?? "",
    }));
  return [...map(pages, "page"), ...map(posts, "post")];
}

/**
 * WordPress responde `404 rest_post_invalid_id` cuando el id no existe COMO ESE
 * TIPO: una entrada pedida por `/pages/` da el mismo 404 que un id inventado.
 */
export function esIdInexistente(error: unknown): error is WpError {
  return error instanceof WpError && error.status === 404 && error.cuerpo.includes("rest_post_invalid_id");
}

function mensajeIdInexistente(id: number): string {
  return `El id ${id} no existe como página ni como entrada (WordPress respondió 404 rest_post_invalid_id): busca el id correcto con wp_listar_contenido.`;
}

async function existeComo(c: WpCreds, tipo: TipoContenido, id: number, o: WpClientOptions): Promise<boolean> {
  const res = await wp(c, o, `/wp/v2/${tipo}s/${id}?context=edit&_fields=id`);
  try {
    await exigirOk(res, `No pude comprobar si ${id} es ${NOMBRE_TIPO[tipo]}`);
    return true;
  } catch (error) {
    if (esIdInexistente(error)) return false;
    throw error;
  }
}

/** Página primero y, si ahí no existe, entrada. Si no es ninguna, un error que dice qué hacer. */
export async function detectarTipoContenido(
  c: WpCreds,
  id: number,
  o: WpClientOptions = {},
): Promise<TipoContenido> {
  if (await existeComo(c, "page", id, o)) return "page";
  if (await existeComo(c, "post", id, o)) return "post";
  throw new WpError(404, "rest_post_invalid_id", mensajeIdInexistente(id));
}

export async function leerContenido(
  c: WpCreds,
  tipo: TipoContenido,
  id: number,
  o: WpClientOptions = {},
): Promise<WpContentDetalle> {
  const res = await wp(c, o, `/wp/v2/${tipo}s/${id}?context=edit`);
  let p: WpPostRaw;
  try {
    p = (await exigirOk(res, `No pude leer ${tipo} ${id}`)) as WpPostRaw;
  } catch (error) {
    if (!esIdInexistente(error)) throw error;
    // "Invalid post ID" no le dice al modelo qué cambiar, y lo repetía igual
    // doce veces. Se mira si es del otro tipo para decírselo con todas las letras.
    const otro: TipoContenido = tipo === "page" ? "post" : "page";
    const esDelOtro = await existeComo(c, otro, id, o).catch(() => null);
    if (esDelOtro === null) throw error;
    throw new WpError(
      404,
      error.cuerpo,
      esDelOtro
        ? `El id ${id} es ${NOMBRE_TIPO[otro]}, no ${NOMBRE_TIPO[tipo]}: vuelve a llamar con tipo="${otro}".`
        : mensajeIdInexistente(id),
    );
  }
  return {
    id: p.id,
    titulo: p.title?.raw ?? p.title?.rendered ?? "",
    contenido: p.content?.raw ?? p.content?.rendered ?? "",
    link: p.link ?? "",
    slug: p.slug ?? "",
    status: p.status ?? "",
    extracto: textoPlano(p.excerpt),
    imagenDestacada: typeof p.featured_media === "number" ? p.featured_media : 0,
  };
}

/**
 * La biblioteca de medios. Se lee para elegir una imagen destacada del propio
 * negocio: sin ella, la tarjeta de la entrada sale vacía en el listado del blog.
 */
export async function listarMedios(
  c: WpCreds,
  filtro: { buscar?: string | undefined } = {},
  o: WpClientOptions = {},
): Promise<WpMedio[]> {
  const busqueda = filtro.buscar?.trim();
  const res = await wp(
    c,
    o,
    `/wp/v2/media?per_page=30&_fields=id,title,source_url,media_type,mime_type,alt_text${
      busqueda ? `&search=${encodeURIComponent(busqueda)}` : ""
    }`,
  );
  if (!res.ok) return [];
  const lista = (await res.json()) as {
    id: number;
    title?: Renderizado;
    source_url?: string;
    media_type?: string;
    mime_type?: string;
    alt_text?: string;
  }[];
  return lista.map((m) => ({
    id: m.id,
    titulo: textoPlano(m.title),
    url: m.source_url ?? "",
    tipo: m.media_type ?? "",
    mime: m.mime_type ?? "",
    alt: m.alt_text ?? "",
  }));
}

export async function listarPlugins(c: WpCreds, o: WpClientOptions = {}): Promise<WpPlugin[]> {
  const res = await wp(c, o, "/wp/v2/plugins?_fields=plugin,name,status,version");
  if (!res.ok) return [];
  return (await res.json()) as WpPlugin[];
}

export async function leerAjustes(
  c: WpCreds,
  o: WpClientOptions = {},
): Promise<Record<string, unknown>> {
  const res = await wp(c, o, "/wp/v2/settings");
  return (await exigirOk(res, "No pude leer los ajustes")) as Record<string, unknown>;
}

export type WpComentario = {
  readonly id: number;
  readonly author_name: string;
  readonly content: { rendered: string };
  readonly status: string;
  readonly post: number;
};

export async function listarComentarios(
  c: WpCreds,
  estado: string,
  o: WpClientOptions = {},
): Promise<WpComentario[]> {
  const res = await wp(
    c,
    o,
    `/wp/v2/comments?status=${encodeURIComponent(estado)}&per_page=30&_fields=id,author_name,content,status,post`,
  );
  if (!res.ok) return [];
  return (await res.json()) as WpComentario[];
}

export type WpUsuario = {
  readonly id: number;
  readonly name: string;
  readonly email?: string;
  readonly roles?: readonly string[];
};

export async function listarUsuarios(c: WpCreds, o: WpClientOptions = {}): Promise<WpUsuario[]> {
  const res = await wp(c, o, "/wp/v2/users?per_page=50&context=edit&_fields=id,name,email,roles");
  if (!res.ok) return [];
  return (await res.json()) as WpUsuario[];
}
