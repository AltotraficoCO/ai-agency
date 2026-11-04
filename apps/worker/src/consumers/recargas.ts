/**
 * Recarga automática: cuando se acaba el saldo, se carga la tarjeta registrada.
 *
 * Es dinero del cliente moviéndose sin que él esté mirando, y por eso:
 *
 *  - **Crear la orden y cobrar son dos pasos, en ese orden.** La orden en vuelo
 *    es única por espacio (índice en la migración 0053): si dos procesos deciden
 *    a la vez, uno no llega a llamar a Wompi.
 *  - **Aquí no se abona nada.** Los créditos los abona solo el evento de Wompi,
 *    el mismo camino que una recarga manual.
 *  - **Si no se sabe qué pasó, no se repite enseguida.** Un corte de red puede
 *    haber cobrado igual: la orden se queda pendiente y decide el evento.
 *  - **Tras varios rechazos, o demasiados cobros en un día, se apaga** y se deja
 *    dicho el motivo. Insistir no arregla una tarjeta, y un bucle de gasto debe
 *    verlo una persona.
 */
import {
  cotizar,
  decidirCobroAutomatico,
  type ConfigCobro,
  type EstadoRecarga,
  type MotivoApagado,
} from "@strappy/core/recargas";
import type { LlavesWompi, ResultadoCobro } from "@strappy/core/wompi";
import type { Consumidor } from "./tipos.js";

export type CandidataRecarga = {
  readonly workspaceId: string;
  readonly usd: number;
  readonly fuenteDePago: number;
  readonly correo: string;
  readonly disponible: number;
};

export interface RecargasAutomaticasPort {
  /** Lo guardado en el panel de super admin. Sin llaves completas no se cobra. */
  ajustes(): Promise<{ config: ConfigCobro; llaves: LlavesWompi }>;
  /** Espacios activos con la recarga encendida y el saldo acabado. */
  candidatas(limite: number, umbral: number): Promise<readonly CandidataRecarga[]>;
  /** Órdenes automáticas de las últimas 24 horas, de la más nueva a la más vieja. */
  recientes(workspaceId: string): Promise<readonly { estado: EstadoRecarga; creadaEn: Date }[]>;
  /** `null` si ya hay una orden en vuelo: otro proceso se adelantó. */
  crearOrden(entrada: {
    workspaceId: string;
    usd: number;
    creditos: number;
    trm: number;
    centavos: number;
  }): Promise<{ referencia: string } | null>;
  marcarFallida(referencia: string, motivo: string): Promise<void>;
  /** Caduca las órdenes sin respuesta para que no bloqueen la siguiente. */
  caducarPendientes(): Promise<void>;
  apagar(workspaceId: string, motivo: MotivoApagado): Promise<void>;
}

export type OpcionesConsumidorRecargas = {
  readonly recargas: RecargasAutomaticasPort;
  readonly cobrar: (cobro: {
    llavePrivada: string;
    secretoIntegridad: string;
    fuenteDePago: number;
    referencia: string;
    centavos: number;
    correo: string;
  }) => Promise<ResultadoCobro>;
  readonly obtenerTrm: () => Promise<number | null>;
  readonly ahora?: () => Date;
  readonly log?: (mensaje: string) => void;
};

export class ConsumidorDeRecargasAutomaticas implements Consumidor {
  readonly nombre = "recargas-automaticas";
  readonly #o: OpcionesConsumidorRecargas;

  constructor(o: OpcionesConsumidorRecargas) {
    this.#o = o;
  }

  async tick(): Promise<boolean> {
    const { recargas } = this.#o;
    const log = this.#o.log ?? (() => {});
    const ahora = (this.#o.ahora ?? (() => new Date()))();

    const { config, llaves } = await recargas.ajustes();
    if (!llaves.privada || !llaves.integridad) return false;

    await recargas.caducarPendientes();

    for (const candidata of await recargas.candidatas(20, config.umbralSaldoAcabado)) {
      const recientes = await recargas.recientes(candidata.workspaceId);
      const decision = decidirCobroAutomatico({ disponible: candidata.disponible, recientes, ahora, config });

      if (decision.tipo === "esperar") continue;
      if (decision.tipo === "apagar") {
        await recargas.apagar(candidata.workspaceId, decision.motivo);
        log(`[recargas] apagada en ${candidata.workspaceId}: ${decision.motivo}`);
        return true;
      }

      const trm = await this.#o.obtenerTrm();
      if (trm === null) {
        // Sin TRM no se cotiza, para nadie: se reintenta en la siguiente vuelta.
        log("[recargas] sin TRM: no se cobra nada todavía");
        return false;
      }

      const cotizacion = cotizar(candidata.usd, trm);
      const orden = await recargas.crearOrden({
        workspaceId: candidata.workspaceId,
        usd: cotizacion.usd,
        creditos: cotizacion.creditos,
        trm: cotizacion.trm,
        centavos: cotizacion.centavos,
      });
      if (!orden) continue;

      const resultado = await this.#o.cobrar({
        llavePrivada: llaves.privada,
        secretoIntegridad: llaves.integridad,
        fuenteDePago: candidata.fuenteDePago,
        referencia: orden.referencia,
        centavos: cotizacion.centavos,
        correo: candidata.correo,
      });

      if (resultado.tipo === "rechazado") {
        await recargas.marcarFallida(orden.referencia, resultado.motivo);
        log(`[recargas] Wompi rechazó el cobro de ${candidata.workspaceId}: ${resultado.motivo}`);
      } else if (resultado.tipo === "incierto") {
        log(`[recargas] cobro incierto de ${candidata.workspaceId}, decide el evento: ${resultado.motivo}`);
      } else {
        log(`[recargas] ${candidata.workspaceId}: ${cotizacion.usd} USD enviados a Wompi (${resultado.estado})`);
      }
      return true;
    }
    return false;
  }
}
