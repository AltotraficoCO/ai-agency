/**
 * Piezas compartidas por las herramientas del agente Administrativo.
 */
import type { ToolContext } from "@strappy/tools";
import { requireLibros } from "../context.js";
import { fecha } from "../analisis.js";
import type { LibrosContext } from "../ports.js";

export type Entorno = {
  readonly libros: LibrosContext;
  readonly workspaceId: string;
};

export function entorno(ctx: ToolContext, toolSlug: string): Entorno {
  return { libros: requireLibros(ctx, toolSlug), workspaceId: ctx.workspaceId };
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Convierte «últimos 30 días» en un periodo cerrado que termina HOY.
 *
 * Al revés que en publicidad: aquí sí se incluye hoy, porque un pago que entró
 * esta mañana es justo lo que el dueño quiere ver cuando pregunta cuánto ha
 * entrado.
 */
export function ultimosDias(dias: number, ahora: Date): { readonly desde: string; readonly hasta: string } {
  const hasta = ahora;
  const desde = new Date(hasta.getTime() - (dias - 1) * DIA_MS);
  return { desde: fecha(desde), hasta: fecha(hasta) };
}

export function recortar(texto: string, max = 6000): string {
  return texto.length > max ? `${texto.slice(0, max)}…[recortado]` : texto;
}
