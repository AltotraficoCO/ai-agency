/**
 * Las herramientas de WordPress del Webmaster.
 *
 * Cada una se define UNA vez, con `defineTool` de `@strappy/tools`. En el
 * proyecto anterior la misma herramienta estaba escrita dos veces —una en
 * `executor.ts` y otra en `mcp/server.ts`— y las dos copias divergieron; los
 * adaptadores a AI SDK y a MCP viven en el registro y no aquí.
 *
 * Toda mutación hace tres cosas antes de tocar el sitio:
 *   1. lee el estado actual (nunca se edita a ciegas),
 *   2. lo guarda como backup y devuelve `backup_id`,
 *   3. pasa por la puerta de aprobación si la acción es sensible.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import { entorno, recortar } from "./comun.js";
import { requireWp } from "../ports.js";
import {
  esBloqueo,
  evaluarSensibilidad,
  hacerBackup,
  puertaDeAprobacion,
  type Bloqueo,
} from "../aprobacion.js";
import * as wp from "../wordpress/client.js";
import {
  PALETA_POR_DEFECTO,
  construirBarra,
  construirSecciones,
  type SeccionSpec,
} from "../wordpress/elementor.js";
import { conPaleta, leerDisenoDelSitio, resumirEstilo } from "../wordpress/diseno.js";
import { exigirTituloValido } from "../wordpress/titulos.js";
import { reservarCreacion } from "../creaciones.js";
import {
  contarPalabras,
  conTituloDeEntradaEnHero,
  extractoDeSecciones,
  extractoDeTexto,
  EXTRACTO_MAXIMO,
  motivoArticuloIncompleto,
  motivoReescrituraDestructiva,
  palabrasDeElementor,
  palabrasDeSecciones,
} from "../wordpress/articulo.js";

/**
 * Extracto e imagen destacada: sin ellos una entrada se publica bien pero su
 * tarjeta sale VACÍA en el listado del blog, que es de lo único que vive ese
 * listado (imagen destacada + título + extracto).
 */
const extractoInput = z
  .string()
  .max(EXTRACTO_MAXIMO)
  .optional()
  .describe(
    "1-2 frases que resumen la entrada para la tarjeta del blog. Si no lo pasas, se genera del propio artículo.",
  );

const imagenDestacadaInput = z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    "Id de la imagen destacada en la biblioteca de medios (wp_listar_medios, o el id que devuelve wp_subir_media). Sin ella la entrada sale sin foto en el listado del blog.",
  );

const cantidadPedida = z
  .number()
  .int()
  .min(1)
  .max(10)
  .optional()
  .describe(
    "Cuántos contenidos NUEVOS pidió el cliente en esta tarea, SOLO si dio un número o dijo «varias». «Un blog», «un post» o «un artículo» es 1: no lo pases.",
  );

const tipoContenido = z.enum(["page", "post"]);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Usa un color hexadecimal, p.ej. #17150F.");

/** `page_on_front` del sitio. Sin esto no se sabe qué página es la portada. */
async function portadaDe(
  creds: wp.WpCreds,
  opciones: Parameters<typeof wp.leerAjustes>[1],
): Promise<number | undefined> {
  try {
    const ajustes = await wp.leerAjustes(creds, opciones);
    const id = ajustes.page_on_front;
    return typeof id === "number" && id > 0 ? id : undefined;
  } catch {
    // Que no se puedan leer los ajustes no debe impedir la tarea; solo hace
    // que no podamos reconocer la portada, y ahí se prefiere seguir.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Lectura y diagnóstico
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Mutaciones de contenido
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Plugins · siempre sensibles: instalar código ajeno en el sitio del cliente
// ---------------------------------------------------------------------------

export const wpInstalarPlugin = defineTool({
  slug: "wp_instalar_plugin",
  label: "Instalar un plugin",
  description:
    "Instala y activa un plugin del directorio oficial de wordpress.org por su slug (p.ej. litespeed-cache). Puede tardar cerca de un minuto. Guarda backup de la lista de plugins.",
  whenToUse: "solo si la tarea lo pide y no hay forma de resolverla con lo ya instalado",
  inputSchema: z.object({
    slug: z.string().regex(/^[a-z0-9-]+$/, "El slug de wordpress.org es en minúsculas con guiones."),
  }),
  sensitive: true,
  creditCost: 10,
  scopes: [SCOPES.wpAdmin],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_instalar_plugin");
    const creds = requireWp(sitio, "wp_instalar_plugin");
    const bloqueo = await puertaDeAprobacion(ctx, sitio, "wp_instalar_plugin", input, {
      sensible: true,
      motivo: `instala el plugin "${input.slug}" en el sitio`,
    });
    if (bloqueo) return bloqueo;
    const backupId = await hacerBackup(ctx, sitio, "plugins", {
      plugins: await wp.listarPlugins(creds, opciones),
    });
    const p = await wp.instalarPlugin(creds, input.slug, opciones);
    return { ...p, backup_id: backupId };
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      plugin: input.slug,
      nota: "Simulación: no se instaló nada. Esta acción exigirá aprobación humana.",
    };
  },
});

export const wpCambiarPlugin = defineTool({
  slug: "wp_cambiar_plugin",
  label: "Activar o desactivar un plugin",
  description:
    'Activa o desactiva un plugin ya instalado (identificador tipo "akismet/akismet"). Guarda backup de la lista de plugins.',
  whenToUse: "para resolver conflictos entre plugins o activar algo ya presente",
  inputSchema: z.object({
    plugin: z.string().min(1),
    estado: z.enum(["active", "inactive"]),
  }),
  sensitive: true,
  creditCost: 5,
  scopes: [SCOPES.wpAdmin],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_cambiar_plugin");
    const creds = requireWp(sitio, "wp_cambiar_plugin");
    const bloqueo = await puertaDeAprobacion(ctx, sitio, "wp_cambiar_plugin", input, {
      sensible: true,
      motivo: `${input.estado === "active" ? "activa" : "desactiva"} el plugin "${input.plugin}"`,
    });
    if (bloqueo) return bloqueo;
    const backupId = await hacerBackup(ctx, sitio, "plugins", {
      plugins: await wp.listarPlugins(creds, opciones),
    });
    const p = await wp.cambiarEstadoPlugin(creds, input.plugin, input.estado, opciones);
    return { ...p, backup_id: backupId };
  },
  simulate(_ctx, input) {
    return { simulado: true, plugin: input.plugin, estado: input.estado, nota: "Simulación." };
  },
});

export const wpEliminarPlugin = defineTool({
  slug: "wp_eliminar_plugin",
  label: "Eliminar un plugin",
  description:
    "Elimina un plugin del sitio (lo desactiva primero si hace falta). Guarda backup de la lista de plugins.",
  whenToUse: "solo si el cliente pidió quitarlo: eliminar un plugin puede romper el sitio",
  inputSchema: z.object({ plugin: z.string().min(1) }),
  sensitive: true,
  creditCost: 10,
  scopes: [SCOPES.wpAdmin],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_eliminar_plugin");
    const creds = requireWp(sitio, "wp_eliminar_plugin");
    const bloqueo = await puertaDeAprobacion(ctx, sitio, "wp_eliminar_plugin", input, {
      sensible: true,
      motivo: `elimina el plugin "${input.plugin}" del sitio`,
    });
    if (bloqueo) return bloqueo;
    const backupId = await hacerBackup(ctx, sitio, "plugins", {
      plugins: await wp.listarPlugins(creds, opciones),
    });
    await wp.eliminarPlugin(creds, input.plugin, opciones);
    return { ok: true, eliminado: input.plugin, backup_id: backupId };
  },
  simulate(_ctx, input) {
    return { simulado: true, plugin: input.plugin, nota: "Simulación: no se eliminó nada." };
  },
});

// ---------------------------------------------------------------------------
// Ajustes, comunidad y medios
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Usuarios · siempre sensibles: quien entra al sitio no lo decide un modelo
// ---------------------------------------------------------------------------

export const wpCrearUsuario = defineTool({
  slug: "wp_crear_usuario",
  label: "Crear un usuario",
  description:
    "Crea un usuario del sitio con un rol. La contraseña la genera la plataforma y el dueño debe cambiarla.",
  whenToUse: "solo si el cliente pidió dar acceso a alguien concreto",
  inputSchema: z.object({
    username: z.string().min(3).max(60).regex(/^[a-z0-9._-]+$/i),
    // A mano y no con `z.email()`: su JSON Schema lleva una expresion regular
    // con comprobaciones hacia delante `(?!`, que OpenAI rechaza. Una sola
    // herramienta invalida tumba TODA la peticion con «Provider returned
    // error», sin decir cual es. Lo vigila `test/esquemas.test.ts`.
    email: z
      .string()
      .min(5)
      .max(254)
      .regex(/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/, "Escribe un correo valido, por ejemplo ana@negocio.com"),
    role: z.enum(["subscriber", "contributor", "author", "editor", "administrator"]),
  }),
  sensitive: true,
  creditCost: 5,
  scopes: [SCOPES.wpAdmin],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_crear_usuario");
    const bloqueo = await puertaDeAprobacion(ctx, sitio, "wp_crear_usuario", input, {
      sensible: true,
      motivo: `da acceso "${input.role}" al sitio a ${input.username}`,
    });
    if (bloqueo) return bloqueo;
    const u = await wp.crearUsuario(requireWp(sitio, "wp_crear_usuario"), input, opciones);
    // La contraseña se devuelve bajo una clave que el filtro de secretos borra
    // antes de persistir o enseñar nada: el modelo no debe verla nunca.
    return { id: u.id, username: input.username, role: input.role, password: u.password };
  },
  simulate(_ctx, input) {
    return { simulado: true, username: input.username, role: input.role };
  },
});

export const wpCambiarRolUsuario = defineTool({
  slug: "wp_cambiar_rol_usuario",
  label: "Cambiar el rol de un usuario",
  description: "Cambia el rol de un usuario existente del sitio.",
  whenToUse: "solo si el cliente lo pidió: subir a administrador es dar las llaves del sitio",
  inputSchema: z.object({
    usuario_id: z.number().int().positive(),
    role: z.enum(["subscriber", "contributor", "author", "editor", "administrator"]),
  }),
  sensitive: true,
  creditCost: 5,
  scopes: [SCOPES.wpAdmin],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_cambiar_rol_usuario");
    const bloqueo = await puertaDeAprobacion(ctx, sitio, "wp_cambiar_rol_usuario", input, {
      sensible: true,
      motivo: `cambia el rol del usuario ${input.usuario_id} a "${input.role}"`,
    });
    if (bloqueo) return bloqueo;
    await wp.cambiarRolUsuario(
      requireWp(sitio, "wp_cambiar_rol_usuario"),
      input.usuario_id,
      input.role,
      opciones,
    );
    return { ok: true, usuario_id: input.usuario_id, role: input.role };
  },
  simulate(_ctx, input) {
    return { simulado: true, usuario_id: input.usuario_id, role: input.role };
  },
});

// ---------------------------------------------------------------------------
// Elementor
// ---------------------------------------------------------------------------

const itemSeccion = z.object({
  titulo: z.string().optional(),
  texto: z.string().optional(),
  icono: z
    .string()
    .optional()
    .describe("Ignorado: no se pintan emojis; las tarjetas se numeran con el color de acento del sitio."),
  cifra: z.string().optional().describe("Solo en stats, p.ej. '500+'"),
  etiqueta: z.string().optional().describe("Solo en stats"),
  autor: z.string().optional().describe("Solo en testimonios"),
  cargo: z.string().optional().describe("Solo en testimonios"),
  pregunta: z.string().optional().describe("Solo en faq"),
  respuesta: z.string().optional().describe("Solo en faq"),
});

const seccionSpec = z.object({
  tipo: z.enum(["hero", "beneficios", "stats", "testimonios", "precios", "faq", "cta", "texto"]),
  titulo: z.string().optional(),
  subtitulo: z.string().optional(),
  boton: z.string().optional(),
  boton_url: z
    .string()
    .optional()
    .describe(
      "Ruta del sitio (/contacto/) o dirección externa completa (https://…). Sin boton_url válido el botón NO se pinta: nunca inventes «Leer más» sin destino.",
    ),
  html: z.string().optional().describe("Solo para tipo texto"),
  items: z.array(itemSeccion).optional(),
  planes: z
    .array(
      z.object({
        nombre: z.string(),
        precio: z.string(),
        periodo: z.string().optional(),
        incluye: z.array(z.string()).min(2).max(8),
        boton: z.string().optional(),
        destacado: z.boolean().optional(),
      }),
    )
    .optional()
    .describe("Solo en tipo precios (2-3 planes)"),
});

export const wpCrearPaginaElementor = defineTool({
  slug: "wp_crear_pagina_elementor",
  label: "Crear página con Elementor",
  description:
    "Crea (o reescribe, pasando su id) una página o una entrada de blog (tipo=\"post\") construida CON ELEMENTOR componiendo secciones: hero, beneficios, stats, testimonios, precios, faq, cta y texto. El diseño (colores, tipografías, radios, botones, ancho) se toma AUTOMÁTICAMENTE del sitio real, para que quede acorde a lo que ya tiene. Oculta el título duplicado del tema y cierra los comentarios salvo que se pidan. Para una landing decente usa 5-8 secciones variadas con copy concreto del negocio: una página de tres bloques es inaceptable. UNA ENTRADA (tipo=\"post\") ES UN ARTÍCULO COMPLETO: hero con el mismo titular de la entrada (sin botón o con el CTA real del sitio) → texto de introducción → 3-5 secciones texto con subtítulos y desarrollo → opcional beneficios o faq → cta con la llamada a la acción real del sitio; mínimo 400 palabras, o se rechaza. Dale también imagen_destacada_id (elígela con wp_listar_medios): el listado del blog pinta cada tarjeta con la imagen destacada, el título y el extracto, y sin ellos la entrada sale ahí vacía; el extracto se genera solo del artículo si no lo pasas. Crea UN contenido nuevo por tarea salvo que pases cantidad_pedida. Para mejorar uno existente, pasa su id y el contenido COMPLETO: una reescritura con mucho menos texto se rechaza. Es la herramienta obligatoria cuando piden algo 'con Elementor', 'de diseño' o 'atractivo', también para una entrada.",
  whenToUse: "para cualquier landing, página de ventas, rediseño o entrada de blog con aspecto profesional",
  inputSchema: z.object({
    titulo: z
      .string()
      .min(1)
      .max(300)
      .describe(
        "Titular redactado por ti a partir del TEMA: completo, atractivo y de 90 caracteres como mucho. Nunca un trozo copiado de la petición ni instrucciones de formato.",
      ),
    tipo: tipoContenido
      .optional()
      .describe(
        '"post" para una entrada o artículo de blog, "page" para una página. Sin id, por defecto crea una página. Con id y sin tipo, se detecta.',
      ),
    pagina_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Si se pasa, escribe el diseño SOBRE ese contenido existente (página o entrada) y conserva su URL."),
    contenido_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Lo mismo que pagina_id, con un nombre que vale también para entradas."),
    secciones: z.array(seccionSpec).min(1).max(10),
    extracto: extractoInput,
    imagen_destacada_id: imagenDestacadaInput,
    paleta: z
      .object({
        fondo: hex.describe("Hexadecimal oscuro"),
        acento: hex.describe("Hexadecimal vivo"),
        texto: hex.describe("Hexadecimal claro"),
        fondo_claro: hex,
      })
      .optional()
      .describe("SOLO si el cliente pidió expresamente otro estilo o hay una referencia de imagen; exige motivo_paleta."),
    motivo_paleta: z
      .enum(["el_cliente_pidio_otro_estilo", "referencia_de_imagen"])
      .optional()
      .describe("Por qué no se usa el diseño del sitio. Sin motivo, la paleta se ignora."),
    referencia_diseno: z
      .string()
      .startsWith("/", "Ruta relativa del sitio, p.ej. /servicios/")
      .max(300)
      .optional()
      .describe("Página de la que copiar el diseño. Por defecto, la portada."),
    permitir_comentarios: z
      .boolean()
      .default(false)
      .describe("true solo si el cliente quiere comentarios debajo; por defecto se cierran."),
    cantidad_pedida: cantidadPedida,
    reemplazar_todo: z
      .boolean()
      .default(false)
      .describe("true SOLO si el cliente pidió reemplazar por completo un contenido existente, aunque quede con menos texto."),
  }),
  sensitive: false,
  creditCost: 8,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_crear_pagina_elementor");
    const creds = requireWp(sitio, "wp_crear_pagina_elementor");
    exigirTituloValido(input.titulo);

    if (
      input.pagina_id !== undefined &&
      input.contenido_id !== undefined &&
      input.pagina_id !== input.contenido_id
    ) {
      throw new Error(
        `pagina_id (${input.pagina_id}) y contenido_id (${input.contenido_id}) no coinciden: pasa solo uno de los dos.`,
      );
    }
    const id = input.contenido_id ?? input.pagina_id;
    // Un contenido nuevo ocupa su plaza ANTES de cualquier await: dos llamadas
    // en paralelo no pueden crear dos entradas cuando se pidió una.
    const reserva =
      id === undefined
        ? reservarCreacion(sitio, {
            tipo: input.tipo ?? "page",
            titulo: input.titulo,
            cantidadPedida: input.cantidad_pedida,
          })
        : null;

    const trabajo = async (): Promise<Bloqueo | Record<string, unknown>> => {
      // Con un id, el tipo no se adivina: se lee. Así una entrada recién creada
      // no acaba pidiéndose por /pages/ hasta agotar el tope de acciones.
      const tipo =
        id === undefined ? (input.tipo ?? "page") : (input.tipo ?? (await wp.detectarTipoContenido(creds, id, opciones)));
      const antes = id !== undefined ? await wp.leerContenido(creds, tipo, id, opciones) : undefined;

      const pedidas = input.secciones as SeccionSpec[];
      // Una entrada de un hero y un botón que no lleva a nada no es un artículo.
      if (tipo === "post") {
        const incompleto = motivoArticuloIncompleto(pedidas);
        if (incompleto) throw new Error(incompleto);
      }

      // Lo que ya había: para el backup y para no destruirlo al reescribir.
      const disenoAnterior =
        id !== undefined ? await wp.leerElementorData(creds, id, opciones, tipo).catch(() => null) : null;
      if (id !== undefined && antes && !input.reemplazar_todo) {
        const palabrasAntes = disenoAnterior ? palabrasDeElementor(disenoAnterior) : contarPalabras(antes.contenido);
        const destructiva = motivoReescrituraDestructiva(id, palabrasAntes, palabrasDeSecciones(pedidas));
        if (destructiva) throw new Error(destructiva);
      }
      const { secciones, cambiado: heroRetitulado } =
        tipo === "post" ? conTituloDeEntradaEnHero(pedidas, input.titulo) : { secciones: pedidas, cambiado: false };

      const portadaId = id !== undefined && tipo === "page" ? await portadaDe(creds, opciones) : undefined;
      const bloqueo = await puertaDeAprobacion(
        ctx,
        sitio,
        "wp_crear_pagina_elementor",
        input,
        evaluarSensibilidad({
          toolSlug: "wp_crear_pagina_elementor",
          titulo: input.titulo,
          ...(id !== undefined ? { contenidoId: id } : {}),
          ...(portadaId !== undefined ? { portadaId } : {}),
          tiposSeccion: input.secciones.map((s) => s.tipo),
        }),
      );
      if (bloqueo) return bloqueo;

      let backupId: string | null = null;
      if (id !== undefined && antes) {
        backupId = await hacerBackup(ctx, sitio, `${tipo}:${id}`, {
          tipo,
          id,
          titulo: antes.titulo,
          contenido: antes.contenido,
          status: antes.status,
          ...(disenoAnterior ? { elementor_data: disenoAnterior } : {}),
        });
      }

      // El diseño sale del sitio. Una paleta del modelo solo vale con motivo:
      // «bonita» no es pedir otro estilo, y era así como salía negro y naranja.
      const delSitio = await leerDisenoDelSitio(sitio, opciones, input.referencia_diseno ?? "/");
      const usarPaleta = input.paleta !== undefined && input.motivo_paleta !== undefined;
      const estilo = usarPaleta ? conPaleta(delSitio, input.paleta!) : delSitio;

      // Sin extracto ni imagen destacada la entrada se publica bien, pero su
      // tarjeta sale vacía en el listado del blog: el extracto se saca del
      // propio artículo cuando el modelo no lo manda.
      const extracto =
        input.extracto ?? (tipo === "post" ? extractoDeSecciones(secciones) : "");

      const data = construirSecciones(secciones, estilo);
      const r = await wp.escribirContenidoElementor(
        creds,
        {
          tipo,
          ...(id !== undefined ? { id } : {}),
          titulo: input.titulo,
          data,
          ...(extracto ? { extracto } : {}),
          ...(input.imagen_destacada_id !== undefined
            ? { imagenDestacadaId: input.imagen_destacada_id }
            : {}),
        },
        opciones,
      );
      if (!r.elementorOk) {
        throw new Error(
          "El WordPress no aceptó el diseño Elementor: falta el plugin conector, que es quien expone los metadatos de Elementor en la REST API. El cliente lo descarga desde el panel.",
        );
      }
      const presentacion = await wp.ajustarPresentacion(
        creds,
        tipo,
        r.id,
        {
          ocultarTitulo: true,
          comentarios: input.permitir_comentarios ? "open" : "closed",
          ...(extracto ? { extracto } : {}),
          ...(input.imagen_destacada_id !== undefined
            ? { imagenDestacadaId: input.imagen_destacada_id }
            : {}),
        },
        opciones,
      );

      const notas = ["Verifica ahora con navegador_ver_pagina (pagina_completa=true) y compárala con la portada: si no se parece, corrígela."];
      if (input.paleta && !usarPaleta) {
        notas.push("Ignoré la paleta porque no diste motivo_paleta: se usó el diseño del sitio.");
      }
      if (estilo.origen === "por_defecto") {
        notas.push("No pude leer el diseño del sitio y usé el aspecto por defecto: revisa la portada y, si no se parece, repite con una paleta y motivo_paleta.");
      }
      if (!presentacion.tituloOculto) {
        notas.push("No pude ocultar el título del tema: si al verlo aparece repetido encima del diseño, dilo en el RESUMEN.");
      }
      if (heroRetitulado) notas.push("Puse en el hero el mismo titular que la entrada.");
      if (tipo === "post") {
        if (presentacion.imagenDestacada <= 0) {
          notas.push(
            "La entrada NO tiene imagen destacada: en el listado del blog su tarjeta saldrá sin foto y, con algunas plantillas, vacía. Elige una con wp_listar_medios y repite esta llamada con contenido_id e imagen_destacada_id, o ponla con wp_editar_contenido.",
          );
        }
        if (extracto && !presentacion.extracto) {
          notas.push("No pude guardar el extracto: sin él la tarjeta del blog sale sin texto. Inténtalo con wp_editar_contenido (nuevo_extracto).");
        }
      }
      if (tipo === "post" && id === undefined) {
        notas.push("Cuando la hayas verificado, enlázala en el blog del sitio con wp_enlazar_entrada_en_blog (su id y un extracto de 1-2 frases) y mira el listado del blog en el navegador. No crees más entradas salvo que el cliente pidiera varias.");
      }
      return {
        ok: true,
        tipo,
        id: r.id,
        link: r.link,
        secciones: secciones.length,
        palabras: palabrasDeSecciones(secciones),
        backup_id: backupId,
        diseno_origen: estilo.origen,
        estilo_aplicado: resumirEstilo(estilo),
        titulo_del_tema_oculto: presentacion.tituloOculto,
        comentarios: presentacion.comentarios,
        extracto: presentacion.extracto || extracto || null,
        imagen_destacada: presentacion.imagenDestacada,
        nota: notas.join(" "),
      };
    };

    try {
      const resultado = await trabajo();
      if (reserva) {
        if (esBloqueo(resultado) || typeof resultado.id !== "number") reserva.liberar();
        else reserva.confirmar(resultado.id);
      }
      return resultado;
    } catch (error) {
      reserva?.liberar();
      throw error;
    }
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      titulo: input.titulo,
      secciones: input.secciones.map((s) => s.tipo),
      nota: "Simulación: la página no se escribió. Describe estas secciones en el plan.",
    };
  },
});

export const wpCrearHeaderGlobal = defineTool({
  slug: "wp_crear_header_global",
  label: "Crear header (y footer) global",
  description:
    "Crea el HEADER —y opcionalmente el FOOTER— GLOBAL del sitio con Elementor: un template que sale en TODAS las páginas. Un header nunca es una página ni un post. Requiere el plugin conector en el WordPress. El diseño de la barra lo compone la plataforma; tú eliges marca, enlaces y paleta.",
  whenToUse: "cuando pidan un menú, cabecera o pie que se vea en todo el sitio",
  inputSchema: z.object({
    marca: z.string().min(1).max(80).describe("Nombre corto del negocio que va en la barra"),
    enlaces: z
      .array(
        z.object({
          texto: z.string().min(1).max(40),
          // Un footer con el Instagram del negocio o un "Llámanos" es lo normal:
          // la restricción a rutas relativas es de las herramientas de
          // navegador (que no deben visitar otros hosts), no de un enlace.
          url: z
            .string()
            .max(500)
            .refine(
              (v) => v.startsWith("/") || /^(https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|tel:[+\d\s()-]+)$/i.test(v),
              "Usa una ruta del sitio (/contacto/) o una dirección completa (https://…, mailto:…, tel:…).",
            )
            .describe("Ruta de una página del sitio (/contacto/) o dirección externa completa con https://"),
        }),
      )
      .min(2)
      .max(6),
    paleta: z.object({ fondo: hex, acento: hex, texto: hex }).optional(),
    incluir_footer: z.boolean().default(false),
  }),
  sensitive: false,
  creditCost: 8,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_crear_header_global");
    const creds = requireWp(sitio, "wp_crear_header_global");
    const pal = input.paleta ?? {
      fondo: PALETA_POR_DEFECTO.fondo,
      acento: PALETA_POR_DEFECTO.acento,
      texto: PALETA_POR_DEFECTO.texto,
    };

    const header = await wp.crearHeaderElementor(
      creds,
      {
        titulo: "Header del sitio",
        tipo: "header",
        data: construirBarra({
          marca: input.marca,
          enlaces: input.enlaces,
          paleta: pal,
          variante: "header",
        }),
      },
      opciones,
    );
    if (!header.disponible) {
      throw new Error(
        "No se puede crear un header o footer global NUEVO en este sitio. Si el sitio ya tiene su header o footer hecho con Elementor, edítalo con wp_listar_plantillas_elementor, wp_leer_plantilla_elementor y wp_editar_plantilla_elementor. No crees páginas ni posts como rodeo.",
      );
    }

    let footerId: number | undefined;
    if (input.incluir_footer) {
      const f = await wp.crearHeaderElementor(
        creds,
        {
          titulo: "Footer del sitio",
          tipo: "footer",
          data: construirBarra({
            marca: input.marca,
            enlaces: input.enlaces,
            paleta: pal,
            variante: "footer",
          }),
        },
        opciones,
      );
      if (f.disponible) footerId = f.id;
    }

    return {
      ok: true,
      header_id: header.id,
      ...(footerId ? { footer_id: footerId } : {}),
      nota: "Verifica con navegador_ver_pagina que la barra se vea bien en la portada y en otra página.",
    };
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      marca: input.marca,
      enlaces: input.enlaces.length,
      nota: "Simulación: el header no se creó.",
    };
  },
});

// ---------------------------------------------------------------------------
// Verificación por HTTP
// ---------------------------------------------------------------------------

export const verificarHttp = defineTool({
  slug: "verificar_http",
  label: "Verificar una ruta por HTTP",
  description:
    "Comprobación rápida de una ruta del sitio: código HTTP, latencia y, si lo pides, si el HTML contiene un texto.",
  whenToUse:
    "como comprobación barata; nunca como verificación final: un 200 no dice que la página se vea bien",
  inputSchema: z.object({
    path: z
      .string()
      .startsWith("/", "Ruta relativa del sitio, p.ej. /contacto")
      .default("/"),
    contiene: z.string().max(200).optional(),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.wpRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sitio, opciones } = entorno(ctx, "verificar_http");
    if (input.path.startsWith("//")) throw new Error("La ruta no puede apuntar a otro dominio.");
    return wp.verificar(requireWp(sitio, "verificar_http"), input.path, input.contiene, opciones);
  },
});

export const HERRAMIENTAS_WP: readonly ToolDef<never, unknown>[] = [
  sitioSalud,
  sitioLeerDiseno,
  wpListarContenido,
  wpLeerContenido,
  wpListarPlugins,
  wpLeerAjustes,
  wpListarComentarios,
  wpListarUsuarios,
  wpEditarContenido,
  wpCrearContenido,
  wpBorrarContenido,
  wpCambiosRecientes,
  wpRestaurarContenido,
  wpInstalarPlugin,
  wpCambiarPlugin,
  wpEliminarPlugin,
  wpActualizarAjustes,
  wpModerarComentario,
  wpCrearTermino,
  wpSubirMedia,
  wpListarMedios,
  wpCrearUsuario,
  wpCambiarRolUsuario,
  wpCrearPaginaElementor,
  wpCrearHeaderGlobal,
  verificarHttp,
] as unknown as readonly ToolDef<never, unknown>[];

export { esBloqueo };
