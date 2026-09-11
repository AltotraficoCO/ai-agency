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
        widgets.push({
          id: n.id,
          tipo: n.widgetType ?? "widget",
          contenedor: padre,
          ...(texto ? { texto } : {}),
          ...(enlaces.length ? { enlaces } : {}),
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
    case "eliminar_widget": {
      const hallado = buscar(copia, (n) => n.id === cambio.widget_id && n.elType === "widget");
      if (!hallado) throw new Error(`No existe el widget ${cambio.widget_id} en la plantilla.`);
      hallado.lista.splice(hallado.lista.indexOf(hallado.nodo), 1);
      return { data: copia, widgetId: cambio.widget_id };
    }
  }
}
