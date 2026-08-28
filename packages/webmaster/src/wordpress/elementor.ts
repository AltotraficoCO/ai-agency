/**
 * Constructor de secciones Elementor.
 *
 * Portado tal cual del proyecto anterior, incluida la decisión que más caro
 * costó aprender: se usan SOLO widgets primitivos (heading, text-editor,
 * button). Elementor puede tener `icon-box`, `counter`, `testimonial` o
 * `toggle` desactivados por el Element Manager, y cuando eso pasa NO da error:
 * los omite en silencio y el cliente recibe una página con secciones vacías.
 *
 * Los identificadores de elemento son aleatorios porque Elementor los exige
 * únicos dentro del documento; no significan nada más.
 */

export type Paleta = {
  readonly fondo: string;
  readonly acento: string;
  readonly texto: string;
  readonly fondo_claro: string;
};

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
type Columna = { id: string; elType: "column"; settings: Record<string, unknown>; elements: Widget[] };
type Seccion = {
  id: string;
  elType: "section";
  settings: Record<string, unknown>;
  elements: Columna[];
};

const eid = (): string => Math.random().toString(16).slice(2, 9);

function primitivas(pal: Paleta) {
  const heading = (txt: string, color: string, size: number, tag = "h2", align = "center"): Widget => ({
    id: eid(),
    elType: "widget",
    widgetType: "heading",
    settings: {
      title: txt,
      align,
      header_size: tag,
      title_color: color,
      typography_typography: "custom",
      typography_font_size: { unit: "px", size, sizes: [] },
      typography_font_weight: "800",
    },
  });

  const parrafo = (html: string, color: string, align = "center"): Widget => ({
    id: eid(),
    elType: "widget",
    widgetType: "text-editor",
    settings: { editor: `<p style="text-align:${align}">${html}</p>`, text_color: color },
  });

  const boton = (txt: string, url?: string, fondo = pal.acento): Widget => ({
    id: eid(),
    elType: "widget",
    widgetType: "button",
    settings: {
      text: txt,
      ...(url ? { link: { url, is_external: false, nofollow: false } } : {}),
      align: "center",
      background_color: fondo,
      button_text_color: "#ffffff",
      typography_typography: "custom",
      typography_font_weight: "700",
      border_radius: { unit: "px", top: "0", right: "0", bottom: "0", left: "0", isLinked: true },
      text_padding: { unit: "px", top: "18", right: "36", bottom: "18", left: "36", isLinked: false },
    },
  });

  const seccion = (bg: string, columnas: Widget[][], padding = "90"): Seccion => ({
    id: eid(),
    elType: "section",
    settings: {
      background_background: "classic",
      background_color: bg,
      padding: { unit: "px", top: padding, right: "20", bottom: padding, left: "20", isLinked: false },
      gap: "extended",
    },
    elements: columnas.map((widgets) => ({
      id: eid(),
      elType: "column" as const,
      settings: { _column_size: Math.floor(100 / Math.max(1, columnas.length)), _inline_size: null },
      elements: widgets,
    })),
  });

  return { heading, parrafo, boton, seccion };
}

/** Traduce las secciones que pide el modelo al JSON que entiende Elementor. */
export function construirSecciones(specs: readonly SeccionSpec[], pal: Paleta): unknown[] {
  const w = primitivas(pal);
  const oscuro = pal.fondo;
  const claro = pal.fondo_claro;
  const out: unknown[] = [];
  // Alterna blanco y el claro de la paleta para que no queden dos secciones
  // seguidas del mismo color: es lo que separa una landing de un muro de texto.
  let claras = 0;
  const alterno = (): string => (claras++ % 2 ? "#ffffff" : claro);

  for (const s of specs) {
    switch (s.tipo) {
      case "hero":
        out.push(
          w.seccion(
            oscuro,
            [
              [
                w.heading(s.titulo ?? "", pal.texto, 54, "h1"),
                w.parrafo(s.subtitulo ?? "", pal.texto),
                ...(s.boton ? [w.boton(s.boton, s.boton_url)] : []),
              ],
            ],
            "120",
          ),
        );
        break;

      case "beneficios":
        out.push(
          w.seccion(
            alterno(),
            (s.items ?? []).slice(0, 4).map((it) => [
              w.parrafo(
                `<span style="font-size:42px;line-height:1">${it.icono ?? "✔"}</span>`,
                pal.acento,
              ),
              w.heading(it.titulo ?? "", oscuro, 23, "h3"),
              w.parrafo(it.texto ?? "", "#555555"),
            ]),
          ),
        );
        break;

      case "stats":
        out.push(
          w.seccion(
            oscuro,
            (s.items ?? [])
              .slice(0, 4)
              .map((it) => [
                w.heading(it.cifra ?? "", pal.acento, 52, "h3"),
                w.parrafo(it.etiqueta ?? "", pal.texto),
              ]),
            "70",
          ),
        );
        break;

      case "testimonios":
        out.push(
          w.seccion(
            alterno(),
            (s.items ?? []).slice(0, 3).map((it) => [
              w.parrafo(`<em style="font-size:17px">“${it.texto ?? ""}”</em>`, "#444444"),
              w.heading(it.autor ?? "", oscuro, 17, "h4"),
              w.parrafo(`<span style="font-size:13px">${it.cargo ?? ""}</span>`, "#888888"),
            ]),
          ),
        );
        break;

      case "precios":
        out.push(
          w.seccion(
            alterno(),
            (s.planes ?? []).slice(0, 3).map((p) => [
              w.heading(
                `${p.destacado ? "★ " : ""}${p.nombre}`,
                p.destacado ? pal.acento : oscuro,
                22,
                "h3",
              ),
              w.heading(`${p.precio}${p.periodo ? ` /${p.periodo}` : ""}`, oscuro, 40, "h4"),
              w.parrafo(
                p.incluye
                  .slice(0, 8)
                  .map((l) => `<span style="color:${pal.acento}">✔</span> ${l}`)
                  .join("<br>"),
                "#444444",
              ),
              w.boton(p.boton ?? "Empezar"),
            ]),
          ),
        );
        break;

      case "faq":
        out.push(
          w.seccion(alterno(), [
            [
              ...(s.titulo ? [w.heading(s.titulo, oscuro, 34)] : []),
              ...(s.items ?? []).slice(0, 8).flatMap((it) => [
                w.heading(it.pregunta ?? "", oscuro, 19, "h4", "left"),
                w.parrafo(it.respuesta ?? "", "#555555", "left"),
              ]),
            ],
          ]),
        );
        break;

      case "cta":
        out.push(
          w.seccion(pal.acento, [
            [
              w.heading(s.titulo ?? "¿Hablamos?", "#ffffff", 38),
              ...(s.subtitulo ? [w.parrafo(s.subtitulo, "#ffffff")] : []),
              w.boton(s.boton ?? "Contáctanos", s.boton_url, pal.fondo),
            ],
          ]),
        );
        break;

      case "texto":
        out.push(
          w.seccion(alterno(), [
            [
              ...(s.titulo ? [w.heading(s.titulo, oscuro, 30)] : []),
              w.parrafo(s.html ?? "", "#444444", "left"),
            ],
          ]),
        );
        break;
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
  const linksHtml = enlaces
    .map(
      (l) =>
        `<a href="${l.url}" style="color:${hp.texto};text-decoration:none;font-weight:600;margin:0 14px">${l.texto}</a>`,
    )
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
