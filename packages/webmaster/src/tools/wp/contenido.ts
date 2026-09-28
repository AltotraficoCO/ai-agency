/**
 * Mutaciones de contenido: editar, crear, borrar y restaurar páginas y entradas.
 *
 * Toda mutación lee antes el estado actual, lo guarda como backup y devuelve
 * `backup_id`; si la acción es sensible pasa por la puerta de aprobación.
 */
import { z } from "zod";
import { defineTool } from "@strappy/tools";
import { SCOPES } from "../../context.js";
import { entorno } from "../comun.js";
import { requireWp } from "../../ports.js";
import { evaluarSensibilidad, hacerBackup, puertaDeAprobacion, type Bloqueo } from "../../aprobacion.js";
import * as wp from "../../wordpress/client.js";
import { exigirTituloValido } from "../../wordpress/titulos.js";
import { reservarCreacion } from "../../creaciones.js";
import { extractoDeTexto } from "../../wordpress/articulo.js";
import { extractoInput, imagenDestacadaInput, cantidadPedida, tipoContenido, portadaDe } from "./comun.js";

const entradaEditar = z.object({
  tipo: tipoContenido,
  id: z.number().int().positive(),
  nuevo_titulo: z.string().min(1).max(300).optional(),
  nuevo_contenido_html: z.string().max(400_000).optional(),
  nuevo_extracto: extractoInput,
  nueva_imagen_destacada_id: imagenDestacadaInput,
});

export const wpEditarContenido = defineTool({
  slug: "wp_editar_contenido",
  label: "Editar una página o post",
  description:
    "Edita el título, el contenido HTML, el extracto y/o la imagen destacada de una página o post. Es la vía rápida para que una entrada ya publicada deje de salir vacía en el listado del blog. Guarda backup del estado anterior y devuelve backup_id.",
  whenToUse: "para cambios de texto sobre contenido que ya existe, después de leerlo",
  inputSchema: entradaEditar,
  sensitive: false,
  creditCost: 3,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_editar_contenido");
    const creds = requireWp(sitio, "wp_editar_contenido");
    if (
      input.nuevo_titulo === undefined &&
      input.nuevo_contenido_html === undefined &&
      input.nuevo_extracto === undefined &&
      input.nueva_imagen_destacada_id === undefined
    ) {
      throw new Error(
        "Pasa al menos nuevo_titulo, nuevo_contenido_html, nuevo_extracto o nueva_imagen_destacada_id.",
      );
    }

    const antes = await wp.leerContenido(creds, input.tipo, input.id, opciones);
    const portadaId = input.tipo === "page" ? await portadaDe(creds, opciones) : undefined;

    const bloqueo = await puertaDeAprobacion(
      ctx,
      sitio,
      "wp_editar_contenido",
      input,
      evaluarSensibilidad({
        toolSlug: "wp_editar_contenido",
        titulo: input.nuevo_titulo ?? antes.titulo,
        slug: antes.slug,
        ...(input.nuevo_contenido_html !== undefined
          ? { contenido: input.nuevo_contenido_html }
          : {}),
        contenidoId: input.id,
        ...(portadaId !== undefined ? { portadaId } : {}),
      }),
    );
    if (bloqueo) return bloqueo;

    const backupId = await hacerBackup(ctx, sitio, `${input.tipo}:${input.id}`, {
      tipo: input.tipo,
      id: input.id,
      titulo: antes.titulo,
      contenido: antes.contenido,
      status: antes.status,
    });

    const r = await wp.actualizarContenido(
      creds,
      input.tipo,
      input.id,
      {
        ...(input.nuevo_titulo !== undefined ? { titulo: input.nuevo_titulo } : {}),
        ...(input.nuevo_contenido_html !== undefined
          ? { contenido: input.nuevo_contenido_html }
          : {}),
        ...(input.nuevo_extracto !== undefined ? { extracto: input.nuevo_extracto } : {}),
        ...(input.nueva_imagen_destacada_id !== undefined
          ? { imagenDestacadaId: input.nueva_imagen_destacada_id }
          : {}),
      },
      opciones,
    );
    return { ...r, backup_id: backupId, anterior_titulo: antes.titulo };
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      id: input.id,
      titulo: input.nuevo_titulo ?? "(sin cambio de título)",
      link: "(no se llamó al sitio)",
      backup_id: null,
      nota: "Simulación: no se tocó el sitio. Propón el cambio en el plan.",
    };
  },
});

export const wpCrearContenido = defineTool({
  slug: "wp_crear_contenido",
  label: "Crear una página o post simple",
  description:
    "Crea una página o post SIMPLE de texto/HTML (posts de blog, avisos, páginas de texto). PROHIBIDA para páginas que pidan Elementor o diseño (usa wp_crear_pagina_elementor) y para headers o footers globales (usa wp_crear_header_global: un header nunca es una página).",
  whenToUse: "solo para posts de blog o páginas de texto plano",
  inputSchema: z.object({
    tipo: tipoContenido,
    titulo: z.string().min(1).max(300),
    contenido_html: z.string().max(400_000),
    status: z.enum(["publish", "draft"]).default("publish"),
    extracto: extractoInput,
    imagen_destacada_id: imagenDestacadaInput,
    cantidad_pedida: cantidadPedida,
  }),
  sensitive: false,
  creditCost: 3,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_crear_contenido");
    exigirTituloValido(input.titulo);
    // La plaza se toma antes de cualquier await: ver creaciones.ts.
    const reserva = reservarCreacion(sitio, {
      tipo: input.tipo,
      titulo: input.titulo,
      cantidadPedida: input.cantidad_pedida,
    });
    try {
      const bloqueo = await puertaDeAprobacion(
        ctx,
        sitio,
        "wp_crear_contenido",
        input,
        evaluarSensibilidad({
          toolSlug: "wp_crear_contenido",
          titulo: input.titulo,
          contenido: input.contenido_html,
        }),
      );
      if (bloqueo) {
        reserva.liberar();
        return bloqueo;
      }

      // Una entrada sin extracto sale vacía en el listado del blog, así que se
      // saca del propio contenido cuando el modelo no lo manda.
      const extracto =
        input.extracto ?? (input.tipo === "post" ? extractoDeTexto(input.contenido_html) : "");
      const r = await wp.crearContenido(
        requireWp(sitio, "wp_crear_contenido"),
        input.tipo,
        {
          titulo: input.titulo,
          contenido: input.contenido_html,
          status: input.status,
          ...(extracto ? { extracto } : {}),
          ...(input.imagen_destacada_id !== undefined
            ? { imagenDestacadaId: input.imagen_destacada_id }
            : {}),
        },
        opciones,
      );
      reserva.confirmar(r.id);
      return {
        ...r,
        creado: true,
        extracto: extracto || null,
        imagen_destacada: input.imagen_destacada_id ?? 0,
        ...(input.tipo === "post" && input.imagen_destacada_id === undefined
          ? {
              nota: "Sin imagen destacada, en el listado del blog esta entrada saldrá sin foto: elige una con wp_listar_medios y ponla con wp_editar_contenido (nueva_imagen_destacada_id).",
            }
          : {}),
      };
    } catch (error) {
      reserva.liberar();
      throw error;
    }
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      tipo: input.tipo,
      titulo: input.titulo,
      nota: "Simulación: la página no se creó. Descríbela en el plan.",
    };
  },
});

export const wpBorrarContenido = defineTool({
  slug: "wp_borrar_contenido",
  label: "Enviar a la papelera",
  description:
    "Envía una página o post a la papelera (recuperable con wp_restaurar_contenido). Guarda backup y devuelve backup_id.",
  whenToUse: "solo cuando el cliente haya pedido explícitamente eliminar ese contenido",
  inputSchema: z.object({ tipo: tipoContenido, id: z.number().int().positive() }),
  sensitive: false,
  creditCost: 3,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_borrar_contenido");
    const creds = requireWp(sitio, "wp_borrar_contenido");
    const antes = await wp.leerContenido(creds, input.tipo, input.id, opciones);
    const portadaId = input.tipo === "page" ? await portadaDe(creds, opciones) : undefined;

    const bloqueo = await puertaDeAprobacion(
      ctx,
      sitio,
      "wp_borrar_contenido",
      input,
      evaluarSensibilidad({
        toolSlug: "wp_borrar_contenido",
        titulo: antes.titulo,
        slug: antes.slug,
        contenidoId: input.id,
        ...(portadaId !== undefined ? { portadaId } : {}),
      }),
    );
    if (bloqueo) return bloqueo;

    const backupId = await hacerBackup(ctx, sitio, `${input.tipo}:${input.id}`, {
      tipo: input.tipo,
      id: input.id,
      titulo: antes.titulo,
      contenido: antes.contenido,
      status: antes.status,
      borrado: true,
    });
    await wp.borrarContenido(creds, input.tipo, input.id, opciones);
    return { ok: true, en_papelera: antes.titulo, backup_id: backupId };
  },
  simulate(_ctx, input) {
    return { simulado: true, tipo: input.tipo, id: input.id, nota: "Simulación: no se borró nada." };
  },
});

/**
 * Qué se puede deshacer.
 *
 * Cada cambio guarda una copia de lo anterior, pero su identificador se
 * quedaba en el resumen del encargo que lo hizo: en un encargo NUEVO, «devuelve
 * la portada a como estaba» era imposible, el agente no tenía dónde mirar.
 * Esta lee las copias del sitio, de la más reciente a la más antigua, con qué
 * tocó cada una y cuándo.
 */
export const wpCambiosRecientes = defineTool({
  slug: "wp_cambios_recientes",
  label: "Ver qué se puede deshacer",
  description:
    "Lista los cambios recientes del sitio que tienen copia de seguridad, del más nuevo al más viejo, con qué se tocó, cuándo y el backup_id para revertirlo.",
  whenToUse:
    "cuando el cliente pide deshacer, revertir o «dejarlo como estaba» y no tienes a mano el backup_id",
  inputSchema: z.object({
    limite: z.number().int().min(1).max(30).default(10).describe("Cuántos cambios traer."),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.wpRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { sitio } = entorno(ctx, "wp_cambios_recientes");
    if (!sitio.backups.listar) {
      return { cambios: [], nota: "Esta instalación no sabe listar copias; usa el backup_id que dio el encargo que quieres deshacer." };
    }
    const copias = await sitio.backups.listar({
      workspaceId: ctx.workspaceId,
      siteId: sitio.siteId,
      limite: input.limite,
    });
    const cambios = copias.map((c) => {
      const snap = c.snapshot as { tipo?: unknown; id?: unknown; titulo?: unknown } | null;
      return {
        backup_id: c.id,
        que_toco: c.alcance,
        ...(snap?.tipo !== undefined ? { tipo: String(snap.tipo) } : {}),
        ...(snap?.id !== undefined ? { id: Number(snap.id) } : {}),
        ...(snap?.titulo !== undefined ? { titulo: String(snap.titulo) } : {}),
        cuando: c.creadoEn,
      };
    });
    return {
      cambios,
      ...(cambios.length === 0
        ? { nota: "No hay copias guardadas de este sitio: no hay nada que deshacer desde aquí." }
        : {
            nota: "Para deshacer uno, wp_restaurar_contenido con su backup_id, su tipo y su id. Dile al cliente QUÉ vas a devolver y de cuándo es la copia antes de hacerlo.",
          }),
    };
  },
});

export const wpRestaurarContenido = defineTool({
  slug: "wp_restaurar_contenido",
  label: "Restaurar contenido",
  description:
    "Revierte un cambio. Con backup_id devuelve el título y el HTML exactos que había antes; sin él, solo saca de la papelera una página o post borrado.",
  whenToUse: "en cuanto algo quede mal: revertir es siempre mejor que improvisar un arreglo",
  inputSchema: z.object({
    tipo: tipoContenido,
    id: z.number().int().positive(),
    backup_id: z
      .string()
      .min(1)
      .optional()
      .describe("El backup_id que devolvió la mutación que quieres deshacer."),
  }),
  sensitive: false,
  creditCost: 3,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_restaurar_contenido");
    const creds = requireWp(sitio, "wp_restaurar_contenido");

    if (!input.backup_id) {
      await wp.restaurarContenido(creds, input.tipo, input.id, opciones);
      return { ok: true, restaurado: input.id, desde: "papelera" };
    }

    const backup = await sitio.backups.read({
      workspaceId: ctx.workspaceId,
      backupId: input.backup_id,
    });
    if (!backup) throw new Error(`No existe el backup "${input.backup_id}".`);
    const snap = backup.snapshot as {
      tipo?: string;
      id?: number;
      titulo?: string;
      contenido?: string;
      status?: string;
      elementor_data?: unknown;
    };
    if (snap.id !== undefined && snap.id !== input.id) {
      throw new Error(
        `El backup "${input.backup_id}" es de ${snap.tipo}:${snap.id} y pediste restaurar ${input.tipo}:${input.id}.`,
      );
    }
    // El diseño de Elementor vive en un meta, no en el contenido: sin esto,
    // «restaurar» una página de Elementor no devolvía su diseño.
    if (Array.isArray(snap.elementor_data)) {
      await wp.escribirElementorDeContenido(creds, input.tipo, input.id, snap.elementor_data, opciones);
    }
    const r = await wp.actualizarContenido(
      creds,
      input.tipo,
      input.id,
      {
        ...(snap.titulo !== undefined ? { titulo: snap.titulo } : {}),
        ...(snap.contenido !== undefined ? { contenido: snap.contenido } : {}),
        ...(snap.status !== undefined ? { status: snap.status } : {}),
      },
      opciones,
    );
    return { ok: true, restaurado: r.id, desde: `backup ${input.backup_id}`, titulo: r.titulo };
  },
  simulate(_ctx, input) {
    return { simulado: true, id: input.id, nota: "Simulación: no se restauró nada." };
  },
});
