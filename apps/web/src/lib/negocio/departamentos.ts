/**
 * En qué departamento trabaja cada agente.
 *
 * El departamento no se guarda en el agente: se deduce de lo que ya sabemos.
 * Un agente de WhatsApp atiende clientes, así que es de Comunicaciones aunque
 * lo haya creado la persona con Strap y no venga del catálogo. Uno contratado
 * hereda el departamento de la categoría de su ficha (`catalog_agents.category`),
 * y la equivalencia categoría → departamento vive en `@strappy/ui`, en un solo
 * sitio, para que añadir un agente al catálogo no obligue a tocar el menú.
 *
 * Módulo puro: sin base de datos, para poder probarlo.
 */
import { departamentoDeCategoria, type DepartamentoId } from "@strappy/ui";

export type AgenteUbicable = {
  /** `conversational` atiende por WhatsApp; `task` trabaja por encargo. */
  readonly tipo: string;
  /** Slug del catálogo del que viene; null si lo creó la persona. */
  readonly catalogo: string | null;
};

export const esDeWhatsapp = (tipo: string): boolean => tipo === "conversational";

/**
 * @param categoriaPorSlug catálogo del espacio: slug → categoría.
 */
export function departamentoDeAgente(
  agente: AgenteUbicable,
  categoriaPorSlug: ReadonlyMap<string, string>,
): DepartamentoId {
  if (esDeWhatsapp(agente.tipo)) return "comunicaciones";
  if (!agente.catalogo) return "otros";
  return departamentoDeCategoria(categoriaPorSlug.get(agente.catalogo));
}

/** Catálogo → mapa slug/categoría, que es lo único que necesita el reparto. */
export function categoriasPorSlug(
  catalogo: readonly { slug: string; categoria: string }[],
): ReadonlyMap<string, string> {
  return new Map(catalogo.map((f) => [f.slug, f.categoria]));
}
