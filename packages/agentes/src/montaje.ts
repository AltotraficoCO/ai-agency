/**
 * El montaje de un agente por encargo: lo que es igual en los cinco oficios.
 *
 * Cada paquete (`webmaster`, `marketing`, `administrativo`, `velocista`,
 * `disenador`) tenía su propio `loop.ts` con el MISMO esqueleto copiado: el
 * mismo tipo de entrada de quince campos, el mismo contexto de herramientas, el
 * mismo ensamblado del oficio y las mismas catorce líneas finales para llamar
 * al bucle. Lo propio de cada uno —sus herramientas, su prompt, sus secretos,
 * cómo describe lo que hay que aprobar— cabe en un puñado de líneas; el resto
 * era ruido repetido cinco veces.
 *
 * Por qué importa y no es sólo estética: cuando algo de ese esqueleto hay que
 * cambiar —y ya pasó con las aprobaciones y con la colaboración— había que
 * acertar en cinco archivos a la vez. El que se olvidara no daba error: se
 * comportaba distinto.
 *
 * Lo que NO vive aquí, a propósito: el prompt, las herramientas, los puertos y
 * la huella de aprobación. Ahí las diferencias son reales y son el producto.
 */
import type { LanguageModel, ModelMessage, ToolApprovalResponse } from "ai";
import type { RateTable } from "@strappy/core";
import type { ToolContext } from "@strappy/tools";
import { ejecutarTareaDeAgente, type OficioDelAgente } from "./bucle.js";
import { bloqueDeCompaneros, type ColaboracionPort, type Companero } from "./colaboracion.js";
import type { PasoTrabajo, ResultadoTarea, TareaEncargo } from "./tipos.js";

/**
 * Lo que toda ejecución de un agente por encargo necesita, sea cual sea su
 * oficio. Cada paquete lo extiende con SU contexto: `& { agent, sitio }`,
 * `& { agent, cuentas }`…
 */
export type EntradaComunDeAgente = {
  readonly model: LanguageModel;
  /** Identificador del modelo tal cual se pide al proveedor. Para tarificar. */
  readonly modelId: string;
  readonly rates: RateTable;
  readonly workspaceId: string;
  readonly agentId?: string;
  /** Nombre con el que el cliente conoce a su agente. */
  readonly agentName: string;
  readonly tarea: TareaEncargo;
  /** Mensajes previos, si se está reanudando tras una aprobación. */
  readonly mensajesPrevios?: readonly ModelMessage[];
  /** Decisiones humanas que hay que inyectar antes de continuar. */
  readonly aprobaciones?: readonly ToolApprovalResponse[];
  readonly abortSignal?: AbortSignal;
  readonly onEvento?: (mensaje: string) => void;
  /**
   * Registro de trabajo en vivo: se llama al empezar cada herramienta
   * (`en_curso`), al terminar (`hecho` o `error`) y cuando algo queda
   * esperando un clic (`esperando`). Un fallo aquí nunca para el trabajo.
   */
  readonly alAvanzar?: (paso: PasoTrabajo) => void;
  /** Compañeros contratados a los que puede pedir ayuda. Vacío: trabaja solo. */
  readonly companeros?: readonly Companero[];
  /** Quién ejecuta el encargo del compañero. Sin esto no se puede delegar. */
  readonly colaboracion?: ColaboracionPort;
  /** Agentes que ya intervinieron en esta cadena. Vacío si lo pidió una persona. */
  readonly cadena?: readonly string[];
};

/** Lo mínimo que el montaje necesita saber de la definición de un agente. */
export type DefinicionDeAgente = {
  readonly slug: string;
  readonly scopes: readonly string[];
  readonly maxAcciones: number;
  readonly timeoutMs: number;
};

/**
 * El contexto que se inyecta a las herramientas, sin la parte del oficio.
 *
 * Cada paquete le añade la suya —`sitio`, `cuentas`, `libros`…— con un spread.
 * `ports` va vacío porque estos agentes no usan los puertos de sistema: sus
 * herramientas reciben lo que necesitan dentro de su propio contexto.
 */
export function contextoComun(
  entrada: EntradaComunDeAgente,
  agent: DefinicionDeAgente,
  simulacion: boolean,
): ToolContext {
  return {
    workspaceId: entrada.workspaceId,
    ...(entrada.agentId ? { agentId: entrada.agentId } : {}),
    agentRunId: entrada.tarea.id,
    dryRun: simulacion,
    scopes: agent.scopes,
    ports: {},
    now: () => new Date(),
  };
}

/** La parte mecánica del oficio: la que no distingue a un agente de otro. */
export type ParteComunDelOficio = Pick<
  OficioDelAgente,
  | "slug"
  | "herramientas"
  | "maxAcciones"
  | "timeoutMs"
  | "sistema"
  | "contexto"
  | "etiquetaDePaso"
  | "detalleDePaso"
  | "colaboracion"
  | "cadena"
>;

/**
 * Ensambla lo mecánico del oficio.
 *
 * El bloque de compañeros se añade AQUÍ y no en cada paquete: es la diferencia
 * entre un agente que sabe que tiene compañeros y uno que cree trabajar solo, y
 * olvidarlo en un oficio nuevo no daría ningún error visible.
 */
export function oficioComun(entrada: {
  readonly agent: DefinicionDeAgente;
  readonly herramientas: OficioDelAgente["herramientas"];
  /** El prompt ya renderizado por el paquete, sin el bloque de compañeros. */
  readonly sistema: string;
  readonly contexto: ToolContext;
  readonly etiquetaDePaso: OficioDelAgente["etiquetaDePaso"];
  readonly detalleDePaso: OficioDelAgente["detalleDePaso"];
  readonly comun: EntradaComunDeAgente;
}): ParteComunDelOficio {
  const { agent, comun } = entrada;
  return {
    slug: agent.slug,
    herramientas: entrada.herramientas,
    maxAcciones: agent.maxAcciones,
    timeoutMs: agent.timeoutMs,
    sistema: entrada.sistema + bloqueDeCompaneros(comun.companeros ?? []),
    contexto: entrada.contexto,
    ...(comun.colaboracion ? { colaboracion: comun.colaboracion } : {}),
    ...(comun.cadena ? { cadena: comun.cadena } : {}),
    etiquetaDePaso: entrada.etiquetaDePaso,
    detalleDePaso: entrada.detalleDePaso,
  };
}

/**
 * Lanza el bucle con el oficio ya montado.
 *
 * Los cinco opcionales se propagan en un único sitio: repetirlos en cada
 * paquete es cómo se pierde uno por el camino (un `abortSignal` que no llega
 * deja una tarea corriendo después de que el worker pida parar).
 */
export function lanzarOficio(
  comun: EntradaComunDeAgente,
  oficio: OficioDelAgente,
  simulacion: boolean,
): Promise<ResultadoTarea> {
  return ejecutarTareaDeAgente({
    oficio,
    model: comun.model,
    modelId: comun.modelId,
    rates: comun.rates,
    workspaceId: comun.workspaceId,
    tarea: comun.tarea,
    simulacion,
    ...(comun.mensajesPrevios ? { mensajesPrevios: comun.mensajesPrevios } : {}),
    ...(comun.aprobaciones ? { aprobaciones: comun.aprobaciones } : {}),
    ...(comun.abortSignal ? { abortSignal: comun.abortSignal } : {}),
    ...(comun.onEvento ? { onEvento: comun.onEvento } : {}),
    ...(comun.alAvanzar ? { alAvanzar: comun.alAvanzar } : {}),
  });
}
