/**
 * Presentación y diseño.
 */
import type { WpCreds } from "../../ports.js";
import { type WpClientOptions, señal, wp, exigirOk } from "./http.js";
import { type Renderizado, type WpPostRaw, textoPlano, type TipoContenido, NOMBRE_TIPO } from "./tipos.js";

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
