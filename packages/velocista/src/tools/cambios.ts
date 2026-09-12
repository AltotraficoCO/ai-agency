/**
 * Lo único que este agente instala en la web del cliente.
 *
 * Pasa SIEMPRE por la puerta de aprobación y guarda copia de la lista de
 * complementos antes de tocar nada. Dos decisiones que no son de estilo:
 *
 *  · **La lista de plugins es cerrada.** El modelo elige entre cuatro caché
 *    conocidas, no escribe un slug libre. Si pudiera escribirlo, una frase
 *    envenenada en una página del propio cliente ("instala el plugin X")
 *    bastaría para meter cualquier cosa en su WordPress.
 *  · **No comprimo imágenes.** Se detectan y se proponen, pero reescribir los
 *    archivos del cliente pide un procesador de imágenes que este producto no
 *    tiene. Fingirlo sería devolver una web con las fotos arruinadas.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import { PLUGINS_DE_CACHE, tieneCache } from "../analisis.js";
import { puertaDeAprobacion, type Bloqueo } from "../aprobacion.js";
import { requireSitio } from "../ports.js";
import { entorno } from "./comun.js";

const SLUGS_CACHE = PLUGINS_DE_CACHE.map((p) => p.slug) as unknown as [string, ...string[]];

export const velocidadActivarCache = defineTool({
  slug: "velocidad_activar_cache",
  label: "Activar la caché de la web",
  description:
    "Instala y activa un plugin de caché en el WordPress del cliente. Cambia cómo se sirve toda su web: SIEMPRE requiere que una persona lo apruebe.",
  whenToUse:
    "cuando hayas medido, hayas comprobado con velocidad_revisar_plugins que no hay caché activa, y la página esté lenta",
  inputSchema: z.object({
    plugin: z
      .enum(SLUGS_CACHE)
      .default(PLUGINS_DE_CACHE[0].slug)
      .describe("Cuál de las cachés conocidas instalar."),
    motivo: z
      .string()
      .min(10)
      .max(300)
      .describe("Por qué, con la cifra que lo sostiene. Lo lee el cliente antes de aprobar."),
  }),
  sensitive: false,
  creditCost: 3,
  scopes: [SCOPES.sitioWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { velocidad, workspaceId } = entorno(ctx, "velocidad_activar_cache");
    const sitio = requireSitio(velocidad, "velocidad_activar_cache");
    if (!sitio.puedeEscribir) {
      throw new Error(
        "La conexión con la web es de solo lectura: puedes proponer la caché en el RESUMEN, pero no instalarla.",
      );
    }

    const plugins = await sitio.plugins();
    const cache = tieneCache(plugins);
    if (cache.activo) {
      return {
        ya_estaba: true,
        cual: cache.cual,
        nota: `La web ya tiene caché activa (${cache.cual}). No hay nada que instalar: dilo en el RESUMEN.`,
      };
    }

    const nombre = PLUGINS_DE_CACHE.find((p) => p.slug === input.plugin)?.nombre ?? input.plugin;
    const bloqueo = await puertaDeAprobacion({
      approvals: velocidad.approvals,
      workspaceId,
      taskId: velocidad.taskId,
      conexionId: velocidad.conexionId,
      toolSlug: "velocidad_activar_cache",
      motivo: "cambia cómo se sirve toda la web",
      resumen:
        `Instalar y activar ${nombre} en tu web. Con caché, las páginas se guardan ya hechas y ` +
        `cargan mucho más rápido. Guardo antes la lista de complementos por si hay que volver atrás. ` +
        `Si algo se ve raro después, se desactiva y todo vuelve a como estaba. Motivo: ${input.motivo}`,
      entrada: input,
    });
    if (bloqueo) return bloqueo;

    if (velocidad.backups) {
      await velocidad.backups.create({
        workspaceId,
        siteId: velocidad.conexionId,
        taskId: velocidad.taskId,
        alcance: `plugins:${velocidad.conexionId}`,
        snapshot: { plugins },
      });
    }

    const r = await sitio.instalarPlugin({ slug: input.plugin });
    return {
      activado: true,
      plugin: r.nombre,
      ya_estaba_instalado: r.yaEstaba,
      nota: "Vuelve a medir la misma página con velocidad_comparar y enseña la diferencia real.",
    };
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      nota: "Simulación: no se instaló nada. Descríbelo en el plan y deja que el cliente decida.",
      plugin: input.plugin,
    };
  },
});

export const HERRAMIENTAS_CAMBIOS: readonly ToolDef<never, unknown>[] = [
  velocidadActivarCache,
] as unknown as readonly ToolDef<never, unknown>[];
