/**
 * Ajustes, comunidad y medios.
 */
import { z } from "zod";
import { defineTool } from "@strappy/tools";
import { SCOPES } from "../../context.js";
import { entorno } from "../comun.js";
import { requireWp } from "../../ports.js";
import { evaluarSensibilidad, hacerBackup, puertaDeAprobacion, type Bloqueo } from "../../aprobacion.js";
import * as wp from "../../wordpress/client.js";

export const wpActualizarAjustes = defineTool({
  slug: "wp_actualizar_ajustes",
  label: "Actualizar ajustes del sitio",
  description:
    "Actualiza ajustes generales (/wp/v2/settings): title, description, show_on_front, page_on_front, posts_per_page… Guarda backup de las claves tocadas.",
  whenToUse:
    "para definir la portada con {show_on_front:'page', page_on_front:<id>} o cambiar datos globales",
  inputSchema: z.object({
    ajustes: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .refine((o) => Object.keys(o).length > 0, "Pasa al menos un ajuste."),
  }),
  sensitive: false,
  creditCost: 3,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_actualizar_ajustes");
    const creds = requireWp(sitio, "wp_actualizar_ajustes");
    const claves = Object.keys(input.ajustes);

    const bloqueo = await puertaDeAprobacion(
      ctx,
      sitio,
      "wp_actualizar_ajustes",
      input,
      evaluarSensibilidad({ toolSlug: "wp_actualizar_ajustes", clavesAjustes: claves }),
    );
    if (bloqueo) return bloqueo;

    const antes = await wp.leerAjustes(creds, opciones);
    const backupId = await hacerBackup(ctx, sitio, "settings", {
      antes: Object.fromEntries(claves.map((k) => [k, antes[k]])),
    });
    const r = await wp.actualizarAjustes(creds, input.ajustes, opciones);
    return {
      actualizado: Object.fromEntries(claves.map((k) => [k, r[k]])),
      backup_id: backupId,
    };
  },
  simulate(_ctx, input) {
    return { simulado: true, ajustes: input.ajustes, nota: "Simulación: los ajustes no cambiaron." };
  },
});

export const wpModerarComentario = defineTool({
  slug: "wp_moderar_comentario",
  label: "Moderar un comentario",
  description: "Cambia el estado de un comentario: approved, hold, spam o trash.",
  whenToUse: "cuando la tarea sea limpiar o aprobar comentarios",
  inputSchema: z.object({
    comentario_id: z.number().int().positive(),
    estado: z.enum(["approved", "hold", "spam", "trash"]),
  }),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_moderar_comentario");
    return wp.moderarComentario(
      requireWp(sitio, "wp_moderar_comentario"),
      input.comentario_id,
      input.estado,
      opciones,
    );
  },
  simulate(_ctx, input) {
    return { simulado: true, id: input.comentario_id, status: input.estado };
  },
});

export const wpCrearTermino = defineTool({
  slug: "wp_crear_termino",
  label: "Crear categoría o etiqueta",
  description: "Crea una categoría o una etiqueta.",
  whenToUse: "al organizar el blog, antes de asignar contenido a una categoría que no existe",
  inputSchema: z.object({
    taxonomia: z.enum(["categories", "tags"]),
    nombre: z.string().min(1).max(120),
    descripcion: z.string().max(500).optional(),
  }),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_crear_termino");
    return wp.crearTermino(
      requireWp(sitio, "wp_crear_termino"),
      input.taxonomia,
      input.nombre,
      input.descripcion,
      opciones,
    );
  },
  simulate(_ctx, input) {
    return { simulado: true, nombre: input.nombre, taxonomia: input.taxonomia };
  },
});

export const wpSubirMedia = defineTool({
  slug: "wp_subir_media",
  label: "Subir un archivo a medios",
  description:
    "Sube una imagen o archivo a la biblioteca de medios descargándolo desde una URL pública https. Devuelve su id, que sirve como imagen_destacada_id de una entrada.",
  whenToUse: "cuando el cliente aportó una imagen y hay que meterla en el sitio",
  inputSchema: z.object({
    url_archivo: z.url().startsWith("https://", "Solo se aceptan URLs https."),
    nombre_archivo: z
      .string()
      .regex(/^[\w.\- ]+\.[a-z0-9]{2,5}$/i, "Nombre de archivo con extensión, sin rutas."),
  }),
  sensitive: false,
  creditCost: 4,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_subir_media");
    return wp.subirMediaDesdeUrl(
      requireWp(sitio, "wp_subir_media"),
      input.url_archivo,
      input.nombre_archivo,
      opciones,
    );
  },
  simulate(_ctx, input) {
    return { simulado: true, nombre: input.nombre_archivo };
  },
});

export const wpListarMedios = defineTool({
  slug: "wp_listar_medios",
  label: "Revisar la biblioteca de imágenes",
  description:
    "Lista la biblioteca de medios del sitio (id, título, URL, tipo y texto alternativo), opcionalmente filtrada por texto. El id sirve como imagen_destacada_id al crear una entrada.",
  whenToUse: "antes de crear una entrada de blog, para darle una imagen destacada del propio negocio",
  inputSchema: z.object({
    buscar: z
      .string()
      .max(80)
      .optional()
      .describe("Filtra por nombre o texto alternativo, p. ej. «equipo» o «oficina»."),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.wpRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sitio, opciones } = entorno(ctx, "wp_listar_medios");
    const medios = await wp.listarMedios(
      requireWp(sitio, "wp_listar_medios"),
      { buscar: input.buscar },
      opciones,
    );
    return {
      medios,
      imagenes: medios.filter((m) => m.tipo === "image").length,
      nota:
        medios.length === 0
          ? "La biblioteca no tiene medios que encajen: crea la entrada igualmente y dile al cliente en el RESUMEN que suba una foto para el blog."
          : "Elige la que mejor represente el tema y pásala como imagen_destacada_id.",
    };
  },
});
