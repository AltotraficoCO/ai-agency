/**
 * Blogs bien hechos: una entrada, completa, sin destruir nada y enlazada.
 *
 * El caso de producción (tarea 4a0b76f2): «Crea un blog de Inteligencia
 * Artificial y Uso Responsable» creó TRES entradas de un solo hero cada una,
 * con un botón «Leer la guía completa» que no llevaba a ninguna parte, las
 * reescribió encima con menos contenido y no aparecieron en /blog/, cuya
 * rejilla eran cuatro imágenes con «[Título del artículo]» pintado dentro.
 */
import { describe, expect, it } from "vitest";
import { executeToolDef, type ToolContext } from "@strappy/tools";
import { etiquetaDePaso, SCOPES_WORDPRESS, webmasterToolRegistry, type SitioContext } from "../src/index.js";
import {
  AprobacionesEnMemoria,
  BackupsEnMemoria,
  BASE_DOBLE,
  crearDobleWordPress,
  estadoInicial,
  type EstadoWordPress,
} from "../src/testing/index.js";
import {
  buscarTarjetasDeRelleno,
  CLASE_REJILLA_ENTRADAS,
  CLASE_SECCION_ENTRADAS,
  elegirTarjeta,
  insertarEntradaReciente,
  rellenarTarjeta,
  tarjetasDeImagen,
  tieneListadoDinamico,
} from "../src/wordpress/blog.js";
import { motivoArticuloIncompleto, palabrasDeSecciones } from "../src/wordpress/articulo.js";
import { construirSecciones } from "../src/wordpress/elementor.js";
import { ESTILO_POR_DEFECTO } from "../src/wordpress/diseno.js";
import type { NodoElementor } from "../src/wordpress/plantillas.js";

const ARTICULO = [
  { tipo: "hero", titulo: "Otra cosa distinta", subtitulo: "Qué cambia para tu despacho" },
  {
    tipo: "texto",
    titulo: "Introducción",
    html: `<p>${"La inteligencia artificial revisa documentos en minutos y el abogado decide. ".repeat(24)}</p>`,
  },
  {
    tipo: "texto",
    titulo: "El uso responsable",
    html: `<h3>Supervisión</h3><p>${"Cada resultado lo revisa una persona con criterio y experiencia. ".repeat(20)}</p>`,
  },
  { tipo: "cta", titulo: "¿Hablamos?", boton: "Agenda tu asesoría", boton_url: "/contacto/" },
];

const SOLO_HERO = [
  { tipo: "hero", titulo: "La inteligencia artificial en el trabajo", subtitulo: "Aprovecha el poder de la IA", boton: "Leer la guía completa" },
];

const tarjetaDeTexto = (n: number, categoria: string): NodoElementor => ({
  id: `card${n}00`,
  elType: "container",
  settings: {},
  elements: [
    { id: `img${n}000`, elType: "widget", widgetType: "image", settings: { image: { url: `${BASE_DOBLE}/wp-content/uploads/foto-${n}.jpg` } }, elements: [] },
    { id: `cat${n}000`, elType: "widget", widgetType: "heading", settings: { title: categoria }, elements: [] },
    { id: `tit${n}000`, elType: "widget", widgetType: "heading", settings: { title: "[Título del artículo]" }, elements: [] },
    { id: `ext${n}000`, elType: "widget", widgetType: "text-editor", settings: { editor: "<p>[Breve extracto del artículo]... Leer más</p>" }, elements: [] },
  ],
});

/** Un blog de tarjetas de relleno con TEXTO, con las categorías del sitio real. */
const BLOG_CON_TEXTO: NodoElementor[] = [
  {
    id: "hero0001",
    elType: "container",
    settings: {},
    elements: [{ id: "h1blog01", elType: "widget", widgetType: "heading", settings: { title: "Blog y actualidad legal" }, elements: [] }],
  },
  {
    id: "rejilla1",
    elType: "container",
    settings: {},
    elements: [
      tarjetaDeTexto(1, "Derecho Público"),
      tarjetaDeTexto(2, "Derecho Privado"),
      tarjetaDeTexto(3, "Derecho Penal"),
      tarjetaDeTexto(4, "Derecho Laboral y Seguridad Social"),
    ],
  },
];

/** El blog de producción tal cual: la rejilla son cuatro imágenes sin enlace (Group-97…100.png). */
const BLOG_DE_IMAGENES: NodoElementor[] = [
  {
    id: "92375d7",
    elType: "container",
    settings: {},
    elements: [
      {
        id: "0fe7407",
        elType: "container",
        settings: {},
        elements: [
          { id: "5e9f1a8", elType: "widget", widgetType: "heading", settings: { title: "Blog y actualidad legal" }, elements: [] },
          { id: "4074357", elType: "widget", widgetType: "text-editor", settings: { editor: "<p>Encuentra aquí información y análisis del panorama jurídico.</p>" }, elements: [] },
        ],
      },
    ],
  },
  {
    id: "2de49b2",
    elType: "container",
    settings: {},
    elements: [
      { id: "5305920", elType: "widget", widgetType: "text-editor", settings: { editor: "<p>En nuestro blog, encontrarás artículos de interés y análisis de nuevas legislaciones.</p>" }, elements: [] },
    ],
  },
  {
    id: "3f21689",
    elType: "container",
    settings: {},
    elements: ["70ad05d", "6e36119", "a1b2c3d", "d4e5f6a"].map((id, i) => ({
      id,
      elType: "container",
      settings: {},
      elements: [
        { id: `im${i}0000`, elType: "widget", widgetType: "image", settings: { image: { url: `${BASE_DOBLE}/wp-content/uploads/2025/12/Group-${97 + i}.png` } }, elements: [] },
      ],
    })),
  },
];

function paginaBlog(data: NodoElementor[]) {
  return { id: 92, tipo: "page" as const, titulo: "Blog", contenido: "", slug: "blog", status: "publish", meta: { _elementor_data: JSON.stringify(data) } };
}

function montar(inicial: Partial<EstadoWordPress> = {}) {
  const wp = crearDobleWordPress(inicial);
  const backups = new BackupsEnMemoria();
  const sitio: SitioContext = {
    siteId: "s",
    taskId: "t",
    tipo: "wp",
    wp: { url: BASE_DOBLE, user: wp.estado.usuario, appPassword: wp.estado.appPassword },
    backups,
    approvals: new AprobacionesEnMemoria(),
    fetch: wp.fetch,
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
  return { wp, backups, llamar };
}

const conBlog = (data: NodoElementor[]) => montar({ contenido: [...estadoInicial().contenido, paginaBlog(data)] });
const entradas = (wp: ReturnType<typeof crearDobleWordPress>) => wp.estado.contenido.filter((c) => c.tipo === "post").length;
const escrituras = (wp: ReturnType<typeof crearDobleWordPress>) => wp.llamadas.filter((l) => l.metodo !== "GET");
const datosDe = (wp: ReturnType<typeof crearDobleWordPress>, id: number) =>
  JSON.parse(String(wp.estado.contenido.find((c) => c.id === id)?.meta._elementor_data)) as NodoElementor[];

function buscarNodo(lista: readonly NodoElementor[], pred: (n: NodoElementor) => boolean): NodoElementor | undefined {
  for (const n of lista) {
    if (pred(n)) return n;
    const dentro = buscarNodo(n.elements ?? [], pred);
    if (dentro) return dentro;
  }
  return undefined;
}

// ---------------------------------------------------------------------------

describe("cantidad: «un blog» es una entrada", () => {
  it("la segunda creación se frena con un error que dice qué hacer", async () => {
    const { wp, llamar } = montar();
    const antes = entradas(wp);
    const r = await llamar("wp_crear_pagina_elementor", {
      titulo: "La inteligencia artificial en tu despacho",
      tipo: "post",
      secciones: ARTICULO,
    });

    await expect(
      llamar("wp_crear_pagina_elementor", { titulo: "El impacto ético de la automatización", tipo: "post", secciones: ARTICULO }),
    ).rejects.toThrow(new RegExp(`Ya creaste la entrada ${r.id} .*cantidad_pedida.*contenido_id`));
    await expect(
      llamar("wp_crear_contenido", { tipo: "post", titulo: "Cómo elegir proveedores de IA", contenido_html: "<p>x</p>" }),
    ).rejects.toThrow(/Ya creaste la entrada/);
    expect(entradas(wp)).toBe(antes + 1);
  });

  it("con cantidad_pedida=3 deja crear las tres, y ni una más", async () => {
    const { wp, llamar } = montar();
    const antes = entradas(wp);
    for (const titulo of ["La IA en tu despacho", "El impacto ético de la automatización", "Cómo elegir proveedores de IA"]) {
      await llamar("wp_crear_pagina_elementor", { titulo, tipo: "post", secciones: ARTICULO, cantidad_pedida: 3 });
    }
    expect(entradas(wp)).toBe(antes + 3);
    await expect(
      llamar("wp_crear_pagina_elementor", { titulo: "Una cuarta entrada", tipo: "post", secciones: ARTICULO, cantidad_pedida: 3 }),
    ).rejects.toThrow(/Ya creaste la entrada/);
  });

  it("mejorar la entrada creada con contenido_id no cuenta como otra", async () => {
    const { llamar } = montar();
    const r = await llamar("wp_crear_pagina_elementor", { titulo: "La IA en tu despacho", tipo: "post", secciones: ARTICULO });
    const otra = await llamar("wp_crear_pagina_elementor", {
      titulo: "La IA en tu despacho",
      tipo: "post",
      contenido_id: r.id,
      secciones: ARTICULO,
    });
    expect(otra).toMatchObject({ ok: true, id: r.id });
  });

  it("una creación que falla no gasta la plaza", async () => {
    const { llamar } = montar({ conectorInstalado: false });
    const pedir = () => llamar("wp_crear_pagina_elementor", { titulo: "La IA en tu despacho", tipo: "post", secciones: ARTICULO });
    await expect(pedir()).rejects.toThrow(/plugin conector/);
    await expect(pedir()).rejects.toThrow(/plugin conector/);
  });
});

describe("una entrada es un artículo completo", () => {
  it("solo un hero se rechaza, dice qué falta y no escribe nada", async () => {
    const { wp, llamar } = montar();
    await expect(
      llamar("wp_crear_pagina_elementor", { titulo: "La inteligencia artificial y su uso responsable en tu empresa", tipo: "post", secciones: SOLO_HERO }),
    ).rejects.toThrow(/Una entrada de blog necesita el artículo completo: solo enviaste un hero \(≈\d+ palabras\).*mínimo 400 palabras/);
    expect(escrituras(wp)).toHaveLength(0);

    // Y la plaza no se gastó: con el artículo completo sí se crea.
    const r = await llamar("wp_crear_pagina_elementor", { titulo: "La inteligencia artificial y su uso responsable", tipo: "post", secciones: ARTICULO });
    expect(r).toMatchObject({ ok: true, tipo: "post" });
    expect(r.palabras as number).toBeGreaterThanOrEqual(400);
  });

  it("el artículo completo pasa y uno corto dice cuántas palabras faltan", () => {
    expect(palabrasDeSecciones(ARTICULO as never)).toBeGreaterThanOrEqual(400);
    expect(motivoArticuloIncompleto(ARTICULO as never)).toBeNull();
    const corto = motivoArticuloIncompleto([
      { tipo: "hero", titulo: "La IA" },
      { tipo: "texto", html: "<p>Poco texto.</p>" },
    ]);
    expect(corto).toMatch(/enviaste 2 secciones \(hero, texto\)/);
    expect(corto).toMatch(/ninguna sección "texto" con cuerpo/);
    expect(corto).toMatch(/hacen falta al menos 3 secciones/);
    expect(corto).toMatch(/faltan ≈\d+ palabras/);
  });

  it("el hero de una entrada lleva el mismo titular que la entrada", async () => {
    const { wp, llamar } = montar();
    const titulo = "La inteligencia artificial en tu despacho";
    const r = await llamar("wp_crear_pagina_elementor", { titulo, tipo: "post", secciones: ARTICULO });
    const data = datosDe(wp, r.id as number);
    const h1 = buscarNodo(data, (n) => n.widgetType === "heading" && n.settings?.header_size === "h1");
    expect(h1?.settings?.title).toBe(titulo);
    expect(JSON.stringify(data)).not.toContain("Otra cosa distinta");
    expect(String(r.nota)).toContain("mismo titular");
    expect(String(r.nota)).toContain("wp_enlazar_entrada_en_blog");
  });

  it("un botón sin destino no se pinta; con destino, sí", () => {
    const sin = JSON.stringify(construirSecciones(SOLO_HERO as never, ESTILO_POR_DEFECTO));
    expect(sin).not.toContain("Leer la guía completa");
    expect(sin).not.toContain('"widgetType":"button"');
    const cta = JSON.stringify(construirSecciones([{ tipo: "cta", titulo: "¿Hablamos?", boton: "Escríbenos" }], ESTILO_POR_DEFECTO));
    expect(cta).not.toContain('"widgetType":"button"');
    const con = JSON.stringify(
      construirSecciones([{ tipo: "hero", titulo: "x", boton: "Agenda tu asesoría", boton_url: "/contacto/" }], ESTILO_POR_DEFECTO),
    );
    expect(con).toContain("Agenda tu asesoría");
  });

  it("el HTML del artículo se sanea", () => {
    const json = JSON.stringify(
      construirSecciones(
        [{ tipo: "texto", html: '<p onclick="robar()">Hola <a href="javascript:alert(1)">x</a></p><script>alert(1)</script>' }],
        ESTILO_POR_DEFECTO,
      ),
    );
    expect(json).not.toContain("<script");
    expect(json).not.toContain("onclick");
    expect(json).not.toContain("javascript:");
  });
});

describe("no destruir al reescribir", () => {
  const LARGO: NodoElementor[] = [
    {
      id: "s1",
      elType: "section",
      settings: {},
      elements: [
        {
          id: "c1",
          elType: "column",
          settings: {},
          elements: [{ id: "w1", elType: "widget", widgetType: "text-editor", settings: { editor: `<p>${"palabra ".repeat(900)}</p>` } }],
        },
      ],
    },
  ];

  it("reescribir una entrada larga con mucho menos texto se rechaza, salvo reemplazar_todo", async () => {
    const inicial = estadoInicial();
    const post = inicial.contenido.find((c) => c.id === 21)!;
    post.meta = { _elementor_data: JSON.stringify(LARGO) };
    const { wp, backups, llamar } = montar({ contenido: inicial.contenido });

    await expect(
      llamar("wp_crear_pagina_elementor", { titulo: "Masa madre en casa", tipo: "post", contenido_id: 21, secciones: ARTICULO }),
    ).rejects.toThrow(/Reescribir el contenido 21 lo dejaría con ≈\d+ palabras cuando ahora tiene ≈900.*reemplazar_todo=true/);
    expect(escrituras(wp)).toHaveLength(0);

    const r = await llamar("wp_crear_pagina_elementor", {
      titulo: "Masa madre en casa",
      tipo: "post",
      contenido_id: 21,
      secciones: ARTICULO,
      reemplazar_todo: true,
    });
    expect(r).toMatchObject({ ok: true, id: 21 });
    // El backup guarda también el diseño, y restaurarlo lo devuelve entero.
    expect(backups.guardados[0]?.snapshot).toMatchObject({ elementor_data: LARGO });
    await llamar("wp_restaurar_contenido", { tipo: "post", id: 21, backup_id: r.backup_id });
    expect(datosDe(wp, 21)).toEqual(LARGO);
  });
});

describe("tarjetas de relleno del blog", () => {
  const entrada = {
    titulo: "La inteligencia artificial y su uso responsable",
    extracto: "Qué puede hacer la IA por tu caso y dónde tiene que decidir siempre una persona.",
    url: `${BASE_DOBLE}/la-inteligencia-artificial-y-su-uso-responsable/`,
  };

  it("encuentra las cuatro tarjetas con su categoría", () => {
    const tarjetas = buscarTarjetasDeRelleno(BLOG_CON_TEXTO);
    expect(tarjetas.map((t) => t.contenedor)).toEqual(["card100", "card200", "card300", "card400"]);
    expect(tarjetas[0]).toMatchObject({ tituloWidget: "tit1000", etiquetas: ["Derecho Público"] });
  });

  it("rellena la más afín, conserva la foto y no toca el original", () => {
    const original = JSON.stringify(BLOG_CON_TEXTO);
    const tarjeta = elegirTarjeta(buscarTarjetasDeRelleno(BLOG_CON_TEXTO), "Derecho laboral");
    expect(tarjeta.contenedor).toBe("card400");

    const r = rellenarTarjeta(BLOG_CON_TEXTO, tarjeta, entrada);
    const card = buscarNodo(r.data, (n) => n.id === "card400")!;
    const porId = (id: string) => buscarNodo([card], (n) => n.id === id)!;
    expect(porId("tit4000").settings).toMatchObject({ title: entrada.titulo, link: { url: entrada.url } });
    const editor = String(porId("ext4000").settings?.editor);
    expect(editor).toContain(entrada.extracto);
    expect(editor).toContain(`<a href="${entrada.url}">Leer más</a>`);
    expect(editor).not.toContain("[Breve");
    expect(porId("img4000").settings).toMatchObject({
      image: { url: `${BASE_DOBLE}/wp-content/uploads/foto-4.jpg` },
      link_to: "custom",
      link: { url: entrada.url },
    });
    expect(porId("cat4000").settings?.title).toBe("Derecho Laboral y Seguridad Social");
    expect(r.quedanDeRelleno).toBe(0);
    // Solo una: las otras tres siguen esperando su entrada.
    expect(buscarTarjetasDeRelleno(r.data)).toHaveLength(3);
    expect(JSON.stringify(BLOG_CON_TEXTO)).toBe(original);
  });

  it("en el blog real las tarjetas son imágenes: no hay texto que rellenar", () => {
    expect(buscarTarjetasDeRelleno(BLOG_DE_IMAGENES)).toEqual([]);
    expect(tarjetasDeImagen(BLOG_DE_IMAGENES)).toEqual({ total: 4, indiceRaiz: 2 });
    expect(tieneListadoDinamico(BLOG_DE_IMAGENES)).toBe(false);
  });

  it("añade «Artículos recientes» encima de las imágenes, y la siguiente entrada va a la misma sección", () => {
    const primera = insertarEntradaReciente(BLOG_DE_IMAGENES, entrada, ESTILO_POR_DEFECTO);
    expect(primera.yaExistia).toBe(false);
    expect(primera.data).toHaveLength(4);
    expect(primera.data[2]?.settings?._css_classes).toBe(CLASE_SECCION_ENTRADAS);
    expect(primera.data[3]?.id).toBe("3f21689");
    const json = JSON.stringify(primera.data[2]);
    expect(json).toContain(entrada.extracto);
    expect(json).toContain(entrada.url);
    expect(json).toContain("Leer más");

    const segunda = insertarEntradaReciente(
      primera.data,
      { ...entrada, titulo: "Cómo elegir proveedores de IA", url: `${BASE_DOBLE}/proveedores-ia/` },
      ESTILO_POR_DEFECTO,
    );
    expect(segunda).toMatchObject({ yaExistia: true, seccion: primera.seccion });
    expect(segunda.data).toHaveLength(4);
    const rejilla = buscarNodo(segunda.data, (n) => n.settings?._css_classes === CLASE_REJILLA_ENTRADAS)!;
    expect(rejilla.elements).toHaveLength(2);
    expect(JSON.stringify(rejilla.elements![0])).toContain("Cómo elegir proveedores de IA");
  });

  it("reconoce un blog que ya lista las entradas solo", () => {
    expect(
      tieneListadoDinamico([
        { id: "a", elType: "container", elements: [{ id: "b", elType: "widget", widgetType: "posts", settings: {} }] },
      ]),
    ).toBe(true);
  });
});

describe("wp_enlazar_entrada_en_blog", () => {
  const EXTRACTO = "Qué puede hacer la IA por tu caso y dónde tiene que decidir siempre una persona.";

  async function crearEntrada(llamar: ReturnType<typeof montar>["llamar"]) {
    return llamar("wp_crear_pagina_elementor", {
      titulo: "La inteligencia artificial y su uso responsable",
      tipo: "post",
      secciones: ARTICULO,
    });
  }

  it("en un blog de tarjetas de texto rellena la más afín y guarda backup", async () => {
    const { wp, backups, llamar } = conBlog(BLOG_CON_TEXTO);
    const creada = await crearEntrada(llamar);
    const r = await llamar("wp_enlazar_entrada_en_blog", { entrada_id: creada.id, extracto: EXTRACTO, categoria: "Derecho Laboral" });

    expect(r).toMatchObject({ ok: true, enlazada: true, modo: "tarjeta_rellenada", tarjeta: "card400", pagina_blog_id: 92 });
    expect(JSON.stringify(datosDe(wp, 92))).toContain(String(creada.link));
    expect(backups.guardados.at(-1)).toMatchObject({ alcance: "page:92", snapshot: { elementor_data: BLOG_CON_TEXTO } });

    // Enlazarla otra vez no rellena otra tarjeta.
    const otra = await llamar("wp_enlazar_entrada_en_blog", { entrada_id: creada.id, extracto: EXTRACTO });
    expect(otra).toMatchObject({ modo: "ya_estaba" });
  });

  it("en el blog de imágenes añade «Artículos recientes», lo avisa y se puede deshacer", async () => {
    const { wp, llamar } = conBlog(BLOG_DE_IMAGENES);
    const creada = await crearEntrada(llamar);
    const r = await llamar("wp_enlazar_entrada_en_blog", { entrada_id: creada.id, extracto: EXTRACTO });

    expect(r).toMatchObject({ enlazada: true, modo: "seccion_entradas_recientes", tarjetas_de_imagen_sin_enlace: 4 });
    expect(String(r.nota)).toContain("IMÁGENES sin enlace");
    const data = datosDe(wp, 92);
    expect(data[2]?.settings?._css_classes).toBe(CLASE_SECCION_ENTRADAS);
    expect(JSON.stringify(data)).toContain(String(creada.link));

    await llamar("wp_restaurar_contenido", { tipo: "page", id: 92, backup_id: r.backup_id });
    expect(datosDe(wp, 92)).toEqual(BLOG_DE_IMAGENES);
  });

  it("si el blog lista las entradas solo, no escribe nada", async () => {
    const { wp, llamar } = conBlog([
      { id: "a", elType: "container", settings: {}, elements: [{ id: "b", elType: "widget", widgetType: "posts", settings: {} }] },
    ]);
    const creada = await crearEntrada(llamar);
    const antes = escrituras(wp).length;
    const r = await llamar("wp_enlazar_entrada_en_blog", { entrada_id: creada.id, extracto: EXTRACTO });
    expect(r).toMatchObject({ enlazada: true, modo: "listado_dinamico" });
    expect(escrituras(wp)).toHaveLength(antes);
  });

  it("sin página de blog lo dice y no toca nada", async () => {
    const { wp, llamar } = montar();
    const r = await llamar("wp_enlazar_entrada_en_blog", { entrada_id: 21, extracto: EXTRACTO });
    expect(r).toMatchObject({ enlazada: false, modo: "sin_pagina_de_blog" });
    expect(escrituras(wp)).toHaveLength(0);
  });

  it("el registro de trabajo lo cuenta para personas", () => {
    expect(etiquetaDePaso("wp_enlazar_entrada_en_blog", { entrada_id: 1 })).toBe("Enlazando la entrada en el blog");
  });
});
