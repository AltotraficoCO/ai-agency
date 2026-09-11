/**
 * Consumidor de tareas por encargo.
 *
 * Reclama una tarea, arma el contexto del sitio, ejecuta el bucle de
 * herramientas del Webmaster y escribe el desenlace: resumen legible, lista de
 * acciones, capturas de verificación e identificadores de backup.
 *
 * Decisiones que no son de estilo:
 *  - Las credenciales se descifran aquí y viven solo en el contexto que se
 *    inyecta a las herramientas. Nunca entran al prompt.
 *  - Mientras la tarea corre se renueva el arrendamiento. Una tarea de nueve
 *    minutos sin latido la recogería otro worker a mitad de camino.
 *  - Un fallo de credenciales, de configuración o de saldo NO se reintenta:
 *    reintentar algo que va a fallar igual es gastar créditos del cliente tres
 *    veces.
 *  - El modelo se elige por tarea (`motorPara`), según el plan del espacio, y lo
 *    gastado se cobra al terminar el intento, también si falló: los tokens ya
 *    se consumieron.
 */
import { randomUUID } from "node:crypto";
import type { LanguageModel, ModelMessage, ToolApprovalResponse } from "ai";
import type { RateTable } from "@strappy/core";
import {
  agentePara,
  ejecutarTareaWebmaster,
  type BrowserPort,
  type ConectorCreds,
  type ReferencePort,
  type SitioContext,
  type WpCreds,
} from "@strappy/webmaster";
import type { MotorTarea, PuertosWorker, SitioConectado, TareaReclamada } from "../ports.js";
import type { Consumidor } from "./tipos.js";

export type OpcionesConsumidorTareas = {
  readonly puertos: PuertosWorker;
  readonly workerId: string;
  /**
   * Modelo, tarifas y cobro de cada tarea. En producción sale del plan del
   * espacio; sin él se usan `model`, `modelId` y `rates` fijos (tests y pruebas).
   */
  readonly motorPara?: (tarea: TareaReclamada) => Promise<MotorTarea>;
  readonly model?: LanguageModel;
  readonly modelId?: string;
  readonly rates?: RateTable;
  /** Cuánto dura el arrendamiento de una tarea reclamada. */
  readonly arrendamientoMs?: number;
  /** Cada cuánto se renueva mientras la tarea corre. */
  readonly latidoMs?: number;
  /** Fábrica del navegador. Sin ella no hay verificación visual, y se dice. */
  readonly navegadorPara?: (sitio: SitioConectado) => Promise<BrowserPort>;
  readonly referencias?: ReferencePort;
  /**
   * Salida HTTP hacia el sitio del cliente. En producción es el `fetch` del
   * proceso; se inyecta para poder poner delante el doble de la REST API en
   * los tests —o mañana una pasarela que controle la salida a internet— sin
   * parchear nada global.
   */
  readonly fetchSitio?: typeof globalThis.fetch;
  readonly log?: (mensaje: string) => void;
};

/** Errores que no tiene sentido reintentar: fallarán igual la próxima vez. */
function esDefinitivo(mensaje: string): boolean {
  return /credencial|indescifrable|no está conectado|desconocid|inválid|APP_ENCRYPTION_KEY|créditos disponibles|OPENROUTER_API_KEY|AI_GATEWAY_API_KEY/i.test(
    mensaje,
  );
}

export class ConsumidorDeTareas implements Consumidor {
  readonly nombre = "tareas";
  readonly #o: Required<Pick<OpcionesConsumidorTareas, "arrendamientoMs" | "latidoMs">> &
    OpcionesConsumidorTareas;
  #navegadorAbierto: BrowserPort | null = null;

  constructor(o: OpcionesConsumidorTareas) {
    if (!o.motorPara && !(o.model && o.modelId && o.rates)) {
      throw new Error("El consumidor de tareas necesita `motorPara` o un modelo fijo con sus tarifas.");
    }
    this.#o = {
      ...o,
      arrendamientoMs: o.arrendamientoMs ?? 11 * 60 * 1000,
      latidoMs: o.latidoMs ?? 30_000,
    };
  }

  async tick(): Promise<boolean> {
    const { puertos, workerId } = this.#o;
    const tarea = await puertos.cola.reclamar({
      workerId,
      arrendamientoMs: this.#o.arrendamientoMs,
    });
    if (!tarea) return false;
    await this.#procesar(tarea);
    return true;
  }

  async cerrar(): Promise<void> {
    await this.#navegadorAbierto?.cerrar().catch(() => {});
    this.#navegadorAbierto = null;
  }

  async #motor(tarea: TareaReclamada): Promise<MotorTarea> {
    if (this.#o.motorPara) return this.#o.motorPara(tarea);
    const { model, modelId, rates } = this.#o;
    if (!model || !modelId || !rates) throw new Error("Sin modelo configurado para la tarea.");
    return { model, modelId, rates };
  }

  async #procesar(tarea: TareaReclamada): Promise<void> {
    const { puertos, workerId } = this.#o;
    const log = this.#o.log ?? (() => {});
    const decir = (m: string) => log(`[tarea ${tarea.id}] ${m}`);
    // Una clave por intento: reanudar tras una aprobación es otro gasto, pero
    // reintentar el cobro de ESTE intento no debe cobrarlo dos veces.
    const intento = randomUUID();

    const latido = setInterval(() => {
      void puertos.cola
        .latido({ taskId: tarea.id, workerId, arrendamientoMs: this.#o.arrendamientoMs })
        .catch(() => {});
    }, this.#o.latidoMs);

    try {
      const sitio = await puertos.sitios.cargar({
        workspaceId: tarea.workspaceId,
        siteId: tarea.siteId,
      });
      if (!sitio) {
        throw new Error(
          "El sitio no está conectado. El cliente debe conectarlo antes de que pueda trabajar en él.",
        );
      }

      const motor = await this.#motor(tarea);
      if (motor.saldo && (await motor.saldo()) <= 0) {
        throw new Error(
          "El espacio no tiene créditos disponibles. Recarga créditos para que el agente pueda trabajar.",
        );
      }

      const agent = agentePara(sitio.tipo);
      decir(
        `"${tarea.titulo}" → ${agent.slug} @ ${sitio.url} · ${motor.modelId}${motor.modo ? ` (${motor.modo})` : ""}` +
          (sitio.primerContacto ? " (simulación)" : ""),
      );

      const navegador = await this.#abrirNavegador(sitio, decir);
      const contextoSitio: SitioContext = {
        siteId: sitio.id,
        taskId: tarea.id,
        tipo: sitio.tipo,
        ...(sitio.tipo === "custom"
          ? { conector: sitio.credenciales as ConectorCreds }
          : { wp: sitio.credenciales as WpCreds }),
        backups: puertos.backups,
        approvals: puertos.aprobaciones,
        ...(navegador ? { browser: navegador } : {}),
        ...(this.#o.referencias ? { referencias: this.#o.referencias } : {}),
        ...(this.#o.fetchSitio ? { fetch: this.#o.fetchSitio } : {}),
        primerContacto: sitio.primerContacto,
      };

      const resultado = await ejecutarTareaWebmaster({
        agent,
        model: motor.model,
        modelId: motor.modelId,
        rates: motor.rates,
        workspaceId: tarea.workspaceId,
        ...(tarea.agentId ? { agentId: tarea.agentId } : {}),
        agentName: sitio.agentName,
        sitio: contextoSitio,
        tarea: { id: tarea.id, titulo: tarea.titulo, detalle: tarea.detalle },
        ...(tarea.mensajes ? { mensajesPrevios: tarea.mensajes as ModelMessage[] } : {}),
        ...(tarea.aprobaciones
          ? { aprobaciones: tarea.aprobaciones as ToolApprovalResponse[] }
          : {}),
        onEvento: decir,
      });

      if (motor.cobrar) {
        await motor
          .cobrar({
            creditos: resultado.evidencia.creditos,
            clave: `${tarea.id}:${intento}`,
            detalle: { estado: resultado.estado, acciones: resultado.evidencia.acciones.length },
          })
          // El trabajo ya está hecho: un fallo al cobrar se registra y se
          // investiga, pero no convierte un cambio aplicado en una tarea fallida.
          .catch((e) => decir(`no se pudo cobrar: ${e instanceof Error ? e.message : String(e)}`));
      }

      // Con simulación no se tocó el sitio, así que sigue siendo primer
      // contacto: el próximo encargo ejecuta de verdad solo si esta vez se
      // ejecutó de verdad.
      if (!resultado.evidencia.simulacion && resultado.estado !== "fallida") {
        await puertos.sitios.marcarTocado({
          workspaceId: tarea.workspaceId,
          siteId: sitio.id,
        });
      }

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
          decir(`listo · ${resultado.evidencia.acciones.length} acciones, ${resultado.evidencia.creditos} créditos`);
          break;
        }
        case "esperando_aprobacion": {
          await puertos.cola.suspender({
            taskId: tarea.id,
            workerId,
            resumen: resultado.resumen,
            evidencia: resultado.evidencia,
            creditos: resultado.evidencia.creditos,
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
            reintentable: resultado.motivo !== "timeout" && !esDefinitivo(resultado.error),
          });
          await puertos.notificaciones?.avisar({
            workspaceId: tarea.workspaceId,
            taskId: tarea.id,
            tipo: "error",
            texto:
              resultado.motivo === "timeout"
                ? `La tarea "${tarea.titulo}" se pasó del tiempo permitido. No dejé cambios sin backup.`
                : `Algo falló ejecutando "${tarea.titulo}". No dejé cambios sin backup: puedes pedírmelo de nuevo.`,
          });
          decir(`fallo (${resultado.motivo}): ${resultado.error}`);
          break;
        }
      }
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      await puertos.cola
        .fallar({
          taskId: tarea.id,
          workerId,
          error: mensaje.slice(0, 500),
          motivo: "error",
          evidencia: null,
          reintentable: !esDefinitivo(mensaje),
        })
        .catch(() => {});
      decir(`fallo antes de arrancar: ${mensaje}`);
    } finally {
      clearInterval(latido);
      await this.cerrar();
    }
  }

  async #abrirNavegador(
    sitio: SitioConectado,
    decir: (m: string) => void,
  ): Promise<BrowserPort | null> {
    if (!this.#o.navegadorPara) return null;
    try {
      this.#navegadorAbierto = await this.#o.navegadorPara(sitio);
      return this.#navegadorAbierto;
    } catch (e) {
      // Sin navegador la tarea se hace igual, con verificación más pobre. Es
      // peor callarlo: el cliente tiene derecho a saber cómo se verificó.
      decir(`sin navegador: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
}
