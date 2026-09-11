/**
 * Cliente de la REST API de WordPress con contraseñas de aplicación.
 *
 * Portado del proyecto anterior (`apps/worker/src/lib/wordpress.ts`), que ya
 * funciona en producción. Los cambios respecto al original son tres:
 *
 *  1. `fetch` es inyectable. Sin eso no se puede probar nada sin un WordPress
 *     de verdad delante, y un agente que solo se prueba a mano no se prueba.
 *  2. Tipos estrictos en las respuestas: el original leía `p.title?.rendered`
 *     sobre `any`, y un cambio de forma de la API se manifestaba como
 *     `undefined` en el contenido del cliente en vez de como un error.
 *  3. Los errores llevan siempre el cuerpo recortado de la respuesta: es lo
 *     único que permite entender un 403 de WordPress sin entrar al servidor.
 */
import type { WpCreds } from "../ports.js";

export type { WpCreds };

type Fetch = typeof globalThis.fetch;

export type WpClientOptions = {
  readonly fetch?: Fetch;
  readonly abortSignal?: AbortSignal;
};

export function baseUrl(c: WpCreds): string {
  const u = c.url.replace(/\/+$/, "");
  return u.startsWith("http") ? u : `https://${u}`;
}

function authHeader(c: WpCreds): string {
  return `Basic ${Buffer.from(`${c.user}:${c.appPassword}`).toString("base64")}`;
}

/** Une la señal externa (timeout duro de la tarea) con la del propio timeout. */
function señal(timeoutMs: number, externa?: AbortSignal): AbortSignal {
  const propia = AbortSignal.timeout(timeoutMs);
  return externa ? AbortSignal.any([propia, externa]) : propia;
}

export class WpError extends Error {
  constructor(
    readonly status: number,
    readonly cuerpo: string,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "WpError";
  }
}

async function wp(
  c: WpCreds,
  o: WpClientOptions,
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const f = o.fetch ?? globalThis.fetch;
  return f(`${baseUrl(c)}/wp-json${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(c),
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: señal(timeoutMs, o.abortSignal),
  });
}

async function exigirOk(res: Response, contexto: string): Promise<unknown> {
  if (res.ok) return res.status === 204 ? null : await res.json();
  const cuerpo = (await res.text()).slice(0, 300);
  throw new WpError(res.status, cuerpo, `${contexto} (${res.status}): ${cuerpo}`);
}

// ---------------------------------------------------------------------------
// Formas de la API que usamos. Solo los campos que leemos.
// ---------------------------------------------------------------------------

type Renderizado = { rendered?: string; raw?: string };

type WpPostRaw = {
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
function textoPlano(r: Renderizado | undefined): string {
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

// ---------------------------------------------------------------------------
// API propia del conector (plugin de WordPress). Devuelve null si no está.
// ---------------------------------------------------------------------------

async function conectorApi(
  c: WpCreds,
  o: WpClientOptions,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown> | null> {
  const f = o.fetch ?? globalThis.fetch;
  try {
    const res = await f(`${baseUrl(c)}/wp-json/strappy/v1${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: authHeader(c), "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: señal(30_000, o.abortSignal),
    });
    if (res.status === 404) return null; // el plugin conector no está instalado
    if (!res.ok) {
      throw new WpError(
        res.status,
        "",
        `strappy/v1${path} (${res.status}): ${(await res.text()).slice(0, 200)}`,
      );
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    // Solo se propaga el fallo del propio conector; que no exista es normal.
    if (e instanceof WpError) throw e;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lectura y diagnóstico
// ---------------------------------------------------------------------------

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

export type TipoContenido = "page" | "post";

const NOMBRE_TIPO: Readonly<Record<TipoContenido, string>> = {
  page: "una página",
  post: "una entrada (post)",
};

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

// ---------------------------------------------------------------------------
// Mutaciones
// ---------------------------------------------------------------------------

export async function actualizarContenido(
  c: WpCreds,
  tipo: "page" | "post",
  id: number,
  cambios: {
    titulo?: string;
    contenido?: string;
    status?: string;
    extracto?: string;
    imagenDestacadaId?: number;
  },
  o: WpClientOptions = {},
): Promise<{ id: number; titulo: string; link: string }> {
  const body: Record<string, string | number> = {};
  if (cambios.titulo !== undefined) body.title = cambios.titulo;
  if (cambios.contenido !== undefined) body.content = cambios.contenido;
  if (cambios.status !== undefined) body.status = cambios.status;
  // Solo van las claves que se piden: mandar `excerpt: ""` borraría el que había.
  if (cambios.extracto !== undefined) body.excerpt = cambios.extracto;
  if (cambios.imagenDestacadaId !== undefined) body.featured_media = cambios.imagenDestacadaId;
  const res = await wp(c, o, `/wp/v2/${tipo}s/${id}`, { method: "POST", body: JSON.stringify(body) });
  const p = (await exigirOk(res, "Fallo al actualizar")) as WpPostRaw;
  return { id: p.id, titulo: p.title?.rendered ?? p.title?.raw ?? "", link: p.link ?? "" };
}

export async function crearContenido(
  c: WpCreds,
  tipo: "page" | "post",
  datos: {
    titulo: string;
    contenido: string;
    status?: "publish" | "draft";
    extracto?: string;
    imagenDestacadaId?: number;
  },
  o: WpClientOptions = {},
): Promise<{ id: number; link: string; status: string }> {
  const res = await wp(c, o, `/wp/v2/${tipo}s`, {
    method: "POST",
    body: JSON.stringify({
      title: datos.titulo,
      content: datos.contenido,
      status: datos.status ?? "publish",
      ...(datos.extracto !== undefined ? { excerpt: datos.extracto } : {}),
      ...(datos.imagenDestacadaId !== undefined ? { featured_media: datos.imagenDestacadaId } : {}),
    }),
  });
  const p = (await exigirOk(res, `Fallo al crear ${tipo}`)) as WpPostRaw;
  return { id: p.id, link: p.link ?? "", status: p.status ?? "" };
}

/** Envía a la papelera. Recuperable: `restaurarContenido` lo revive. */
export async function borrarContenido(
  c: WpCreds,
  tipo: "page" | "post",
  id: number,
  o: WpClientOptions = {},
): Promise<{ id: number }> {
  const res = await wp(c, o, `/wp/v2/${tipo}s/${id}`, { method: "DELETE" });
  await exigirOk(res, `Fallo al borrar ${tipo} ${id}`);
  return { id };
}

export async function restaurarContenido(
  c: WpCreds,
  tipo: "page" | "post",
  id: number,
  o: WpClientOptions = {},
): Promise<void> {
  const res = await wp(c, o, `/wp/v2/${tipo}s/${id}`, {
    method: "POST",
    body: JSON.stringify({ status: "publish" }),
  });
  await exigirOk(res, `Fallo al restaurar ${tipo} ${id}`);
}

/**
 * Ruta de un plugin en la REST API. El identificador es "carpeta/archivo" y
 * WordPress solo reconoce la barra LITERAL: con `encodeURIComponent` entero la
 * barra viaja como "%2F", la ruta no casa y responde 404 "Plugin not found".
 * Por eso cada parte se codifica por separado.
 */
function rutaPlugin(plugin: string): string {
  return `/wp/v2/plugins/${plugin.split("/").map(encodeURIComponent).join("/")}`;
}

export async function cambiarEstadoPlugin(
  c: WpCreds,
  plugin: string,
  status: "active" | "inactive",
  o: WpClientOptions = {},
): Promise<WpPlugin> {
  const res = await wp(
    c,
    o,
    rutaPlugin(plugin),
    { method: "PUT", body: JSON.stringify({ status }) },
    30_000,
  );
  return (await exigirOk(
    res,
    `No pude ${status === "active" ? "activar" : "desactivar"} "${plugin}"`,
  )) as WpPlugin;
}

/** Instala desde wordpress.org y activa. La descarga tarda: 90 s de tope. */
export async function instalarPlugin(
  c: WpCreds,
  slug: string,
  o: WpClientOptions = {},
): Promise<WpPlugin> {
  const res = await wp(
    c,
    o,
    "/wp/v2/plugins",
    { method: "POST", body: JSON.stringify({ slug, status: "active" }) },
    90_000,
  );
  if (res.ok) return (await res.json()) as WpPlugin;
  const cuerpo = (await res.text()).slice(0, 300);
  // "folder_exists": ya estaba descargado. Activarlo es lo que quería el cliente.
  if (res.status === 500 || cuerpo.includes("folder_exists")) {
    const existente = (await listarPlugins(c, o)).find(
      (p) => p.plugin.startsWith(`${slug}/`) || p.plugin === slug,
    );
    if (existente) {
      return existente.status === "active"
        ? existente
        : await cambiarEstadoPlugin(c, existente.plugin, "active", o);
    }
  }
  throw new WpError(res.status, cuerpo, `No pude instalar "${slug}" (${res.status}): ${cuerpo}`);
}

export async function eliminarPlugin(
  c: WpCreds,
  plugin: string,
  o: WpClientOptions = {},
): Promise<void> {
  // WordPress exige que esté inactivo antes de borrarlo.
  const actual = (await listarPlugins(c, o)).find((p) => p.plugin === plugin);
  if (actual?.status === "active") await cambiarEstadoPlugin(c, plugin, "inactive", o);
  const res = await wp(c, o, rutaPlugin(plugin), { method: "DELETE" }, 30_000);
  await exigirOk(res, `No pude eliminar "${plugin}"`);
}

export async function actualizarAjustes(
  c: WpCreds,
  patch: Record<string, unknown>,
  o: WpClientOptions = {},
): Promise<Record<string, unknown>> {
  const res = await wp(c, o, "/wp/v2/settings", { method: "POST", body: JSON.stringify(patch) });
  return (await exigirOk(res, "Fallo al actualizar ajustes")) as Record<string, unknown>;
}

export async function moderarComentario(
  c: WpCreds,
  id: number,
  status: string,
  o: WpClientOptions = {},
): Promise<{ id: number; status: string }> {
  const res = await wp(c, o, `/wp/v2/comments/${id}`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
  return (await exigirOk(res, `Fallo al moderar comentario ${id}`)) as { id: number; status: string };
}

export async function crearTermino(
  c: WpCreds,
  tipo: "categories" | "tags",
  nombre: string,
  descripcion: string | undefined,
  o: WpClientOptions = {},
): Promise<{ id: number; nombre: string }> {
  const res = await wp(c, o, `/wp/v2/${tipo}`, {
    method: "POST",
    body: JSON.stringify({ name: nombre, description: descripcion ?? "" }),
  });
  const t = (await exigirOk(
    res,
    `Fallo al crear ${tipo === "categories" ? "categoría" : "etiqueta"}`,
  )) as { id: number; name: string };
  return { id: t.id, nombre: t.name };
}

export async function subirMediaDesdeUrl(
  c: WpCreds,
  url: string,
  nombre: string,
  o: WpClientOptions = {},
): Promise<{ id: number; url: string }> {
  const f = o.fetch ?? globalThis.fetch;
  const archivo = await f(url, { signal: señal(30_000, o.abortSignal) });
  if (!archivo.ok) throw new Error(`No pude descargar el archivo (${archivo.status})`);
  const buf = Buffer.from(await archivo.arrayBuffer());
  const contentType = archivo.headers.get("content-type") ?? "image/png";
  const res = await f(`${baseUrl(c)}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: authHeader(c),
      "content-type": contentType,
      "content-disposition": `attachment; filename="${nombre}"`,
    },
    body: new Uint8Array(buf),
    signal: señal(60_000, o.abortSignal),
  });
  const m = (await exigirOk(res, "Fallo al subir media")) as { id: number; source_url: string };
  return { id: m.id, url: m.source_url };
}

export async function crearUsuario(
  c: WpCreds,
  datos: { username: string; email: string; role: string },
  o: WpClientOptions = {},
): Promise<{ id: number; password: string }> {
  // WordPress exige contraseña. Se genera una fuerte que el dueño reseteará;
  // nunca se muestra al modelo, solo se devuelve al canal de la plataforma.
  const password = `${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .toUpperCase()
    .slice(2)}!${Date.now().toString(36)}`;
  const res = await wp(c, o, "/wp/v2/users", {
    method: "POST",
    body: JSON.stringify({ ...datos, password }),
  });
  const u = (await exigirOk(res, "Fallo al crear usuario")) as { id: number };
  return { id: u.id, password };
}

export async function cambiarRolUsuario(
  c: WpCreds,
  id: number,
  role: string,
  o: WpClientOptions = {},
): Promise<void> {
  const res = await wp(c, o, `/wp/v2/users/${id}`, {
    method: "POST",
    body: JSON.stringify({ roles: [role] }),
  });
  await exigirOk(res, `Fallo al cambiar rol del usuario ${id}`);
}

// ---------------------------------------------------------------------------
// Elementor: requiere el plugin conector, que expone los metas en la REST API
// ---------------------------------------------------------------------------

/**
 * Metas de Elementor según el tipo de contenido.
 *
 * `_elementor_template_type` es el tipo de documento de Elementor: `wp-page`
 * para páginas y `wp-post` para entradas. Con `wp-page` en una entrada,
 * Elementor la abre y le aplica condiciones como si fuera una página.
 *
 * `_wp_page_template` es `elementor_header_footer` (ancho completo) en los dos
 * casos: conserva el header y el footer globales del sitio —el diseño que el
 * cliente ya tiene— y da todo el ancho a las secciones. La plantilla `single`
 * del tema metería el diseño en la columna estrecha del blog con el título
 * repetido, y `elementor_canvas` quitaría el header y el footer.
 */
function metaElementor(tipo: TipoContenido) {
  return {
    _elementor_edit_mode: "builder",
    _elementor_template_type: tipo === "post" ? "wp-post" : "wp-page",
    _elementor_version: "3.25.0",
    _wp_page_template: "elementor_header_footer",
  } as const;
}

async function metaElementorGuardado(
  c: WpCreds,
  o: WpClientOptions,
  tipo: TipoContenido,
  id: number,
): Promise<boolean> {
  const check = await wp(c, o, `/wp/v2/${tipo}s/${id}?context=edit&_fields=meta`);
  if (!check.ok) return false;
  const meta = ((await check.json()) as WpPostRaw).meta;
  const data = meta?._elementor_data;
  return typeof data === "string" && data.length > 10;
}

export async function escribirContenidoElementor(
  c: WpCreds,
  entrada: {
    tipo: TipoContenido;
    id?: number;
    titulo: string;
    data: readonly unknown[];
    /** `excerpt`. La tarjeta del listado del blog lo necesita para no salir vacía. */
    extracto?: string;
    /** `featured_media`. Ídem: sin foto, la tarjeta queda en blanco. */
    imagenDestacadaId?: number;
  },
  o: WpClientOptions = {},
): Promise<{ id: number; link: string; elementorOk: boolean }> {
  const { tipo, id } = entrada;
  const nombre = NOMBRE_TIPO[tipo];
  // Solo viajan si se piden: un `excerpt: ""` borraría el que ya tuviera.
  const presentacion = {
    ...(entrada.extracto !== undefined ? { excerpt: entrada.extracto } : {}),
    ...(entrada.imagenDestacadaId !== undefined ? { featured_media: entrada.imagenDestacadaId } : {}),
  };

  const porRest = async (destino: number | undefined, status: "publish" | "draft") => {
    const res = await wp(c, o, destino ? `/wp/v2/${tipo}s/${destino}` : `/wp/v2/${tipo}s`, {
      method: "POST",
      body: JSON.stringify({
        title: entrada.titulo,
        status,
        content: "",
        ...presentacion,
        meta: { _elementor_data: JSON.stringify(entrada.data), ...metaElementor(tipo) },
      }),
    });
    const p = (await exigirOk(res, `Fallo al escribir ${nombre} con Elementor`)) as WpPostRaw;
    return { id: p.id, link: p.link ?? "", elementorOk: await metaElementorGuardado(c, o, tipo, p.id) };
  };

  // Vía preferida: la API del plugin conector. Actualiza en sitio y purga la
  // caché de Elementor — por REST cruda el render viejo se queda cacheado.
  // `pagina_id` se mantiene porque es lo que lee un conector ya instalado.
  const porConector = (destino?: number) =>
    conectorApi(c, o, "/elementor/pagina", {
      titulo: entrada.titulo,
      data: entrada.data,
      status: "publish",
      tipo,
      // El conector puede no entenderlas: `ajustarPresentacion` las reafirma
      // después por REST y comprueba leyendo de vuelta.
      ...presentacion,
      ...(destino ? { pagina_id: destino, post_id: destino } : {}),
    });

  if (tipo === "post" && id === undefined) {
    // Una entrada nueva nace por la REST de posts: un conector que solo sabe
    // de páginas crearía una página. Nace en borrador para que, si Elementor
    // no se puede guardar, no quede publicada una entrada vacía.
    const creada = await porRest(undefined, "draft");
    if (creada.elementorOk) {
      const res = await wp(c, o, `/wp/v2/posts/${creada.id}`, {
        method: "POST",
        body: JSON.stringify({ status: "publish" }),
      });
      const p = (await exigirOk(res, `Fallo al publicar la entrada ${creada.id}`)) as WpPostRaw;
      return { ...creada, link: p.link ?? creada.link };
    }
    const v2 = await porConector(creada.id);
    return v2?.id === creada.id
      ? { id: creada.id, link: String(v2.link ?? creada.link), elementorOk: true }
      : creada;
  }

  const v2 = await porConector(id);
  // Sobre un contenido existente solo vale si el conector escribió ESE id.
  if (typeof v2?.id === "number" && (id === undefined || v2.id === id)) {
    return { id: v2.id, link: String(v2.link ?? ""), elementorOk: true };
  }
  return porRest(id, "publish");
}

export function escribirPaginaElementor(
  c: WpCreds,
  entrada: { paginaId?: number; titulo: string; data: readonly unknown[] },
  o: WpClientOptions = {},
): Promise<{ id: number; link: string; elementorOk: boolean }> {
  return escribirContenidoElementor(
    c,
    {
      tipo: "page",
      ...(entrada.paginaId ? { id: entrada.paginaId } : {}),
      titulo: entrada.titulo,
      data: entrada.data,
    },
    o,
  );
}

export async function crearHeaderElementor(
  c: WpCreds,
  entrada: { titulo: string; tipo: "header" | "footer"; data: readonly unknown[] },
  o: WpClientOptions = {},
): Promise<{ id: number; disponible: boolean }> {
  // Solo por la API del plugin: un header global no es una página, es un
  // template, y por REST cruda no hay forma de registrarlo en cualquier tema.
  const v2 = await conectorApi(c, o, "/elementor/header", {
    titulo: entrada.titulo,
    tipo: entrada.tipo,
    data: entrada.data,
  });
  if (typeof v2?.id === "number") return { id: v2.id, disponible: true };
  return { id: 0, disponible: false };
}

// ---------------------------------------------------------------------------
// Plantillas de Elementor (header, footer…) por la REST API, sin plugin
// ---------------------------------------------------------------------------

export type PlantillaElementor = {
  readonly id: number;
  readonly titulo: string;
  readonly tipo: string;
  readonly status: string;
};

const SIN_PLANTILLAS =
  "Este WordPress no expone las plantillas de Elementor por la API: no se pueden leer ni editar sin un plugin conector.";

function tipoDePlantilla(p: WpPostRaw): string {
  const tipo = p.meta?.["_elementor_template_type"];
  return typeof tipo === "string" ? tipo : "desconocido";
}

export async function listarPlantillasElementor(
  c: WpCreds,
  o: WpClientOptions = {},
): Promise<PlantillaElementor[]> {
  const res = await wp(c, o, "/wp/v2/elementor_library?per_page=50&context=edit&_fields=id,title,status,meta");
  if (res.status === 404) throw new Error(SIN_PLANTILLAS);
  const lista = (await exigirOk(res, "No pude listar las plantillas de Elementor")) as WpPostRaw[];
  return lista.map((p) => ({
    id: p.id,
    titulo: p.title?.raw ?? p.title?.rendered ?? "",
    tipo: tipoDePlantilla(p),
    status: p.status ?? "",
  }));
}

export async function leerPlantillaElementor(
  c: WpCreds,
  id: number,
  o: WpClientOptions = {},
): Promise<PlantillaElementor & { data: unknown[] }> {
  const res = await wp(c, o, `/wp/v2/elementor_library/${id}?context=edit&_fields=id,title,status,meta`);
  const p = (await exigirOk(res, `No pude leer la plantilla ${id}`)) as WpPostRaw;
  const crudo = p.meta?.["_elementor_data"];
  if (typeof crudo !== "string") throw new Error(SIN_PLANTILLAS);
  let data: unknown;
  try {
    data = crudo ? JSON.parse(crudo) : [];
  } catch {
    throw new Error(`El diseño de la plantilla ${id} no es JSON válido: no lo toco.`);
  }
  if (!Array.isArray(data)) throw new Error(`El diseño de la plantilla ${id} tiene una forma inesperada: no lo toco.`);
  return {
    id: p.id,
    titulo: p.title?.raw ?? p.title?.rendered ?? "",
    tipo: tipoDePlantilla(p),
    status: p.status ?? "",
    data,
  };
}

export async function escribirPlantillaElementor(
  c: WpCreds,
  id: number,
  data: readonly unknown[],
  o: WpClientOptions = {},
): Promise<{ cache: "limpiada" | "no disponible" }> {
  const texto = JSON.stringify(data);
  const res = await wp(c, o, `/wp/v2/elementor_library/${id}`, {
    method: "POST",
    body: JSON.stringify({ meta: { _elementor_data: texto } }),
  });
  await exigirOk(res, `No pude guardar la plantilla ${id}`);

  // WordPress ignora en silencio un meta que no acepta y responde 200 igual:
  // se relee para no dar por hecho un cambio que no quedó.
  const releida = await leerPlantillaElementor(c, id, o);
  if (JSON.stringify(releida.data) !== texto) {
    throw new Error(`WordPress respondió bien pero la plantilla ${id} no quedó guardada: el cambio no se aplicó.`);
  }

  // Elementor cachea el CSS y el HTML de sus plantillas; sin limpiarla el
  // cambio puede tardar en verse. Si la ruta no existe se sigue: es un extra.
  let cache: "limpiada" | "no disponible" = "no disponible";
  try {
    const limpiar = await wp(c, o, "/elementor/v1/cache", { method: "DELETE" });
    if (limpiar.ok) cache = "limpiada";
  } catch {
    /* sin limpieza de caché el cambio queda guardado igual */
  }
  return { cache };
}

// ---------------------------------------------------------------------------
// Presentación y diseño
// ---------------------------------------------------------------------------

/**
 * Oculta el título del tema, decide los comentarios y asegura extracto e imagen
 * destacada de un contenido diseñado.
 *
 * Hello Elementor pinta el título de la entrada ENCIMA del diseño salvo que
 * la página tenga `hide_title`; el resultado es un H1 repetido. Y una entrada
 * de marketing no quiere el formulario «Leave a Reply» sin estilo debajo.
 *
 * El extracto y la imagen destacada se reafirman aquí porque la escritura pudo
 * ir por el plugin conector, que quizá no las entienda: sin ellas la entrada se
 * publica bien pero su tarjeta sale VACÍA en el listado del blog.
 *
 * Nada de esto puede tumbar la escritura, que ya se hizo: es best-effort y se
 * comprueba leyendo de vuelta.
 */
export async function ajustarPresentacion(
  c: WpCreds,
  tipo: TipoContenido,
  id: number,
  ajustes: {
    ocultarTitulo: boolean;
    comentarios: "open" | "closed";
    extracto?: string;
    imagenDestacadaId?: number;
  },
  o: WpClientOptions = {},
): Promise<{
  tituloOculto: boolean;
  comentarios: string | null;
  extracto: string;
  imagenDestacada: number;
}> {
  const ruta = `/wp/v2/${tipo}s/${id}`;
  const vacio = { tituloOculto: false, comentarios: null, extracto: "", imagenDestacada: 0 };
  const presentacion = {
    ...(ajustes.extracto !== undefined ? { excerpt: ajustes.extracto } : {}),
    ...(ajustes.imagenDestacadaId !== undefined ? { featured_media: ajustes.imagenDestacadaId } : {}),
  };
  try {
    const completo = await wp(c, o, ruta, {
      method: "POST",
      body: JSON.stringify({
        comment_status: ajustes.comentarios,
        ...presentacion,
        ...(ajustes.ocultarTitulo ? { meta: { _elementor_page_settings: { hide_title: "yes" } } } : {}),
      }),
    });
    if (!completo.ok) {
      // Un meta que el sitio no acepta no debe impedir lo demás.
      await wp(c, o, ruta, {
        method: "POST",
        body: JSON.stringify({ comment_status: ajustes.comentarios, ...presentacion }),
      });
    }
    const check = await wp(c, o, `${ruta}?context=edit&_fields=meta,comment_status,excerpt,featured_media`);
    if (!check.ok) return vacio;
    const p = (await check.json()) as {
      meta?: Record<string, unknown>;
      comment_status?: string;
      excerpt?: Renderizado;
      featured_media?: number;
    };
    const ajustesPagina = p.meta?._elementor_page_settings as Record<string, unknown> | undefined;
    return {
      tituloOculto: ajustesPagina?.hide_title === "yes",
      comentarios: typeof p.comment_status === "string" ? p.comment_status : null,
      extracto: textoPlano(p.excerpt),
      imagenDestacada: typeof p.featured_media === "number" ? p.featured_media : 0,
    };
  } catch {
    return vacio;
  }
}

/** El `_elementor_data` de una página o entrada, o null si no hay o no se expone. */
export async function leerElementorData(
  c: WpCreds,
  id: number,
  o: WpClientOptions = {},
  /** Si ya se sabe, se lee solo por su ruta: sin probar primero como página. */
  tipoConocido?: TipoContenido,
): Promise<unknown[] | null> {
  for (const tipo of tipoConocido ? ([`${tipoConocido}s`] as const) : (["pages", "posts"] as const)) {
    const res = await wp(c, o, `/wp/v2/${tipo}/${id}?context=edit&_fields=meta`);
    if (!res.ok) continue;
    const data = ((await res.json()) as WpPostRaw).meta?._elementor_data;
    if (typeof data !== "string" || data.length < 3) return null;
    try {
      const nodos = JSON.parse(data) as unknown;
      return Array.isArray(nodos) ? nodos : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Reescribe el `_elementor_data` de una página o entrada que ya existe.
 *
 * WordPress responde 200 aunque ignore un meta que no tiene registrado, así que
 * se relee: dar por hecho un cambio que no quedó es peor que fallar.
 */
export async function escribirElementorDeContenido(
  c: WpCreds,
  tipo: TipoContenido,
  id: number,
  data: readonly unknown[],
  o: WpClientOptions = {},
): Promise<{ cache: "limpiada" | "no disponible" }> {
  const texto = JSON.stringify(data);
  const res = await wp(c, o, `/wp/v2/${tipo}s/${id}`, {
    method: "POST",
    body: JSON.stringify({ meta: { _elementor_data: texto } }),
  });
  await exigirOk(res, `No pude guardar el diseño de ${NOMBRE_TIPO[tipo]} ${id}`);

  const check = await wp(c, o, `/wp/v2/${tipo}s/${id}?context=edit&_fields=meta`);
  const guardado = check.ok ? ((await check.json()) as WpPostRaw).meta?._elementor_data : undefined;
  let igual = false;
  if (typeof guardado === "string") {
    try {
      igual = JSON.stringify(JSON.parse(guardado)) === texto;
    } catch {
      igual = false;
    }
  }
  if (!igual) {
    throw new Error(
      `WordPress respondió bien pero el diseño de ${NOMBRE_TIPO[tipo]} ${id} no quedó guardado: este sitio no deja escribir el diseño de Elementor por la API (hace falta el plugin conector). No cambió nada.`,
    );
  }

  let cache: "limpiada" | "no disponible" = "no disponible";
  try {
    const limpiar = await wp(c, o, "/elementor/v1/cache", { method: "DELETE" });
    if (limpiar.ok) cache = "limpiada";
  } catch {
    /* sin limpieza de caché el cambio queda guardado igual */
  }
  return { cache };
}

/**
 * GET público (como un visitante) de una ruta o de una URL del MISMO sitio.
 * Otro host se rechaza: esto no puede ser un lector de la red del servidor.
 */
export async function leerPublico(
  base: string,
  rutaOUrl: string,
  o: WpClientOptions = {},
): Promise<{ status: number; texto: string }> {
  const raiz = new URL(base.startsWith("http") ? base : `https://${base}`);
  const destino = new URL(rutaOUrl, `${raiz.origin}/`);
  if (destino.host !== raiz.host) throw new Error(`${destino.host} no es el sitio del cliente.`);
  const f = o.fetch ?? globalThis.fetch;
  const res = await f(destino.href, {
    signal: señal(15_000, o.abortSignal),
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`${destino.pathname} respondió ${res.status}`);
  return { status: res.status, texto: texto.slice(0, 2_000_000) };
}

// ---------------------------------------------------------------------------
// Verificación
// ---------------------------------------------------------------------------

export async function verificar(
  c: WpCreds,
  path: string,
  contiene: string | undefined,
  o: WpClientOptions = {},
): Promise<{ ok: boolean; status: number; encontrado?: boolean; ms: number }> {
  const f = o.fetch ?? globalThis.fetch;
  const t0 = Date.now();
  const res = await f(`${baseUrl(c)}${path}`, {
    signal: señal(15_000, o.abortSignal),
    // Sin esto se verifica la copia cacheada y el cambio "no aparece".
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
  });
  const ms = Date.now() - t0;
  if (!contiene) return { ok: res.ok, status: res.status, ms };
  const html = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    encontrado: html.toLowerCase().includes(contiene.toLowerCase()),
    ms,
  };
}
