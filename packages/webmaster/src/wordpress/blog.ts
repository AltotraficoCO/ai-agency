/**
 * Que una entrada nueva aparezca en el blog del sitio.
 *
 * El caso de producción: las entradas se publicaron, pero la página /blog/ del
 * cliente es un diseño estático de Elementor y no las lista. Ahí había cuatro
 * tarjetas de relleno («[Título del artículo]», «[Breve extracto del
 * artículo]… Leer más»), y en ese sitio en concreto las cuatro son IMÁGENES
 * con ese texto pintado dentro: no hay nada que editar como texto.
 *
 * Tres casos, de mejor a peor:
 *   1. el blog lista las entradas solo (widget de posts): no se toca nada;
 *   2. hay tarjetas de relleno con TEXTO: se rellena una, conservando la foto;
 *   3. no hay tarjetas de texto: se añade (o amplía) una sección «Artículos
 *      recientes» con el estilo del sitio, encima de las tarjetas de imagen.
 *
 * Módulo puro, sin red: trabaja sobre el `_elementor_data` y nunca muta la
 * entrada, que es el backup.
 */
import { randomBytes } from "node:crypto";
import type { Estilo } from "./diseno.js";
import { primitivasDeEstilo } from "./elementor.js";
import type { NodoElementor } from "./plantillas.js";

export const CLASE_SECCION_ENTRADAS = "strappy-entradas-recientes";
export const CLASE_REJILLA_ENTRADAS = "strappy-entradas-rejilla";

/** Texto de relleno: «[Título del artículo]», «Lorem ipsum…». */
const RELLENO = /\[[^\]\n]{3,80}\]|lorem ipsum|dolor sit amet/i;
const CORCHETES = /\[[^\]\n]{3,80}\](\s*(\.{3}|…))?/;
const PIDE_TITULO = /t[ií]tulo|title|titular/i;
const LEER_MAS = /(?:leer|ver)\s+m[aá]s|read more/i;
const WIDGET_LISTADO = /(^|-)posts?($|-)|loop-(grid|carousel)|recent-posts|blog-(grid|list)/i;

export type EntradaParaBlog = {
  readonly titulo: string;
  readonly extracto: string;
  readonly url: string;
  readonly categoria?: string | undefined;
};

export type TarjetaDeRelleno = {
  /** Id del contenedor que es la tarjeta. */
  readonly contenedor: string;
  /** Id del widget con el título de relleno. */
  readonly tituloWidget: string;
  /** Textos reales de la tarjeta (p. ej. la categoría «Derecho Público»). */
  readonly etiquetas: readonly string[];
};

const nuevoId = (): string => randomBytes(4).toString("hex").slice(0, 7);

const escapar = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const quitarHtml = (s: string): string => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const normalizar = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();

function textoDe(n: NodoElementor): string {
  const s = n.settings ?? {};
  return ["title", "editor", "text", "title_text", "description_text"]
    .map((k) => s[k])
    .filter((v): v is string => typeof v === "string")
    .join(" ");
}

function widgetsDe(n: NodoElementor): NodoElementor[] {
  if (n.elType === "widget") return [n];
  return (n.elements ?? []).flatMap(widgetsDe);
}

function buscar(
  lista: NodoElementor[],
  pred: (n: NodoElementor) => boolean,
): { nodo: NodoElementor; lista: NodoElementor[] } | null {
  for (const n of lista) {
    if (pred(n)) return { nodo: n, lista };
    const dentro = buscar(n.elements ?? [], pred);
    if (dentro) return dentro;
  }
  return null;
}

const tieneClase = (n: NodoElementor, clase: string): boolean =>
  String(n.settings?._css_classes ?? "")
    .split(/\s+/)
    .includes(clase);

/** El blog ya lista las entradas con un widget: una entrada nueva sale sola. */
export function tieneListadoDinamico(data: readonly NodoElementor[]): boolean {
  const recorrer = (lista: readonly NodoElementor[] | undefined): boolean =>
    (lista ?? []).some(
      (n) => (n.elType === "widget" && WIDGET_LISTADO.test(n.widgetType ?? "")) || recorrer(n.elements),
    );
  return recorrer(data);
}

/** La página ya enlaza esa entrada. */
export function enlazaA(data: readonly NodoElementor[], url: string, id: number): boolean {
  const json = JSON.stringify(data);
  const sinBarra = url.replace(/\/+$/, "");
  return (sinBarra.length > 8 && json.includes(sinBarra)) || json.includes(`?p=${id}"`);
}

/**
 * Las tarjetas de relleno con texto. Una tarjeta es el contenedor más alto
 * (hasta dos niveles sobre el título, sin llegar al primer nivel de la página)
 * que tiene UN solo título de relleno: así incluye la foto y la categoría sin
 * tragarse la tarjeta de al lado.
 */
export function buscarTarjetasDeRelleno(data: readonly NodoElementor[]): TarjetaDeRelleno[] {
  const widgets: { nodo: NodoElementor; ancestros: NodoElementor[] }[] = [];
  const recorrer = (lista: readonly NodoElementor[] | undefined, ancestros: NodoElementor[]) => {
    for (const n of lista ?? []) {
      if (n.elType === "widget") widgets.push({ nodo: n, ancestros });
      else recorrer(n.elements, [...ancestros, n]);
    }
  };
  recorrer(data, []);

  const conRelleno = widgets.filter((w) => RELLENO.test(textoDe(w.nodo)));
  // Primero los que dicen ser un título; si ninguno lo dice, los encabezados.
  let titulos = conRelleno.filter((w) => PIDE_TITULO.test(textoDe(w.nodo)));
  if (titulos.length === 0) titulos = conRelleno.filter((w) => w.nodo.widgetType === "heading");

  const ids = new Set(titulos.map((t) => t.nodo.id));
  const cuenta = (n: NodoElementor): number =>
    n.elType === "widget" ? (ids.has(n.id) ? 1 : 0) : (n.elements ?? []).reduce((a, e) => a + cuenta(e), 0);

  const out: TarjetaDeRelleno[] = [];
  for (const t of titulos) {
    const { ancestros } = t;
    if (ancestros.length === 0) continue;
    let i = ancestros.length - 1;
    let subidas = 0;
    while (i - 1 >= 1 && subidas < 2 && cuenta(ancestros[i - 1]!) === 1) {
      i--;
      subidas++;
    }
    const tarjeta = ancestros[i]!;
    const etiquetas = widgetsDe(tarjeta)
      .filter((w) => w.id !== t.nodo.id && (w.widgetType === "heading" || w.widgetType === "text-editor"))
      .map((w) => quitarHtml(textoDe(w)))
      .filter((x) => x.length > 0 && x.length <= 60 && !RELLENO.test(x) && !LEER_MAS.test(x));
    out.push({ contenedor: tarjeta.id, tituloWidget: t.nodo.id, etiquetas });
  }
  return out;
}

/** La tarjeta cuya categoría se parece más al tema de la entrada; si ninguna, la primera. */
export function elegirTarjeta(tarjetas: readonly TarjetaDeRelleno[], categoria?: string): TarjetaDeRelleno {
  if (tarjetas.length === 0) throw new Error("No hay tarjetas de relleno que rellenar.");
  if (categoria) {
    const buscada = normalizar(categoria);
    const afin = tarjetas.find((t) =>
      t.etiquetas.some((e) => {
        const n = normalizar(e);
        return n.includes(buscada) || buscada.includes(n);
      }),
    );
    if (afin) return afin;
  }
  return tarjetas[0]!;
}

function contarRelleno(n: NodoElementor): number {
  return widgetsDe(n).filter((w) => RELLENO.test(textoDe(w))).length;
}

/** Enlaza «Leer más» a la entrada: cambia el href si ya es un enlace, o lo convierte en uno. */
function enlazarLeerMas(html: string, url: string): string {
  const conEnlace = /(<a\b[^>]*href=")[^"]*("[^>]*>\s*(?:leer|ver)\s+m[aá]s)/i;
  if (conEnlace.test(html)) return html.replace(conEnlace, `$1${escapar(url)}$2`);
  return html.replace(/((?:leer|ver)\s+m[aá]s|read more)/i, `<a href="${escapar(url)}">$1</a>`);
}

/**
 * Rellena UNA tarjeta con la entrada real: título enlazado, extracto, «Leer
 * más» y la foto enlazados a la entrada. La foto se conserva.
 */
export function rellenarTarjeta(
  data: readonly NodoElementor[],
  tarjeta: TarjetaDeRelleno,
  entrada: EntradaParaBlog,
): { data: NodoElementor[]; cambiados: string[]; quedanDeRelleno: number } {
  const copia = structuredClone(data) as NodoElementor[];
  const hallada = buscar(copia, (n) => n.id === tarjeta.contenedor && n.elType !== "widget");
  if (!hallada) throw new Error(`No existe la tarjeta ${tarjeta.contenedor} en la página del blog.`);
  const nodo = hallada.nodo;
  const enlace = { url: entrada.url, is_external: false, nofollow: false };
  const cambiados = new Set<string>();
  let extractoPuesto = false;
  let junto: { lista: NodoElementor[]; indice: number } | null = null;

  const recorrer = (lista: NodoElementor[]) => {
    lista.forEach((w, indice) => {
      if (w.elType !== "widget") return recorrer(w.elements ?? []);
      const s = (w.settings ??= {});
      const texto = textoDe(w);

      if (w.id === tarjeta.tituloWidget) {
        if (w.widgetType === "text-editor") {
          s.editor = `<h3><a href="${escapar(entrada.url)}">${escapar(entrada.titulo)}</a></h3>`;
        } else if (w.widgetType === "heading") {
          s.title = escapar(entrada.titulo);
          s.link = enlace;
        } else {
          s.title_text = escapar(entrada.titulo);
          s.link = enlace;
        }
        junto = { lista, indice };
        cambiados.add(w.id);
        return;
      }

      switch (w.widgetType) {
        case "text-editor": {
          let html = String(s.editor ?? "");
          const conRelleno = RELLENO.test(quitarHtml(html));
          if (!conRelleno && !LEER_MAS.test(html)) return;
          if (LEER_MAS.test(html)) html = enlazarLeerMas(html, entrada.url);
          if (conRelleno && !extractoPuesto) {
            html = CORCHETES.test(html)
              ? html.replace(CORCHETES, `${escapar(entrada.extracto)} `)
              : `<p>${escapar(entrada.extracto)} <a href="${escapar(entrada.url)}">Leer más</a></p>`;
            extractoPuesto = true;
          } else if (conRelleno && entrada.categoria && CORCHETES.test(html)) {
            html = html.replace(CORCHETES, escapar(entrada.categoria));
          }
          s.editor = html;
          cambiados.add(w.id);
          return;
        }
        case "heading":
          if (RELLENO.test(texto) && entrada.categoria) {
            s.title = escapar(entrada.categoria);
            cambiados.add(w.id);
          } else if (LEER_MAS.test(texto)) {
            s.link = enlace;
            cambiados.add(w.id);
          }
          return;
        case "button":
          s.link = enlace;
          if (typeof s.text !== "string" || !s.text.trim() || RELLENO.test(s.text)) s.text = "Leer más";
          cambiados.add(w.id);
          return;
        case "image":
          s.link_to = "custom";
          s.link = enlace;
          cambiados.add(w.id);
          return;
        case "image-box":
        case "icon-box":
          s.link = enlace;
          if (!extractoPuesto && typeof s.description_text === "string" && RELLENO.test(s.description_text)) {
            s.description_text = escapar(entrada.extracto);
            extractoPuesto = true;
          }
          cambiados.add(w.id);
          return;
      }
    });
  };
  recorrer(nodo.elements ?? []);

  // Una tarjeta sin sitio para el extracto lo recibe justo debajo del título.
  const lugar = junto as { lista: NodoElementor[]; indice: number } | null;
  if (!extractoPuesto && lugar) {
    const id = nuevoId();
    lugar.lista.splice(lugar.indice + 1, 0, {
      id,
      elType: "widget",
      widgetType: "text-editor",
      settings: {
        editor: `<p>${escapar(entrada.extracto)} <a href="${escapar(entrada.url)}">Leer más</a></p>`,
      },
      elements: [],
    });
    cambiados.add(id);
  }
  return { data: copia, cambiados: [...cambiados], quedanDeRelleno: contarRelleno(nodo) };
}

// ---------------------------------------------------------------------------
// Tarjetas que son solo imágenes
// ---------------------------------------------------------------------------

const esImagenSinEnlace = (n: NodoElementor): boolean => {
  if (n.elType !== "widget" || n.widgetType !== "image") return false;
  const link = n.settings?.link as { url?: unknown } | undefined;
  return !(typeof link?.url === "string" && link.url) && (n.settings?.link_to ?? "none") !== "custom";
};

const esTarjetaDeImagen = (n: NodoElementor): boolean =>
  n.elType !== "widget" && (n.elements?.length ?? 0) > 0 && n.elements!.every(esImagenSinEnlace);

/**
 * Rejillas de tarjetas que son solo una imagen sin enlace: dos o más hermanas.
 * Es lo que tiene el blog de producción, con el texto de relleno dentro del PNG.
 */
export function tarjetasDeImagen(data: readonly NodoElementor[]): { total: number; indiceRaiz: number } {
  let total = 0;
  let indiceRaiz = -1;
  const recorrer = (lista: readonly NodoElementor[] | undefined, raiz: number) => {
    for (const [i, n] of (lista ?? []).entries()) {
      if (n.elType === "widget") continue;
      const hijos = n.elements ?? [];
      const tarjetas = hijos.filter((h) => esTarjetaDeImagen(h) || esImagenSinEnlace(h)).length;
      const r = raiz < 0 ? i : raiz;
      if (tarjetas >= 2) {
        total += tarjetas;
        if (indiceRaiz < 0) indiceRaiz = r;
        continue;
      }
      recorrer(hijos, r);
    }
  };
  recorrer(data, -1);
  return { total, indiceRaiz };
}

// ---------------------------------------------------------------------------
// Sección «Artículos recientes»
// ---------------------------------------------------------------------------

const px = (size: number) => ({ unit: "px", size, sizes: [] });
const hueco = (size: number) => ({ unit: "px", size, column: String(size), row: String(size) });
const caja = (v: number, h: number) => ({
  unit: "px",
  top: String(v),
  right: String(h),
  bottom: String(v),
  left: String(h),
  isLinked: v === h,
});
const radio = (r: number) => ({ unit: "px", top: String(r), right: String(r), bottom: String(r), left: String(r), isLinked: true });

function widgetsDeTarjeta(e: Estilo, entrada: EntradaParaBlog): NodoElementor[] {
  const w = primitivasDeEstilo(e);
  const titulo = w.heading(entrada.titulo, e.colores.primario, e.tipografia.h3, "h3", "left");
  titulo.settings.link = { url: entrada.url, is_external: false, nofollow: false };
  return [
    ...(entrada.categoria ? [w.heading(entrada.categoria, e.colores.acento, 15, "div", "left")] : []),
    titulo,
    w.parrafo(escapar(entrada.extracto), e.colores.texto, "left"),
    w.boton("Leer más", entrada.url, undefined, undefined, "left"),
  ] as unknown as NodoElementor[];
}

function tarjetaContenedor(e: Estilo, entrada: EntradaParaBlog): NodoElementor {
  return {
    id: nuevoId(),
    elType: "container",
    isInner: true,
    settings: {
      content_width: "full",
      width: { unit: "%", size: 31, sizes: [] },
      width_tablet: { unit: "%", size: 48, sizes: [] },
      width_mobile: { unit: "%", size: 100, sizes: [] },
      flex_direction: "column",
      flex_gap: hueco(12),
      background_background: "classic",
      background_color: e.colores.tarjeta,
      border_radius: radio(e.radio_tarjeta),
      padding: caja(32, 28),
    },
    elements: widgetsDeTarjeta(e, entrada),
  };
}

function recalcularColumnas(fila: NodoElementor): void {
  const columnas = fila.elements ?? [];
  for (const c of columnas) (c.settings ??= {})._column_size = Math.floor(100 / Math.max(1, columnas.length));
}

/**
 * Añade la entrada a la sección «Artículos recientes» del blog, creándola la
 * primera vez encima de las tarjetas de imagen (o al final). La más nueva va
 * primero. Usa contenedores o secciones según esté hecha la página.
 */
export function insertarEntradaReciente(
  data: readonly NodoElementor[],
  entrada: EntradaParaBlog,
  estilo: Estilo,
): { data: NodoElementor[]; seccion: string; yaExistia: boolean } {
  const copia = structuredClone(data) as NodoElementor[];
  const w = primitivasDeEstilo(estilo);
  const conContenedores = !copia.some((n) => n.elType === "section");

  const tarjetaNueva = (): NodoElementor =>
    conContenedores
      ? tarjetaContenedor(estilo, entrada)
      : (w.columna(widgetsDeTarjeta(estilo, entrada) as never, 33, estilo.colores.tarjeta, [32, 28]) as unknown as NodoElementor);

  const rejillaNueva = (): NodoElementor => {
    const rejilla = conContenedores
      ? ({
          id: nuevoId(),
          elType: "container",
          isInner: true,
          settings: {
            content_width: "full",
            flex_direction: "row",
            flex_wrap: "wrap",
            flex_gap: hueco(24),
            flex_justify_content: "center",
          },
          elements: [tarjetaNueva()],
        } as NodoElementor)
      : (w.seccion([tarjetaNueva() as never], { interior: true }) as unknown as NodoElementor);
    (rejilla.settings ??= {})._css_classes = CLASE_REJILLA_ENTRADAS;
    if (!conContenedores) recalcularColumnas(rejilla);
    return rejilla;
  };

  const existente = copia.find((n) => tieneClase(n, CLASE_SECCION_ENTRADAS));
  if (existente) {
    const hallada = buscar(existente.elements ?? [], (n) => tieneClase(n, CLASE_REJILLA_ENTRADAS));
    if (!hallada) {
      // Alguien quitó la rejilla a mano: se vuelve a poner dentro de la sección.
      const destino = conContenedores ? existente : (existente.elements?.[0] ?? existente);
      (destino.elements ??= []).push(rejillaNueva());
    } else if (conContenedores) {
      (hallada.nodo.elements ??= []).unshift(tarjetaNueva());
    } else if ((hallada.nodo.elements?.length ?? 0) >= 3) {
      hallada.lista.splice(hallada.lista.indexOf(hallada.nodo), 0, rejillaNueva());
    } else {
      (hallada.nodo.elements ??= []).unshift(tarjetaNueva());
      recalcularColumnas(hallada.nodo);
    }
    return { data: copia, seccion: existente.id, yaExistia: true };
  }

  const encabezado = w.heading("Artículos recientes", estilo.colores.primario, estilo.tipografia.h2, "h2") as unknown as NodoElementor;
  const seccion: NodoElementor = conContenedores
    ? {
        id: nuevoId(),
        elType: "container",
        settings: {
          content_width: "boxed",
          boxed_width: px(estilo.ancho),
          flex_direction: "column",
          flex_gap: hueco(24),
          padding: caja(40, 20),
        },
        elements: [encabezado, rejillaNueva()],
      }
    : (w.seccion([w.columna([encabezado as never, rejillaNueva() as never], 100)], { relleno: 40 }) as unknown as NodoElementor);
  (seccion.settings ??= {})._css_classes = CLASE_SECCION_ENTRADAS;

  const { indiceRaiz } = tarjetasDeImagen(copia);
  if (indiceRaiz >= 0) copia.splice(indiceRaiz, 0, seccion);
  else copia.push(seccion);
  return { data: copia, seccion: seccion.id, yaExistia: false };
}
