/**
 * Herramientas del conector estándar: sitios propios que no son WordPress.
 *
 * Su contenido son PÁGINAS compuestas por SECCIONES tipadas, y el sitio
 * declara qué CAPACIDADES tiene. Esa declaración es el límite: si el sitio no
 * dice que sabe publicar, el agente no publica, y eso es mejor que descubrirlo
 * a base de errores en producción.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import { entorno } from "./comun.js";
import { requireConector } from "../ports.js";
import { hacerBackup, puertaDeAprobacion, evaluarSensibilidad, type Bloqueo } from "../aprobacion.js";
import * as con from "../conector/client.js";

const bloque = z.object({
  id: z.string().min(1),
  tipo: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
});

export const conectorSalud = defineTool({
  slug: "conector_salud",
  label: "Diagnóstico del sitio conectado",
  description:
    "Diagnóstico del sitio conectado por el contrato estándar: conexión, nombre y CAPACIDADES declaradas. Solo puedes hacer lo que el sitio declare.",
  whenToUse: "siempre lo primero en un sitio de este tipo",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.conectorRead],
  effect: "read",
  kind: "http",
  async execute(ctx) {
    const { sitio, opciones } = entorno(ctx, "conector_salud");
    return con.health(requireConector(sitio, "conector_salud"), opciones);
  },
});

export const conectorListarPaginas = defineTool({
  slug: "conector_listar_paginas",
  label: "Listar páginas",
  description: "Lista las páginas del sitio (id, título, ruta, estado).",
  whenToUse: "antes de editar nada, para no inventar identificadores",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.conectorRead],
  effect: "read",
  kind: "http",
  async execute(ctx) {
    const { sitio, opciones } = entorno(ctx, "conector_listar_paginas");
    return { paginas: await con.listarPaginas(requireConector(sitio, "conector_listar_paginas"), opciones) };
  },
});

export const conectorLeerPagina = defineTool({
  slug: "conector_leer_pagina",
  label: "Leer una página",
  description: "Lee una página completa con sus secciones tipadas.",
  whenToUse: "SIEMPRE antes de editar",
  inputSchema: z.object({ id: z.string().min(1) }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.conectorRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sitio, opciones } = entorno(ctx, "conector_leer_pagina");
    return con.leerPagina(requireConector(sitio, "conector_leer_pagina"), input.id, opciones);
  },
});

export const conectorLeerAjustes = defineTool({
  slug: "conector_leer_ajustes",
  label: "Leer ajustes globales",
  description: "Lee los ajustes globales del sitio (título, navegación, teléfono, redes…).",
  whenToUse: "antes de tocar cualquier dato que salga en todas las páginas",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.conectorRead],
  effect: "read",
  kind: "http",
  async execute(ctx) {
    const { sitio, opciones } = entorno(ctx, "conector_leer_ajustes");
    return { ajustes: await con.leerAjustes(requireConector(sitio, "conector_leer_ajustes"), opciones) };
  },
});

export const conectorCrearPagina = defineTool({
  slug: "conector_crear_pagina",
  label: "Crear una página",
  description:
    "Crea una página nueva compuesta por secciones tipadas (hero, texto, beneficios, stats, testimonios, precios, faq, cta, imagen, galeria, contacto). Compón 5-8 secciones variadas con copy específico del negocio.",
  whenToUse: "cuando la tarea pida una página que no existe",
  inputSchema: z.object({
    titulo: z.string().min(1).max(300),
    ruta: z.string().startsWith("/").optional(),
    status: z.enum(["publicada", "borrador"]).optional(),
    secciones: z.array(bloque).min(1).max(20),
  }),
  sensitive: false,
  creditCost: 6,
  scopes: [SCOPES.conectorWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "conector_crear_pagina");
    const bloqueo = await puertaDeAprobacion(
      ctx,
      sitio,
      "conector_crear_pagina",
      input,
      evaluarSensibilidad({
        toolSlug: "conector_crear_pagina",
        titulo: input.titulo,
        ...(input.ruta ? { slug: input.ruta } : {}),
        tiposSeccion: input.secciones.map((s) => s.tipo),
      }),
    );
    if (bloqueo) return bloqueo;
    const r = await con.crearPagina(
      requireConector(sitio, "conector_crear_pagina"),
      {
        titulo: input.titulo,
        ...(input.ruta ? { ruta: input.ruta } : {}),
        ...(input.status ? { status: input.status } : {}),
        secciones: input.secciones,
      },
      opciones,
    );
    return { ...r, creada: true };
  },
  simulate(_ctx, input) {
    return { simulado: true, titulo: input.titulo, secciones: input.secciones.map((s) => s.tipo) };
  },
});

export const conectorActualizarPagina = defineTool({
  slug: "conector_actualizar_pagina",
  label: "Actualizar una página entera",
  description:
    "Actualiza título, estado y/o TODAS las secciones de una página (reemplazo completo de lo enviado). Guarda backup y devuelve backup_id.",
  whenToUse: "para rediseñar una página completa; para un cambio puntual usa conector_actualizar_seccion",
  inputSchema: z.object({
    id: z.string().min(1),
    titulo: z.string().min(1).max(300).optional(),
    status: z.enum(["publicada", "borrador"]).optional(),
    secciones: z.array(bloque).max(20).optional(),
  }),
  sensitive: false,
  creditCost: 6,
  scopes: [SCOPES.conectorWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "conector_actualizar_pagina");
    const creds = requireConector(sitio, "conector_actualizar_pagina");
    const antes = await con.leerPagina(creds, input.id, opciones);

    const bloqueo = await puertaDeAprobacion(
      ctx,
      sitio,
      "conector_actualizar_pagina",
      input,
      evaluarSensibilidad({
        toolSlug: "conector_actualizar_pagina",
        titulo: input.titulo ?? antes.titulo,
        slug: antes.ruta,
        tiposSeccion: (input.secciones ?? antes.secciones).map((s) => s.tipo),
      }),
    );
    if (bloqueo) return bloqueo;

    const backupId = await hacerBackup(ctx, sitio, `conector:pagina:${input.id}`, antes);
    await con.actualizarPagina(
      creds,
      input.id,
      {
        ...(input.titulo !== undefined ? { titulo: input.titulo } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.secciones !== undefined ? { secciones: input.secciones } : {}),
      },
      opciones,
    );
    return { ok: true, id: input.id, backup_id: backupId, anterior_titulo: antes.titulo };
  },
  simulate(_ctx, input) {
    return { simulado: true, id: input.id };
  },
});

export const conectorActualizarSeccion = defineTool({
  slug: "conector_actualizar_seccion",
  label: "Actualizar una sección",
  description:
    "Actualiza UNA sección de una página; las demás quedan intactas. Guarda backup y devuelve backup_id.",
  whenToUse: "la vía preferida para cambiar un texto, una imagen o un dato puntual",
  inputSchema: z.object({
    pagina_id: z.string().min(1),
    seccion_id: z.string().min(1),
    tipo: z.string().min(1).optional(),
    props: z.record(z.string(), z.unknown()),
  }),
  sensitive: false,
  creditCost: 4,
  scopes: [SCOPES.conectorWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "conector_actualizar_seccion");
    const creds = requireConector(sitio, "conector_actualizar_seccion");
    const antes = await con.leerPagina(creds, input.pagina_id, opciones);
    const seccion = antes.secciones.find((s) => s.id === input.seccion_id);

    const bloqueo = await puertaDeAprobacion(
      ctx,
      sitio,
      "conector_actualizar_seccion",
      input,
      evaluarSensibilidad({
        toolSlug: "conector_actualizar_seccion",
        titulo: antes.titulo,
        slug: antes.ruta,
        contenido: JSON.stringify(input.props),
        ...(seccion ? { tiposSeccion: [seccion.tipo] } : {}),
      }),
    );
    if (bloqueo) return bloqueo;

    const backupId = await hacerBackup(ctx, sitio, `conector:pagina:${input.pagina_id}`, antes);
    await con.actualizarSeccion(
      creds,
      input.pagina_id,
      input.seccion_id,
      { ...(input.tipo ? { tipo: input.tipo } : {}), props: input.props },
      opciones,
    );
    return { ok: true, pagina: input.pagina_id, seccion: input.seccion_id, backup_id: backupId };
  },
  simulate(_ctx, input) {
    return { simulado: true, pagina: input.pagina_id, seccion: input.seccion_id };
  },
});

export const conectorBorrarPagina = defineTool({
  slug: "conector_borrar_pagina",
  label: "Borrar una página",
  description: "Borra una página del sitio. Guarda backup del contenido anterior.",
  whenToUse: "solo si el cliente pidió eliminarla",
  inputSchema: z.object({ id: z.string().min(1) }),
  sensitive: false,
  creditCost: 5,
  scopes: [SCOPES.conectorWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "conector_borrar_pagina");
    const creds = requireConector(sitio, "conector_borrar_pagina");
    const antes = await con.leerPagina(creds, input.id, opciones);

    const bloqueo = await puertaDeAprobacion(
      ctx,
      sitio,
      "conector_borrar_pagina",
      input,
      evaluarSensibilidad({
        toolSlug: "conector_borrar_pagina",
        titulo: antes.titulo,
        slug: antes.ruta,
        tiposSeccion: antes.secciones.map((s) => s.tipo),
      }),
    );
    if (bloqueo) return bloqueo;

    const backupId = await hacerBackup(ctx, sitio, `conector:pagina:${input.id}`, {
      ...antes,
      borrada: true,
    });
    await con.borrarPagina(creds, input.id, opciones);
    return { ok: true, borrada: antes.titulo, backup_id: backupId };
  },
  simulate(_ctx, input) {
    return { simulado: true, id: input.id, nota: "Simulación: no se borró nada." };
  },
});

export const conectorActualizarAjustes = defineTool({
  slug: "conector_actualizar_ajustes",
  label: "Actualizar ajustes globales",
  description:
    "Modifica ajustes globales del sitio (mezcla parcial: solo cambian las claves enviadas). Guarda backup.",
  whenToUse: "para el título del sitio, la navegación o datos de contacto",
  inputSchema: z.object({
    cambios: z
      .record(z.string(), z.unknown())
      .refine((o) => Object.keys(o).length > 0, "Pasa al menos un cambio."),
  }),
  sensitive: false,
  creditCost: 4,
  scopes: [SCOPES.conectorWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "conector_actualizar_ajustes");
    const creds = requireConector(sitio, "conector_actualizar_ajustes");
    const bloqueo = await puertaDeAprobacion(
      ctx,
      sitio,
      "conector_actualizar_ajustes",
      input,
      evaluarSensibilidad({
        toolSlug: "conector_actualizar_ajustes",
        clavesAjustes: Object.keys(input.cambios),
      }),
    );
    if (bloqueo) return bloqueo;
    const antes = await con.leerAjustes(creds, opciones);
    const backupId = await hacerBackup(ctx, sitio, "conector:ajustes", antes);
    await con.actualizarAjustes(creds, input.cambios, opciones);
    return { ok: true, backup_id: backupId };
  },
  simulate(_ctx, input) {
    return { simulado: true, cambios: Object.keys(input.cambios) };
  },
});

export const conectorPublicar = defineTool({
  slug: "conector_publicar",
  label: "Publicar el sitio",
  description:
    "Dispara la publicación o revalidación del sitio, si declara la capacidad 'publicar'.",
  whenToUse: "después de mutar, para que el cambio quede en vivo",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.conectorWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx): Promise<Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "conector_publicar");
    return con.publicar(requireConector(sitio, "conector_publicar"), opciones);
  },
  simulate() {
    return { simulado: true, nota: "Simulación: no se publicó nada." };
  },
});

export const HERRAMIENTAS_CONECTOR: readonly ToolDef<never, unknown>[] = [
  conectorSalud,
  conectorListarPaginas,
  conectorLeerPagina,
  conectorLeerAjustes,
  conectorCrearPagina,
  conectorActualizarPagina,
  conectorActualizarSeccion,
  conectorBorrarPagina,
  conectorActualizarAjustes,
  conectorPublicar,
] as unknown as readonly ToolDef<never, unknown>[];
