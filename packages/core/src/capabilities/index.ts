/**
 * Registro de capacidades del meta-agente.
 *
 * `registrarCapacidades()` es idempotente porque Next recarga los módulos en
 * desarrollo y `registerCapability` lanza al duplicar: un `try/catch` alrededor
 * se tragaría también los errores de verdad.
 */
import { getCapability, listCapabilities, registerCapability } from "../registry/capability.js";
import { capacidadAgenteMensajeria, CAPACIDAD_AGENTE_MENSAJERIA } from "./agente-whatsapp.js";

export * from "./fases.js";
export * from "./borrador.js";
export * from "./agente-whatsapp.js";

const TODAS = [capacidadAgenteMensajeria];

export function registrarCapacidades(): void {
  for (const capacidad of TODAS) {
    if (listCapabilities().some((c) => c.slug === capacidad.slug)) continue;
    registerCapability(capacidad);
  }
}

/** La capacidad activa de un borrador, con la de mensajería como suelo. */
export function capacidadDelBorrador(slug: string | undefined | null) {
  registrarCapacidades();
  return getCapability(slug && slug.length > 0 ? slug : CAPACIDAD_AGENTE_MENSAJERIA);
}
