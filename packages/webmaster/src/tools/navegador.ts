/**
 * Navegador persistente: verificar de verdad, no que devolvió 200.
 *
 * Una página puede responder 200 y verse rota, tener el menú caído o un error
 * de JavaScript que impide enviar el formulario de contacto. La sesión vive
 * toda la tarea (como un visitante que va navegando) y está contenida en el
 * dominio del cliente: la implementación del puerto es la que vuelve al sitio
 * si una acción intenta salir.
 *
 * Las capturas NO viajan en el resultado que ve el modelo salvo referencia:
 * van a la evidencia de la tarea. El bucle las recoge por `onCaptura`.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import { entorno, recortar } from "./comun.js";
import { requireBrowser } from "../ports.js";

/**
 * El colector viaja en el contexto del sitio, no en una variable de módulo:
 * dos tareas en el mismo proceso no pueden compartir evidencia.
 */
function guardar(
  sitio: { capturas?: import("../ports.js").ColectorCapturas },
  herramienta: string,
  cap: { base64: string; mimeType: string; url: string; titulo: string },
) {
  sitio.capturas?.push({ herramienta, ...cap });
}

export const navegadorVerPagina = defineTool({
  slug: "navegador_ver_pagina",
  label: "Ver una página en el navegador",
  description:
    "Abre una ruta del sitio en un navegador real y devuelve qué se ve: URL final, título, código HTTP y si hubo errores de JavaScript. La captura queda guardada como evidencia de la tarea.",
  whenToUse: "para verificar visualmente CADA cambio, después de hacerlo",
  inputSchema: z.object({
    path: z.string().startsWith("/", "Ruta relativa del sitio, p.ej. /contacto").default("/"),
    pagina_completa: z
      .boolean()
      .default(false)
      .describe("true captura la página entera (más lento); false solo lo visible."),
  }),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.navegador],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sitio } = entorno(ctx, "navegador_ver_pagina");
    if (input.path.startsWith("//")) throw new Error("La ruta no puede apuntar a otro dominio.");
    const nav = requireBrowser(sitio, "navegador_ver_pagina");
    const r = await nav.ir(input.path, input.pagina_completa);
    guardar(sitio, "navegador_ver_pagina", r);
    return { url: r.url, titulo: r.titulo, status: r.status, captura_guardada: true };
  },
});

export const navegadorClick = defineTool({
  slug: "navegador_click",
  label: "Hacer click en la página",
  description:
    "Hace click en un elemento de la página abierta (por texto visible o selector CSS) y devuelve dónde quedó el navegador.",
  whenToUse: "para probar menús, botones y enlaces como lo haría un visitante",
  inputSchema: z
    .object({
      texto: z.string().max(120).optional().describe("Texto visible del enlace o botón (preferido)"),
      selector: z.string().max(200).optional().describe("Selector CSS si el texto es ambiguo"),
    })
    .refine((o) => Boolean(o.texto || o.selector), "Pasa texto o selector."),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.navegador],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sitio } = entorno(ctx, "navegador_click");
    const nav = requireBrowser(sitio, "navegador_click");
    const r = await nav.click({
      ...(input.texto ? { texto: input.texto } : {}),
      ...(input.selector ? { selector: input.selector } : {}),
    });
    guardar(sitio, "navegador_click", r);
    return { url: r.url, titulo: r.titulo, ...(r.nota ? { nota: r.nota } : {}) };
  },
});

export const navegadorEscribir = defineTool({
  slug: "navegador_escribir",
  label: "Escribir en un campo",
  description:
    "Escribe en un campo de la página abierta (buscador, formulario de contacto) y opcionalmente lo envía con Enter.",
  whenToUse: "para comprobar que un formulario funciona de verdad",
  inputSchema: z.object({
    selector: z.string().min(1).max(200).describe("Selector CSS del input o textarea"),
    texto: z.string().max(2000),
    enviar: z.boolean().default(false),
  }),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.navegador],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sitio } = entorno(ctx, "navegador_escribir");
    const nav = requireBrowser(sitio, "navegador_escribir");
    const r = await nav.escribir(input);
    guardar(sitio, "navegador_escribir", r);
    return { url: r.url, titulo: r.titulo, ...(r.nota ? { nota: r.nota } : {}) };
  },
});

export const navegadorLeer = defineTool({
  slug: "navegador_leer",
  label: "Leer el texto renderizado",
  description:
    "Lee el TEXTO renderizado de la página abierta (o de un selector concreto): lo que de verdad ve el visitante.",
  whenToUse: "para verificar que el copy quedó como debía, no solo que la página responde",
  inputSchema: z.object({ selector: z.string().max(200).optional() }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.navegador],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sitio } = entorno(ctx, "navegador_leer");
    const nav = requireBrowser(sitio, "navegador_leer");
    const r = await nav.leer(input.selector);
    return { url: r.url, texto: recortar(r.texto) };
  },
});

export const navegadorConsola = defineTool({
  slug: "navegador_consola",
  label: "Ver errores de JavaScript",
  description:
    "Devuelve los errores y avisos de JavaScript acumulados en la sesión del navegador.",
  whenToUse: "para diagnosticar páginas rotas o plugins en conflicto",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.navegador],
  effect: "read",
  kind: "http",
  async execute(ctx) {
    const { sitio } = entorno(ctx, "navegador_consola");
    return requireBrowser(sitio, "navegador_consola").consola();
  },
});

export const verReferencia = defineTool({
  slug: "ver_referencia",
  label: "Ver una referencia del cliente",
  description:
    "Descarga y describe una imagen de referencia adjuntada por el cliente para tomar de ahí paleta, estructura y estilo.",
  whenToUse: "si el detalle de la tarea trae una referencia, antes de diseñar nada",
  inputSchema: z.object({ url: z.url() }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.navegador],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sitio } = entorno(ctx, "ver_referencia");
    const port = sitio.referencias;
    if (!port) throw new Error("Esta ejecución no tiene almacén de referencias configurado.");
    // Solo el almacén de la plataforma: una URL arbitraria convierte esta
    // herramienta en un lector de la red interna del servidor.
    const host = new URL(input.url).host;
    if (!port.hostsPermitidos.includes(host)) {
      throw new Error("Solo se pueden ver referencias adjuntadas en la plataforma.");
    }
    const { mimeType, bytes } = await port.descargar(input.url);
    if (bytes.byteLength > 6 * 1024 * 1024) throw new Error("La referencia pesa demasiado.");
    if (!mimeType.startsWith("image/")) {
      return { tipo: mimeType, contenido: recortar(Buffer.from(bytes).toString("utf8")) };
    }
    guardar(sitio, "ver_referencia", {
      base64: Buffer.from(bytes).toString("base64"),
      mimeType,
      url: input.url,
      titulo: "referencia del cliente",
    });
    return { tipo: mimeType, bytes: bytes.byteLength, guardada_como_evidencia: true };
  },
});

export const HERRAMIENTAS_NAVEGADOR: readonly ToolDef<never, unknown>[] = [
  navegadorVerPagina,
  navegadorClick,
  navegadorEscribir,
  navegadorLeer,
  navegadorConsola,
  verReferencia,
] as unknown as readonly ToolDef<never, unknown>[];
