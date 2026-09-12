/**
 * Consumidor del trabajo programado: los agentes trabajan sin que se lo pidan.
 *
 * «Cada mañana revisa qué vence», «todos los lunes mándame el informe». Cuando
 * llega la hora, esto crea el encargo; quien lo ejecuta es el consumidor de
 * tareas de siempre.
 *
 * Cuatro decisiones que no son de estilo:
 *
 *  - **No ejecuta agentes, crea encargos.** Así el trabajo programado hereda el
 *    enrutado por agente, las aprobaciones, el registro en vivo y el cobro, en
 *    vez de tener su propia versión de todo eso.
 *  - **Nunca se auto-aprueba nada.** Si el encargo acaba pidiendo permiso, queda
 *    esperando igual que si lo hubiera escrito el cliente. Que el trabajo sea
 *    automático no convierte en automático el permiso para gastar su dinero.
 *  - **Sin saldo se pausa, no se insiste.** Un programado que falla cada mañana
 *    llena la pantalla del cliente de errores y no arregla nada.
 *  - **Lo atrasado se salta.** Un informe del lunes entregado el miércoles es
 *    peor que no entregarlo (ver `decidirEjecucion`).
 */
import { decidirEjecucion, describirCadencia } from "@strappy/core";
import type { ProgramadorPort } from "../ports.js";
import type { Consumidor } from "./tipos.js";

export type OpcionesConsumidorProgramados = {
  readonly programador: ProgramadorPort;
  readonly workerId: string;
  /** Cuánto se reserva un programado mientras se crea su encargo. */
  readonly arrendamientoMs?: number;
  /** Cada cuánto se apagan los programados de agentes dados de baja. */
  readonly sincronizarCadaMs?: number;
  /** Inyectable para los tests; en producción es el reloj. */
  readonly ahora?: () => Date;
  readonly log?: (mensaje: string) => void;
};

export class ConsumidorDeProgramados implements Consumidor {
  readonly nombre = "programados";
  readonly #o: OpcionesConsumidorProgramados;
  #ultimaSincronizacion = 0;

  constructor(o: OpcionesConsumidorProgramados) {
    this.#o = o;
  }

  async tick(): Promise<boolean> {
    const ahora = (this.#o.ahora ?? (() => new Date()))();
    await this.#sincronizarSiToca(ahora.getTime());

    const programado = await this.#o.programador.reclamar({
      workerId: this.#o.workerId,
      arrendamientoMs: this.#o.arrendamientoMs ?? 60_000,
    });
    if (!programado) return false;

    const log = this.#o.log ?? (() => {});
    const { id, workspaceId, titulo, cadencia } = programado;
    const decision = decidirEjecucion(programado.previstaEn, ahora, cadencia);

    if (!decision.ejecutar) {
      await this.#o.programador.reprogramar({
        id,
        workerId: this.#o.workerId,
        proxima: decision.proxima,
      });
      log(`[programados] "${titulo}" se saltó por llegar tarde · próxima ${decision.proxima.toISOString()}`);
      return true;
    }

    // Cada ejecución es un encargo normal y cuesta créditos. Crear encargos que
    // van a fallar por saldo sería llenarle la pantalla de errores al cliente.
    let saldo = 1;
    try {
      saldo = await this.#o.programador.saldo(workspaceId);
    } catch (e) {
      // Si no se puede leer el saldo, se intenta igual: el consumidor de tareas
      // vuelve a comprobarlo antes de gastar nada.
      log(`[programados] no pude leer el saldo de ${workspaceId}: ${mensajeDe(e)}`);
    }
    if (saldo <= 0) {
      await this.#o.programador.pausar({
        id,
        workerId: this.#o.workerId,
        motivo: "sin_creditos",
      });
      log(`[programados] "${titulo}" en pausa: el espacio se quedó sin créditos`);
      return true;
    }

    try {
      const taskId = await this.#o.programador.lanzar({
        id,
        workerId: this.#o.workerId,
        programado,
        proxima: decision.proxima,
      });
      log(
        `[programados] "${titulo}" → encargo ${taskId ?? "(sin id)"} · ${describirCadencia(cadencia)}` +
          ` · próxima ${decision.proxima.toISOString()}`,
      );
    } catch (e) {
      // Que falle la creación no puede dejar el programado bloqueado hasta que
      // expire el arrendamiento: se reprograma y se intentará a la hora que toca.
      log(`[programados] "${titulo}" no se pudo encargar: ${mensajeDe(e)}`);
      await this.#o.programador
        .reprogramar({ id, workerId: this.#o.workerId, proxima: decision.proxima })
        .catch(() => {});
    }
    return true;
  }

  async #sincronizarSiToca(ahoraMs: number): Promise<void> {
    const cada = this.#o.sincronizarCadaMs ?? 10 * 60 * 1000;
    if (ahoraMs - this.#ultimaSincronizacion < cada) return;
    this.#ultimaSincronizacion = ahoraMs;
    try {
      const apagados = await this.#o.programador.sincronizar();
      if (apagados > 0) {
        this.#o.log?.(`[programados] ${apagados} en pausa: su agente ya no está contratado`);
      }
    } catch (e) {
      this.#o.log?.(`[programados] no pude revisar las bajas: ${mensajeDe(e)}`);
    }
  }
}

function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
