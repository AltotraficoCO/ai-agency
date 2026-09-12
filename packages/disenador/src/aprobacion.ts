/**
 * La puerta por la que pasa todo lo que deja algo en el sitio del cliente.
 *
 * Aquí la regla no es la misma que en Marketing o en el financiero, y conviene
 * explicar por qué:
 *
 *  · **Generar una imagen NO pide botón.** No toca nada del cliente, se puede
 *    tirar a la basura y cuesta unos pocos cientos de pesos. Lo que la acota es
 *    un tope por encargo (`MAX_IMAGENES_POR_ENCARGO`) y que el coste se dice en
 *    voz alta. Si cada generación pidiera aprobación, el Webmaster que pide la
 *    portada de un artículo se quedaría colgado a mitad de encargo esperando un
 *    clic que el cliente no sabe que tiene que dar.
 *
 *  · **Publicar en la biblioteca del cliente SÍ pide botón**, porque a partir de
 *    ahí la imagen vive en su sitio.
 *
 *  · **Reemplazar una imagen existente pide botón siempre y con más razón**:
 *    crear es reversible, pisar la portada de alguien no.
 *
 * `huella` es un hash de (tarea + herramienta + entrada): una aprobación vale
 * para EXACTAMENTE lo aprobado. Aprobar «sube esta imagen» no aprueba «sube
 * esta otra».
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
 * `resumen` es lo que verá la persona en el botón: tiene que decir qué imagen
 * es y dónde va a acabar, no un identificador.
 */
export async function puertaDeAprobacion(input: {
  approvals: ApprovalPort;
  workspaceId: string;
  taskId: string;
  conexionId: string | null;
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
        "Una persona rechazó esto. No lo intentes por otra vía: respétalo y explícalo en el RESUMEN.",
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
      mensaje: "Una persona rechazó esto.",
    };
  }
  return {
    requiere_aprobacion: true,
    solicitud_id: solicitud.id,
    motivo: input.motivo,
    mensaje:
      "NO se subió nada. El cliente tiene que aprobarlo. Sigue con lo que sí puedas hacer y dilo en el RESUMEN.",
  };
}
