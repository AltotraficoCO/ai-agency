/**
 * Verificación por HTTP y refresco de caché: comprobar que el cambio se ve.
 */
import { z } from "zod";
import { defineTool } from "@strappy/tools";
import { SCOPES } from "../../context.js";
import { entorno } from "../comun.js";
import { requireWp } from "../../ports.js";
import * as wp from "../../wordpress/client.js";

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

/**
 * Lo que arregla el «lo cambié y no se ve».
 *
 * No es un truco: es exactamente lo que hace una persona cuando pulsa
 * «Actualizar» en WordPress. Existe porque un cambio guardado y tapado por la
 * caché parece un cambio fallido, y un agente que cree que falló lo deshace y
 * lo vuelve a hacer hasta quedarse sin acciones.
 */
export const wpRefrescarCache = defineTool({
  slug: "wp_refrescar_cache",
  label: "Refrescar la caché del sitio",
  description:
    "Fuerza al sitio a regenerar una página: limpia la caché de Elementor y vuelve a guardar el contenido, que es lo que hace que los plugins de caché suelten la copia vieja. Dice además qué plugins de caché están activos.",
  whenToUse:
    "cuando guardaste un cambio, lo releíste y está puesto, pero la página se sigue viendo igual en el navegador. Úsalo UNA vez y sigue; si tras eso tampoco se ve, es la caché del servidor o del CDN y eso se dice en el RESUMEN, no se pelea.",
  inputSchema: z.object({
    id: z.number().int().positive().describe("Id de la página o entrada que no se actualiza."),
    tipo: z.enum(["page", "post"]).default("page"),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.wpWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_refrescar_cache");
    const r = await wp.refrescarCacheDelSitio(
      requireWp(sitio, "wp_refrescar_cache"),
      { tipo: input.tipo as "page" | "post", id: input.id },
      opciones,
    );
    return {
      ok: true,
      cache_elementor: r.elementor ? "limpiada" : "no disponible",
      contenido_regenerado: r.tocado,
      plugins_de_cache: r.plugins,
      nota: r.plugins.length
        ? `Este sitio usa ${r.plugins.join(", ")}. Si aun así la página se ve igual, el cambio ESTÁ hecho y lo que ves es una copia guardada: dilo en el RESUMEN y no lo vuelvas a hacer de otra forma.`
        : "Sin plugins de caché activos. Si aun así no se ve, puede ser caché del servidor o del CDN del hosting.",
    };
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      nota: `Simulación: no se tocó nada. En real se regeneraría ${input.tipo === "post" ? "la entrada" : "la página"} ${input.id}.`,
    };
  },
});
