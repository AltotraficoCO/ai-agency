/**
 * Constructor de secciones Elementor.
 *
 * Portado tal cual del proyecto anterior, incluida la decisión que más caro
 * costó aprender: se usan SOLO widgets primitivos (heading, text-editor,
 * button). Elementor puede tener `icon-box`, `counter`, `testimonial` o
 * `toggle` desactivados por el Element Manager, y cuando eso pasa NO da error:
 * los omite en silencio y el cliente recibe una página con secciones vacías.
 *
 * Lo que cambió: el aspecto ya no está escrito aquí. Colores, tipografías,
 * radios, botones y ancho salen del `Estilo` que se lee del sitio
 * (`diseno.ts`), porque una entrada nueva negra y naranja sobre un sitio azul
 * marino y dorado no es «acorde al diseño». Y no se pintan emojis como iconos:
 * las tarjetas se numeran con el acento, que es lo que haría el sitio.
 *
 * Los identificadores de elemento son aleatorios porque Elementor los exige
 * únicos dentro del documento; no significan nada más.
 */
import { ESTILO_POR_DEFECTO, type Estilo } from "./diseno.js";
import { esEnlaceValido } from "./plantillas.js";

/** Un botón sin destino real es un botón roto: no se pinta. */
const conDestino = (url: string | undefined): url is string => typeof url === "string" && esEnlaceValido(url);

/** El HTML del modelo va al sitio del cliente: fuera scripts, manejadores y `javascript:`. */
function sanear(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?(<\/\1\s*>|$)/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

export type Paleta = {
  readonly fondo: string;
  readonly acento: string;
  readonly texto: string;
  readonly fondo_claro: string;
};

/** Solo como último recurso (ver `ESTILO_POR_DEFECTO`). */
export const PALETA_POR_DEFECTO: Paleta = {
  fondo: "#17150F",
  acento: "#FF4D00",
  texto: "#F5F0E4",
  fondo_claro: "#F5F0E4",
};

export type ItemSeccion = {
  titulo?: string;
  texto?: string;
  icono?: string;
  cifra?: string;
  etiqueta?: string;
  autor?: string;
  cargo?: string;
  pregunta?: string;
  respuesta?: string;
};

export type PlanPrecio = {
  nombre: string;
  precio: string;
  periodo?: string;
  incluye: string[];
  boton?: string;
  destacado?: boolean;
};

export type TipoSeccion =
  | "hero"
  | "beneficios"
  | "stats"
  | "testimonios"
  | "precios"
  | "faq"
  | "cta"
  | "texto";

export type SeccionSpec = {
  tipo: TipoSeccion;
  titulo?: string;
  subtitulo?: string;
  boton?: string;
  boton_url?: string;
  html?: string;
  items?: ItemSeccion[];
  planes?: PlanPrecio[];
};

type Widget = { id: string; elType: string; widgetType?: string; settings: Record<string, unknown> };
type Columna = {
  id: string;
  elType: "column";
  settings: Record<string, unknown>;
  elements: (Widget | Seccion)[];
};
type Seccion = {
  id: string;
  elType: "section";
  isInner?: boolean;
  settings: Record<string, unknown>;
  elements: Columna[];
};

const eid = (): string => Math.random().toString(16).slice(2, 9);

/** Los emojis no son iconos del sitio: se quitan de todo lo que se pinta. */
export function sinEmojis(texto: string): string {
  return texto
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]️?/gu, "")
    .replace(/‍/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const px = (size: number) => ({ unit: "px", size, sizes: [] });
const caja4 = (arriba: number, lado: number, abajo = arriba) => ({
  unit: "px",
  top: String(arriba),
  right: String(lado),
  bottom: String(abajo),
  left: String(lado),
  isLinked: arriba === lado && abajo === arriba,
});
const radio = (r: number) => ({ unit: "px", top: String(r), right: String(r), bottom: String(r), left: String(r), isLinked: true });

/** Los widgets básicos ya vestidos con el estilo del sitio. */
export function primitivasDeEstilo(e: Estilo) {
  const { colores: c, tipografia: t } = e;
  const familia = (f: string | null) => (f ? { typography_font_family: f } : {});

  const heading = (
    txt: string,
    color: string,
    size: number,
    tag = "h2",
    align: string = e.alineacion_titulos,
  ): Widget => ({
    id: eid(),
    elType: "widget",
    widgetType: "heading",
    settings: {
      title: sinEmojis(txt),
      align,
      header_size: tag,
      title_color: color,
      typography_typography: "custom",
      ...familia(t.titulos.familia),
      typography_font_size: px(size),
      typography_font_weight: t.titulos.grosor,
      typography_line_height: { unit: "em", size: 1.2, sizes: [] },
    },
  });

  const parrafo = (html: string, color: string, align = "center", size = t.cuerpo_px): Widget => ({
    id: eid(),
    elType: "widget",
    widgetType: "text-editor",
    settings: {
      editor: /^\s*<(p|ul|ol|h[1-6]|div|blockquote)\b/i.test(html)
        ? sinEmojis(sanear(html))
        : `<p>${sinEmojis(sanear(html))}</p>`,
      align,
      text_color: color,
      typography_typography: "custom",
      ...familia(t.cuerpo.familia),
      typography_font_size: px(size),
      typography_font_weight: t.cuerpo.grosor,
      typography_line_height: { unit: "em", size: 1.6, sizes: [] },
    },
  });

  const boton = (txt: string, url?: string, fondo = c.acento, colorTexto = c.sobre_acento, align = "center"): Widget => ({
    id: eid(),
    elType: "widget",
    widgetType: "button",
    settings: {
      text: sinEmojis(txt),
      ...(url ? { link: { url, is_external: /^https?:\/\//i.test(url), nofollow: false } } : {}),
      align,
      background_color: fondo,
      button_text_color: colorTexto,
      button_background_hover_color: fondo,
      hover_color: colorTexto,
      typography_typography: "custom",
      ...familia(t.titulos.familia ?? t.cuerpo.familia),
      typography_font_weight: "600",
      border_radius: radio(e.boton.radio),
      text_padding: caja4(e.boton.relleno_v, e.boton.relleno_h),
    },
  });

  /** Una columna; con `fondo` es una tarjeta con el radio del sitio. */
  const columna = (
    elementos: (Widget | Seccion)[],
    tamano: number,
    fondo?: string,
    relleno: [number, number] = [40, 32],
  ): Columna => ({
    id: eid(),
    elType: "column",
    settings: {
      _column_size: tamano,
      _inline_size: null,
      ...(fondo
        ? {
            background_background: "classic",
            background_color: fondo,
            border_radius: radio(e.radio_tarjeta),
            padding: caja4(relleno[0], relleno[1]),
          }
        : {}),
    },
    elements: elementos,
  });

  /** Sección encajonada al ancho del sitio. */
  const seccion = (columnas: Columna[], opciones: { fondo?: string; relleno?: number; interior?: boolean } = {}): Seccion => ({
    id: eid(),
    elType: "section",
    ...(opciones.interior ? { isInner: true } : {}),
    settings: {
      layout: "boxed",
      content_width: px(opciones.interior ? e.ancho : e.ancho),
      gap: "extended",
      ...(opciones.fondo
        ? { background_background: "classic", background_color: opciones.fondo }
        : {}),
      padding: caja4(opciones.interior ? 10 : (opciones.relleno ?? 60), opciones.interior ? 0 : 20),
    },
    elements: columnas,
  });

  /** Encabezado opcional de un bloque de tarjetas + las tarjetas en una fila interior. */
  const bloqueDeTarjetas = (s: SeccionSpec, tarjetas: { elementos: Widget[]; fondo: string }[], fondoSeccion?: string) => {
    const encabezado: Widget[] = [
      ...(s.titulo ? [heading(s.titulo, c.primario, t.h2)] : []),
      ...(s.subtitulo ? [parrafo(s.subtitulo, c.texto)] : []),
    ];
    const tamano = Math.floor(100 / Math.max(1, tarjetas.length));
    const fila = seccion(
      tarjetas.map((x) => columna(x.elementos, tamano, x.fondo)),
      { interior: true },
    );
    return seccion([columna([...encabezado, fila], 100)], fondoSeccion ? { fondo: fondoSeccion } : {});
  };

  return { heading, parrafo, boton, columna, seccion, bloqueDeTarjetas };
}

/** Traduce las secciones que pide el modelo al JSON que entiende Elementor, con el estilo del sitio. */
export function construirSecciones(specs: readonly SeccionSpec[], estilo: Estilo = ESTILO_POR_DEFECTO): unknown[] {
  const e = estilo;
  const { colores: c, tipografia: t } = e;
  const w = primitivasDeEstilo(e);
  const out: unknown[] = [];
  const numero = (i: number) => String(i + 1).padStart(2, "0");
  // Los bloques de texto alternan página y tarjeta clara, como hace el sitio.
  let textos = 0;

  for (const s of specs) {
    switch (s.tipo) {
      case "hero":
        out.push(
          w.seccion(
            [
              w.columna(
                [
                  w.heading(s.titulo ?? "", c.sobre_oscuro, t.h1, "h1", "center"),
                  ...(s.subtitulo ? [w.parrafo(s.subtitulo, c.sobre_oscuro, "center", t.cuerpo_px + 2)] : []),
                  ...(s.boton && conDestino(s.boton_url) ? [w.boton(s.boton, s.boton_url)] : []),
                ],
                100,
                c.oscuro,
                [100, 48],
              ),
            ],
            { relleno: 30 },
          ),
        );
        break;

      case "beneficios":
        out.push(
          w.bloqueDeTarjetas(
            s,
            (s.items ?? []).slice(0, 4).map((it, i) => ({
              fondo: c.tarjeta,
              elementos: [
                w.heading(numero(i), c.acento, 22, "div"),
                w.heading(it.titulo ?? "", c.primario, t.h3, "h3"),
                w.parrafo(it.texto ?? "", c.texto),
              ],
            })),
          ),
        );
        break;

      case "stats":
        out.push(
          w.bloqueDeTarjetas(
            s,
            (s.items ?? []).slice(0, 4).map((it) => ({
              fondo: c.oscuro,
              elementos: [
                w.heading(it.cifra ?? "", c.acento, Math.round(t.h1 * 0.9), "div", "center"),
                w.parrafo(it.etiqueta ?? "", c.sobre_oscuro),
              ],
            })),
          ),
        );
        break;

      case "testimonios":
        out.push(
          w.bloqueDeTarjetas(
            s,
            (s.items ?? []).slice(0, 3).map((it) => ({
              fondo: c.oscuro,
              elementos: [
                w.heading("“", c.acento, 64, "div", "center"),
                w.parrafo(`<em>${it.texto ?? ""}</em>`, c.sobre_oscuro, "center", t.cuerpo_px + 1),
                w.heading(it.autor ?? "", c.acento, 18, "h4", "center"),
                ...(it.cargo ? [w.parrafo(it.cargo, c.sobre_oscuro, "center", 14)] : []),
              ],
            })),
          ),
        );
        break;

      case "precios":
        out.push(
          w.bloqueDeTarjetas(
            s,
            (s.planes ?? []).slice(0, 3).map((p) => {
              const oscura = Boolean(p.destacado);
              const tinta = oscura ? c.sobre_oscuro : c.primario;
              const cuerpo = oscura ? c.sobre_oscuro : c.texto;
              return {
                fondo: oscura ? c.oscuro : c.tarjeta,
                elementos: [
                  ...(oscura ? [w.heading("Recomendado", c.acento, 14, "div", "center")] : []),
                  w.heading(p.nombre, tinta, t.h3, "h3", "center"),
                  w.heading(`${p.precio}${p.periodo ? ` /${p.periodo}` : ""}`, oscura ? c.acento : c.primario, Math.round(t.h2 * 1.1), "div", "center"),
                  w.parrafo(`<ul>${p.incluye.slice(0, 8).map((l) => `<li>${l}</li>`).join("")}</ul>`, cuerpo, "left"),
                  ...(conDestino(s.boton_url) ? [w.boton(p.boton ?? "Empezar", s.boton_url)] : []),
                ],
              };
            }),
          ),
        );
        break;

      case "faq":
        out.push(
          w.seccion([
            w.columna(
              [
                ...(s.titulo ? [w.heading(s.titulo, c.primario, t.h2)] : []),
                ...(s.items ?? []).slice(0, 8).flatMap((it) => [
                  w.heading(it.pregunta ?? "", c.primario, Math.max(18, t.h3 - 2), "h4", "left"),
                  w.parrafo(it.respuesta ?? "", c.texto, "left"),
                ]),
              ],
              100,
              c.tarjeta,
              [48, 48],
            ),
          ]),
        );
        break;

      case "cta":
        out.push(
          w.seccion([
            w.columna(
              [
                w.heading(s.titulo ?? "¿Hablamos?", c.sobre_oscuro, t.h2, "h2", "center"),
                ...(s.subtitulo ? [w.parrafo(s.subtitulo, c.sobre_oscuro)] : []),
                ...(conDestino(s.boton_url) ? [w.boton(s.boton ?? "Contáctanos", s.boton_url)] : []),
              ],
              100,
              c.oscuro,
              [64, 40],
            ),
          ]),
        );
        break;

      case "texto": {
        const enTarjeta = textos++ % 2 === 1;
        const html = s.html ?? "";
        // Un artículo largo se lee a la izquierda; un párrafo corto, como el sitio.
        const alinear = html.replace(/<[^>]*>/g, "").length > 280 ? "left" : e.alineacion_titulos;
        out.push(
          w.seccion([
            w.columna(
              [
                ...(s.titulo ? [w.heading(s.titulo, c.primario, t.h2, "h2", alinear)] : []),
                w.parrafo(html, c.texto, alinear),
              ],
              100,
              enTarjeta ? c.tarjeta : undefined,
              [48, 48],
            ),
          ]),
        );
        break;
      }
    }
  }
  return out;
}

export type EnlaceHeader = { texto: string; url: string };

/** Barra de header/footer global. La compone la plataforma, no el modelo. */
export function construirBarra(entrada: {
  marca: string;
  enlaces: readonly EnlaceHeader[];
  paleta: { fondo: string; acento: string; texto: string };
  variante: "header" | "footer";
}): unknown[] {
  const { marca, enlaces, paleta: hp, variante } = entrada;
  // Los enlaces van a HTML del sitio del cliente: se escapan aunque el esquema
  // ya los valide, y los externos se abren aparte para no sacar al visitante.
  const escapar = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linksHtml = enlaces
    .map((l) => {
      const externo = /^https?:\/\//i.test(l.url);
      return `<a href="${escapar(l.url)}"${externo ? ' target="_blank" rel="noopener"' : ""} style="color:${hp.texto};text-decoration:none;font-weight:600;margin:0 14px">${escapar(l.texto)}</a>`;
    })
    .join("");

  const wMarca = (size: number, align: string): Widget => ({
    id: eid(),
    elType: "widget",
    widgetType: "heading",
    settings: {
      title: marca,
      header_size: "h3",
      align,
      title_color: hp.acento,
      typography_typography: "custom",
      typography_font_weight: "800",
      typography_font_size: { unit: "px", size, sizes: [] },
    },
  });

  const wTexto = (html: string, align: string): Widget => ({
    id: eid(),
    elType: "widget",
    widgetType: "text-editor",
    settings: { editor: `<p style="text-align:${align};margin:6px 0">${html}</p>` },
  });

  const barra = (cols: { size: number; widgets: Widget[] }[]): Seccion => ({
    id: eid(),
    elType: "section",
    settings: {
      background_background: "classic",
      background_color: hp.fondo,
      padding: { unit: "px", top: "16", right: "40", bottom: "16", left: "40", isLinked: false },
    },
    elements: cols.map((c) => ({
      id: eid(),
      elType: "column" as const,
      settings: { _column_size: c.size },
      elements: c.widgets,
    })),
  });

  if (variante === "header") {
    return [
      barra([
        { size: 30, widgets: [wMarca(24, "left")] },
        { size: 70, widgets: [wTexto(linksHtml, "right")] },
      ]),
    ];
  }
  return [
    barra([
      {
        size: 100,
        widgets: [
          wMarca(20, "center"),
          wTexto(linksHtml, "center"),
          wTexto(
            `<span style="color:${hp.texto};opacity:.7;font-size:13px">© ${new Date().getFullYear()} ${marca} — Todos los derechos reservados</span>`,
            "center",
          ),
        ],
      },
    ]),
  ];
}
