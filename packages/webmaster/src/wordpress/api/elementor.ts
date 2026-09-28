/**
 * Elementor: requiere el plugin conector, que expone los metas en la REST API.
 */
import type { WpCreds } from "../../ports.js";
import { type WpClientOptions, wp, exigirOk, conectorApi } from "./http.js";
import { type WpPostRaw, type TipoContenido, NOMBRE_TIPO } from "./tipos.js";

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
