/**
 * Validar y normalizar lo que se escribe en los avisos del Webmaster.
 *
 * Módulo puro, sin base de datos ni `server-only`, para poder probarlo. Lo que
 * sale de aquí es exactamente lo que el worker espera leer después en
 * `settings.avisos.whatsapp`.
 */

export const IDIOMA_POR_DEFECTO = "es";

/**
 * WhatsApp quiere el número en formato internacional: solo dígitos, con
 * indicativo de país y sin el `+`. La persona lo escribe como quiera —con
 * espacios, guiones o paréntesis— y se limpia aquí.
 */
export function normalizarNumero(valor: string): string | null {
  const digitos = valor.replace(/\D/g, "");
  // Por debajo de 8 dígitos no hay número posible; por encima de 15 no lo
  // admite el estándar internacional.
  if (digitos.length < 8 || digitos.length > 15) return null;
  return digitos;
}

/** Un nombre de plantilla de Meta: minúsculas, números y guiones bajos. */
export function normalizarPlantilla(valor: string): string | null {
  const limpio = valor.trim().toLowerCase();
  if (!limpio) return null;
  return /^[a-z0-9_]{1,512}$/.test(limpio) ? limpio : null;
}

/** `es`, `es_CO`, `en_US`… Vacío significa el idioma por defecto. */
export function normalizarIdioma(valor: string): string | null {
  const limpio = valor.trim();
  if (!limpio) return IDIOMA_POR_DEFECTO;
  return /^[a-z]{2}(_[A-Z]{2})?$/.test(limpio) ? limpio : null;
}

/**
 * Sin plantilla no se pueden encender los avisos.
 *
 * No es una regla nuestra: un aviso lo empieza el negocio, y para eso WhatsApp
 * exige una plantilla que Meta haya aprobado. Dejar encenderlos sin ella sería
 * prometer avisos que nunca van a salir.
 */
export function puedeActivarse(entrada: {
  destino: string | null | undefined;
  plantilla: string | null | undefined;
}): boolean {
  return Boolean(entrada.destino && entrada.plantilla);
}
