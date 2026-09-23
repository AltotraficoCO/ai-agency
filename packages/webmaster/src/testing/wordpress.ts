/**
 * Doble de la REST API de WordPress.
 *
 * Es un WordPress de mentira con estado en memoria: responde en las mismas
 * rutas, con las mismas formas (`title.rendered` frente a `title.raw`, el
 * `context=edit` que hace falta para leer el HTML crudo, el 401 sin
 * credenciales) y guarda de verdad lo que se escribe. Las respuestas están
 * calcadas de lo que el cliente del proyecto anterior lee, que es la mejor
 * fuente disponible de "cómo responde de verdad esta API".
 *
 * Sirve para probar el agente entero sin un WordPress delante. No sustituye a
 * una prueba contra un sitio real, y el reporte lo dice.
 */

export type PaginaDoble = {
  id: number;
  tipo: "page" | "post";
  titulo: string;
  contenido: string;
  slug: string;
  status: string;
  meta: Record<string, unknown>;
  comment_status?: string;
  /** `excerpt`: lo que pinta la tarjeta del listado del blog. */
  extracto?: string;
  /** `featured_media`: 0 o ausente cuando no tiene imagen destacada. */
  imagenDestacada?: number;
};

export type MedioDoble = {
  id: number;
  titulo: string;
  url: string;
  tipo: string;
  mime: string;
  alt: string;
};

/**
 * Una plantilla de Elementor (`elementor_library`). Su diseño se expone en el
 * meta `_elementor_data` sin plugin, como en un sitio real con Elementor
 * reciente: por eso no depende de `conectorInstalado`.
 */
export type PlantillaDoble = {
  id: number;
  titulo: string;
  tipo: string;
  status: string;
  /** `_elementor_data` tal cual lo guarda WordPress: JSON serializado. */
  data: string;
};

export type EstadoWordPress = {
  nombre: string;
  usuario: string;
  appPassword: string;
  /** El plugin conector instalado: sin él no se pueden escribir metas de páginas Elementor. */
  conectorInstalado: boolean;
  contenido: PaginaDoble[];
  plantillas: PlantillaDoble[];
  ajustes: Record<string, unknown>;
  plugins: { plugin: string; name: string; status: string; version: string }[];
  comentarios: { id: number; author_name: string; content: { rendered: string }; status: string; post: number }[];
  usuarios: { id: number; name: string; email: string; roles: string[] }[];
  /** La biblioteca de medios, de donde sale la imagen destacada de una entrada. */
  medios: MedioDoble[];
  /**
   * Respuestas públicas fijas por ruta (HTML de la portada con sus clases,
   * CSS de Elementor…). Ganan al render genérico del sitio.
   */
  archivos: Record<string, { tipo: string; cuerpo: string }>;
};

export type DobleWordPress = {
  readonly estado: EstadoWordPress;
  readonly fetch: typeof globalThis.fetch;
  /** Peticiones vistas, para poder afirmar que NO se llamó a algo. */
  readonly llamadas: { metodo: string; ruta: string }[];
};

export const BASE_DOBLE = "https://ejemplo.test";

export function estadoInicial(): EstadoWordPress {
  return {
    nombre: "Panadería Aurora",
    usuario: "admin",
    appPassword: "abcd EFGH ijkl MNOP qrst UVWX",
    conectorInstalado: true,
    contenido: [
      {
        id: 2,
        tipo: "page",
        titulo: "Inicio",
        contenido: "<p>Pan de verdad, todos los días.</p>",
        slug: "inicio",
        status: "publish",
        // La portada viene hecha con Elementor, como en la mayoría de los
        // sitios reales: es lo que permite probar un cambio de una PARTE
        // (el banner) sin rehacer la página entera.
        meta: {
          _elementor_edit_mode: "builder",
          _elementor_data: JSON.stringify([
            {
              id: "c1",
              elType: "container",
              settings: {},
              elements: [
                { id: "w1", elType: "widget", widgetType: "heading", settings: { title: "Pan de verdad" }, elements: [] },
                { id: "w2", elType: "widget", widgetType: "button", settings: { text: "Ver la carta", link: { url: "/carta/" } }, elements: [] },
              ],
            },
          ]),
        },
      },
      {
        id: 7,
        tipo: "page",
        titulo: "Nuestra historia",
        contenido: "<p>Abrimos en 1998 en el barrio.</p>",
        slug: "nuestra-historia",
        status: "publish",
        meta: {},
      },
      {
        id: 11,
        tipo: "page",
        titulo: "Planes y precios",
        contenido: "<p>Suscripción semanal: 20 €</p>",
        slug: "planes-y-precios",
        status: "publish",
        meta: {},
      },
      {
        id: 21,
        tipo: "post",
        titulo: "Masa madre en casa",
        contenido: "<p>Receta paso a paso.</p>",
        slug: "masa-madre-en-casa",
        status: "publish",
        meta: {},
      },
    ],
    plantillas: [
      {
        id: 12,
        titulo: "Header",
        tipo: "header",
        status: "publish",
        data: JSON.stringify([
          {
            id: "h0c0n7a",
            elType: "container",
            settings: {},
            elements: [
              {
                id: "h1l0g0a",
                elType: "widget",
                widgetType: "heading",
                settings: { title: "Panadería Aurora", link: { url: "/" } },
                elements: [],
              },
            ],
          },
        ]),
      },
      {
        id: 78,
        titulo: "Footer",
        tipo: "footer",
        status: "publish",
        data: JSON.stringify([
          {
            id: "f0c0n7a",
            elType: "container",
            settings: {},
            elements: [
              {
                id: "f1m4g3n",
                elType: "widget",
                widgetType: "image",
                settings: { image: { url: `${BASE_DOBLE}/wp-content/uploads/logo.png` } },
                elements: [],
              },
              {
                id: "f2s0c1a",
                elType: "widget",
                widgetType: "social-icons",
                settings: { social_icon_list: [{ link: { url: "https://instagram.com/aurora" } }] },
                elements: [],
              },
            ],
          },
        ]),
      },
    ],
    ajustes: {
      title: "Panadería Aurora",
      description: "Pan artesano desde 1998",
      show_on_front: "page",
      page_on_front: 2,
      posts_per_page: 10,
    },
    plugins: [
      { plugin: "elementor/elementor", name: "Elementor", status: "active", version: "3.25.0" },
      { plugin: "akismet/akismet", name: "Akismet", status: "inactive", version: "5.3" },
    ],
    comentarios: [
      {
        id: 100,
        author_name: "Marta",
        content: { rendered: "¡Riquísimo!" },
        status: "hold",
        post: 21,
      },
    ],
    usuarios: [{ id: 1, name: "admin", email: "admin@ejemplo.test", roles: ["administrator"] }],
    medios: [
      {
        id: 301,
        titulo: "Obrador al amanecer",
        url: `${BASE_DOBLE}/wp-content/uploads/obrador.jpg`,
        tipo: "image",
        mime: "image/jpeg",
        alt: "El obrador de la panadería al amanecer",
      },
      {
        id: 302,
        titulo: "Masa madre",
        url: `${BASE_DOBLE}/wp-content/uploads/masa-madre.jpg`,
        tipo: "image",
        mime: "image/jpeg",
        alt: "Un bote de masa madre",
      },
      {
        id: 303,
        titulo: "Catálogo en PDF",
        url: `${BASE_DOBLE}/wp-content/uploads/catalogo.pdf`,
        tipo: "file",
        mime: "application/pdf",
        alt: "",
      },
    ],
    archivos: {},
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function error(codigo: string, mensaje: string, status: number): Response {
  return json({ code: codigo, message: mensaje, data: { status } }, status);
}

/** Renderiza el sitio como lo vería un visitante, para `verificar_http`. */
function html(estado: EstadoWordPress, ruta: string): Response {
  const slug = ruta.replace(/^\/|\/$/g, "");
  const portadaId = estado.ajustes.page_on_front;
  const pagina =
    slug === ""
      ? estado.contenido.find((c) => c.id === portadaId)
      : estado.contenido.find((c) => c.slug === slug);
  if (!pagina) return new Response("<html><body>404</body></html>", { status: 404 });
  return new Response(
    `<!doctype html><html><head><title>${pagina.titulo}</title></head><body><h1>${pagina.titulo}</h1>${pagina.contenido}</body></html>`,
    { status: 200, headers: { "content-type": "text/html" } },
  );
}

export function crearDobleWordPress(
  inicial: Partial<EstadoWordPress> = {},
  base = BASE_DOBLE,
): DobleWordPress {
  const estado: EstadoWordPress = { ...estadoInicial(), ...inicial };
  const llamadas: { metodo: string; ruta: string }[] = [];
  let siguienteId = 100;

  const autorizado = (req: Request | RequestInit | undefined): boolean => {
    const crudas = (req as RequestInit | undefined)?.headers;
    const headers = new Headers((crudas ?? {}) as Record<string, string>);
    const auth = headers.get("authorization") ?? "";
    if (!auth.startsWith("Basic ")) return false;
    const [usuario, ...resto] = Buffer.from(auth.slice(6), "base64").toString("utf8").split(":");
    return usuario === estado.usuario && resto.join(":") === estado.appPassword;
  };

  const fetchDoble: typeof globalThis.fetch = async (entrada, init) => {
    const url = new URL(typeof entrada === "string" ? entrada : String(entrada));
    if (`${url.protocol}//${url.host}` !== base) {
      throw new Error(`El doble solo atiende ${base}, y se pidió ${url.href}`);
    }
    const metodo = (init?.method ?? "GET").toUpperCase();
    const ruta = url.pathname;
    llamadas.push({ metodo, ruta });
    const cuerpo = (): Record<string, unknown> =>
      init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    // Un archivo estático cualquiera: lo pide `wp_subir_media` al descargar.
    if (/\.(png|jpe?g|gif|webp|svg)$/i.test(ruta)) {
      return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }

    // --- Fuera de la REST API: el sitio tal cual lo ve un visitante ---
    const fijo = estado.archivos[ruta];
    if (fijo) return new Response(fijo.cuerpo, { status: 200, headers: { "content-type": fijo.tipo } });
    if (!ruta.startsWith("/wp-json")) return html(estado, ruta);

    // --- Descubrimiento (público) ---
    if (ruta === "/wp-json" || ruta === "/wp-json/") {
      return json({ name: estado.nombre, description: estado.ajustes.description });
    }

    if (!autorizado(init)) {
      return error("rest_not_logged_in", "No estás conectado actualmente.", 401);
    }

    if (ruta === "/wp-json/wp/v2/users/me") return json({ id: 1, name: estado.usuario });

    // --- API del plugin conector ---
    if (ruta === "/wp-json/strappy/v1/elementor/pagina") {
      if (!estado.conectorInstalado) return error("rest_no_route", "No existe la ruta.", 404);
      const b = cuerpo();
      const paginaId = typeof b.pagina_id === "number" ? b.pagina_id : undefined;
      const tipoPedido = b.tipo === "post" || b.tipo === "page" ? b.tipo : undefined;
      const destino = paginaId
        ? estado.contenido.find((c) => c.id === paginaId && (!tipoPedido || c.tipo === tipoPedido))
        : (() => {
            const nueva: PaginaDoble = {
              id: ++siguienteId,
              tipo: tipoPedido ?? "page",
              titulo: String(b.titulo ?? ""),
              contenido: "",
              slug: String(b.titulo ?? "pagina").toLowerCase().replace(/\s+/g, "-"),
              status: "publish",
              meta: {},
            };
            estado.contenido.push(nueva);
            return nueva;
          })();
      if (!destino) return error("rest_post_invalid_id", "Identificador inválido.", 404);
      destino.titulo = String(b.titulo ?? destino.titulo);
      destino.meta._elementor_data = JSON.stringify(b.data ?? []);
      destino.meta._elementor_edit_mode = "builder";
      return json({ id: destino.id, link: `${base}/${destino.slug}/` });
    }
    if (ruta === "/wp-json/strappy/v1/elementor/header") {
      if (!estado.conectorInstalado) return error("rest_no_route", "No existe la ruta.", 404);
      return json({ id: ++siguienteId });
    }
    if (ruta.startsWith("/wp-json/strappy/")) return error("rest_no_route", "No existe la ruta.", 404);

    // --- Plantillas de Elementor (sin plugin: el meta está expuesto) ---
    if (ruta === "/wp-json/wp/v2/elementor_library") {
      return json(estado.plantillas.map(vistaPlantilla));
    }
    const plantilla = /^\/wp-json\/wp\/v2\/elementor_library\/(\d+)$/.exec(ruta);
    if (plantilla) {
      const p = estado.plantillas.find((x) => x.id === Number(plantilla[1]));
      if (!p) return error("rest_post_invalid_id", "Identificador inválido.", 404);
      if (metodo === "POST") {
        const meta = cuerpo().meta as Record<string, unknown> | undefined;
        if (meta && typeof meta._elementor_data === "string") p.data = meta._elementor_data;
      }
      return json(vistaPlantilla(p));
    }
    if (ruta === "/wp-json/elementor/v1/cache") return json({ success: true });

    // --- Ajustes ---
    if (ruta === "/wp-json/wp/v2/settings") {
      if (metodo === "POST") {
        Object.assign(estado.ajustes, cuerpo());
        return json(estado.ajustes);
      }
      return json(estado.ajustes);
    }

    // --- Plugins ---
    if (ruta === "/wp-json/wp/v2/plugins") {
      if (metodo === "POST") {
        const slug = String(cuerpo().slug ?? "");
        const ya = estado.plugins.find((p) => p.plugin.startsWith(`${slug}/`));
        if (ya) return error("folder_exists", "El destino ya existe.", 500);
        const nuevo = {
          plugin: `${slug}/${slug}`,
          name: slug,
          status: "active",
          version: "1.0.0",
        };
        estado.plugins.push(nuevo);
        return json(nuevo, 201);
      }
      return json(estado.plugins);
    }
    if (ruta.startsWith("/wp-json/wp/v2/plugins/")) {
      const crudo = ruta.slice("/wp-json/wp/v2/plugins/".length);
      // WordPress solo reconoce la barra literal entre carpeta y archivo: con
      // "%2F" la ruta no casa y responde 404. Aceptarla aquí escondió ese fallo.
      if (/%2f/i.test(crudo)) return error("rest_plugin_not_found", "Plugin not found.", 404);
      const id = decodeURIComponent(crudo);
      const p = estado.plugins.find((x) => x.plugin === id);
      if (!p) return error("rest_plugin_not_found", "Plugin no encontrado.", 404);
      if (metodo === "PUT") {
        p.status = String(cuerpo().status ?? p.status);
        return json(p);
      }
      if (metodo === "DELETE") {
        if (p.status === "active") {
          return error("rest_cannot_delete_active_plugin", "Está activo.", 400);
        }
        estado.plugins = estado.plugins.filter((x) => x.plugin !== id);
        return json({ deleted: true, previous: p });
      }
      return json(p);
    }

    // --- Comentarios ---
    if (ruta === "/wp-json/wp/v2/comments") {
      const estadoPedido = url.searchParams.get("status") ?? "hold";
      return json(estado.comentarios.filter((c) => c.status === estadoPedido));
    }
    if (ruta.startsWith("/wp-json/wp/v2/comments/")) {
      const id = Number(ruta.split("/").pop());
      const c = estado.comentarios.find((x) => x.id === id);
      if (!c) return error("rest_comment_invalid_id", "Comentario inválido.", 404);
      c.status = String(cuerpo().status ?? c.status);
      return json({ id: c.id, status: c.status });
    }

    // --- Usuarios ---
    if (ruta === "/wp-json/wp/v2/users") {
      if (metodo === "POST") {
        const b = cuerpo();
        const nuevo = {
          id: ++siguienteId,
          name: String(b.username ?? ""),
          email: String(b.email ?? ""),
          roles: [String(b.role ?? "subscriber")],
        };
        estado.usuarios.push(nuevo);
        return json(nuevo, 201);
      }
      return json(estado.usuarios);
    }
    if (ruta.startsWith("/wp-json/wp/v2/users/")) {
      const id = Number(ruta.split("/").pop());
      const u = estado.usuarios.find((x) => x.id === id);
      if (!u) return error("rest_user_invalid_id", "Usuario inválido.", 404);
      const roles = cuerpo().roles;
      if (Array.isArray(roles)) u.roles = roles.map(String);
      return json(u);
    }

    // --- Taxonomías ---
    if (ruta === "/wp-json/wp/v2/categories" || ruta === "/wp-json/wp/v2/tags") {
      const b = cuerpo();
      return json({ id: ++siguienteId, name: String(b.name ?? "") }, 201);
    }

    // --- Medios ---
    if (ruta === "/wp-json/wp/v2/media") {
      if (metodo === "POST") {
        const nuevo: MedioDoble = {
          id: ++siguienteId,
          titulo: "archivo",
          url: `${base}/wp-content/uploads/archivo.png`,
          tipo: "image",
          mime: "image/png",
          alt: "",
        };
        estado.medios.push(nuevo);
        return json({ id: nuevo.id, source_url: nuevo.url }, 201);
      }
      const buscar = (url.searchParams.get("search") ?? "").toLowerCase();
      const lista = buscar
        ? estado.medios.filter((m) => `${m.titulo} ${m.alt}`.toLowerCase().includes(buscar))
        : estado.medios;
      return json(
        lista.map((m) => ({
          id: m.id,
          title: { rendered: m.titulo },
          source_url: m.url,
          media_type: m.tipo,
          mime_type: m.mime,
          alt_text: m.alt,
        })),
      );
    }

    // --- Contenido ---
    const coleccion = /^\/wp-json\/wp\/v2\/(pages|posts)$/.exec(ruta);
    if (coleccion) {
      const tipo = coleccion[1] === "pages" ? "page" : "post";
      if (metodo === "POST") {
        const b = cuerpo();
        const nueva: PaginaDoble = {
          id: ++siguienteId,
          tipo,
          titulo: String(b.title ?? ""),
          contenido: String(b.content ?? ""),
          slug: String(b.title ?? "sin-titulo").toLowerCase().replace(/[^\w]+/g, "-"),
          status: String(b.status ?? "publish"),
          // Sin el plugin conector, WordPress ignora en silencio los metas no
          // registrados. Ese silencio es justo el fallo que hay que reproducir.
          meta: estado.conectorInstalado ? ((b.meta as Record<string, unknown>) ?? {}) : {},
          ...(b.excerpt !== undefined ? { extracto: String(b.excerpt) } : {}),
          ...(b.featured_media !== undefined ? { imagenDestacada: Number(b.featured_media) } : {}),
        };
        estado.contenido.push(nueva);
        return json(vista(nueva, base, true), 201);
      }
      return json(estado.contenido.filter((c) => c.tipo === tipo).map((c) => vista(c, base, false)));
    }

    const item = /^\/wp-json\/wp\/v2\/(pages|posts)\/(\d+)$/.exec(ruta);
    if (item) {
      const tipo = item[1] === "pages" ? "page" : "post";
      const id = Number(item[2]);
      const c = estado.contenido.find((x) => x.id === id && x.tipo === tipo);
      if (!c) return error("rest_post_invalid_id", "Identificador inválido.", 404);
      if (metodo === "POST") {
        const b = cuerpo();
        if (b.title !== undefined) c.titulo = String(b.title);
        if (b.content !== undefined) c.contenido = String(b.content);
        if (b.status !== undefined) c.status = String(b.status);
        if (b.comment_status !== undefined) c.comment_status = String(b.comment_status);
        if (b.excerpt !== undefined) c.extracto = String(b.excerpt);
        if (b.featured_media !== undefined) c.imagenDestacada = Number(b.featured_media);
        if (b.meta !== undefined && estado.conectorInstalado) {
          Object.assign(c.meta, b.meta as Record<string, unknown>);
        }
        return json(vista(c, base, true));
      }
      if (metodo === "DELETE") {
        c.status = "trash";
        return json({ id: c.id, status: "trash" });
      }
      return json(vista(c, base, url.searchParams.get("context") === "edit"));
    }

    return error("rest_no_route", `No existe la ruta ${ruta}.`, 404);
  };

  return { estado, fetch: fetchDoble, llamadas };
}

function vista(c: PaginaDoble, base: string, edit: boolean) {
  return {
    id: c.id,
    title: edit ? { raw: c.titulo, rendered: c.titulo } : { rendered: c.titulo },
    content: edit ? { raw: c.contenido, rendered: c.contenido } : { rendered: c.contenido },
    // WordPress devuelve el extracto envuelto en <p> al renderizarlo.
    excerpt: edit
      ? { raw: c.extracto ?? "", rendered: c.extracto ? `<p>${c.extracto}</p>` : "" }
      : { rendered: c.extracto ? `<p>${c.extracto}</p>` : "" },
    featured_media: c.imagenDestacada ?? 0,
    link: `${base}/${c.slug}/`,
    status: c.status,
    slug: c.slug,
    meta: c.meta,
    comment_status: c.comment_status ?? "open",
  };
}

function vistaPlantilla(p: PlantillaDoble) {
  return {
    id: p.id,
    title: { raw: p.titulo, rendered: p.titulo },
    status: p.status,
    meta: { _elementor_template_type: p.tipo, _elementor_data: p.data },
  };
}
