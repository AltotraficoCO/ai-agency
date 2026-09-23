/**
 * Plantillas de Elementor: el header, el footer y los bloques globales que el
 * sitio YA tiene.
 *
 * Existen porque el Webmaster no podía tocar un footer hecho con Elementor: la
 * única herramienta de headers creaba uno nuevo y exigía un plugin conector, y
 * sin él el modelo terminaba publicando posts de "evidencia". Estas tres leen y
 * cambian la plantilla existente por la REST API, con la contraseña de la app,
 * como lo haría una persona. Toda escritura pasa por backup y por la puerta de
 * aprobación, y el cambio se valida antes: un widget que no existe no debe
 * costarle un clic a nadie.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import { entorno } from "./comun.js";
import { requireWp } from "../ports.js";
import { evaluarSensibilidad, hacerBackup, puertaDeAprobacion, type Bloqueo } from "../aprobacion.js";
import * as wp from "../wordpress/client.js";
import {
  aplicarCambio,
  PATRON_ENLACE,
  resumirPlantilla,
  WIDGETS_DINAMICOS,
  type CambioPlantilla,
  type NodoElementor,
} from "../wordpress/plantillas.js";

const enlace = z
  .string()
  .max(500)
  .regex(PATRON_ENLACE, "Usa una ruta del sitio (/contacto/) o una dirección completa (https://…, mailto:…, tel:…).")
  .describe("Ruta del sitio (/contacto/) o dirección completa con https://");

const contenedorId = z
  .string()
  .max(20)
  .optional()
  .describe("Id del contenedor según wp_leer_plantilla_elementor. Sin él, el primero que ya tiene widgets.");
const alineacion = z.enum(["left", "center", "right"]).optional();
const posicion = z.enum(["inicio", "final"]).optional().describe("Dónde dentro del contenedor; por defecto al final.");
const widgetId = z.string().min(1).max(20).describe("Id del widget según wp_leer_plantilla_elementor.");

/**
 * Lo que vale como valor de un ajuste: un primitivo, o una de las dos cajas
 * con las que Elementor guarda medidas (un tamaño y una caja de cuatro lados).
 * Cerrarlo así evita que el modelo meta un objeto arbitrario en el JSON.
 */
const valorAjuste = z.union([
  z.string().max(120),
  z.number(),
  z.boolean(),
  z.object({ unit: z.string().max(8), size: z.number() }),
  z.object({
    unit: z.string().max(8),
    top: z.string().max(8),
    right: z.string().max(8),
    bottom: z.string().max(8),
    left: z.string().max(8),
    isLinked: z.boolean().optional(),
  }),
]);

const ajustes = z
  .record(z.string().max(60), valorAjuste)
  .describe(
    "Ajustes del widget, tal cual los nombra Elementor. Los que se ven: show_title, show_excerpt, show_read_more, link_to, excerpt_length. Los de reparto: columns, image_size, align. Los de aspecto: title_color, text_color, typography_typography (ponlo en «custom» antes de tocar la tipografía), typography_font_family, typography_font_size, typography_font_weight.",
  );

const cambio = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("anadir_enlace"),
    texto: z.string().min(1).max(80),
    url: enlace,
    contenedor_id: contenedorId,
    alineacion,
    posicion,
  }),
  z.object({
    accion: z.literal("anadir_texto"),
    html: z.string().min(1).max(2000),
    contenedor_id: contenedorId,
    alineacion,
    posicion,
  }),
  z.object({
    accion: z.literal("anadir_boton"),
    texto: z.string().min(1).max(40),
    url: enlace,
    contenedor_id: contenedorId,
    posicion,
  }),
  z.object({ accion: z.literal("cambiar_texto"), widget_id: widgetId, texto: z.string().min(1).max(500) }),
  z.object({ accion: z.literal("cambiar_enlace"), widget_id: widgetId, url: enlace }),
  z.object({
    accion: z.literal("cambiar_ajustes"),
    widget_id: widgetId,
    ajustes,
  }),
  z.object({
    accion: z.literal("anadir_widget"),
    tipo: z.enum(WIDGETS_DINAMICOS),
    contenedor_id: contenedorId,
    posicion,
    ajustes: ajustes.optional(),
  }),
  z.object({ accion: z.literal("eliminar_widget"), widget_id: widgetId }),
]);

function textoDelCambio(c: CambioPlantilla): string {
  // Los ajustes y los widgets dinámicos no llevan texto del cliente, así que
  // se describen con lo que se toca: quien aprueba tiene que leer «show_title»
  // y no una línea vacía.
  if (c.accion === "cambiar_ajustes") return Object.keys(c.ajustes).join(", ");
  if (c.accion === "anadir_widget") return c.tipo;
  return ["texto" in c ? c.texto : "", "url" in c ? c.url : "", "html" in c ? c.html : ""].join(" ").trim();
}

export const wpListarPlantillasElementor = defineTool({
  slug: "wp_listar_plantillas_elementor",
  label: "Listar plantillas de Elementor",
  description:
    "Lista las plantillas de Elementor del sitio (header, footer, popups, secciones globales) con su id y su tipo.",
  whenToUse: "siempre antes de tocar un header, un footer o cualquier bloque que se vea en todo el sitio",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.wpRead],
  effect: "read",
  kind: "http",
  async execute(ctx) {
    const { sitio, opciones } = entorno(ctx, "wp_listar_plantillas_elementor");
    const creds = requireWp(sitio, "wp_listar_plantillas_elementor");
    const plantillas = await wp.listarPlantillasElementor(creds, opciones);
    return { total: plantillas.length, plantillas };
  },
});

export const wpLeerPlantillaElementor = defineTool({
  slug: "wp_leer_plantilla_elementor",
  label: "Leer una plantilla de Elementor",
  description:
    "Lee la estructura de una plantilla de Elementor: sus contenedores y sus widgets, con el texto y los enlaces de cada uno y sus ids.",
  whenToUse: "antes de editar una plantilla, para saber en qué contenedor añadir y qué widget cambiar",
  inputSchema: z.object({ id: z.number().int().positive() }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.wpRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sitio, opciones } = entorno(ctx, "wp_leer_plantilla_elementor");
    const creds = requireWp(sitio, "wp_leer_plantilla_elementor");
    const plantilla = await wp.leerPlantillaElementor(creds, input.id, opciones);
    const { contenedores, widgets } = resumirPlantilla(plantilla.data as NodoElementor[]);
    return {
      id: plantilla.id,
      titulo: plantilla.titulo,
      tipo: plantilla.tipo,
      status: plantilla.status,
      contenedores: contenedores.slice(0, 40),
      widgets: widgets.slice(0, 60),
      ...(widgets.length > 60 ? { nota: `La plantilla tiene ${widgets.length} widgets; se muestran 60.` } : {}),
    };
  },
});

export const wpEditarPlantillaElementor = defineTool({
  slug: "wp_editar_plantilla_elementor",
  label: "Editar una plantilla de Elementor",
  description:
    "Hace UN cambio acotado sobre una plantilla de Elementor existente (header, footer…): añadir un enlace, un texto o un botón, cambiar el texto o el enlace de un widget, o quitar un widget. Guarda backup del diseño anterior.",
  whenToUse:
    "para cambiar el header o el footer que el sitio ya tiene, después de leerlo con wp_leer_plantilla_elementor",
  inputSchema: z.object({
    plantilla_id: z.number().int().positive(),
    cambio,
  }),
  sensitive: false,
  creditCost: 3,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_editar_plantilla_elementor");
    const creds = requireWp(sitio, "wp_editar_plantilla_elementor");
    const antes = await wp.leerPlantillaElementor(creds, input.plantilla_id, opciones);
    const pedido = input.cambio as CambioPlantilla;

    // Se aplica en memoria ANTES de pedir aprobación o guardar backup: si el
    // widget no existe o el enlace no vale, falla aquí sin molestar a nadie.
    const { data, widgetId: afectado } = aplicarCambio(antes.data as NodoElementor[], pedido);

    const bloqueo = await puertaDeAprobacion(
      ctx,
      sitio,
      "wp_editar_plantilla_elementor",
      input,
      evaluarSensibilidad({
        toolSlug: "wp_editar_plantilla_elementor",
        titulo: antes.titulo,
        contenido: textoDelCambio(pedido),
      }),
    );
    if (bloqueo) return bloqueo;

    const backupId = await hacerBackup(ctx, sitio, `elementor:${antes.id}`, {
      id: antes.id,
      titulo: antes.titulo,
      tipo: antes.tipo,
      data: antes.data,
    });
    const { cache } = await wp.escribirPlantillaElementor(creds, antes.id, data, opciones);

    return {
      ok: true,
      plantilla_id: antes.id,
      tipo: antes.tipo,
      accion: pedido.accion,
      widget_id: afectado,
      backup_id: backupId,
      cache,
      nota: pedido.accion.startsWith("anadir")
        ? `Verifica con navegador_ver_pagina que se ve en el sitio. Para deshacerlo, usa eliminar_widget con widget_id ${afectado}.`
        : "Verifica con navegador_ver_pagina que el cambio se ve en el sitio.",
    };
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      plantilla_id: input.plantilla_id,
      accion: input.cambio.accion,
      nota: "Simulación: la plantilla no se tocó. Describe el cambio en el plan.",
    };
  },
});

// ---------------------------------------------------------------------------
// El diseño de una PÁGINA que ya existe
// ---------------------------------------------------------------------------

/**
 * Las dos de arriba solo valen para plantillas (header, footer). Sin estas, un
 * «cambia el banner de la portada» obligaba a REHACER la portada entera con
 * wp_crear_pagina_elementor: el cliente pedía un cambio y recibía otra página.
 */
export const wpLeerDisenoPagina = defineTool({
  slug: "wp_leer_diseno_pagina",
  label: "Leer el diseño de una página",
  description:
    "Lee la estructura de Elementor de una página o entrada que ya existe: sus secciones y sus widgets, con el texto, el enlace y el id de cada uno.",
  whenToUse:
    "antes de cambiar una parte de una página hecha con Elementor (el banner, un botón, un texto), para saber qué widget tocar",
  inputSchema: z.object({
    id: z.number().int().positive(),
    tipo: z.enum(["page", "post"]).optional().describe("Por defecto se prueban los dos."),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.wpRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sitio, opciones } = entorno(ctx, "wp_leer_diseno_pagina");
    const creds = requireWp(sitio, "wp_leer_diseno_pagina");
    const data = await wp.leerElementorData(creds, input.id, opciones, input.tipo);
    if (!data) {
      return {
        id: input.id,
        con_elementor: false,
        nota: "Esta página no está hecha con Elementor (o el sitio no expone su diseño). Si hay que rediseñarla entera, usa wp_crear_pagina_elementor con pagina_id; si solo hay que cambiar texto, wp_actualizar_contenido.",
      };
    }
    const { contenedores, widgets } = resumirPlantilla(data as NodoElementor[]);
    return {
      id: input.id,
      con_elementor: true,
      contenedores: contenedores.slice(0, 40),
      widgets: widgets.slice(0, 60),
      ...(widgets.length > 60 ? { nota: `La página tiene ${widgets.length} widgets; se muestran 60.` } : {}),
    };
  },
});

export const wpEditarDisenoPagina = defineTool({
  slug: "wp_editar_diseno_pagina",
  label: "Cambiar una parte de una página",
  description:
    "Hace UN cambio acotado en una página hecha con Elementor sin rehacerla: cambiar el texto o el enlace de un widget, añadir un texto, un enlace o un botón a una sección, o quitar un widget. Guarda copia del diseño anterior.",
  whenToUse:
    "cuando el cliente pide cambiar una PARTE de una página que ya existe (el banner, un titular, un botón), después de leerla con wp_leer_diseno_pagina",
  inputSchema: z.object({
    id: z.number().int().positive(),
    tipo: z.enum(["page", "post"]).default("page"),
    cambio,
  }),
  sensitive: false,
  creditCost: 3,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_editar_diseno_pagina");
    const creds = requireWp(sitio, "wp_editar_diseno_pagina");
    const antes = await wp.leerElementorData(creds, input.id, opciones, input.tipo);
    if (!antes) {
      throw new Error(
        `La página ${input.id} no está hecha con Elementor, o el sitio no expone su diseño. Para cambiar su texto usa wp_actualizar_contenido; para rediseñarla, wp_crear_pagina_elementor con pagina_id.`,
      );
    }
    const pedido = input.cambio as CambioPlantilla;
    // Se aplica en memoria antes de pedir aprobación: un widget que no existe
    // falla aquí, sin gastarle un clic a nadie.
    const { data, widgetId: afectado } = aplicarCambio(antes as NodoElementor[], pedido);
    const bloqueo = await puertaDeAprobacion(
      ctx,
      sitio,
      "wp_editar_diseno_pagina",
      input,
      evaluarSensibilidad({
        toolSlug: "wp_editar_diseno_pagina",
        titulo: `página ${input.id}`,
        contenido: textoDelCambio(pedido),
      }),
    );
    if (bloqueo) return bloqueo;
    const backupId = await hacerBackup(ctx, sitio, `elementor:${input.tipo}:${input.id}`, {
      id: input.id,
      tipo: input.tipo,
      data: antes,
    });
    const { cache } = await wp.escribirElementorDeContenido(creds, input.tipo, input.id, data, opciones);
    return {
      ok: true,
      id: input.id,
      tipo: input.tipo,
      accion: pedido.accion,
      widget_id: afectado,
      backup_id: backupId,
      cache,
      nota: "Verifica con navegador_ver_pagina que el cambio se ve en el sitio.",
    };
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      id: input.id,
      accion: input.cambio.accion,
      nota: "Simulación: la página no se tocó. Describe el cambio en el plan.",
    };
  },
});

export const HERRAMIENTAS_ELEMENTOR: readonly ToolDef<never, unknown>[] = [
  wpListarPlantillasElementor,
  wpLeerPlantillaElementor,
  wpEditarPlantillaElementor,
  wpLeerDisenoPagina,
  wpEditarDisenoPagina,
] as unknown as readonly ToolDef<never, unknown>[];
