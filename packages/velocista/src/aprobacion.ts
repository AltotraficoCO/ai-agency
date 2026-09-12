/**
 * La puerta por la que pasa todo lo que toca el sitio del cliente.
 *
 * Regla del producto, no del código: el Velocista NUNCA instala ni activa nada
 * por su cuenta. Propone, una persona pulsa un botón y entonces se ejecuta. Un
 * plugin de caché mal puesto no deja una página fea: deja la tienda cerrada
 * mostrando precios de la semana pasada, y el dueño se entera por un cliente.
 *
 * `huella` es un hash de (tarea + herramienta + entrada): una aprobación vale
 * para EXACTAMENTE lo aprobado. Aprobar «instala LiteSpeed Cache» no aprueba
 * «instala otro plugin cualquiera».
 */
import { createHash } from "node:crypto";
import type { ApprovalPort } from "./ports.js";

export function huellaAccion(taskId: string, toolSlug: string, entrada: unknown): string {
  const cuerpo = JSON.stringify({ taskId, toolSlug, entrada });
  return createHash("sha256").update(cuerpo).digest("hex").slice(0, 32);
}

export type ResultadoPendiente = {
  readonly requiere_aprobacion: true;
  readonly solicitud_id: string;
  readonly motivo: string;
  readonly mensaje: string;
};

export type ResultadoRechazado = {
  readonly aprobacion_rechazada: true;
  readonly motivo: string;
  readonly mensaje: string;
};

export type Bloqueo = ResultadoPendiente | ResultadoRechazado;

export function esBloqueo(v: unknown): v is Bloqueo {
  if (!v || typeof v !== "object") return false;
  return "requiere_aprobacion" in v || "aprobacion_rechazada" in v;
}

/**
 * Devuelve `null` si se puede ejecutar (una persona ya dijo que sí) y un
 * bloqueo si no. Nunca ejecuta nada por su cuenta.
 *
 * `resumen` es lo que verá la persona: tiene que decir qué se va a instalar,
 * qué gana con ello y qué riesgo tiene, no el slug del plugin a secas.
 */
export async function puertaDeAprobacion(input: {
  approvals: ApprovalPort;
  workspaceId: string;
  taskId: string;
  conexionId: string;
  toolSlug: string;
  motivo: string;
  resumen: string;
  entrada: unknown;
}): Promise<Bloqueo | null> {
  const huella = huellaAccion(input.taskId, input.toolSlug, input.entrada);
  const previa = await input.approvals.check({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    huella,
  });
  if (previa === "aprobada") return null;
  if (previa === "rechazada") {
    return {
      aprobacion_rechazada: true,
      motivo: input.motivo,
      mensaje:
        "Una persona rechazó este cambio. No lo intentes por otra vía: respétalo y explícalo en el RESUMEN.",
    };
  }

  const solicitud = await input.approvals.request({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    siteId: input.conexionId,
    huella,
    toolSlug: input.toolSlug,
    motivo: input.motivo,
    resumen: input.resumen,
    entrada: input.entrada,
  });
  if (solicitud.decision === "aprobada") return null;
  if (solicitud.decision === "rechazada") {
    return {
      aprobacion_rechazada: true,
      motivo: input.motivo,
      mensaje: "Una persona rechazó este cambio.",
    };
  }
  return {
    requiere_aprobacion: true,
    solicitud_id: solicitud.id,
    motivo: input.motivo,
    mensaje:
      "NO se cambió nada. El cliente tiene que aprobarlo. Sigue con lo que sí puedas hacer y dilo en el RESUMEN.",
  };
}
