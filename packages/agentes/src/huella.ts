/**
 * Implementación de REFERENCIA de la huella de una acción aprobable.
 *
 * Ojo: cada oficio pasa la suya al bucle (`OficioDelAgente.huella`) porque sus
 * herramientas y la web ya resuelven las decisiones guardadas con un formato
 * concreto —el Webmaster usa el hash entero y Marketing lo recorta a 32—. Esta
 * de aquí solo vale para agentes nuevos que no arrastren historia.
 *
 * La huella de una acción aprobable.
 *
 * Hash de (tarea + herramienta + entrada): una aprobación vale para EXACTAMENTE
 * lo aprobado. Aprobar «sube el presupuesto a 50.000» no aprueba «sube a
 * 500.000», ni «instala este plugin» aprueba instalar otro.
 *
 * La misma función vive en `@strappy/webmaster/aprobacion` y en
 * `@strappy/marketing`: las tres calculan idéntico porque la web resuelve las
 * decisiones guardadas por esta huella y un cambio aquí dejaría huérfanas las
 * aprobaciones ya pendientes.
 */
import { createHash } from "node:crypto";

export function huellaAccion(taskId: string, toolSlug: string, entrada: unknown): string {
  const cuerpo = JSON.stringify({ taskId, toolSlug, entrada });
  return createHash("sha256").update(cuerpo).digest("hex").slice(0, 32);
}
