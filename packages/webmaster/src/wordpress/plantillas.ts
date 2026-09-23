/**
 * Plantillas de Elementor (header, footer, bloques globales) editadas sin plugin.
 *
 * Elementor guarda cada plantilla como un post `elementor_library` y su diseño
 * en el meta `_elementor_data`: un árbol JSON de contenedores y widgets. En los
 * sitios con Elementor reciente ese meta está expuesto en la API REST, así que
 * se puede leer y reescribir con la contraseña de aplicación, sin instalar el
 * plugin conector. Es lo mismo que haría una persona con la clave de la app.
 *
 * Este módulo es puro —sin red—: resume el árbol para que el modelo no reciba
 * cientos de líneas de JSON y aplica cambios acotados. Los cambios libres sobre
 * el JSON son exactamente la forma de romper un footer que sale en todo el sitio.
 */
import { randomBytes } from "node:crypto";

export type NodoElementor = {
  id: string;
  elType: string;
  widgetType?: string;
  settings?: Record<string, unknown>;
  elements?: NodoElementor[];
  isInner?: boolean;
};

export type WidgetResumido = {
  readonly id: string;
  readonly tipo: string;
  /** Id del contenedor que lo tiene. Es donde se añadiría uno nuevo a su lado. */
  readonly contenedor: string;
  readonly texto?: string;
  readonly enlaces?: readonly string[];
  /**
   * Los ajustes que se pueden cambiar y que este widget ya tiene puestos. Sin
   * esto el modelo cambiaría a ciegas: no sabría si el título está oculto o si
   * es que el widget no está. Solo van los de la lista blanca, que además es
   * lo único que podrá escribir después.
   */
  readonly ajustes?: Readonly<Record<string, unknown>>;
  /**
   * Para un widget de bucle: el id de la plantilla que dibuja CADA tarjeta.
   *
   * Es el dato que le faltaba al agente. Sin él sabía que la tarjeta se
   * decide en otra plantilla, pero no en cuál, y se iba a rastrearlo por el
   * navegador. Elementor lo guarda en `template_id` del propio widget, así
   * que se lee de ahí y se le da masticado. No se puede escribir: cambiarlo
   * repuntaría el listado entero a otro diseño.
   */
  readonly plantilla_del_bucle?: number;
};

export type ContenedorResumido = {
  readonly id: string;
  readonly tipo: string;
  readonly profundidad: number;
  readonly widgets: number;
};

/** Rutas del sitio, https, mailto y tel. Lo mismo que acepta el header global. */
export const PATRON_ENLACE = /^(\/[^\s"'<>]*|https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|tel:[+\d\s()-]+)$/i;

export function esEnlaceValido(url: string): boolean {
  return PATRON_ENLACE.test(url);
}

const escapar = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const quitarHtml = (s: string): string => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const esExterno = (url: string): boolean => /^https?:\/\//i.test(url);

/** Ids como los de Elementor: siete caracteres hexadecimales. */
function nuevoId(): string {
  return randomBytes(4).toString("hex").slice(0, 7);
}

function enlacesDe(s: Record<string, unknown>): string[] {
  const out: string[] = [];
  const link = s.link as { url?: unknown } | undefined;
  if (link && typeof link.url === "string" && link.url) out.push(link.url);
  for (const campo of ["editor", "title", "text"]) {
    const v = s[campo];
    if (typeof v === "string") for (const m of v.matchAll(/href="([^"]+)"/g)) if (m[1]) out.push(m[1]);
  }
  for (const lista of [s.social_icon_list, s.icon_list]) {
    if (!Array.isArray(lista)) continue;
    for (const item of lista) {
      const l = (item as { link?: { url?: unknown } }).link;
      if (l && typeof l.url === "string" && l.url) out.push(l.url);
    }
  }
  return [...new Set(out)].slice(0, 10);
}

/** El árbol en una forma que el modelo puede leer y citar por id. */
export function resumirPlantilla(data: readonly NodoElementor[]): {
  contenedores: ContenedorResumido[];
  widgets: WidgetResumido[];
} {
  const contenedores: ContenedorResumido[] = [];
  const widgets: WidgetResumido[] = [];
  const recorrer = (nodos: readonly NodoElementor[] | undefined, padre: string, profundidad: number) => {
    for (const n of nodos ?? []) {
      if (n.elType === "widget") {
        const s = n.settings ?? {};
        const texto = [s.title, s.text, s.editor]
          .filter((v): v is string => typeof v === "string")
          .map(quitarHtml)
          .filter(Boolean)
          .join(" · ")
          .slice(0, 160);
        const enlaces = enlacesDe(s);
        const ajustes = Object.fromEntries(
          Object.entries(s).filter(([k, v]) => ajustePermitido(k) && v !== "" && v != null),
        );
        const plantillaDelBucle = Number(s.template_id);
        widgets.push({
          id: n.id,
          tipo: n.widgetType ?? "widget",
          contenedor: padre,
          ...(texto ? { texto } : {}),
          ...(enlaces.length ? { enlaces } : {}),
          ...(Object.keys(ajustes).length ? { ajustes } : {}),
          ...(Number.isFinite(plantillaDelBucle) && plantillaDelBucle > 0
            ? { plantilla_del_bucle: plantillaDelBucle }
            : {}),
        });
      } else {
        contenedores.push({
          id: n.id,
          tipo: n.elType,
          profundidad,
          widgets: (n.elements ?? []).filter((e) => e.elType === "widget").length,
        });
        recorrer(n.elements, n.id, profundidad + 1);
      }
    }
  };
  recorrer(data, "", 0);
  return { contenedores, widgets };
}

/**
 * Los ajustes de un widget que se pueden tocar, por nombre o por patrón.
 *
 * Es lista BLANCA y no lista negra a propósito. El `_elementor_data` lleva
 * dentro cosas que no son diseño —condiciones de visualización, consultas,
 * identificadores internos— y dejar escribir cualquier clave es la forma de
 * romper una portada entera cambiando un título. Aquí solo entran las tres
 * familias que un cliente pide con palabras:
 *
 *  · **Qué se ve** (`show_*`, `link_to`, `excerpt_length`…): es lo que faltaba
 *    para que un listado de entradas enseñe el título y lleve al artículo.
 *  · **Cómo se reparte** (`columns`, `item_gap`, `image_size`, alineación).
 *  · **Con qué pinta** (color y tipografía): lo que hace que un bloque se
 *    integre con el resto del sitio en vez de parecer pegado encima.
 */
const AJUSTES_PERMITIDOS: readonly (string | RegExp)[] = [
  // Qué se muestra y a dónde lleva.
  /^show_[a-z0-9_]+$/,
  "link_to",
  "open_new_tab",
  "excerpt_length",
  "title_tag",
  "header_size",
  "html_tag",
  // Cómo se reparte. Aquí entra `posts_per_page`, que es cuántas entradas
  // enseña el listado: es una decisión del cliente sobre su blog, no una
  // consulta que pueda dejar la página pintando cualquier cosa.
  /^columns(_tablet|_mobile)?$/,
  /^(row|column)_gap$/,
  "item_gap",
  "posts_per_page",
  "image_size",
  "thumbnail_size",
  "aspect_ratio",
  "item_ratio",
  "image_ratio",
  "align",
  "text_align",
  "alignment",
  // Con qué pinta.
  /^(title|text|heading|excerpt|meta|link)_color$/,
  "color",
  "background_color",
  /^typography_(typography|font_family|font_size|font_weight|line_height|letter_spacing|text_transform)$/,
  "border_radius",
];

export function ajustePermitido(clave: string): boolean {
  return AJUSTES_PERMITIDOS.some((p) => (typeof p === "string" ? p === clave : p.test(clave)));
}

/**
 * Widgets que se pueden AÑADIR a una plantilla, además de los de texto.
 *
 * Son los dinámicos del tema: no llevan contenido propio, lo sacan de la
 * entrada que se esté pintando. Por eso son los que arreglan un listado al que
 * le falta el título, y por eso la lista es corta: un widget que no exista en
 * el sitio deja un hueco roto en todas las entradas a la vez.
 */
export const WIDGETS_DINAMICOS = [
  "theme-post-title",
  "theme-post-excerpt",
  "theme-post-featured-image",
  "theme-post-content",
  "post-info",
] as const;

export type WidgetDinamico = (typeof WIDGETS_DINAMICOS)[number];

/** Valores que aceptan los ajustes: primitivos y las dos cajas de Elementor. */
export type ValorAjuste =
  | string
  | number
  | boolean
  | { unit: string; size: number }
  | { unit: string; top: string; right: string; bottom: string; left: string; isLinked?: boolean };

type Alineacion = "left" | "center" | "right";
type Posicion = "inicio" | "final";

export type CambioPlantilla =
  | {
      accion: "anadir_enlace";
      texto: string;
      url: string;
      contenedor_id?: string | undefined;
      alineacion?: Alineacion | undefined;
      posicion?: Posicion | undefined;
    }
  | {
      accion: "anadir_texto";
      html: string;
      contenedor_id?: string | undefined;
      alineacion?: Alineacion | undefined;
      posicion?: Posicion | undefined;
    }
  | {
      accion: "anadir_boton";
      texto: string;
      url: string;
      contenedor_id?: string | undefined;
      posicion?: Posicion | undefined;
    }
  | { accion: "cambiar_texto"; widget_id: string; texto: string }
  | { accion: "cambiar_enlace"; widget_id: string; url: string }
  | { accion: "cambiar_ajustes"; widget_id: string; ajustes: Record<string, ValorAjuste> }
  | {
      accion: "anadir_widget";
      tipo: WidgetDinamico;
      contenedor_id?: string | undefined;
      posicion?: Posicion | undefined;
      ajustes?: Record<string, ValorAjuste> | undefined;
    }
  | { accion: "eliminar_widget"; widget_id: string };

function buscar(
  nodos: NodoElementor[],
  pred: (n: NodoElementor) => boolean,
  padre: NodoElementor | null = null,
): { nodo: NodoElementor; padre: NodoElementor | null; lista: NodoElementor[] } | null {
  for (const n of nodos) {
    if (pred(n)) return { nodo: n, padre, lista: nodos };
    const dentro = buscar(n.elements ?? [], pred, n);
    if (dentro) return dentro;
  }
  return null;
}

/** Donde se añade un widget: el contenedor pedido o el primero que ya tiene widgets. */
function destino(data: NodoElementor[], contenedorId?: string): NodoElementor {
  if (contenedorId) {
    const hallado = buscar(data, (n) => n.id === contenedorId && n.elType !== "widget");
    if (!hallado) throw new Error(`No existe el contenedor ${contenedorId} en la plantilla.`);
    return hallado.nodo;
  }
  const conWidgets = buscar(
    data,
    (n) => n.elType !== "widget" && (n.elements ?? []).some((e) => e.elType === "widget"),
  );
  const primero = conWidgets?.nodo ?? data.find((n) => n.elType !== "widget");
  if (!primero) throw new Error("La plantilla está vacía: no hay ningún contenedor donde añadir.");
  return primero;
}

function insertar(contenedor: NodoElementor, widget: NodoElementor, posicion: Posicion = "final"): void {
  contenedor.elements ??= [];
  if (posicion === "inicio") contenedor.elements.unshift(widget);
  else contenedor.elements.push(widget);
}

function exigirEnlace(url: string): void {
  if (!esEnlaceValido(url)) {
    throw new Error("Usa una ruta del sitio (/contacto/) o una dirección completa (https://…, mailto:…, tel:…).");
  }
}

/**
 * Aplica UN cambio sobre una copia del árbol. Nunca muta la entrada: el árbol
 * original es el backup y tiene que llegar intacto.
 */
export function aplicarCambio(
  data: readonly NodoElementor[],
  cambio: CambioPlantilla,
): { data: NodoElementor[]; widgetId: string } {
  const copia = structuredClone(data) as NodoElementor[];

  switch (cambio.accion) {
    case "anadir_enlace": {
      exigirEnlace(cambio.url);
      const id = nuevoId();
      const destinoExterno = esExterno(cambio.url) ? ' target="_blank" rel="noopener"' : "";
      insertar(
        destino(copia, cambio.contenedor_id),
        {
          id,
          elType: "widget",
          widgetType: "text-editor",
          settings: {
            editor: `<p style="text-align:${cambio.alineacion ?? "center"}"><a href="${escapar(cambio.url)}"${destinoExterno}>${escapar(cambio.texto)}</a></p>`,
          },
          elements: [],
        },
        cambio.posicion,
      );
      return { data: copia, widgetId: id };
    }
    case "anadir_texto": {
      const id = nuevoId();
      const html = cambio.html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, "");
      insertar(
        destino(copia, cambio.contenedor_id),
        {
          id,
          elType: "widget",
          widgetType: "text-editor",
          settings: { editor: `<div style="text-align:${cambio.alineacion ?? "center"}">${html}</div>` },
          elements: [],
        },
        cambio.posicion,
      );
      return { data: copia, widgetId: id };
    }
    case "anadir_boton": {
      exigirEnlace(cambio.url);
      const id = nuevoId();
      insertar(
        destino(copia, cambio.contenedor_id),
        {
          id,
          elType: "widget",
          widgetType: "button",
          settings: {
            text: cambio.texto,
            link: { url: cambio.url, is_external: esExterno(cambio.url), nofollow: false },
            align: "center",
          },
          elements: [],
        },
        cambio.posicion,
      );
      return { data: copia, widgetId: id };
    }
    case "cambiar_texto": {
      const hallado = buscar(copia, (n) => n.id === cambio.widget_id && n.elType === "widget");
      if (!hallado) throw new Error(`No existe el widget ${cambio.widget_id} en la plantilla.`);
      const s = (hallado.nodo.settings ??= {});
      switch (hallado.nodo.widgetType) {
        case "heading":
          s.title = cambio.texto;
          break;
        case "button":
          s.text = cambio.texto;
          break;
        case "text-editor":
          s.editor = `<p>${escapar(cambio.texto)}</p>`;
          break;
        default:
          throw new Error(
            `No sé cambiar el texto de un widget «${hallado.nodo.widgetType}». Se puede con heading, button o text-editor.`,
          );
      }
      return { data: copia, widgetId: cambio.widget_id };
    }
    case "cambiar_enlace": {
      exigirEnlace(cambio.url);
      const hallado = buscar(copia, (n) => n.id === cambio.widget_id && n.elType === "widget");
      if (!hallado) throw new Error(`No existe el widget ${cambio.widget_id} en la plantilla.`);
      const s = (hallado.nodo.settings ??= {});
      if (hallado.nodo.widgetType === "text-editor" && typeof s.editor === "string" && /href="[^"]*"/.test(s.editor)) {
        s.editor = s.editor.replace(/href="[^"]*"/, `href="${escapar(cambio.url)}"`);
      } else if (["button", "heading", "image", "icon", "icon-box", "image-box"].includes(hallado.nodo.widgetType ?? "")) {
        const actual = (s.link as Record<string, unknown> | undefined) ?? {};
        s.link = { ...actual, url: cambio.url, is_external: esExterno(cambio.url) };
      } else {
        throw new Error(`El widget «${hallado.nodo.widgetType}» no tiene un enlace que se pueda cambiar así.`);
      }
      return { data: copia, widgetId: cambio.widget_id };
    }
    case "cambiar_ajustes": {
      const hallado = buscar(copia, (n) => n.id === cambio.widget_id && n.elType === "widget");
      if (!hallado) throw new Error(`No existe el widget ${cambio.widget_id} en la plantilla.`);
      const claves = Object.keys(cambio.ajustes);
      if (claves.length === 0) throw new Error("No dijiste qué ajuste cambiar.");
      const prohibidas = claves.filter((k) => !ajustePermitido(k));
      if (prohibidas.length) {
        throw new Error(
          `No puedo tocar ${prohibidas.join(", ")} de un widget. Se pueden cambiar los ajustes de qué se ve ` +
            `(show_title, show_excerpt, link_to, excerpt_length…), de reparto (columns, image_size, align) ` +
            `y de aspecto (title_color, text_color, typography_font_family, typography_font_size…).`,
        );
      }
      // Un loop-grid no dibuja la tarjeta: la dibuja su plantilla loop-item.
      // Aceptar aquí un `show_title` sería escribir un ajuste que Elementor
      // ignora, y el agente se quedaría convencido de haberlo arreglado. Pasó
      // el 22-sep con el blog de Vox: puso show_title y link_to en el
      // loop-grid, no cambió nada, y cerró el encargo como hecho.
      const tipo = hallado.nodo.widgetType ?? "";
      if (/^loop-(grid|carousel)$/.test(tipo)) {
        const deLaTarjeta = claves.filter((k) => /^show_/.test(k) || k === "link_to");
        if (deLaTarjeta.length) {
          const plantilla = Number(hallado.nodo.settings?.template_id);
          const cual =
            Number.isFinite(plantilla) && plantilla > 0
              ? `la plantilla ${plantilla}`
              : `su plantilla de bucle (la verás como loop-item en wp_listar_plantillas_elementor)`;
          throw new Error(
            `Un widget «${tipo}» no decide qué lleva cada tarjeta: eso está en ${cual}, y ` +
              `${deLaTarjeta.join(", ")} aquí no hace nada. Ve allí con wp_leer_plantilla_elementor y ` +
              `arréglalo con wp_editar_plantilla_elementor: si no tiene theme-post-title, añádelo con ` +
              `anadir_widget; si la foto abre la imagen en vez de llevar al artículo, pon link_to en "post" ` +
              `en su theme-post-featured-image.`,
          );
        }
      }
      const s = (hallado.nodo.settings ??= {});
      for (const [clave, valor] of Object.entries(cambio.ajustes)) s[clave] = valor;
      return { data: copia, widgetId: cambio.widget_id };
    }
    case "anadir_widget": {
      if (!WIDGETS_DINAMICOS.includes(cambio.tipo)) {
        throw new Error(`No sé añadir un widget «${cambio.tipo}». Puedo con: ${WIDGETS_DINAMICOS.join(", ")}.`);
      }
      const prohibidas = Object.keys(cambio.ajustes ?? {}).filter((k) => !ajustePermitido(k));
      if (prohibidas.length) throw new Error(`No puedo poner ${prohibidas.join(", ")} en un widget nuevo.`);
      const id = nuevoId();
      insertar(
        destino(copia, cambio.contenedor_id),
        {
          id,
          elType: "widget",
          widgetType: cambio.tipo,
          settings: { ...(cambio.ajustes ?? {}) },
          elements: [],
        },
        cambio.posicion,
      );
      return { data: copia, widgetId: id };
    }
    case "eliminar_widget": {
      const hallado = buscar(copia, (n) => n.id === cambio.widget_id && n.elType === "widget");
      if (!hallado) throw new Error(`No existe el widget ${cambio.widget_id} en la plantilla.`);
      hallado.lista.splice(hallado.lista.indexOf(hallado.nodo), 1);
      return { data: copia, widgetId: cambio.widget_id };
    }
  }
}
