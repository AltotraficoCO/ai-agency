/**
 * Plantillas de Elementor sin plugin: el caso que motivó estas herramientas es
 * añadir un enlace al footer de un sitio con Elementor, que el Webmaster no
 * sabía hacer y resolvía publicando un post de "evidencia".
 */
import { describe, expect, it } from "vitest";
import { executeToolDef, type ToolContext } from "@strappy/tools";
import { SCOPES_WORDPRESS, webmasterToolRegistry, type SitioContext } from "../src/index.js";
import { aplicarCambio, resumirPlantilla, type NodoElementor } from "../src/wordpress/plantillas.js";
import { BackupsEnMemoria, BASE_DOBLE, crearDobleWordPress, estadoInicial } from "../src/testing/index.js";

const footer = (): NodoElementor[] =>
  JSON.parse(estadoInicial().plantillas.find((p) => p.id === 78)!.data) as NodoElementor[];

describe("resumen de una plantilla", () => {
  it("lista contenedores y widgets con sus enlaces, sin confundir imágenes con enlaces", () => {
    const { contenedores, widgets } = resumirPlantilla(footer());
    expect(contenedores).toEqual([{ id: "f0c0n7a", tipo: "container", profundidad: 0, widgets: 2 }]);
    expect(widgets.map((w) => w.tipo)).toEqual(["image", "social-icons"]);
    expect(widgets[0]?.enlaces).toBeUndefined();
    expect(widgets[1]?.enlaces).toEqual(["https://instagram.com/aurora"]);
  });
});

describe("cambios sobre una plantilla", () => {
  it("añade un enlace externo junto a los widgets existentes, escapado, sin tocar el original", () => {
    const original = footer();
    const copiaDelOriginal = structuredClone(original);
    const { data, widgetId } = aplicarCambio(original, {
      accion: "anadir_enlace",
      texto: 'Strappy "IA"',
      url: "https://strappy.vercel.app/",
    });

    expect(original).toEqual(copiaDelOriginal);
    const contenedor = data[0]!;
    expect(contenedor.elements).toHaveLength(3);
    const nuevo = contenedor.elements![2]!;
    expect(nuevo.id).toBe(widgetId);
    expect(nuevo.widgetType).toBe("text-editor");
    const html = String(nuevo.settings?.editor);
    expect(html).toContain('href="https://strappy.vercel.app/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Strappy &quot;IA&quot;");
  });

  it("rechaza enlaces que no son enlaces y widgets que no existen", () => {
    expect(() =>
      aplicarCambio(footer(), { accion: "anadir_enlace", texto: "x", url: "javascript:alert(1)" }),
    ).toThrow(/ruta del sitio/);
    expect(() => aplicarCambio(footer(), { accion: "eliminar_widget", widget_id: "noexiste" })).toThrow(
      /No existe el widget/,
    );
  });

  it("quita un widget", () => {
    const { data } = aplicarCambio(footer(), { accion: "eliminar_widget", widget_id: "f2s0c1a" });
    expect(data[0]!.elements!.map((e) => e.id)).toEqual(["f1m4g3n"]);
  });
});

describe("wp_editar_plantilla_elementor contra el doble", () => {
  it("escribe el enlace en el footer y devuelve backup y widget para deshacer", async () => {
    const wp = crearDobleWordPress();
    const sitio: SitioContext = {
      siteId: "site_1",
      taskId: "task_footer",
      tipo: "wp",
      wp: { url: BASE_DOBLE, user: wp.estado.usuario, appPassword: wp.estado.appPassword },
      backups: new BackupsEnMemoria(),
      approvals: {
        async check() {
          return null;
        },
        async request() {
          return { id: "ap", decision: null };
        },
      },
      fetch: wp.fetch,
    };
    const ctx = {
      workspaceId: "ws_1",
      dryRun: false,
      scopes: [...SCOPES_WORDPRESS],
      ports: {},
      now: () => new Date(),
      ...{ sitio },
    } as ToolContext;

    const salida = (await executeToolDef(webmasterToolRegistry.get("wp_editar_plantilla_elementor"), ctx, {
      plantilla_id: 78,
      cambio: { accion: "anadir_enlace", texto: "Strappy", url: "https://strappy.vercel.app/" },
    } as never)) as Record<string, unknown>;

    expect(salida.ok).toBe(true);
    expect(typeof salida.backup_id).toBe("string");
    expect(typeof salida.widget_id).toBe("string");
    expect(wp.estado.plantillas.find((p) => p.id === 78)!.data).toContain("https://strappy.vercel.app/");
  });
});

/**
 * El caso de Vox (22-sep): su /blog/ pinta las entradas con un widget de
 * bucle cuya plantilla NO lleva el título y no enlaza al artículo. El
 * Webmaster no podía arreglarlo porque solo sabía cambiar TEXTO, y el texto de
 * un listado no existe: lo pone cada entrada. Lo que faltaba era poder tocar
 * los AJUSTES del widget y poder añadir un widget dinámico.
 */
describe("ajustes de un widget y widgets dinámicos", () => {
  const listado = (): NodoElementor[] => [
    {
      id: "c1",
      elType: "container",
      elements: [
        {
          id: "w1",
          elType: "widget",
          widgetType: "loop-grid",
          settings: { show_title: "", columns: "3" },
          elements: [],
        },
      ],
    },
  ];

  it("enciende el título y el enlace de un listado de entradas", () => {
    const { data } = aplicarCambio(listado(), {
      accion: "cambiar_ajustes",
      widget_id: "w1",
      ajustes: { show_title: "yes", link_to: "post" },
    });
    const widget = data[0]?.elements?.[0];
    expect(widget?.settings).toMatchObject({ show_title: "yes", link_to: "post", columns: "3" });
  });

  it("se niega a escribir un ajuste que no es de diseño", () => {
    expect(() =>
      aplicarCambio(listado(), {
        accion: "cambiar_ajustes",
        widget_id: "w1",
        ajustes: { query_post_type: "product" },
      }),
    ).toThrow(/query_post_type/);
  });

  it("añade el título de la entrada dentro del contenedor que se le diga", () => {
    const { data, widgetId } = aplicarCambio(listado(), {
      accion: "anadir_widget",
      tipo: "theme-post-title",
      contenedor_id: "c1",
      posicion: "inicio",
      ajustes: { link_to: "post", title_color: "#123A59" },
    });
    const primero = data[0]?.elements?.[0];
    expect(primero?.widgetType).toBe("theme-post-title");
    expect(primero?.id).toBe(widgetId);
    expect(primero?.settings).toMatchObject({ link_to: "post", title_color: "#123A59" });
  });

  it("el resumen enseña los ajustes que se pueden cambiar, para no tocar a ciegas", () => {
    const { widgets } = resumirPlantilla(listado());
    // `show_title` está vacío, así que no se enseña: lo que se ve es lo puesto.
    expect(widgets[0]?.ajustes).toEqual({ columns: "3" });
  });
});
