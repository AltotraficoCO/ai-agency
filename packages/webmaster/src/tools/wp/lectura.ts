/**
 * Lectura y diagnóstico: nada de aquí cambia el sitio.
 */
import { z } from "zod";
import { defineTool } from "@strappy/tools";
import { SCOPES } from "../../context.js";
import { entorno, recortar } from "../comun.js";
import { requireWp } from "../../ports.js";
import * as wp from "../../wordpress/client.js";
import { leerDisenoDelSitio, resumirEstilo } from "../../wordpress/diseno.js";
import { tipoContenido } from "./comun.js";

export const sitioSalud = defineTool({
  slug: "sitio_salud",
  label: "Diagnóstico del sitio",
  description:
    "Diagnóstico del sitio: REST API accesible, credenciales válidas, nombre del sitio y estado de la portada.",
  whenToUse: "siempre lo primero, antes de tocar nada",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.wpRead],
  effect: "read",
  kind: "http",
  async execute(ctx) {
    const { sitio, opciones } = entorno(ctx, "sitio_salud");
    const creds = requireWp(sitio, "sitio_salud");
    const [salud, portada] = await Promise.all([
      wp.health(creds, opciones),
      wp.verificar(creds, "/", undefined, opciones).catch(() => null),
    ]);
    return { ...salud, portada, modo: ctx.dryRun ? "simulación" : "ejecución" };
  },
});

export const sitioLeerDiseno = defineTool({
  slug: "sitio_leer_diseno",
  label: "Estudiar el diseño del sitio",
  description:
    "Mide el diseño REAL de una página del sitio (por defecto la portada): colores de titulares, acento de los botones, fondos de tarjetas, tipografías, tamaños, radio de botones y tarjetas y ancho del contenedor. wp_crear_pagina_elementor lo aplica solo; léelo para escribir contenido acorde (tono, CTA, imágenes) y para comparar al verificar.",
  whenToUse: "antes de diseñar o crear cualquier página o entrada, para que quede acorde al sitio",
  inputSchema: z.object({
    path: z
      .string()
      .startsWith("/", "Ruta relativa del sitio, p.ej. /servicios/")
      .max(300)
      .default("/")
      .describe("Página de referencia. La portada suele ser la que mejor representa el diseño."),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.wpRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sitio, opciones } = entorno(ctx, "sitio_leer_diseno");
    if (input.path.startsWith("//")) throw new Error("La ruta no puede apuntar a otro dominio.");
    const estilo = await leerDisenoDelSitio(sitio, opciones, input.path);
    return {
      ...resumirEstilo(estilo),
      nota:
        estilo.origen === "sitio"
          ? "wp_crear_pagina_elementor aplicará este estilo automáticamente. No pases paleta salvo que el cliente pida expresamente otro estilo."
          : "No pude deducir el diseño del sitio: revisa la portada con navegador_ver_pagina y, si hace falta, pasa una paleta con motivo_paleta.",
    };
  },
});

export const wpListarContenido = defineTool({
  slug: "wp_listar_contenido",
  label: "Listar páginas y posts",
  description: "Lista páginas y posts del sitio (id, tipo, título, enlace, estado, slug).",
  whenToUse: "antes de editar o crear nada, para no inventar identificadores",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.wpRead],
  effect: "read",
  kind: "http",
  async execute(ctx) {
    const { sitio, opciones } = entorno(ctx, "wp_listar_contenido");
    return { contenido: await wp.listarContenido(requireWp(sitio, "wp_listar_contenido"), opciones) };
  },
});

export const wpLeerContenido = defineTool({
  slug: "wp_leer_contenido",
  label: "Leer una página o post",
  description: "Lee el título y el HTML crudo de una página o post.",
  whenToUse: "SIEMPRE antes de editar: sin leer no se puede revertir ni comparar",
  inputSchema: z.object({ tipo: tipoContenido, id: z.number().int().positive() }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.wpRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sitio, opciones } = entorno(ctx, "wp_leer_contenido");
    const c = await wp.leerContenido(
      requireWp(sitio, "wp_leer_contenido"),
      input.tipo,
      input.id,
      opciones,
    );
    return { ...c, contenido: recortar(c.contenido) };
  },
});

export const wpListarPlugins = defineTool({
  slug: "wp_listar_plugins",
  label: "Listar plugins",
  description: "Lista los plugins instalados (identificador, nombre, estado, versión).",
  whenToUse: "para saber si Elementor u otro plugin necesario está activo",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.wpRead],
  effect: "read",
  kind: "http",
  async execute(ctx) {
    const { sitio, opciones } = entorno(ctx, "wp_listar_plugins");
    return { plugins: await wp.listarPlugins(requireWp(sitio, "wp_listar_plugins"), opciones) };
  },
});

export const wpLeerAjustes = defineTool({
  slug: "wp_leer_ajustes",
  label: "Leer ajustes del sitio",
  description: "Lee los ajustes generales del sitio (título, descripción, portada, zona horaria…).",
  whenToUse: "antes de cambiar la portada o cualquier ajuste global",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.wpRead],
  effect: "read",
  kind: "http",
  async execute(ctx) {
    const { sitio, opciones } = entorno(ctx, "wp_leer_ajustes");
    return { ajustes: await wp.leerAjustes(requireWp(sitio, "wp_leer_ajustes"), opciones) };
  },
});

export const wpListarComentarios = defineTool({
  slug: "wp_listar_comentarios",
  label: "Listar comentarios",
  description: "Lista comentarios por estado (hold = pendientes de moderar, approved, spam).",
  whenToUse: "cuando la tarea sea moderar la comunidad del sitio",
  inputSchema: z.object({ estado: z.enum(["hold", "approved", "spam"]).default("hold") }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.wpRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sitio, opciones } = entorno(ctx, "wp_listar_comentarios");
    return {
      comentarios: await wp.listarComentarios(
        requireWp(sitio, "wp_listar_comentarios"),
        input.estado,
        opciones,
      ),
    };
  },
});

export const wpListarUsuarios = defineTool({
  slug: "wp_listar_usuarios",
  label: "Listar usuarios",
  description: "Lista los usuarios del sitio con su rol.",
  whenToUse: "antes de crear un usuario o cambiar un rol, para no duplicar",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.wpAdmin],
  effect: "read",
  kind: "http",
  async execute(ctx) {
    const { sitio, opciones } = entorno(ctx, "wp_listar_usuarios");
    const usuarios = await wp.listarUsuarios(requireWp(sitio, "wp_listar_usuarios"), opciones);
    // El correo es un dato personal del cliente: el modelo no lo necesita para
    // cambiar un rol y lo que no entra al contexto no se puede filtrar.
    return { usuarios: usuarios.map((u) => ({ id: u.id, nombre: u.name, roles: u.roles ?? [] })) };
  },
});
