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
import type {
  ColaboracionPort,
  Companero,
  EncargoDelegado,
  EntradaComunDeAgente,
  ResultadoTarea,
} from "@strappy/agentes";
import {
  agentePara,
  ejecutarTareaWebmaster,
  type BrowserPort,
  type ConectorCreds,
  type ReferencePort,
  type SitioContext,
  type WpCreds,
} from "@strappy/webmaster";
import { ejecutarTareaMarketing, marketing, type CuentasContext } from "@strappy/marketing";
import {
  administrativo,
  AGENTES as AGENTES_ADMINISTRATIVOS,
  ejecutarTareaAdministrativa,
  type LibrosContext,
} from "@strappy/administrativo";
import {
  disenador,
  ejecutarTareaDisenador,
  type DisenoContext,
} from "@strappy/disenador";
import {
  ejecutarTareaVelocista,
  velocista,
  type Medicion,
  type VelocidadContext,
} from "@strappy/velocista";
import type {
  CuentasDeMarketing,
  EstudioDeDiseno,
  LibrosDelNegocio,
  MotorTarea,
  PuertosWorker,
  SitioConectado,
  TareaReclamada,
  VelocidadDelSitio,
} from "../ports.js";
import { RegistroDePasos } from "./pasos.js";
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

/**
 * Todo lo que un encargo arrastra mientras se ejecuta.
 *
 * Iba como siete parámetros posicionales repetidos en la firma de cada rama.
 * Varios eran del mismo tipo, así que cambiarlos de orden por error no daba
 * ningún aviso del compilador: compilaba y se comportaba mal.
 */
type Encargo = {
  readonly tarea: TareaReclamada;
  readonly motor: MotorTarea;
  readonly registro: RegistroDePasos;
  readonly decir: (m: string) => void;
  /** Agentes que ya intervinieron, del primero al actual. Vacío si lo pidió una persona. */
  readonly cadena: readonly string[];
  /** Lo que gastan los compañeros. Se acumula para cobrarlo todo junto una vez. */
  readonly extra: { creditos: number };
  /** El trabajo que le encarga un compañero, cuando no es el encargo del cliente. */
  readonly delegado?: { titulo: string; detalle: string };
};

/** Errores que no tiene sentido reintentar: fallarán igual la próxima vez. */
function esDefinitivo(mensaje: string): boolean {
  return /credencial|indescifrable|no está conectado|desconocid|inválid|APP_ENCRYPTION_KEY|créditos disponibles|OPENROUTER_API_KEY|AI_GATEWAY_API_KEY/i.test(
    mensaje,
  );
}

/**
 * El slug con el que se busca el oficio.
 *
 * Se compara en minúsculas y sin espacios porque llega de dos sitios distintos:
 * la columna `agente` de la tarea y el `slug` que un agente escribe al pedirle
 * ayuda a un compañero. Un modelo que escriba «Velocista » con mayúscula o con
 * un espacio de más nombraba un oficio que existe y se llevaba un rechazo.
 */
function normalizarSlug(valor: string): string {
  return valor.trim().toLowerCase();
}

/** Quién ejecuta el encargo. Sin valor, el Webmaster: es lo que eran todos. */
function agenteDeLaTarea(tarea: TareaReclamada): string {
  return normalizarSlug(tarea.agente ?? "webmaster") || "webmaster";
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
    // Lo que el agente va haciendo, guardado en vivo para que la web lo enseñe.
    const registro = new RegistroDePasos({
      previos: tarea.pasos,
      guardar: (pasos) => puertos.cola.registrarPasos({ taskId: tarea.id, workerId, pasos }),
      log: decir,
    });

    const latido = setInterval(() => {
      void puertos.cola
        .latido({ taskId: tarea.id, workerId, arrendamientoMs: this.#o.arrendamientoMs })
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

      await this.#cerrarTarea(tarea, resultado, decir);
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
      case "webmaster":
        return this.#ejecutarWebmaster(e);
      case "marketing":
        return this.#ejecutarMarketing(e);
      case "disenador":
        return this.#ejecutarDisenador(e);
      case "velocista":
        return this.#ejecutarVelocista(e);
      // Dos puestos, un mismo paquete: el Administrativo toca la contabilidad y
      // Reportes solo la mira. Comparten adaptador, así que comparten camino.
      case "administrativo":
      case "reportes":
        return this.#ejecutarAdministrativo(e, quien);
      default:
        return this.#oficioDesconocido(quien, e);
    }
  }

  /**
   * Se devuelve como fallo del compañero, no como excepción: el que pidió ayuda
   * tiene que poder terminar su parte y contarlo. Tumbar un encargo que el
   * cliente ya aprobó por esto sería desproporcionado.
   */
  #oficioDesconocido(quien: string, e: Encargo): ResultadoTarea {
    e.decir(`no puedo delegar en "${quien}": ese oficio todavía no se ejecuta aquí`);
    return {
      estado: "fallida",
      motivo: "error",
      error: `Todavía no puedo encargarle trabajo a "${quien}" desde otro agente.`,
      evidencia: {
        acciones: [],
        capturas: [],
        backups: [],
        aprobacionesPendientes: [],
        pasos: 0,
        uso: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        creditos: 0,
        modelo: e.motor.modelId,
        simulacion: false,
      },
    };
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
    const colaboracion = this.#colaboracion(slug, e);
    const companeros = await this.#companeros(slug, tarea.workspaceId);
    return {
      model: motor.model,
      modelId: motor.modelId,
      rates: motor.rates,
      workspaceId: tarea.workspaceId,
      ...(tarea.agentId ? { agentId: tarea.agentId } : {}),
      agentName,
      tarea: e.delegado
        ? { id: tarea.id, titulo: e.delegado.titulo, detalle: e.delegado.detalle }
        : { id: tarea.id, titulo: tarea.titulo, detalle: tarea.detalle },
      ...(companeros.length > 0 && colaboracion
        ? { companeros, colaboracion, cadena: e.cadena }
        : {}),
      ...(tarea.mensajes ? { mensajesPrevios: tarea.mensajes as ModelMessage[] } : {}),
      ...(tarea.aprobaciones ? { aprobaciones: tarea.aprobaciones as ToolApprovalResponse[] } : {}),
      onEvento: decir,
      alAvanzar: (paso) => registro.anotar(paso),
    };
  }

  /**
   * Con quién puede contar el agente y cómo se le encarga trabajo a uno.
   *
   * El compañero se ejecuta con SU contexto y SUS aprobaciones: aquí solo se
   * enruta. Comparte el `taskId` a propósito, para que el cliente vea un único
   * encargo con todo lo que pasó dentro, y sus créditos se suman al mismo cargo.
   */
  #colaboracion(quien: string, e: Encargo): ColaboracionPort | null {
    const nomina = this.#o.puertos.nomina;
    if (!nomina) return null;

    const puerto: ColaboracionPort = {
      companeros: () => nomina.companeros({ workspaceId: e.tarea.workspaceId, exceptoSlug: quien }),
      encargar: async (input: EncargoDelegado): Promise<ResultadoTarea> => {
        e.decir(`${quien} le pide ayuda a ${input.slug}: "${input.titulo}"`);
        const resultado = await this.#ejecutarAgente(input.slug, {
          ...e,
          cadena: [...e.cadena, quien],
          delegado: { titulo: input.titulo, detalle: input.detalle },
        });
        e.extra.creditos += resultado.evidencia.creditos;
        e.decir(
          `${input.slug} terminó (${resultado.estado}) · ${resultado.evidencia.creditos} créditos`,
        );
        return resultado;
      },
    };
    return puerto;
  }

  /** La nómina, ya resuelta, para ofrecérsela al modelo en su prompt. */
  async #companeros(quien: string, workspaceId: string): Promise<readonly Companero[]> {
    const nomina = this.#o.puertos.nomina;
    if (!nomina) return [];
    try {
      return await nomina.companeros({ workspaceId, exceptoSlug: quien });
    } catch {
      // Quedarse sin compañeros es trabajar solo, que es lo de siempre. No es
      // motivo para tumbar un encargo que el cliente ya aprobó.
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Cada oficio: cargar lo suyo y lanzarlo. Lo demás ya es común.
  // -------------------------------------------------------------------------

  async #ejecutarWebmaster(e: Encargo): Promise<ResultadoTarea> {
    const { tarea, motor, decir } = e;
    const { puertos } = this.#o;
    if (!tarea.siteId) {
      throw new Error(
        "El sitio no está conectado. El cliente debe conectarlo antes de que pueda trabajar en él.",
      );
    }
    const sitio = await puertos.sitios.cargar({
      workspaceId: tarea.workspaceId,
      siteId: tarea.siteId,
    });
    if (!sitio) {
      throw new Error(
        "El sitio no está conectado. El cliente debe conectarlo antes de que pueda trabajar en él.",
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
      ...(await this.#comun(e, "webmaster", sitio.agentName)),
      agent,
      sitio: contextoSitio,
    });

    // Con simulación no se tocó el sitio, así que sigue siendo primer
    // contacto: el próximo encargo ejecuta de verdad solo si esta vez se
    // ejecutó de verdad.
    if (!resultado.evidencia.simulacion && resultado.estado !== "fallida") {
      await puertos.sitios.marcarTocado({ workspaceId: tarea.workspaceId, siteId: sitio.id });
    }
    return resultado;
  }

  async #ejecutarMarketing(e: Encargo): Promise<ResultadoTarea> {
    const { tarea, motor, decir } = e;
    const { puertos } = this.#o;
    const cuentas: CuentasDeMarketing = puertos.cuentas
      ? await puertos.cuentas.cargar({
          workspaceId: tarea.workspaceId,
          conexionId: tarea.siteId,
        })
      : {
          conexionId: tarea.siteId,
          ads: [],
          negocio: "tu negocio",
          agentName: marketing.label,
        };

    decir(
      `"${tarea.titulo}" → ${marketing.slug} · ${cuentas.ads.length} plataforma(s) · ` +
        `${motor.modelId}${motor.modo ? ` (${motor.modo})` : ""}` +
        (cuentas.primerContacto ? " (simulación)" : ""),
    );

    const contexto: CuentasContext = {
      conexionId: cuentas.conexionId ?? "",
      taskId: tarea.id,
      ads: cuentas.ads,
      ...(cuentas.analytics ? { analytics: cuentas.analytics } : {}),
      approvals: puertos.aprobaciones,
      // El backup solo tiene dónde colgarse si hay conexión: sin ella no hay
      // nada que revertir todavía.
      ...(cuentas.conexionId ? { backups: puertos.backups } : {}),
      ...(cuentas.primerContacto ? { primerContacto: true } : {}),
    };

    return ejecutarTareaMarketing({
      ...(await this.#comun(e, "marketing", cuentas.agentName)),
      agent: marketing,
      negocio: cuentas.negocio,
      cuentas: contexto,
    });
  }

  /**
   * El compañero más pedido de la oficina.
   *
   * Dos cosas propias suyas: el estudio se arma con el MODO de la tarea (el
   * modelo de imagen sale de `model_tiers`, fila `imagen`, igual que el de
   * texto sale de `negocio`), y su conexión es el sitio del cliente, que es
   * donde acaban las imágenes que publica.
   */
  async #ejecutarDisenador(e: Encargo): Promise<ResultadoTarea> {
    const { tarea, motor, decir } = e;
    const { puertos } = this.#o;
    const estudio: EstudioDeDiseno = puertos.estudio
      ? await puertos.estudio.cargar({
          workspaceId: tarea.workspaceId,
          siteId: tarea.siteId,
          taskId: tarea.id,
          modo: motor.modo ?? "lite",
        })
      : {
          conexionId: tarea.siteId,
          negocio: "tu negocio",
          agentName: disenador.label,
        };

    decir(
      `"${tarea.titulo}" → ${disenador.slug} · ` +
        `${estudio.imagenes ? estudio.imagenes.modelo : "sin generador de imágenes"} · ` +
        `${estudio.medios ? estudio.medios.sitio : "sin sitio donde publicar"}` +
        (estudio.estilo ? " · con los colores del sitio" : " · sin colores medidos") +
        (estudio.primerContacto ? " (simulación)" : ""),
    );

    const contexto: DisenoContext = {
      conexionId: estudio.conexionId ?? "",
      taskId: tarea.id,
      ...(estudio.imagenes ? { imagenes: estudio.imagenes } : {}),
      ...(estudio.medios ? { medios: estudio.medios } : {}),
      ...(estudio.estilo ? { estilo: estudio.estilo } : {}),
      approvals: puertos.aprobaciones,
      ...(estudio.primerContacto ? { primerContacto: true } : {}),
    };

    return ejecutarTareaDisenador({
      ...(await this.#comun(e, "disenador", estudio.agentName)),
      agent: disenador,
      negocio: estudio.negocio,
      diseno: contexto,
    });
  }

  async #ejecutarAdministrativo(e: Encargo, quien: string): Promise<ResultadoTarea> {
    const { tarea, motor, decir } = e;
    const { puertos } = this.#o;
    // El oficio decide qué herramientas tiene: Reportes no lleva las que
    // escriben, así que no puede emitir nada aunque se lo pidan.
    // Sin respaldo a `administrativo`: era una red que dependia de quien
    // llamara. Hoy el enrutado solo manda aqui dos slugs, pero un tercero
    // acabaria emitiendo facturas con el oficio equivocado en vez de fallar.
    const oficio = AGENTES_ADMINISTRATIVOS[normalizarSlug(quien)];
    if (!oficio) return this.#oficioDesconocido(quien, e);
    const libros: LibrosDelNegocio = puertos.libros
      ? await puertos.libros.cargar({
          workspaceId: tarea.workspaceId,
          conexionId: tarea.siteId,
        })
      : {
          conexionId: tarea.siteId,
          negocio: "tu negocio",
          agentName: oficio.label,
        };

    decir(
      `"${tarea.titulo}" → ${oficio.slug} · ` +
        `${libros.contabilidad ? libros.contabilidad.sistema : "sin contabilidad conectada"} · ` +
        `${motor.modelId}${motor.modo ? ` (${motor.modo})` : ""}` +
        (libros.primerContacto ? " (simulación)" : ""),
    );

    const contexto: LibrosContext = {
      conexionId: libros.conexionId ?? "",
      taskId: tarea.id,
      ...(libros.contabilidad ? { contabilidad: libros.contabilidad } : {}),
      approvals: puertos.aprobaciones,
      // El backup solo tiene dónde colgarse si hay conexión: sin ella no hay
      // nada que revertir todavía.
      ...(libros.conexionId ? { backups: puertos.backups } : {}),
      ...(libros.primerContacto ? { primerContacto: true } : {}),
    };

    return ejecutarTareaAdministrativa({
      ...(await this.#comun(e, oficio.slug, libros.agentName)),
      agent: oficio,
      negocio: libros.negocio,
      libros: contexto,
      ...(libros.secretos ? { secretos: libros.secretos } : {}),
    });
  }

  async #ejecutarVelocista(e: Encargo): Promise<ResultadoTarea> {
    const { tarea, motor, decir } = e;
    const { puertos } = this.#o;
    const velocidad: VelocidadDelSitio = puertos.velocidad
      ? await puertos.velocidad.cargar({
          workspaceId: tarea.workspaceId,
          conexionId: tarea.siteId,
        })
      : {
          conexionId: tarea.siteId,
          negocio: "tu negocio",
          agentName: velocista.label,
        };

    decir(
      `"${tarea.titulo}" → ${velocista.slug} · ` +
        `${velocidad.sitio ? velocidad.sitio.url : "sin sitio conectado"} · ` +
        `${velocidad.rendimiento?.disponible ? velocidad.rendimiento.fuente : "sin medidor"} · ` +
        `${motor.modelId}${motor.modo ? ` (${motor.modo})` : ""}` +
        (velocidad.primerContacto ? " (simulación)" : ""),
    );

    // El historial vive UNA sola vez por encargo: es lo que permite comparar el
    // antes y el después dentro de la misma tarea.
    const historial: Medicion[] = [];
    const contexto: VelocidadContext = {
      conexionId: velocidad.conexionId ?? "",
      taskId: tarea.id,
      ...(velocidad.sitio ? { sitio: velocidad.sitio } : {}),
      ...(velocidad.rendimiento ? { rendimiento: velocidad.rendimiento } : {}),
      approvals: puertos.aprobaciones,
      // El backup solo tiene dónde colgarse si hay conexión: sin ella no hay
      // nada que revertir todavía.
      ...(velocidad.conexionId ? { backups: puertos.backups } : {}),
      ...(velocidad.primerContacto ? { primerContacto: true } : {}),
      historial,
    };

    return ejecutarTareaVelocista({
      ...(await this.#comun(e, "velocista", velocidad.agentName)),
      agent: velocista,
      negocio: velocidad.negocio,
      velocidad: contexto,
      ...(velocidad.secretos ? { secretos: velocidad.secretos } : {}),
    });
  }

  // -------------------------------------------------------------------------
  // Cierre, igual para cualquier agente
  // -------------------------------------------------------------------------

  async #cerrarTarea(
    tarea: TareaReclamada,
    resultado: ResultadoTarea,
    decir: (m: string) => void,
  ): Promise<void> {
    const { puertos, workerId } = this.#o;
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
