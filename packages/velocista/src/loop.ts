/**
 * El Velocista, montado sobre el bucle común de `@strappy/agentes`.
 *
 * El bucle es el mismo que el del Webmaster —y eso es deliberado: el tope de
 * acciones, el freno de repeticiones, el registro en vivo y las aprobaciones ya
 * se pelearon una vez contra sistemas reales—. Lo propio de aquí es el sitio, el
 * medidor y cómo se le explica al cliente lo que va a aprobar.
 *
 * Nada de este archivo sabe hablar con PageSpeed Insights ni con WordPress: eso
 * son los puertos (`ports.ts`), que en producción rellena el worker y en los
 * tests rellenan los dobles. Por eso el agente se puede probar entero hoy,
 * aunque no haya clave de Google puesta todavía.
 */
import type { LanguageModel, ModelMessage, ToolApprovalResponse } from "ai";
import {
  bloqueDeCompaneros,
  ejecutarTareaDeAgente,
  filtrarHerramientas,
  type ColaboracionPort,
  type Companero,
  type OficioDelAgente,
  type ResultadoTarea,
  type TareaEncargo,
} from "@strappy/agentes";
import type { ToolDef } from "@strappy/tools";
import type { RateTable } from "@strappy/core";
import type { VelocistaAgentDef } from "./agent.js";
import { huellaAccion } from "./aprobacion.js";
import type { VelocistaContext } from "./context.js";
import type { VelocidadContext } from "./ports.js";
import { detalleDePaso, etiquetaDePaso } from "./pasos.js";
import { HERRAMIENTAS_VELOCISTA } from "./tools/index.js";

export type { PasoTrabajo } from "./pasos.js";

export function herramientasDe(agent: VelocistaAgentDef): readonly ToolDef<never, unknown>[] {
  return filtrarHerramientas(HERRAMIENTAS_VELOCISTA, agent.allowedToolPatterns);
}

export type EjecucionVelocista = {
  readonly agent: VelocistaAgentDef;
  readonly model: LanguageModel;
  readonly modelId: string;
  readonly rates: RateTable;
  readonly workspaceId: string;
  readonly agentId?: string;
  /** Nombre con el que el cliente conoce a su agente. */
  readonly agentName: string;
  /** Cómo se llama el negocio: el agente habla de él por su nombre. */
  readonly negocio: string;
  readonly velocidad: VelocidadContext;
  readonly tarea: TareaEncargo;
  readonly mensajesPrevios?: readonly ModelMessage[];
  readonly aprobaciones?: readonly ToolApprovalResponse[];
  readonly abortSignal?: AbortSignal;
  readonly onEvento?: (mensaje: string) => void;
  readonly alAvanzar?: (paso: import("./pasos.js").PasoTrabajo) => void;
  /** Compañeros contratados a los que puede pedir ayuda. Vacío: trabaja solo. */
  readonly companeros?: readonly Companero[];
  /** Quién ejecuta el encargo del compañero. Sin esto no se puede delegar. */
  readonly colaboracion?: ColaboracionPort;
  /** Agentes que ya intervinieron en esta cadena. Vacío si lo pidió una persona. */
  readonly cadena?: readonly string[];
  /**
   * Credenciales descifradas que nunca pueden salir en un texto del cliente.
   * La clave del medidor es nuestra, no suya, y aun así se tapa: los errores de
   * una API traen la URL completa, y la URL lleva la clave dentro.
   */
  readonly secretos?: readonly string[];
};

export async function ejecutarTareaVelocista(input: EjecucionVelocista): Promise<ResultadoTarea> {
  const { agent, velocidad, tarea } = input;
  const simulacion = Boolean(velocidad.primerContacto);

  const contexto: VelocistaContext = {
    workspaceId: input.workspaceId,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    agentRunId: tarea.id,
    dryRun: simulacion,
    scopes: agent.scopes,
    ports: {},
    now: () => new Date(),
    velocidad,
  };

  const tapar = crearTapadera(input.secretos ?? []);

  const oficio: OficioDelAgente = {
    slug: agent.slug,
    herramientas: herramientasDe(agent),
    maxAcciones: agent.maxAcciones,
    timeoutMs: agent.timeoutMs,
    sistema:
      agent.prompt({
        agentName: input.agentName,
        negocio: input.negocio,
        sitioUrl: velocidad.sitio?.url ?? "su web",
        modoSimulacion: simulacion,
      }) + bloqueDeCompaneros(input.companeros ?? []),
    contexto,
    ...(input.colaboracion ? { colaboracion: input.colaboracion } : {}),
    ...(input.cadena ? { cadena: input.cadena } : {}),
    etiquetaDePaso,
    detalleDePaso,
    limpiarSecretos: tapar,
    describirSolicitud,
    // La misma que usan las herramientas de este paquete al pasar por la puerta
    // de aprobación: una decisión guardada tiene que poder encontrarse.
    huella: (toolSlug, entrada) => huellaAccion(velocidad.taskId, toolSlug, entrada),
    aprobaciones: velocidad.approvals,
    conexionId: velocidad.conexionId || null,
    motivoAprobacion: "instala algo en la web del negocio",
  };

  return ejecutarTareaDeAgente({
    oficio,
    model: input.model,
    modelId: input.modelId,
    rates: input.rates,
    workspaceId: input.workspaceId,
    tarea,
    simulacion,
    ...(input.mensajesPrevios ? { mensajesPrevios: input.mensajesPrevios } : {}),
    ...(input.aprobaciones ? { aprobaciones: input.aprobaciones } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    ...(input.onEvento ? { onEvento: input.onEvento } : {}),
    ...(input.alAvanzar ? { alAvanzar: input.alAvanzar } : {}),
  });
}

/** Cualquier cabecera de autenticación, venga como venga. */
const AUTORIZACION = /\b(authorization|x-api-key|api[-_]?key)\b\s*[:=]\s*\S+/gi;
/** `?key=…` y `&key=…`: así viaja la clave del medidor dentro de una URL. */
const CLAVE_EN_URL = /([?&](?:key|api_?key)=)[^&\s"']+/gi;

/**
 * Tapa lo que nunca debe llegar al cliente.
 *
 * No es paranoia: cuando PageSpeed Insights falla, su error incluye la URL
 * completa de la petición, y esa URL lleva nuestra clave dentro. Si ese texto
 * acaba en el resumen de un encargo, la clave queda escrita en la base de datos
 * del cliente y en su pantalla.
 */
export function crearTapadera(secretos: readonly string[]): (texto: string) => string {
  const utiles = secretos.filter((s) => typeof s === "string" && s.trim().length >= 6);
  return (texto: string): string => {
    let salida = texto.replace(AUTORIZACION, "$1 ***").replace(CLAVE_EN_URL, "$1***");
    for (const secreto of utiles) salida = salida.split(secreto).join("***");
    return salida;
  };
}

/**
 * Lo que lee la persona antes de pulsar Aprobar.
 *
 * La herramienta que instala la caché ya escribe su propio resumen con el
 * nombre del plugin y el riesgo; esto es la red por si el AI SDK corta una
 * llamada antes de que llegue a escribirlo.
 */
export function describirSolicitud(toolName: string, entrada: unknown): string {
  const e = (entrada ?? {}) as Record<string, unknown>;
  const motivo = typeof e.motivo === "string" && e.motivo.trim() ? ` Motivo: ${e.motivo}` : "";
  switch (toolName) {
    case "velocidad_activar_cache":
      return (
        `Instalar y activar ${String(e.plugin ?? "un plugin de caché")} en tu web para que las páginas ` +
        `se guarden hechas y carguen más rápido.${motivo}`
      );
    default:
      return `${toolName}: ${JSON.stringify(entrada).slice(0, 160)}`;
  }
}
