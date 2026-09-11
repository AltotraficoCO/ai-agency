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
  link?: string;
  status?: string;
  slug?: string;
  meta?: Record<string, unknown>;
};

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

export async function leerContenido(
  c: WpCreds,
  tipo: "page" | "post",
  id: number,
  o: WpClientOptions = {},
): Promise<WpContentDetalle> {
  const res = await wp(c, o, `/wp/v2/${tipo}s/${id}?context=edit`);
  const p = (await exigirOk(res, `No pude leer ${tipo} ${id}`)) as WpPostRaw;
  return {
    id: p.id,
    titulo: p.title?.raw ?? p.title?.rendered ?? "",
    contenido: p.content?.raw ?? p.content?.rendered ?? "",
    link: p.link ?? "",
    slug: p.slug ?? "",
    status: p.status ?? "",
  };
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
  cambios: { titulo?: string; contenido?: string; status?: string },
  o: WpClientOptions = {},
): Promise<{ id: number; titulo: string; link: string }> {
  const body: Record<string, string> = {};
  if (cambios.titulo !== undefined) body.title = cambios.titulo;
  if (cambios.contenido !== undefined) body.content = cambios.contenido;
  if (cambios.status !== undefined) body.status = cambios.status;
  const res = await wp(c, o, `/wp/v2/${tipo}s/${id}`, { method: "POST", body: JSON.stringify(body) });
  const p = (await exigirOk(res, "Fallo al actualizar")) as WpPostRaw;
  return { id: p.id, titulo: p.title?.rendered ?? p.title?.raw ?? "", link: p.link ?? "" };
}

export async function crearContenido(
  c: WpCreds,
  tipo: "page" | "post",
  datos: { titulo: string; contenido: string; status?: "publish" | "draft" },
  o: WpClientOptions = {},
): Promise<{ id: number; link: string; status: string }> {
  const res = await wp(c, o, `/wp/v2/${tipo}s`, {
    method: "POST",
    body: JSON.stringify({
      title: datos.titulo,
      content: datos.contenido,
      status: datos.status ?? "publish",
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

export async function cambiarEstadoPlugin(
  c: WpCreds,
  plugin: string,
  status: "active" | "inactive",
  o: WpClientOptions = {},
): Promise<WpPlugin> {
  const res = await wp(
    c,
    o,
    `/wp/v2/plugins/${encodeURIComponent(plugin)}`,
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
  const res = await wp(
    c,
    o,
    `/wp/v2/plugins/${encodeURIComponent(plugin)}`,
    { method: "DELETE" },
    30_000,
  );
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

const META_ELEMENTOR = {
  _elementor_edit_mode: "builder",
  _elementor_template_type: "wp-page",
  _elementor_version: "3.25.0",
  _wp_page_template: "elementor_header_footer",
} as const;

async function metaElementorGuardado(
  c: WpCreds,
  o: WpClientOptions,
  id: number,
): Promise<boolean> {
  const check = await wp(c, o, `/wp/v2/pages/${id}?context=edit&_fields=meta`);
  if (!check.ok) return false;
  const meta = ((await check.json()) as WpPostRaw).meta;
  const data = meta?._elementor_data;
  return typeof data === "string" && data.length > 10;
}

export async function escribirPaginaElementor(
  c: WpCreds,
  entrada: { paginaId?: number; titulo: string; data: readonly unknown[] },
  o: WpClientOptions = {},
): Promise<{ id: number; link: string; elementorOk: boolean }> {
  // Vía preferida: la API del plugin conector. Actualiza en sitio y purga la
  // caché de Elementor — por REST cruda el render viejo se queda cacheado.
  const v2 = await conectorApi(c, o, "/elementor/pagina", {
    titulo: entrada.titulo,
    data: entrada.data,
    status: "publish",
    ...(entrada.paginaId ? { pagina_id: entrada.paginaId } : {}),
  });
  if (typeof v2?.id === "number") {
    return { id: v2.id, link: String(v2.link ?? ""), elementorOk: true };
  }

  const ruta = entrada.paginaId ? `/wp/v2/pages/${entrada.paginaId}` : "/wp/v2/pages";
  const res = await wp(c, o, ruta, {
    method: "POST",
    body: JSON.stringify({
      title: entrada.titulo,
      status: "publish",
      content: "",
      meta: { _elementor_data: JSON.stringify(entrada.data), ...META_ELEMENTOR },
    }),
  });
  const p = (await exigirOk(res, "Fallo al escribir la página Elementor")) as WpPostRaw;
  return { id: p.id, link: p.link ?? "", elementorOk: await metaElementorGuardado(c, o, p.id) };
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
