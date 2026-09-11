/**
 * Elementor sobre entradas, no solo sobre páginas.
 *
 * El caso de producción: `wp_crear_contenido` creó la ENTRADA 177 y el modelo
 * pidió diseñarla con `wp_crear_pagina_elementor` y `pagina_id: 177`. La
 * herramienta la buscaba en `/pages/`, WordPress respondía «Invalid post ID» y
 * el modelo repitió exactamente lo mismo doce veces.
 */
import { describe, expect, it } from "vitest";
import { executeToolDef, type ToolContext } from "@strappy/tools";
import {
  etiquetaDePaso,
  SCOPES_WORDPRESS,
  webmasterToolRegistry,
  type SitioContext,
} from "../src/index.js";
import {
  AprobacionesEnMemoria,
  BackupsEnMemoria,
  BASE_DOBLE,
  crearDobleWordPress,
  type DobleWordPress,
  type EstadoWordPress,
} from "../src/testing/index.js";

/** Una entrada ya es un artículo completo: con menos, la herramienta la rechaza. */
const CUERPO = `<h2>Por qué importa</h2><p>${"La inteligencia artificial automatiza lo repetitivo y deja tiempo para el criterio humano. ".repeat(32)}</p>`;
const SECCIONES = [
  { tipo: "hero", titulo: "La IA ya está aquí", subtitulo: "Qué cambia para tu despacho" },
  { tipo: "texto", titulo: "Por qué importa", html: CUERPO },
  { tipo: "cta", titulo: "¿Hablamos?", boton: "Escríbenos", boton_url: "/contacto/" },
];

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

const escrituras = (wp: DobleWordPress) => wp.llamadas.filter((l) => l.metodo !== "GET");
const paginas = (wp: DobleWordPress) => wp.estado.contenido.filter((c) => c.tipo === "page").length;

describe("wp_crear_pagina_elementor sobre entradas", () => {
  it("con el id de una entrada y sin tipo, detecta que es un post y la diseña", async () => {
    const { wp, backups, llamar } = montar();
    const antes = paginas(wp);

    const r = await llamar("wp_crear_pagina_elementor", {
      titulo: "Masa madre en casa",
      pagina_id: 21,
      secciones: SECCIONES,
    });

    expect(r).toMatchObject({ ok: true, tipo: "post", id: 21 });
    const entrada = wp.estado.contenido.find((c) => c.id === 21);
    expect(entrada?.tipo).toBe("post");
    expect(JSON.parse(String(entrada?.meta._elementor_data))).toHaveLength(3);
    expect(entrada?.meta._elementor_edit_mode).toBe("builder");
    // El backup es de la entrada, con su tipo: si no, no se podría restaurar.
    expect(backups.guardados[0]).toMatchObject({ alcance: "post:21", snapshot: { tipo: "post", id: 21 } });
    expect(r.backup_id).toBe(backups.guardados[0]?.id);
    // Ni una página nueva ni una escritura por la ruta de páginas.
    expect(paginas(wp)).toBe(antes);
    expect(escrituras(wp).some((l) => l.ruta.includes("/wp/v2/pages"))).toBe(false);
  });

  it("contenido_id con tipo post va directo a la entrada, sin probar como página", async () => {
    const { wp, llamar } = montar();
    const r = await llamar("wp_crear_pagina_elementor", {
      titulo: "Masa madre en casa",
      tipo: "post",
      contenido_id: 21,
      secciones: SECCIONES,
    });
    expect(r).toMatchObject({ tipo: "post", id: 21 });
    expect(wp.llamadas.some((l) => l.ruta === "/wp-json/wp/v2/pages/21")).toBe(false);
  });

  it("crea una entrada nueva ya diseñada con Elementor y la publica", async () => {
    const { wp, llamar } = montar();
    const antes = paginas(wp);

    const r = await llamar("wp_crear_pagina_elementor", {
      titulo: "La importancia de la IA",
      tipo: "post",
      secciones: SECCIONES,
    });

    const nueva = wp.estado.contenido.find((c) => c.id === r.id);
    expect(nueva).toMatchObject({ tipo: "post", titulo: "La importancia de la IA", status: "publish" });
    expect(JSON.parse(String(nueva?.meta._elementor_data))).toHaveLength(3);
    expect(nueva?.meta._elementor_template_type).toBe("wp-post");
    expect(nueva?.meta._wp_page_template).toBe("elementor_header_footer");
    expect(paginas(wp)).toBe(antes);
  });

  it("sin el conector, la entrada nueva no queda publicada vacía", async () => {
    const { wp, llamar } = montar({ conectorInstalado: false });
    await expect(
      llamar("wp_crear_pagina_elementor", { titulo: "La IA", tipo: "post", secciones: SECCIONES }),
    ).rejects.toThrow(/plugin conector/);
    const creada = wp.estado.contenido.find((c) => c.titulo === "La IA");
    expect(creada?.status).toBe("draft");
  });

  it("un id que no existe como nada da un error que dice qué hacer, sin escribir", async () => {
    const { wp, llamar } = montar();
    await expect(
      llamar("wp_crear_pagina_elementor", { titulo: "La IA", pagina_id: 999, secciones: SECCIONES }),
    ).rejects.toThrow(/El id 999 no existe como página ni como entrada.*wp_listar_contenido/);
    expect(escrituras(wp)).toHaveLength(0);
  });

  it("con el tipo equivocado dice cuál es el bueno", async () => {
    const { wp, llamar } = montar();
    await expect(
      llamar("wp_crear_pagina_elementor", { titulo: "La IA", tipo: "page", pagina_id: 21, secciones: SECCIONES }),
    ).rejects.toThrow('El id 21 es una entrada (post), no una página: vuelve a llamar con tipo="post".');
    expect(escrituras(wp)).toHaveLength(0);
  });
});

describe("las demás herramientas de tipo fijo", () => {
  it("wp_leer_contenido con el tipo equivocado también dice cuál es", async () => {
    const { llamar } = montar();
    await expect(llamar("wp_leer_contenido", { tipo: "page", id: 21 })).rejects.toThrow(
      'El id 21 es una entrada (post), no una página: vuelve a llamar con tipo="post".',
    );
    await expect(llamar("wp_editar_contenido", { tipo: "post", id: 7, nuevo_titulo: "x" })).rejects.toThrow(
      'El id 7 es una página, no una entrada (post): vuelve a llamar con tipo="page".',
    );
    await expect(llamar("wp_borrar_contenido", { tipo: "post", id: 999 })).rejects.toThrow(
      /no existe como página ni como entrada/,
    );
  });

  it("el registro de trabajo no llama página a una entrada", () => {
    expect(etiquetaDePaso("wp_crear_contenido", { tipo: "post" })).toBe("Creando una entrada");
    expect(etiquetaDePaso("wp_crear_contenido", { tipo: "page" })).toBe("Creando una página");
    expect(etiquetaDePaso("wp_crear_pagina_elementor", { tipo: "post" })).toBe(
      "Diseñando una entrada con Elementor",
    );
    expect(etiquetaDePaso("wp_crear_pagina_elementor", { pagina_id: 177 })).toBe("Diseñando con Elementor");
  });
});
