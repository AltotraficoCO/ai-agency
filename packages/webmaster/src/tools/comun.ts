/**
 * Piezas compartidas por las herramientas del Webmaster.
 */
import type { ToolContext } from "@strappy/tools";
import { requireSitio } from "../context.js";
import type { SitioContext } from "../ports.js";

export type Entorno = {
  readonly sitio: SitioContext;
  readonly opciones: { fetch?: typeof globalThis.fetch; abortSignal?: AbortSignal };
};

/** Contexto de sitio + las opciones de red que necesitan los clientes HTTP. */
export function entorno(ctx: ToolContext, toolSlug: string): Entorno {
  const sitio = requireSitio(ctx, toolSlug);
  return {
    sitio,
    opciones: {
      ...(sitio.fetch ? { fetch: sitio.fetch } : {}),
      ...(ctx.abortSignal ? { abortSignal: ctx.abortSignal } : {}),
    },
  };
}

/** Recorta un texto largo antes de que entre al contexto del modelo. */
export function recortar(texto: string, max = 6000): string {
  return texto.length > max ? `${texto.slice(0, max)}…[recortado]` : texto;
}
