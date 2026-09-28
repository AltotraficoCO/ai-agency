/**
 * Cierre, igual para cualquier agente: guardar el desenlace y avisar al cliente.
 */
import type { ResultadoTarea } from "@strappy/agentes";
import type { PuertosWorker, TareaReclamada } from "../../ports.js";
import { esDefinitivo, type Encargo } from "./encargo.js";

export async function cerrarTarea(
  { puertos, workerId }: { readonly puertos: PuertosWorker; readonly workerId: string },
  tarea: TareaReclamada,
  resultado: ResultadoTarea,
  decir: (m: string) => void,
  extra?: Encargo["extra"],
): Promise<void> {
  switch (resultado.estado) {
    case "completada": {
      await puertos.cola.completar({
        taskId: tarea.id,
        workerId,
        resumen: resultado.resumen,
        evidencia: resultado.evidencia,
        creditos: resultado.evidencia.creditos,
      });
      await puertos.notificaciones?.avisar({
        workspaceId: tarea.workspaceId,
        taskId: tarea.id,
        tipo: "resultado",
        texto: resultado.resumen,
      });
      decir(
        `listo · ${resultado.evidencia.acciones.length} acciones, ${resultado.evidencia.creditos} créditos`,
      );
      break;
    }
    case "esperando_aprobacion": {
      await puertos.cola.suspender({
        taskId: tarea.id,
        workerId,
        resumen: resultado.resumen,
        // La colaboración a medias viaja DENTRO de la evidencia: es lo único
        // que se guarda entre un intento y el siguiente, y sin ella el
        // compañero volvería a empezar cuando el cliente apruebe.
        evidencia: extra?.colaboracionPendiente
          ? { ...(resultado.evidencia as object), colaboracionPendiente: extra.colaboracionPendiente }
          : resultado.evidencia,
        creditos: resultado.evidencia.creditos + (extra?.creditos ?? 0),
        mensajes: resultado.mensajes,
      });
      await puertos.notificaciones?.avisar({
        workspaceId: tarea.workspaceId,
        taskId: tarea.id,
        tipo: "aprobacion",
        texto: resultado.resumen,
      });
      decir(`en espera · ${resultado.evidencia.aprobacionesPendientes.length} aprobaciones`);
      break;
    }
    case "fallida": {
      await puertos.cola.fallar({
        taskId: tarea.id,
        workerId,
        error: resultado.error,
        motivo: resultado.motivo,
        evidencia: resultado.evidencia,
        // Un freno por fallo repetido volvería a tropezar igual, y empezar
        // de cero podría duplicar lo que ya se creó.
        reintentable:
          resultado.motivo !== "timeout" &&
          resultado.motivo !== "tope_acciones" &&
          !esDefinitivo(resultado.error),
      });
      await puertos.notificaciones?.avisar({
        workspaceId: tarea.workspaceId,
        taskId: tarea.id,
        tipo: "error",
        texto:
          resultado.motivo === "timeout"
            ? `La tarea "${tarea.titulo}" se pasó del tiempo permitido. No dejé cambios sin backup.`
            : resultado.motivo === "tope_acciones"
              ? `Detuve "${tarea.titulo}" porque repetía el mismo fallo. No dejé cambios sin backup: revisa el registro de trabajo y pídemelo de nuevo.`
              : `Algo falló ejecutando "${tarea.titulo}". No dejé cambios sin backup: puedes pedírmelo de nuevo.`,
      });
      decir(`fallo (${resultado.motivo}): ${resultado.error}`);
      break;
    }
  }
}
