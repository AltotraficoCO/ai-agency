/**
 * El ADN visual del sitio: lo que una página nueva tiene que respetar.
 *
 * El caso que lo motivó: se pidió una entrada «acorde al diseño de la página»
 * y salió negra, beige y naranja —la paleta por defecto de la herramienta—
 * sobre un sitio azul marino y dorado, con tarjetas grises redondeadas y
 * botones tipo píldora. Nada leía el diseño del sitio.
 *
 * De dónde sale, por orden de fiabilidad:
 *  1. Estilos COMPUTADOS en el navegador (lo que de verdad se pinta), sin
 *     header ni footer, votados por superficie o por cantidad de texto.
 *  2. Si no hay navegador: el CSS que Elementor genera para esa página y el
 *     `_elementor_data` de la página, votados por frecuencia.
 *
 * Los colores y fuentes GLOBALES del kit no son una fuente fiable: en muchos
 * sitios siguen siendo los de fábrica de Elementor (#6EC1E4, #54595F, #7A7A7A,
 * #61CE70) aunque ninguna página los use. Se descartan.
 */
import type { MuestraBoton, MuestraCaja, MuestrasDiseno, MuestraTexto, SitioContext } from "../ports.js";
import type { Paleta } from "./elementor.js";
import * as wp from "./client.js";
import { baseDeSitio } from "../browser/playwright.js";

export type OrigenDiseno = "sitio" | "paleta_modelo" | "por_defecto";

export type Tipografia = { readonly familia: string | null; readonly grosor: string };

export type Estilo = {
  readonly origen: OrigenDiseno;
  /** «navegador», «css», «elementor_data». */
  readonly fuentes_datos: readonly string[];
  /** Ruta de la página de la que se tomó. */
  readonly referencia: string;
  readonly colores: {
    /** Titulares sobre fondo claro. */
    readonly primario: string;
    /** Botones y detalles. */
    readonly acento: string;
    /** Párrafos. */
    readonly texto: string;
    /** Fondo de la página. */
    readonly fondo: string;
    /** Tarjetas claras. */
    readonly tarjeta: string;
    /** Tarjetas o bandas oscuras (hero, cita, llamada a la acción). */
    readonly oscuro: string;
    readonly sobre_oscuro: string;
    readonly sobre_acento: string;
  };
  readonly tipografia: {
    readonly titulos: Tipografia;
    readonly cuerpo: Tipografia;
    readonly h1: number;
    readonly h2: number;
    readonly h3: number;
    readonly cuerpo_px: number;
  };
  readonly boton: {
    readonly radio: number;
    readonly relleno_v: number;
    readonly relleno_h: number;
  };
  readonly radio_tarjeta: number;
  readonly ancho: number;
  readonly alineacion_titulos: "center" | "left";
  readonly avisos?: readonly string[];
};

export const GLOBALES_POR_DEFECTO_ELEMENTOR: ReadonlySet<string> = new Set([
  "#6EC1E4",
  "#54595F",
  "#7A7A7A",
  "#61CE70",
]);

/** Último recurso: el aspecto que tenía la herramienta antes de leer el sitio. */
export const ESTILO_POR_DEFECTO: Estilo = {
  origen: "por_defecto",
  fuentes_datos: [],
  referencia: "/",
  colores: {
    primario: "#17150F",
    acento: "#FF4D00",
    texto: "#444444",
    fondo: "#FFFFFF",
    tarjeta: "#F5F0E4",
    oscuro: "#17150F",
    sobre_oscuro: "#F5F0E4",
    sobre_acento: "#FFFFFF",
  },
  tipografia: {
    titulos: { familia: null, grosor: "800" },
    cuerpo: { familia: null, grosor: "400" },
    h1: 54,
    h2: 34,
    h3: 23,
    cuerpo_px: 17,
  },
  boton: { radio: 0, relleno_v: 18, relleno_h: 36 },
  radio_tarjeta: 0,
  ancho: 1140,
  alineacion_titulos: "center",
};

// ---------------------------------------------------------------------------
// Colores
// ---------------------------------------------------------------------------

const h2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/** Normaliza a `#RRGGBB`. Devuelve null si es transparente, una variable o no se entiende. */
export function aHex(valor: string | undefined | null): string | null {
  if (!valor) return null;
  const v = valor.trim().toLowerCase();
  if (!v || v === "transparent" || v.includes("var(")) return null;
  let m = /^#([0-9a-f]{3,4})$/.exec(v);
  if (m) {
    const [r, g, b, a] = m[1]!.split("").map((c) => parseInt(c + c, 16));
    if (a !== undefined && a < 128) return null;
    return `#${h2(r!)}${h2(g!)}${h2(b!)}`.toUpperCase();
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) {
    if (m[2] && parseInt(m[2], 16) < 128) return null;
    return `#${m[1]}`.toUpperCase();
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    if (m[4] !== undefined) {
      const a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (a < 0.5) return null;
    }
    return `#${h2(+m[1]!)}${h2(+m[2]!)}${h2(+m[3]!)}`.toUpperCase();
  }
  return null;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminancia relativa (0 negro, 1 blanco). */
export function luminancia(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function croma(hex: string): number {
  const c = rgb(hex);
  return (Math.max(...c) - Math.min(...c)) / 255;
}

function distancia(a: string, b: string): number {
  const x = rgb(a);
  const y = rgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

function oscurecer(hex: string, factor: number): string {
  const [r, g, b] = rgb(hex);
  return `#${h2(r * factor)}${h2(g * factor)}${h2(b * factor)}`.toUpperCase();
}

const colorUtil = (v: string | undefined): string | null => {
  const hex = aHex(v);
  return hex && !GLOBALES_POR_DEFECTO_ELEMENTOR.has(hex) ? hex : null;
};

// ---------------------------------------------------------------------------
// Votación
// ---------------------------------------------------------------------------

function ganador<T>(votos: Iterable<readonly [T | null | undefined, number]>): T | null {
  const cuenta = new Map<T, number>();
  for (const [clave, peso] of votos) {
    if (clave === null || clave === undefined) continue;
    cuenta.set(clave, (cuenta.get(clave) ?? 0) + (Number.isFinite(peso) && peso > 0 ? peso : 1));
  }
  let mejor: T | null = null;
  let max = -1;
  for (const [clave, total] of cuenta) {
    if (total > max) {
      mejor = clave;
      max = total;
    }
  }
  return mejor;
}

function mediana(valores: readonly (number | undefined)[]): number | null {
  const v = valores.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  return v[Math.floor(v.length / 2)]!;
}

/** Primera familia de un `font-family`, sin comillas ni genéricas. */
export function primeraFamilia(valor: string | undefined): string | null {
  if (!valor || valor.includes("var(")) return null;
  const primera = valor.split(",")[0]?.trim().replace(/^["']|["']$/g, "").trim();
  if (!primera) return null;
  if (/^(sans-serif|serif|monospace|system-ui|inherit|initial|-apple-system|ui-sans-serif)$/i.test(primera)) return null;
  return primera;
}

const PESO_ETIQUETA: Readonly<Record<string, number>> = { h1: 1.5, h2: 2, h3: 1, h4: 0.6 };

/**
 * Convierte muestras en un estilo. Devuelve null si no hay lo mínimo (un color
 * de titulares o de botones): mejor decir «no pude leer el diseño» que
 * inventar uno.
 */
export function estiloDesdeMuestras(
  m: MuestrasDiseno,
  contexto: { referencia: string; fuentes_datos: readonly string[] },
): Estilo | null {
  const pesoTitulo = (t: MuestraTexto) => (t.peso ?? 1) * (PESO_ETIQUETA[t.etiqueta] ?? 1);

  const fondo = colorUtil(m.fondo_pagina) ?? "#FFFFFF";

  // Titulares legibles sobre claro: el blanco de un hero no es el color de marca.
  const primarioTitulos = ganador(
    m.titulos.map((t) => {
      const c = colorUtil(t.color);
      return [c && luminancia(c) < 0.45 ? c : null, pesoTitulo(t)] as const;
    }),
  );

  const cajasColor = m.cajas
    .map((c) => ({ c: colorUtil(c.fondo), radio: c.radio ?? 0, area: c.area ?? 1 }))
    .filter((c): c is { c: string; radio: number; area: number } => c.c !== null);

  const oscuroCajas = ganador(
    cajasColor.map((c) => [luminancia(c.c) < 0.2 && croma(c.c) > 0.12 ? c.c : null, c.area] as const),
  );

  const botonesColor = m.botones.map((b: MuestraBoton) => {
    const c = colorUtil(b.fondo);
    return { c, b };
  });
  const acentoBotones = ganador(
    botonesColor.map(({ c, b }) => [c && luminancia(c) < 0.9 ? c : null, b.peso ?? 1] as const),
  );

  const primario = primarioTitulos ?? oscuroCajas;
  // El acento es lo que destaca: si el botón más votado es el mismo color de
  // marca, se busca el color con más croma distinto del primario.
  let acento = acentoBotones && (!primario || distancia(acentoBotones, primario) > 40) ? acentoBotones : null;
  if (!acento) {
    const candidatos: [string | null, number][] = [
      ...botonesColor.map(({ c, b }) => [c, (b.peso ?? 1) * 2] as [string | null, number]),
      ...m.titulos.map((t) => [colorUtil(t.color), pesoTitulo(t)] as [string | null, number]),
      ...cajasColor.map((c) => [c.c, 1] as [string | null, number]),
    ];
    acento = ganador(
      candidatos.map(([c, p]) => [
        c && croma(c) > 0.35 && luminancia(c) < 0.9 && (!primario || distancia(c, primario) > 60) ? c : null,
        p,
      ] as const),
    );
  }
  if (!acento) acento = acentoBotones;

  if (!primario && !acento) return null;

  const texto =
    ganador(
      m.parrafos.map((t) => {
        const c = colorUtil(t.color);
        return [c && luminancia(c) < 0.5 ? c : null, t.peso ?? 1] as const;
      }),
    ) ?? "#444444";

  const tarjeta =
    ganador(
      cajasColor.map((c) => [
        luminancia(c.c) > 0.75 && distancia(c.c, fondo) > 6 ? c.c : null,
        c.area,
      ] as const),
    ) ?? (luminancia(fondo) > 0.9 ? "#F3F3F3" : fondo);

  const base = primario ?? acento!;
  const oscuro = oscuroCajas ?? (luminancia(base) < 0.2 ? base : oscurecer(base, 0.55));

  const botonAcento = acento ? m.botones.filter((b) => colorUtil(b.fondo) === acento) : [];
  const botonesRef = botonAcento.length > 0 ? botonAcento : m.botones;
  const sobreAcento =
    ganador(botonesRef.map((b) => [colorUtil(b.texto), b.peso ?? 1] as const)) ??
    (acento && luminancia(acento) > 0.5 ? "#111111" : "#FFFFFF");

  const radioBoton = ganador(
    botonesRef.map((b) => {
      if (b.radio === undefined) return [null, 1] as const;
      const pildora = b.alto !== undefined && b.alto > 0 && b.radio >= b.alto / 2 - 1;
      return [pildora || b.radio >= 60 ? 100 : Math.round(b.radio), b.peso ?? 1] as const;
    }),
  );

  const radioTarjeta = ganador(
    m.cajas.map((c) => [c.radio !== undefined && c.radio > 0 && c.radio < 60 ? Math.round(c.radio) : null, 1] as const),
  );

  const ancho = ganador(
    m.anchos.map((a) => [a >= 900 && a <= 1600 ? Math.round(a / 10) * 10 : null, 1] as const),
  );

  const familiaTitulos = ganador(m.titulos.map((t) => [primeraFamilia(t.familia), pesoTitulo(t)] as const));
  const familiaCuerpo = ganador(m.parrafos.map((t) => [primeraFamilia(t.familia), t.peso ?? 1] as const));
  const grosorTitulos = ganador(m.titulos.map((t) => [t.grosor ?? null, pesoTitulo(t)] as const));
  const grosorCuerpo = ganador(m.parrafos.map((t) => [t.grosor ?? null, t.peso ?? 1] as const));
  const tam = (etiqueta: string) => mediana(m.titulos.filter((t) => t.etiqueta === etiqueta).map((t) => t.tamano));
  const alineacion = ganador(
    m.titulos.map((t) => [
      t.alineacion === "center" ? "center" : t.alineacion ? "left" : null,
      pesoTitulo(t),
    ] as const),
  );

  const d = ESTILO_POR_DEFECTO;
  const limitar = (n: number | null, min: number, max: number, def: number) =>
    n === null ? def : Math.max(min, Math.min(max, Math.round(n)));

  return {
    origen: "sitio",
    fuentes_datos: contexto.fuentes_datos,
    referencia: contexto.referencia,
    colores: {
      primario: primario ?? oscuro,
      acento: acento ?? base,
      texto,
      fondo,
      tarjeta,
      oscuro,
      sobre_oscuro: luminancia(oscuro) < 0.4 ? "#FFFFFF" : "#111111",
      sobre_acento: sobreAcento,
    },
    tipografia: {
      titulos: { familia: familiaTitulos, grosor: grosorTitulos ?? "700" },
      cuerpo: { familia: familiaCuerpo ?? familiaTitulos, grosor: grosorCuerpo ?? "400" },
      h1: limitar(tam("h1"), 30, 72, 46),
      h2: limitar(tam("h2"), 24, 56, 34),
      h3: limitar(tam("h3"), 18, 34, 22),
      cuerpo_px: limitar(mediana(m.parrafos.map((t) => t.tamano)), 14, 22, d.tipografia.cuerpo_px),
    },
    boton: {
      radio: radioBoton ?? 6,
      relleno_v: limitar(mediana(botonesRef.map((b) => b.relleno_v)), 8, 24, 14),
      relleno_h: limitar(mediana(botonesRef.map((b) => b.relleno_h)), 14, 48, 30),
    },
    radio_tarjeta: radioTarjeta ?? 12,
    ancho: ancho ?? 1140,
    alineacion_titulos: alineacion ?? "center",
  };
}

// ---------------------------------------------------------------------------
// CSS de Elementor y _elementor_data
// ---------------------------------------------------------------------------

type Regla = { selector: string; decl: Record<string, string> };

/** Reglas de primer nivel; los bloques @media (versiones móviles) se saltan. */
function reglas(css: string): Regla[] {
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Regla[] = [];
  let i = 0;
  while (i < limpio.length) {
    const abre = limpio.indexOf("{", i);
    if (abre < 0) break;
    const selector = limpio.slice(i, abre).trim();
    if (selector.startsWith("@")) {
      // Salta el bloque entero, con sus llaves anidadas.
      let prof = 1;
      let j = abre + 1;
      while (j < limpio.length && prof > 0) {
        if (limpio[j] === "{") prof++;
        else if (limpio[j] === "}") prof--;
        j++;
      }
      i = j;
      continue;
    }
    const cierra = limpio.indexOf("}", abre);
    if (cierra < 0) break;
    const decl: Record<string, string> = {};
    for (const d of limpio.slice(abre + 1, cierra).split(";")) {
      const k = d.indexOf(":");
      if (k < 0) continue;
      decl[d.slice(0, k).trim().toLowerCase()] = d.slice(k + 1).replace(/!important/g, "").trim();
    }
    out.push({ selector, decl });
    i = cierra + 1;
  }
  return out;
}

const px = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  const m = /(-?[\d.]+)px/.exec(v);
  return m ? parseFloat(m[1]!) : undefined;
};

/** Variables `--e-global-*` del kit, sin las de fábrica. */
export function globalesDesdeCss(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of reglas(css)) {
    for (const [k, v] of Object.entries(r.decl)) {
      if (!k.startsWith("--e-global-")) continue;
      const hex = aHex(v);
      if (hex && GLOBALES_POR_DEFECTO_ELEMENTOR.has(hex)) continue;
      // Las familias de fábrica también se descartan si el color lo era.
      out[k] = v;
    }
  }
  const coloresDeFabrica = Object.keys(out).filter((k) => k.startsWith("--e-global-color-")).length === 0;
  if (coloresDeFabrica) {
    for (const k of Object.keys(out)) if (k.startsWith("--e-global-typography-")) delete out[k];
  }
  return out;
}

function resolver(valor: string | undefined, globales: Record<string, string>): string | undefined {
  if (!valor) return undefined;
  const m = /var\(\s*(--[\w-]+)\s*\)/.exec(valor);
  if (!m) return valor;
  const g = globales[m[1]!];
  return g ? valor.replace(m[0], g) : undefined;
}

export function muestrasDesdeCss(css: string, globales: Record<string, string> = {}): MuestrasDiseno {
  const titulos: MuestraTexto[] = [];
  const parrafos: MuestraTexto[] = [];
  const botones: MuestraBoton[] = [];
  const cajas: MuestraCaja[] = [];
  const anchos: number[] = [];

  for (const { selector, decl } of reglas(css)) {
    const s = selector.toLowerCase();
    const val = (k: string) => resolver(decl[k], globales);
    for (const k of ["max-width", "--container-max-width", "--content-width", "--width"]) {
      const n = px(decl[k]);
      if (n && n >= 900 && (s.includes("container") || s.includes("e-con") || k !== "max-width")) anchos.push(n);
    }

    if (/elementor-button|elementor-slide-button|button/.test(s)) {
      if (val("background-color") || val("border-radius") || val("color")) {
        botones.push({
          ...(val("background-color") ? { fondo: val("background-color")! } : {}),
          ...(val("color") ? { texto: val("color")! } : {}),
          ...(px(decl["border-radius"]) !== undefined ? { radio: px(decl["border-radius"])! } : {}),
          ...(px(decl["padding"]) !== undefined ? { relleno_v: px(decl["padding"])! } : {}),
          ...(val("font-family") ? { familia: val("font-family")! } : {}),
        });
      }
      continue;
    }
    if (/heading-title|\bh[1-3]\b/.test(s)) {
      const etiqueta = /\bh1\b/.test(s) ? "h1" : /\bh3\b/.test(s) ? "h3" : "h2";
      titulos.push({
        etiqueta,
        ...(val("color") ? { color: val("color")! } : {}),
        ...(val("font-family") ? { familia: val("font-family")! } : {}),
        ...(val("font-weight") ? { grosor: val("font-weight")! } : {}),
        ...(px(decl["font-size"]) !== undefined ? { tamano: px(decl["font-size"])! } : {}),
        ...(decl["text-align"] ? { alineacion: decl["text-align"] } : {}),
      });
      continue;
    }
    if (/text-editor|\bp\b/.test(s)) {
      parrafos.push({
        etiqueta: "p",
        ...(val("color") ? { color: val("color")! } : {}),
        ...(val("font-family") ? { familia: val("font-family")! } : {}),
        ...(val("font-weight") ? { grosor: val("font-weight")! } : {}),
        ...(px(decl["font-size"]) !== undefined ? { tamano: px(decl["font-size"])! } : {}),
      });
      continue;
    }
    const fondo = val("background-color") ?? val("--background-color");
    const radio = px(decl["border-radius"]) ?? px(decl["--border-radius"]);
    if (fondo || radio !== undefined) {
      cajas.push({ ...(fondo ? { fondo } : {}), ...(radio !== undefined ? { radio } : {}) });
    }
  }
  return { titulos, parrafos, botones, cajas, anchos };
}

type Nodo = { elType?: string; widgetType?: string; settings?: Record<string, unknown>; elements?: Nodo[] };

const dim = (v: unknown): number | undefined => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const n = Number(o["size"] ?? o["top"]);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
};
const cad = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export function muestrasDesdeElementorData(data: readonly unknown[]): MuestrasDiseno {
  const titulos: MuestraTexto[] = [];
  const parrafos: MuestraTexto[] = [];
  const botones: MuestraBoton[] = [];
  const cajas: MuestraCaja[] = [];
  const anchos: number[] = [];

  const visitar = (n: Nodo) => {
    const s = n.settings ?? {};
    if (n.elType === "widget") {
      if (n.widgetType === "heading") {
        titulos.push({
          etiqueta: cad(s["header_size"]) ?? "h2",
          ...(cad(s["title_color"]) ? { color: cad(s["title_color"])! } : {}),
          ...(cad(s["typography_font_family"]) ? { familia: cad(s["typography_font_family"])! } : {}),
          ...(s["typography_font_weight"] ? { grosor: String(s["typography_font_weight"]) } : {}),
          ...(dim(s["typography_font_size"]) ? { tamano: dim(s["typography_font_size"])! } : {}),
          ...(cad(s["align"]) ? { alineacion: cad(s["align"])! } : {}),
        });
      } else if (n.widgetType === "text-editor") {
        parrafos.push({
          etiqueta: "p",
          ...(cad(s["text_color"]) ? { color: cad(s["text_color"])! } : {}),
          ...(cad(s["typography_font_family"]) ? { familia: cad(s["typography_font_family"])! } : {}),
          ...(dim(s["typography_font_size"]) ? { tamano: dim(s["typography_font_size"])! } : {}),
        });
      } else if (n.widgetType === "button") {
        botones.push({
          ...(cad(s["background_color"]) ? { fondo: cad(s["background_color"])! } : {}),
          ...(cad(s["button_text_color"]) ? { texto: cad(s["button_text_color"])! } : {}),
          ...(dim(s["border_radius"]) ? { radio: dim(s["border_radius"])! } : {}),
          ...(dim(s["text_padding"]) ? { relleno_v: dim(s["text_padding"])! } : {}),
        });
      }
    } else {
      const fondo = s["background_background"] === "classic" ? cad(s["background_color"]) : undefined;
      const radio = dim(s["border_radius"]);
      if (fondo || radio) cajas.push({ ...(fondo ? { fondo } : {}), ...(radio ? { radio } : {}) });
      const w = dim(s["boxed_width"]) ?? dim(s["content_width"]);
      if (w && w >= 900) anchos.push(w);
    }
    for (const hijo of n.elements ?? []) visitar(hijo);
  };
  for (const n of data) if (n && typeof n === "object") visitar(n as Nodo);
  return { titulos, parrafos, botones, cajas, anchos };
}

function unir(...partes: MuestrasDiseno[]): MuestrasDiseno {
  const fondo = partes.map((p) => p.fondo_pagina).find(Boolean);
  return {
    titulos: partes.flatMap((p) => p.titulos),
    parrafos: partes.flatMap((p) => p.parrafos),
    botones: partes.flatMap((p) => p.botones),
    cajas: partes.flatMap((p) => p.cajas),
    anchos: partes.flatMap((p) => p.anchos),
    ...(fondo ? { fondo_pagina: fondo } : {}),
  };
}

const cuantas = (m: MuestrasDiseno) => m.titulos.length + m.botones.length + m.cajas.length;

// ---------------------------------------------------------------------------
// Lectura del sitio
// ---------------------------------------------------------------------------

/** Por ejecución: el sitio es el mismo objeto durante toda la tarea. */
const cache = new WeakMap<SitioContext, Map<string, Promise<Estilo>>>();

export function leerDisenoDelSitio(
  sitio: SitioContext,
  opciones: wp.WpClientOptions,
  referencia = "/",
): Promise<Estilo> {
  let porRuta = cache.get(sitio);
  if (!porRuta) {
    porRuta = new Map();
    cache.set(sitio, porRuta);
  }
  const ya = porRuta.get(referencia);
  if (ya) return ya;
  const promesa = leer(sitio, opciones, referencia);
  porRuta.set(referencia, promesa);
  // Un fallo no se cachea: el siguiente intento puede tener suerte.
  promesa.catch(() => porRuta!.delete(referencia));
  return promesa;
}

async function leer(sitio: SitioContext, opciones: wp.WpClientOptions, referencia: string): Promise<Estilo> {
  const avisos: string[] = [];

  if (sitio.browser?.muestrearDiseno) {
    try {
      const m = await sitio.browser.muestrearDiseno(referencia);
      if (cuantas(m) >= 3) {
        const e = estiloDesdeMuestras(m, { referencia, fuentes_datos: ["navegador"] });
        if (e) return e;
      }
      avisos.push("el navegador no encontró suficientes elementos con estilo");
    } catch (error) {
      avisos.push(`el navegador no pudo medir la página: ${mensaje(error)}`);
    }
  }

  const partes: MuestrasDiseno[] = [];
  const fuentes: string[] = [];
  let base: string;
  try {
    base = baseDeSitio(sitio);
  } catch {
    return { ...ESTILO_POR_DEFECTO, referencia, avisos: ["el sitio no tiene URL"] };
  }

  let paginaId: number | undefined;
  try {
    const html = await wp.leerPublico(base, referencia, opciones);
    const clases = /<body[^>]*class=["']([^"']*)["']/i.exec(html.texto)?.[1] ?? "";
    const id = /\b(?:elementor-page|page-id|postid)-(\d+)\b/.exec(clases)?.[1];
    paginaId = id ? Number(id) : undefined;
    const kitId = /\belementor-kit-(\d+)\b/.exec(clases)?.[1];

    const hrefDe = (n: string) =>
      new RegExp(`["']([^"']*/wp-content/uploads/elementor/css/post-${n}\\.css[^"']*)["']`).exec(html.texto)?.[1];
    let globales: Record<string, string> = {};
    if (kitId) {
      const href = hrefDe(kitId);
      if (href) globales = globalesDesdeCss((await wp.leerPublico(base, href, opciones)).texto);
    }
    const cssPagina: string[] = [];
    if (paginaId !== undefined) {
      const href = hrefDe(String(paginaId));
      if (href) cssPagina.push((await wp.leerPublico(base, href, opciones)).texto);
      // Elementor puede imprimir el CSS en línea en vez de en un archivo.
      for (const m of html.texto.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
        if (m[1]!.includes(`.elementor-${paginaId} `)) cssPagina.push(m[1]!);
      }
    }
    if (cssPagina.length > 0) {
      partes.push(muestrasDesdeCss(cssPagina.join("\n"), globales));
      fuentes.push("css");
    } else {
      avisos.push("no encontré el CSS de Elementor de la página de referencia");
    }
  } catch (error) {
    avisos.push(`no pude leer la página de referencia: ${mensaje(error)}`);
  }

  if (sitio.wp && paginaId !== undefined) {
    try {
      const data = await wp.leerElementorData(sitio.wp, paginaId, opciones);
      if (data && data.length > 0) {
        partes.push(muestrasDesdeElementorData(data));
        fuentes.push("elementor_data");
      }
    } catch (error) {
      avisos.push(`no pude leer el diseño guardado de la página: ${mensaje(error)}`);
    }
  }

  const e = partes.length > 0 ? estiloDesdeMuestras(unir(...partes), { referencia, fuentes_datos: fuentes }) : null;
  if (e) return avisos.length > 0 ? { ...e, avisos } : e;
  return { ...ESTILO_POR_DEFECTO, referencia, avisos: [...avisos, "no se pudo deducir el diseño del sitio"] };
}

function mensaje(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 160);
}

// ---------------------------------------------------------------------------
// Para las herramientas
// ---------------------------------------------------------------------------

/** El estilo del sitio con los colores de una paleta que el cliente pidió expresamente. */
export function conPaleta(base: Estilo, pal: Paleta): Estilo {
  return {
    ...base,
    origen: "paleta_modelo",
    colores: {
      ...base.colores,
      primario: pal.fondo,
      oscuro: pal.fondo,
      acento: pal.acento,
      sobre_oscuro: pal.texto,
      tarjeta: pal.fondo_claro,
      sobre_acento: luminancia(pal.acento) > 0.5 ? "#111111" : "#FFFFFF",
    },
  };
}

/** Lo que ve el modelo del estilo: corto y legible. */
export function resumirEstilo(e: Estilo): Record<string, unknown> {
  return {
    origen: e.origen,
    fuentes_datos: e.fuentes_datos,
    referencia: e.referencia,
    colores: e.colores,
    tipografia: {
      titulos: e.tipografia.titulos.familia ?? "la del tema",
      cuerpo: e.tipografia.cuerpo.familia ?? "la del tema",
      grosor_titulos: e.tipografia.titulos.grosor,
      tamanos_px: { h1: e.tipografia.h1, h2: e.tipografia.h2, h3: e.tipografia.h3, cuerpo: e.tipografia.cuerpo_px },
    },
    botones: e.boton.radio >= 100 ? "píldora" : `radio ${e.boton.radio}px`,
    radio_tarjetas_px: e.radio_tarjeta,
    ancho_contenedor_px: e.ancho,
    titulares: e.alineacion_titulos === "center" ? "centrados" : "a la izquierda",
    ...(e.avisos?.length ? { avisos: e.avisos } : {}),
  };
}
