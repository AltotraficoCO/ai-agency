/**
 * Qué fuentes fallidas se pueden volver a aprender, y cuándo hacerlo solas.
 *
 * Módulo puro (sin base ni red) para poder probarlo entero. Lo usa
 * `recuperar.ts`, que es quien lee las fuentes y lanza el aprendizaje.
 *
 * Existe por un fallo concreto: las bases que Strap creó antes de que hubiera
 * proveedor de búsqueda por significado quedaron con fuentes en «error»
 * («AI Gateway authentication failed…»). El fallo ya está corregido, pero esas
 * fuentes nunca se volvieron a leer y la base seguía diciendo «Con problemas»
 * sin que la persona hubiera hecho nada mal.
 */
import { esFalloDeProveedor } from "./mensajes";

/** Tras un reintento automático, no se repite hasta pasado este tiempo. */
export const ESPERA_REINTENTO_AUTOMATICO_MS = 24 * 60 * 60 * 1000;

export type FuenteFallida = {
  readonly id: string;
  readonly cerebroId: string;
  readonly kind: string;
  readonly status: string;
  readonly titulo: string;
  readonly uri: string | null;
  /** Hay texto extraído guardado (`raw_content`) para aprender sin pedirlo otra vez. */
  readonly tieneContenido: boolean;
  readonly errorDetail: string | null;
  readonly metadata: Readonly<Record<string, unknown>> | null;
};

export type Releible = { readonly releible: true } | { readonly releible: false; readonly motivo: string };

/**
 * ¿Falló por culpa del proveedor de búsqueda por significado y no de la fuente?
 * Se reconoce tanto el detalle técnico viejo en inglés como el que ya se guarda
 * traducido.
 */
export function esFalloRecuperable(fuente: Pick<FuenteFallida, "status" | "errorDetail">): boolean {
  if (fuente.status !== "error") return false;
  const detalle = fuente.errorDetail ?? "";
  return esFalloDeProveedor(detalle) || /búsqueda inteligente/i.test(detalle);
}

/** ¿Se puede volver a aprender sin pedirle nada a la persona? Si no, por qué. */
export function sePuedeReleer(fuente: FuenteFallida): Releible {
  // Un PDF escaneado da lo mismo cada vez que se lee: reintentarlo no arregla nada.
  if (fuente.status === "stale" && /escane/i.test(fuente.errorDetail ?? "")) {
    return { releible: false, motivo: fuente.errorDetail ?? "Este PDF es un escaneo: súbelo con texto." };
  }
  switch (fuente.kind) {
    case "url":
      return fuente.uri
        ? { releible: true }
        : { releible: false, motivo: "Le falta la dirección: vuelve a añadir la página." };
    case "sitemap":
      return fuente.uri || typeof fuente.metadata?.["sitio"] === "string"
        ? { releible: true }
        : { releible: false, motivo: "No guardamos la dirección de este sitio: vuelve a añadirlo." };
    case "file":
      return fuente.tieneContenido
        ? { releible: true }
        : { releible: false, motivo: "Vuelve a subir este archivo: no guardamos su contenido." };
    default:
      return fuente.tieneContenido
        ? { releible: true }
        : { releible: false, motivo: "Vuelve a pegar este texto: no lo guardamos." };
  }
}

/**
 * ¿Toca reintentarla sola al abrir la base? Solo los fallos del proveedor, y
 * como mucho una vez al día: si vuelve a fallar, no se entra en bucle.
 */
export function tocaReintentoAutomatico(fuente: FuenteFallida, ahora: number): boolean {
  if (!esFalloRecuperable(fuente)) return false;
  const previo = fuente.metadata?.["reintentoAutomatico"];
  if (typeof previo === "string") {
    const instante = Date.parse(previo);
    if (Number.isFinite(instante) && ahora - instante < ESPERA_REINTENTO_AUTOMATICO_MS) return false;
  }
  return true;
}
