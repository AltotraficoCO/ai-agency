/**
 * Plugins · siempre sensibles: instalar código ajeno en el sitio del cliente.
 */
import { z } from "zod";
import { defineTool } from "@strappy/tools";
import { SCOPES } from "../../context.js";
import { entorno } from "../comun.js";
import { requireWp } from "../../ports.js";
import { hacerBackup, puertaDeAprobacion, type Bloqueo } from "../../aprobacion.js";
import * as wp from "../../wordpress/client.js";

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
