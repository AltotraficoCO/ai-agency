/**
 * Piezas compartidas por las herramientas de Marketing.
 */
import type { ToolContext } from "@strappy/tools";
import { requireCuentas } from "../context.js";
import type { CuentasContext, Periodo } from "../ports.js";

export type Entorno = {
  readonly cuentas: CuentasContext;
  readonly workspaceId: string;
};

export function entorno(ctx: ToolContext, toolSlug: string): Entorno {
  return { cuentas: requireCuentas(ctx, toolSlug), workspaceId: ctx.workspaceId };
}

const DIA_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD en UTC: las plataformas piden fechas, no instantes. */
export function fecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Convierte «últimos 7 días» en un periodo cerrado que termina AYER.
 *
 * Hoy no se incluye a propósito: el día en curso está a medias y compararlo
 * con días completos hace que todo parezca que va peor de lo que va.
 */
export function ultimosDias(dias: number, ahora: Date): Periodo {
  const hasta = new Date(ahora.getTime() - DIA_MS);
  const desde = new Date(hasta.getTime() - (dias - 1) * DIA_MS);
  return { desde: fecha(desde), hasta: fecha(hasta) };
}

export function recortar(texto: string, max = 6000): string {
  return texto.length > max ? `${texto.slice(0, max)}…[recortado]` : texto;
}
