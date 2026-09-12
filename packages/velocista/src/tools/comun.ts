/**
 * Piezas compartidas por las herramientas del Velocista.
 */
import type { ToolContext } from "@strappy/tools";
import { requireVelocidad } from "../context.js";
import type { Dispositivo, VelocidadContext } from "../ports.js";

export type Entorno = {
  readonly velocidad: VelocidadContext;
  readonly workspaceId: string;
};

export function entorno(ctx: ToolContext, toolSlug: string): Entorno {
  return { velocidad: requireVelocidad(ctx, toolSlug), workspaceId: ctx.workspaceId };
}

/**
 * Une la ruta que pide el modelo con el dominio del cliente.
 *
 * El modelo NUNCA da una URL completa: da una ruta. Si pudiera dar el dominio,
 * una inyección de prompt haría que midiéramos —y expusiéramos— la web de otro.
 * Es la misma regla que el navegador del Webmaster: nunca se sale del sitio.
 */
export function urlDelSitio(base: string, ruta: string): string {
  if (ruta.startsWith("//") || /^https?:/i.test(ruta)) {
    throw new Error(
      "La ruta no puede apuntar a otro dominio: escribe solo la parte de después del dominio, como /servicios/.",
    );
  }
  const dominio = base.replace(/\/+$/, "");
  const camino = ruta.startsWith("/") ? ruta : `/${ruta}`;
  return `${dominio}${camino}`;
}

/** La última medición guardada de esa página y ese dispositivo, si la hay. */
export function ultimaMedicion(
  velocidad: VelocidadContext,
  url: string,
  dispositivo: Dispositivo,
): (typeof velocidad.historial)[number] | undefined {
  for (let i = velocidad.historial.length - 1; i >= 0; i--) {
    const m = velocidad.historial[i];
    if (m && m.url === url && m.dispositivo === dispositivo) return m;
  }
  return undefined;
}
