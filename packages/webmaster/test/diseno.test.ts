/**
 * Diseños acordes al sitio real.
 *
 * El caso de producción: se pidió una entrada «acorde al diseño de la página»
 * sobre un sitio azul marino (#123A59) y dorado (#D09E1D), con tarjetas grises
 * de radio 38 y botones píldora, y salió negra, beige y naranja con emojis. El
 * kit de Elementor del sitio seguía con los globales de fábrica (#6EC1E4…),
 * que no dicen nada del diseño y hay que descartar.
 */
import { describe, expect, it } from "vitest";
import { executeToolDef, type ToolContext } from "@strappy/tools";
import {
  etiquetaDePaso,
  SCOPES_WORDPRESS,
  webmasterToolRegistry,
  type BrowserPort,
  type SitioContext,
} from "../src/index.js";
import {
  AprobacionesEnMemoria,
  BackupsEnMemoria,
  BASE_DOBLE,
  crearDobleWordPress,
  type EstadoWordPress,
} from "../src/testing/index.js";
import {
  ESTILO_POR_DEFECTO,
  estiloDesdeMuestras,
  globalesDesdeCss,
  muestrasDesdeCss,
  type Estilo,
} from "../src/wordpress/diseno.js";
import { construirSecciones } from "../src/wordpress/elementor.js";
import { motivoTituloInvalido } from "../src/wordpress/titulos.js";

const CSS_KIT = `.elementor-kit-6{--e-global-color-primary:#6EC1E4;--e-global-color-secondary:#54595F;--e-global-color-text:#7A7A7A;--e-global-color-accent:#61CE70;--e-global-typography-primary-font-family:"Roboto";--e-global-typography-primary-font-weight:600;}`;

const CSS_PORTADA = `
.elementor-widget-heading .elementor-heading-title{color:var( --e-global-color-primary );font-family:var( --e-global-typography-primary-font-family ), Sans-serif;}
.elementor-2 .elementor-element.elementor-element-a1 .elementor-heading-title{color:#123A59;font-family:"Roboto", Sans-serif;font-size:32px;font-weight:700;}
.elementor-2 .elementor-element.elementor-element-a2 .elementor-heading-title{color:#123A59;font-family:"Roboto", Sans-serif;font-size:34px;font-weight:700;}
.elementor-2 .elementor-element.elementor-element-a3 .elementor-heading-title{color:#AE841A;font-family:"Roboto", Sans-serif;font-size:23px;}
.elementor-2 .elementor-element.elementor-element-b1 .elementor-widget-container{color:#1E1E1E;font-family:"Roboto", Sans-serif;font-size:18px;}
.elementor-2 .elementor-element.elementor-element-b1 .elementor-text-editor{color:#1E1E1E;}
.elementor-2 .elementor-element.elementor-element-c1 .elementor-button{background-color:#D09E1D;color:#FFFFFF;border-radius:100px 100px 100px 100px;}
.elementor-2 .elementor-element.elementor-element-c2 .elementor-button{background-color:#D09E1D;color:#FFFFFF;border-radius:100px;}
.elementor-2 .elementor-element.elementor-element-d1:not(.elementor-motion-effects-element-type-background){background-color:#F3F3F3;}
.elementor-2 .elementor-element.elementor-element-d1{--border-radius:38px 38px 38px 38px;}
.elementor-2 .elementor-element.elementor-element-d2:not(.elementor-motion-effects-element-type-background){background-color:#F3F3F3;}
.elementor-2 .elementor-element.elementor-element-d2{--border-radius:38px 38px 38px 38px;}
.elementor-2 .elementor-element.elementor-element-d3:not(.elementor-motion-effects-element-type-background){background-color:#123A59;}
.elementor-2 .elementor-element.elementor-element-d3{border-radius:38px;}
.elementor-2 .elementor-element.elementor-element-d4 .elementor-background-overlay{background-color:#123A59A1;}
.e-con{--container-max-width:1140px;}
@media(max-width:767px){.elementor-2 .elementor-element.elementor-element-a1 .elementor-heading-title{color:#FF0000;font-size:20px;}}
`;

const HTML_PORTADA = `<!doctype html><html><head>
<link rel="stylesheet" href="${BASE_DOBLE}/wp-content/uploads/elementor/css/post-6.css?ver=1" />
<link rel="stylesheet" href="${BASE_DOBLE}/wp-content/uploads/elementor/css/post-2.css?ver=1" />
</head><body class="home page-template-default page page-id-2 elementor-default elementor-kit-6 elementor-page elementor-page-2"><h1>Inicio</h1></body></html>`;

const ARCHIVOS_SITIO: EstadoWordPress["archivos"] = {
  "/": { tipo: "text/html", cuerpo: HTML_PORTADA },
  "/wp-content/uploads/elementor/css/post-6.css": { tipo: "text/css", cuerpo: CSS_KIT },
  "/wp-content/uploads/elementor/css/post-2.css": { tipo: "text/css", cuerpo: CSS_PORTADA },
};

const SECCIONES = [
  { tipo: "hero", titulo: "La IA ya está en tu despacho 🤖", subtitulo: "Qué cambia y qué no", boton: "Agenda tu asesoría" },
  {
    tipo: "beneficios",
    titulo: "Por qué importa",
    items: [
      { titulo: "Rapidez", texto: "Análisis en minutos", icono: "⚡" },
      { titulo: "Precisión", texto: "Menos errores humanos", icono: "🔍" },
    ],
  },
  { tipo: "texto", titulo: "El uso responsable", html: "<p>Supervisión humana siempre.</p>" },
  { tipo: "cta", titulo: "¿Hablamos?", boton: "Escríbenos", boton_url: "/contacto/" },
];

const EMOJI = /\p{Extended_Pictographic}/u;

function montar(inicial: Partial<EstadoWordPress> = {}, browser?: BrowserPort) {
  const wp = crearDobleWordPress(inicial);
  const sitio: SitioContext = {
    siteId: "s",
    taskId: "t",
    tipo: "wp",
    wp: { url: BASE_DOBLE, user: wp.estado.usuario, appPassword: wp.estado.appPassword },
    backups: new BackupsEnMemoria(),
    approvals: new AprobacionesEnMemoria(),
    fetch: wp.fetch,
    ...(browser ? { browser } : {}),
  };
  const ctx = {
    workspaceId: "ws_1",
    dryRun: false,
    scopes: SCOPES_WORDPRESS,
    ports: {},
    now: () => new Date(),
    sitio,
  } as unknown as ToolContext;
  const llamar = (slug: string, entrada: unknown) =>
    executeToolDef(webmasterToolRegistry.get(slug), ctx, entrada as never) as Promise<Record<string, unknown>>;
  return { wp, llamar };
}

describe("extraer el diseño del CSS de Elementor", () => {
  it("toma azul marino, dorado, tarjetas grises y botones píldora, y descarta los globales de fábrica", () => {
    const globales = globalesDesdeCss(CSS_KIT);
    expect(globales).toEqual({});
    const estilo = estiloDesdeMuestras(muestrasDesdeCss(CSS_PORTADA, globales), {
      referencia: "/",
      fuentes_datos: ["css"],
    });

    expect(estilo).not.toBeNull();
    expect(estilo!.colores).toMatchObject({
      primario: "#123A59",
      acento: "#D09E1D",
      texto: "#1E1E1E",
      tarjeta: "#F3F3F3",
      oscuro: "#123A59",
      sobre_oscuro: "#FFFFFF",
      sobre_acento: "#FFFFFF",
    });
    expect(estilo!.radio_tarjeta).toBe(38);
    expect(estilo!.boton.radio).toBe(100);
    expect(estilo!.ancho).toBe(1140);
    expect(estilo!.tipografia.titulos.familia).toBe("Roboto");
    // Ni los globales de fábrica ni el rojo de la versión móvil.
    const todo = JSON.stringify(estilo);
    for (const c of ["#6EC1E4", "#54595F", "#7A7A7A", "#61CE70", "#FF0000"]) expect(todo).not.toContain(c);
  });

  it("sin colores de titulares ni de botones no inventa un diseño", () => {
    expect(
      estiloDesdeMuestras(
        { titulos: [], parrafos: [], botones: [], cajas: [{ fondo: "#FFFFFF" }], anchos: [] },
        { referencia: "/", fuentes_datos: ["css"] },
      ),
    ).toBeNull();
  });
});

describe("construirSecciones con el estilo del sitio", () => {
  const estilo = estiloDesdeMuestras(muestrasDesdeCss(CSS_PORTADA), { referencia: "/", fuentes_datos: ["css"] }) as Estilo;

  it("aplica colores, tipografía, radios y ancho del sitio, sin emojis", () => {
    const data = construirSecciones(SECCIONES as never, estilo);
    expect(data).toHaveLength(SECCIONES.length);
    const json = JSON.stringify(data);

    expect(json).not.toMatch(EMOJI);
    expect(json).toContain('"typography_font_family":"Roboto"');
    expect(json).toContain('"background_color":"#D09E1D"');
    expect(json).toContain('"title_color":"#123A59"');
    expect(json).toContain('"background_color":"#F3F3F3"');
    expect(json).toContain('"size":1140');
    // Botón píldora y tarjetas con el radio del sitio.
    expect(json).toContain('"border_radius":{"unit":"px","top":"100"');
    expect(json).toContain('"border_radius":{"unit":"px","top":"38"');
    // Nada de la paleta por defecto.
    expect(json).not.toContain("#FF4D00");
    expect(json).not.toContain("#17150F");
  });

  it("sin estilo, conserva el aspecto por defecto como último recurso", () => {
    const json = JSON.stringify(construirSecciones(SECCIONES as never, ESTILO_POR_DEFECTO));
    expect(json).toContain("#FF4D00");
    expect(json).not.toMatch(EMOJI);
  });
});

describe("wp_crear_pagina_elementor usa el diseño del sitio", () => {
  const TITULO = "La importancia de la IA en la práctica legal";

  it("una entrada nueva sale con los colores del sitio, sin título duplicado y sin comentarios", async () => {
    const { wp, llamar } = montar({ archivos: ARCHIVOS_SITIO });
    const r = await llamar("wp_crear_pagina_elementor", { titulo: TITULO, tipo: "post", secciones: SECCIONES });

    expect(r).toMatchObject({ ok: true, tipo: "post", diseno_origen: "sitio", titulo_del_tema_oculto: true, comentarios: "closed" });
    expect((r.estilo_aplicado as { colores: { acento: string } }).colores.acento).toBe("#D09E1D");

    const entrada = wp.estado.contenido.find((c) => c.id === r.id);
    const data = String(entrada?.meta._elementor_data);
    expect(data).toContain("#123A59");
    expect(data).toContain("#D09E1D");
    expect(data).not.toContain("#FF4D00");
    expect(data).not.toMatch(EMOJI);
    expect(entrada?.meta._elementor_page_settings).toEqual({ hide_title: "yes" });
    expect(entrada?.comment_status).toBe("closed");
  });

  it("permitir_comentarios los deja abiertos", async () => {
    const { wp, llamar } = montar({ archivos: ARCHIVOS_SITIO });
    const r = await llamar("wp_crear_pagina_elementor", {
      titulo: TITULO,
      tipo: "post",
      secciones: SECCIONES,
      permitir_comentarios: true,
    });
    expect(wp.estado.contenido.find((c) => c.id === r.id)?.comment_status).toBe("open");
  });

  it("una paleta sin motivo se ignora; con motivo, se usa", async () => {
    const paleta = { fondo: "#101010", acento: "#E91E63", texto: "#FFFFFF", fondo_claro: "#FCE4EC" };

    const sinMotivo = montar({ archivos: ARCHIVOS_SITIO });
    const a = await sinMotivo.llamar("wp_crear_pagina_elementor", { titulo: TITULO, tipo: "post", secciones: SECCIONES, paleta });
    expect(a.diseno_origen).toBe("sitio");
    expect(String(a.nota)).toContain("Ignoré la paleta");
    expect(String(sinMotivo.wp.estado.contenido.find((c) => c.id === a.id)?.meta._elementor_data)).not.toContain("#E91E63");

    const conMotivo = montar({ archivos: ARCHIVOS_SITIO });
    const b = await conMotivo.llamar("wp_crear_pagina_elementor", {
      titulo: TITULO,
      tipo: "post",
      secciones: SECCIONES,
      paleta,
      motivo_paleta: "el_cliente_pidio_otro_estilo",
    });
    expect(b.diseno_origen).toBe("paleta_modelo");
    const data = String(conMotivo.wp.estado.contenido.find((c) => c.id === b.id)?.meta._elementor_data);
    expect(data).toContain("#E91E63");
    // Los colores cambian, pero la forma del sitio se conserva.
    expect(data).toContain('"typography_font_family":"Roboto"');
  });

  it("solo cae al aspecto por defecto cuando no hay nada que leer, y lo dice", async () => {
    const { llamar } = montar();
    const r = await llamar("wp_crear_pagina_elementor", { titulo: TITULO, tipo: "post", secciones: SECCIONES });
    expect(r.diseno_origen).toBe("por_defecto");
    expect(String(r.nota)).toContain("No pude leer el diseño del sitio");
  });

  it("un título que es un trozo de la petición se rechaza sin escribir nada", async () => {
    const { wp, llamar } = montar({ archivos: ARCHIVOS_SITIO });
    const antes = wp.estado.contenido.length;
    await expect(
      llamar("wp_crear_pagina_elementor", {
        titulo: "La importancia y el uso responsable de la IA, pero también…",
        tipo: "post",
        secciones: SECCIONES,
      }),
    ).rejects.toThrow(/fragmento de la petición/);
    await expect(
      llamar("wp_crear_contenido", {
        tipo: "post",
        titulo: "La importancia y el uso responsable de la IA, pero también…",
        contenido_html: "<p>x</p>",
      }),
    ).rejects.toThrow(/fragmento de la petición/);
    expect(wp.estado.contenido.length).toBe(antes);
    expect(wp.llamadas.filter((l) => l.metodo !== "GET")).toHaveLength(0);
  });
});

describe("sitio_leer_diseno", () => {
  it("con navegador usa los estilos computados", async () => {
    const navegador = {
      async muestrearDiseno() {
        return {
          titulos: [
            { etiqueta: "h2", color: "rgb(18, 58, 89)", familia: '"Roboto", sans-serif', grosor: "700", tamano: 36, alineacion: "center", peso: 40 },
            { etiqueta: "h1", color: "rgb(255, 255, 255)", familia: "Roboto", grosor: "700", tamano: 44, alineacion: "center", peso: 30 },
          ],
          parrafos: [{ etiqueta: "p", color: "rgb(30, 30, 30)", familia: "Roboto", grosor: "400", tamano: 18, peso: 300 }],
          botones: [{ fondo: "rgb(208, 158, 29)", texto: "rgb(255, 255, 255)", radio: 50, alto: 48, relleno_v: 12, relleno_h: 28 }],
          cajas: [
            { fondo: "rgb(243, 243, 243)", radio: 38, area: 400 },
            { fondo: "rgba(18, 58, 89, 0.88)", radio: 38, area: 300 },
            { fondo: "rgba(0, 0, 0, 0)", radio: 0, area: 900 },
          ],
          anchos: [1140, 1140, 1000],
          fondo_pagina: "rgb(255, 255, 255)",
        };
      },
    } as unknown as BrowserPort;
    const { llamar } = montar({}, navegador);
    const r = await llamar("sitio_leer_diseno", { path: "/" });
    expect(r).toMatchObject({
      origen: "sitio",
      fuentes_datos: ["navegador"],
      colores: { primario: "#123A59", acento: "#D09E1D", tarjeta: "#F3F3F3", sobre_acento: "#FFFFFF" },
      botones: "píldora",
      radio_tarjetas_px: 38,
      ancho_contenedor_px: 1140,
    });
  });

  it("sin navegador lee el CSS de Elementor de la portada", async () => {
    const { llamar } = montar({ archivos: ARCHIVOS_SITIO });
    const r = await llamar("sitio_leer_diseno", {});
    expect(r).toMatchObject({ origen: "sitio", fuentes_datos: ["css"], colores: { primario: "#123A59" } });
  });

  it("el registro de trabajo lo cuenta para personas", () => {
    expect(etiquetaDePaso("sitio_leer_diseno", { path: "/" })).toBe("Estudiando el diseño del sitio");
  });
});

describe("títulos", () => {
  it.each([
    "La importancia y el uso responsable de la IA, pero también…",
    "La importancia y el uso responsable de la IA, pero también...",
    "Guía de precios para",
    "Cómo usar la IA y",
    "Crea un post sobre la IA y créale una plantilla de Elementor",
    "x".repeat(95),
    "",
  ])("rechaza «%s»", (titulo) => {
    expect(motivoTituloInvalido(titulo)).toMatch(/fragmento de la petición/);
  });

  it.each([
    "La importancia de la IA en la práctica legal",
    "Masa madre en casa",
    "¿Qué es la inteligencia artificial?",
    "Inicio",
    "Novedades del horno",
    "La IA",
  ])("acepta «%s»", (titulo) => {
    expect(motivoTituloInvalido(titulo)).toBeNull();
  });
});
