/**
 * Mutaciones: contenido, plugins, ajustes, comentarios, términos, medios y
 * usuarios.
 */
import type { WpCreds } from "../../ports.js";
import { type WpClientOptions, baseUrl, authHeader, señal, WpError, wp, exigirOk } from "./http.js";
import type { WpPostRaw, WpPlugin } from "./tipos.js";
import { listarPlugins } from "./lectura.js";

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

/**
 * Sube a la biblioteca una imagen que ya tenemos en memoria.
 *
 * Existe para el Diseñador: sus imágenes nacen en la cartera de modelos y nunca
 * llegan a tener una URL pública, así que `subirMediaDesdeUrl` no vale. Y
 * alojarlas en un sitio temporal solo para que WordPress las descargue sería
 * inventar un punto de fallo —y una fuga— donde no hace falta.
 *
 * El texto alternativo se escribe en una segunda llamada porque la de subida
 * solo acepta el binario: WordPress no deja mandar metadatos en el mismo envío.
 * Si esa segunda falla, la imagen ya está subida y se devuelve igual: perder el
 * texto alternativo es peor que perder la imagen, pero mucho menos que fallar
 * entero y dejar un archivo huérfano.
 */
export async function subirMediaDesdeBytes(
  c: WpCreds,
  entrada: { bytes: Uint8Array; mimeType: string; nombre: string; alt?: string },
  o: WpClientOptions = {},
): Promise<{ id: number; url: string; altGuardado: boolean }> {
  const f = o.fetch ?? globalThis.fetch;
  // Se copia a un array propio, igual que en `subirMediaDesdeUrl`: el cuerpo de
  // una petición pide bytes respaldados por un `ArrayBuffer` concreto, y el que
  // llega desde fuera puede venir sobre cualquier búfer. Sin esta copia compila
  // en el paquete y falla al comprobarlo desde la web, que trae otros tipos.
  const cuerpo = new Uint8Array(Buffer.from(entrada.bytes));
  const res = await f(`${baseUrl(c)}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: authHeader(c),
      "content-type": entrada.mimeType,
      "content-disposition": `attachment; filename="${entrada.nombre}"`,
    },
    body: cuerpo,
    signal: señal(60_000, o.abortSignal),
  });
  const m = (await exigirOk(res, "Fallo al subir la imagen")) as {
    id: number;
    source_url: string;
  };

  let altGuardado = false;
  if (entrada.alt) {
    try {
      const meta = await wp(c, o, `/wp/v2/media/${m.id}`, {
        method: "POST",
        body: JSON.stringify({ alt_text: entrada.alt, title: entrada.alt }),
      });
      altGuardado = meta.ok;
    } catch {
      altGuardado = false;
    }
  }
  return { id: m.id, url: m.source_url, altGuardado };
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
