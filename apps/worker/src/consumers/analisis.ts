/**
 * Consumidor de análisis post-conversación.
 *
 * Cerrar una conversación encola un trabajo; este consumidor lo reclama y hace
 * la única pasada de análisis. Vive en el worker y no en la web por dos
 * razones: la llamada al modelo no puede colgar de una petición HTTP, y el
 * reintento tiene que ser de la cola, no del navegador de nadie.
 *
 * Todo lo que toca base de datos entra por puertos de `@strappy/analysis`: el
 * worker no conoce ni una tabla de este dominio.
 */
import {
  analizarConversacion,
  type ColaDeAnalisisPort,
  type DepsAnalisis,
  type TranscriptoPort,
} from "@strappy/analysis";
import type { Consumidor } from "./tipos.js";

export type OpcionesConsumidorAnalisis = {
  readonly cola: ColaDeAnalisisPort;
  readonly transcriptos: TranscriptoPort;
  /** Modelo, agentes, almacén y —si las hay— automatizaciones. */
  readonly analisis: DepsAnalisis;
  readonly workerId: string;
  readonly arrendamientoMs?: number;
  /** A partir de aquí, el trabajo se deja morir en vez de seguir reintentando. */
  readonly intentosMaximos?: number;
  readonly log?: (mensaje: string) => void;
};

/** Un fallo de configuración fallará igual la próxima vez: no se reintenta. */
function esDefinitivo(mensaje: string): boolean {
  return /desconocid|inválid|invalid|no existe|sin permiso/i.test(mensaje);
}

export class ConsumidorDeAnalisis implements Consumidor {
  readonly nombre = "analisis";
  readonly #o: OpcionesConsumidorAnalisis;

  constructor(o: OpcionesConsumidorAnalisis) {
    this.#o = o;
  }

  async tick(): Promise<boolean> {
    const { cola, transcriptos, workerId, log } = this.#o;
    const trabajo = await cola.reclamar({
      workerId,
      arrendamientoMs: this.#o.arrendamientoMs ?? 2 * 60 * 1000,
    });
    if (!trabajo) return false;

    try {
      const transcripto = await transcriptos.cargar({
        workspaceId: trabajo.workspaceId,
        conversationId: trabajo.conversationId,
      });
      if (!transcripto) {
        // La conversación pudo borrarse entre el cierre y el análisis. No es un
        // error del sistema: es un trabajo que ya no tiene objeto.
        await cola.fallar({ id: trabajo.id, workerId, error: "conversación inexistente", reintentable: false });
        return true;
      }

      const salida = await analizarConversacion(this.#o.analisis, {
        ...transcripto,
        motivoCierre: trabajo.motivoCierre,
      });
      if (!salida) {
        await cola.fallar({ id: trabajo.id, workerId, error: "agente desconocido", reintentable: false });
        return true;
      }

      await cola.completar({ id: trabajo.id, workerId, analisisId: salida.analisisId });
      log?.(
        `[analisis] ${trabajo.conversationId} · objetivo ${salida.resultado.objetivoScore}/100 · ` +
          `${salida.automatizaciones.length} automatización(es)`,
      );
      return true;
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      const agotado = trabajo.intentos + 1 >= (this.#o.intentosMaximos ?? 3);
      await cola
        .fallar({ id: trabajo.id, workerId, error: mensaje, reintentable: !agotado && !esDefinitivo(mensaje) })
        .catch(() => {});
      log?.(`[analisis] ${trabajo.conversationId} falló: ${mensaje}`);
      return true;
    }
  }
}
