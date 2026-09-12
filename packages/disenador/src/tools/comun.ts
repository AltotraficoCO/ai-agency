/**
 * Piezas compartidas por las herramientas del Diseñador.
 */
import type { ToolContext } from "@strappy/tools";
import { requireDiseno } from "../context.js";
import { MAX_IMAGENES_POR_ENCARGO, type DisenoContext } from "../ports.js";

export type Entorno = {
  readonly diseno: DisenoContext;
  readonly workspaceId: string;
};

export function entorno(ctx: ToolContext, toolSlug: string): Entorno {
  return { diseno: requireDiseno(ctx, toolSlug), workspaceId: ctx.workspaceId };
}

export function topeDeImagenes(diseno: DisenoContext): number {
  return diseno.maxImagenes ?? MAX_IMAGENES_POR_ENCARGO;
}

export function generadas(diseno: DisenoContext): number {
  return diseno.contador?.generadas ?? 0;
}

export function recortar(texto: string, max = 4000): string {
  return texto.length > max ? `${texto.slice(0, max)}…[recortado]` : texto;
}
