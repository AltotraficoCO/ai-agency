/**
 * Consumidor de tareas por encargo.
 *
 * Reclama una tarea, arma el contexto del agente que le toca, ejecuta su bucle
 * de herramientas y escribe el desenlace: resumen legible, lista de acciones,
 * capturas de verificación e identificadores de backup.
 *
 * Decisiones que no son de estilo:
 *  - **Quién ejecuta se lee, no se adivina.** Antes se deducía del tipo del
 *    sitio, que solo valía mientras el único agente por encargo fuera el
 *    Webmaster. Ahora la fila dice `agente` (ver migración 0029) y sin valor se
 *    trata como Webmaster, que es lo que eran todos los encargos de antes.
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
import type { ConocimientoPort, EntradaComunDeAgente, ResultadoTarea } from "@strappy/agentes";
import type { BrowserPort, ReferencePort } from "@strappy/webmaster";
import type { MotorTarea, PuertosWorker, SitioConectado, TareaReclamada } from "../ports.js";
import { RegistroDePasos } from "./pasos.js";
import type { Consumidor } from "./tipos.js";
import { cerrarTarea } from "./tareas/cierre.js";
import { companerosDe, esperaDeUnCompanero, nombreDe, puertoDeColaboracion } from "./tareas/colaboracion.js";
import { agenteDeLaTarea, esDefinitivo, normalizarSlug, oficioDesconocido, type Encargo } from "./tareas/encargo.js";
import {
  ejecutarAdministrativo,
  ejecutarDisenador,
  ejecutarMarketing,
  ejecutarWebmaster,
  type EntornoDeOficio,
} from "./tareas/oficios.js";

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
  /** La base de conocimiento del negocio. Sin ella, los agentes trabajan sin consultarla. */
  readonly conocimiento?: { para(workspaceId: string): Promise<ConocimientoPort | undefined> };
  /**
   * Salida HTTP hacia el sitio del cliente. En producción es el `fetch` del
   * proceso; se inyecta para poder poner delante el doble de la REST API en
   * los tests —o mañana una pasarela que controle la salida a internet— sin
   * parchear nada global.
   */
  readonly fetchSitio?: typeof globalThis.fetch;
  readonly log?: (mensaje: string) => void;
};

export class ConsumidorDeTareas implements Consumidor {
  readonly nombre = "tareas";
  readonly #o: Required<Pick<OpcionesConsumidorTareas, "arrendamientoMs" | "latidoMs">> &
    OpcionesConsumidorTareas;
  #navegadorAbierto: BrowserPort | null = null;
  readonly #oficios: EntornoDeOficio;

  constructor(o: OpcionesConsumidorTareas) {
    if (!o.motorPara && !(o.model && o.modelId && o.rates)) {
      throw new Error("El consumidor de tareas necesita `motorPara` o un modelo fijo con sus tarifas.");
    }
    this.#o = {
      ...o,
      arrendamientoMs: o.arrendamientoMs ?? 11 * 60 * 1000,
      // Cada diez segundos y no cada treinta: este latido es también lo que
      // detecta que el cliente pulsó «Detener», y esperar medio minuto viendo
      // al agente seguir trabajando no es detenerlo.
      latidoMs: o.latidoMs ?? 10_000,
    };
    this.#oficios = {
      puertos: o.puertos,
      comun: (e, slug, agentName) => this.#comun(e, slug, agentName),
      abrirNavegador: (sitio, decir) => this.#abrirNavegador(sitio, decir),
      ...(o.referencias ? { referencias: o.referencias } : {}),
      ...(o.fetchSitio ? { fetchSitio: o.fetchSitio } : {}),
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
    // Lo que el agente va haciendo, guardado en vivo para que la web lo enseñe.
    const registro = new RegistroDePasos({
      previos: tarea.pasos,
      guardar: (pasos) => puertos.cola.registrarPasos({ taskId: tarea.id, workerId, pasos }),
      log: decir,
    });

    // Parar un encargo desde la pantalla del cliente pasa por aquí: la web lo
    // marca `cancelled`, el latido siguiente ya no lo encuentra `running`, y
    // esto aborta lo que el agente esté haciendo. Sin esto no había forma de
    // detener un encargo: había que esperar sus diez minutos viendo cómo
    // gastaba créditos.
    const cancelacion = new AbortController();
    const latido = setInterval(() => {
      void puertos.cola
        .latido({ taskId: tarea.id, workerId, arrendamientoMs: this.#o.arrendamientoMs })
        .then((sigueSiendoNuestra) => {
          if (!sigueSiendoNuestra && !cancelacion.signal.aborted) {
            decir("el encargo se detuvo: lo paró el cliente o lo reclamó otro worker");
            cancelacion.abort();
          }
        })
        .catch(() => {});
    }, this.#o.latidoMs);

    try {
      const motor = await this.#motor(tarea);
      if (motor.saldo && (await motor.saldo()) <= 0) {
        throw new Error(
          "El espacio no tiene créditos disponibles. Recarga créditos para que el agente pueda trabajar.",
        );
      }

      const quien = agenteDeLaTarea(tarea);
      // Lo que gasten los compañeros a los que este agente pida ayuda. El
      // cliente pidió UN trabajo: ve UN cargo, con el reparto en el registro.
      const extra = { creditos: 0 };
      const resultado = await this.#ejecutarAgente(quien, {
        tarea,
        motor,
        registro,
        decir,
        cadena: [],
        senal: cancelacion.signal,
        extra,
      });
      await registro.cerrar(resultado.estado);

      if (motor.cobrar) {
        await motor
          .cobrar({
            creditos: resultado.evidencia.creditos + extra.creditos,
            clave: `${tarea.id}:${intento}`,
            detalle: { estado: resultado.estado, acciones: resultado.evidencia.acciones.length },
          })
          // El trabajo ya está hecho: un fallo al cobrar se registra y se
          // investiga, pero no convierte un cambio aplicado en una tarea fallida.
          .catch((e) => decir(`no se pudo cobrar: ${e instanceof Error ? e.message : String(e)}`));
      }

      await cerrarTarea(this.#o, tarea, resultado, decir, extra);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      await registro.cerrar("fallida");
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

  // -------------------------------------------------------------------------
  // Quién ejecuta, y con quién puede contar
  // -------------------------------------------------------------------------

  /**
   * Enruta al oficio que toca. Un compañero entra por aquí igual que el primero.
   *
   * Un encargo sin `agente` es del Webmaster, porque eso eran todos antes de la
   * 0029. Pero un slug NOMBRADO que este worker no sabe ejecutar se rechaza y se
   * dice, venga de una delegación o del cliente. Caer al Webmaster sería poner a
   * un agente a hacer el trabajo de otro, con las herramientas de otro, sobre el
   * sitio del cliente: el agente financiero acabaría tocando WordPress.
   */
  async #ejecutarAgente(quien: string, e: Encargo): Promise<ResultadoTarea> {
    // Se normaliza AQUI y no en cada entrada: este es el unico punto por el que
    // pasan los dos caminos, el encargo del cliente y la delegacion de un
    // companero. El mensaje de rechazo conserva lo que escribio quien llamo,
    // para que se vea que nombro un oficio que no existe.
    switch (normalizarSlug(quien)) {
      // El Velocista se fusionó en el Webmaster el 22-sep-2026: un encargo
      // viejo con ese oficio lo hace el Webmaster con sus herramientas de
      // velocidad, que son las mismas.
      case "webmaster":
      case "velocista":
        return ejecutarWebmaster(e, this.#oficios);
      case "marketing":
        return ejecutarMarketing(e, this.#oficios);
      case "disenador":
        return ejecutarDisenador(e, this.#oficios);
      // Dos puestos, un mismo paquete: el Administrativo toca la contabilidad y
      // Reportes solo la mira. Comparten adaptador, así que comparten camino.
      case "administrativo":
      case "reportes":
        return ejecutarAdministrativo(e, quien, this.#oficios);
      default:
        return oficioDesconocido(quien, e);
    }
  }

  /**
   * Lo que toda llamada a un bucle de agente lleva igual.
   *
   * Estaban copiadas doce líneas en cada rama. No es sólo ruido: si a una se le
   * olvidaran los mensajes previos, ese agente perdería la conversación al
   * reanudar tras una aprobación, y no daría ningún error.
   */
  async #comun(e: Encargo, slug: string, agentName: string): Promise<EntradaComunDeAgente> {
    const { tarea, motor, registro, decir } = e;
    const { nomina } = this.#o.puertos;
    const colaboracion = nomina
      ? puertoDeColaboracion(slug, e, nomina, (quien, encargo) => this.#ejecutarAgente(quien, encargo))
      : null;
    const companeros = await companerosDe(nomina, slug, tarea.workspaceId);
    // El nombre manda desde `agents`: el que guardó cada conexión al crearse
    // («Larry») se queda viejo cuando el agente pasa a llamarse como su puesto.
    // Un compañero al que se le pidió ayuda comparte el encargo (y su agentId)
    // con quien lo llamó: su nombre sale de la nómina por su oficio, no del
    // agente del encargo, o el registro diría que el Webmaster es el Velocista.
    const nombreReal = e.delegado
      ? await nombreDe(nomina, tarea.workspaceId, slug)
      : tarea.agentId && nomina
        ? await nomina.nombreDe({ workspaceId: tarea.workspaceId, agentId: tarea.agentId })
        : null;
    // Lo que el negocio guardó en su base de conocimiento: todos los agentes lo
    // consultan. Si falla la lectura, el agente trabaja sin él en vez de caerse.
    const conocimiento = this.#o.conocimiento
      ? await this.#o.conocimiento.para(tarea.workspaceId).catch(() => undefined)
      : undefined;
    return {
      model: motor.model,
      modelId: motor.modelId,
      rates: motor.rates,
      workspaceId: tarea.workspaceId,
      ...(conocimiento ? { conocimiento } : {}),
      ...(tarea.agentId ? { agentId: tarea.agentId } : {}),
      agentName: nombreReal ?? agentName,
      tarea: e.delegado
        ? { id: tarea.id, titulo: e.delegado.titulo, detalle: e.delegado.detalle }
        : { id: tarea.id, titulo: tarea.titulo, detalle: tarea.detalle },
      ...(companeros.length > 0 && colaboracion
        ? { companeros, colaboracion, cadena: e.cadena }
        : {}),
      ...(tarea.mensajes ? { mensajesPrevios: tarea.mensajes as ModelMessage[] } : {}),
      // Si lo que quedó esperando fue la parte de un COMPAÑERO, las decisiones
      // no son de este agente: sus huellas apuntan a herramientas que él no
      // tiene. Se las lleva el compañero cuando se le vuelva a pedir ayuda, y
      // aquí se entra con el aviso de reanudación en su lugar.
      ...(tarea.aprobaciones && !esperaDeUnCompanero(tarea)
        ? { aprobaciones: tarea.aprobaciones as ToolApprovalResponse[] }
        : {}),
      abortSignal: e.senal,
      onEvento: decir,
      alAvanzar: (paso) => registro.anotar(paso),
    };
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
