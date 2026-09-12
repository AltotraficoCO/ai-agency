/**
 * El agente de Marketing, montado sobre el bucle común de `@strappy/agentes`.
 *
 * El bucle es el mismo que el del Webmaster —y eso es deliberado: el tope de
 * acciones, el freno de repeticiones, el registro en vivo y las aprobaciones ya
 * se pelearon una vez contra sistemas reales—. Lo propio de aquí son las
 * cuentas de publicidad, cómo se cuentan sus pasos y cómo se le explica al
 * cliente lo que va a aprobar.
 *
 * Nada de este archivo sabe hablar con Google ni con Meta: eso son los puertos
 * (`ports.ts`), que en producción rellena el worker y en los tests rellenan los
 * dobles. Por eso el agente se puede probar entero hoy, aunque los accesos de
 * las plataformas tarden semanas en llegar.
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
import type { MarketingAgentDef } from "./agent.js";
import { huellaAccion } from "./aprobacion.js";
import type { MarketingContext } from "./context.js";
import type { CuentasContext } from "./ports.js";
import { NOMBRE_PLATAFORMA, type Plataforma } from "./ports.js";
import { detalleDePaso, etiquetaDePaso } from "./pasos.js";
import { HERRAMIENTAS_MARKETING } from "./tools/index.js";

export type { PasoTrabajo } from "./pasos.js";

export function herramientasDe(agent: MarketingAgentDef): readonly ToolDef<never, unknown>[] {
  return filtrarHerramientas(HERRAMIENTAS_MARKETING, agent.allowedToolPatterns);
}

export type EjecucionMarketing = {
  readonly agent: MarketingAgentDef;
  readonly model: LanguageModel;
  readonly modelId: string;
  readonly rates: RateTable;
  readonly workspaceId: string;
  readonly agentId?: string;
  /** Nombre con el que el cliente conoce a su agente. */
  readonly agentName: string;
  /** Cómo se llama el negocio: el agente habla de él por su nombre. */
  readonly negocio: string;
  readonly cuentas: CuentasContext;
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
};

export async function ejecutarTareaMarketing(input: EjecucionMarketing): Promise<ResultadoTarea> {
  const { agent, cuentas, tarea } = input;
  const simulacion = Boolean(cuentas.primerContacto);

  const contexto: MarketingContext = {
    workspaceId: input.workspaceId,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    agentRunId: tarea.id,
    dryRun: simulacion,
    scopes: agent.scopes,
    ports: {},
    now: () => new Date(),
    cuentas,
  };

  const oficio: OficioDelAgente = {
    slug: agent.slug,
    herramientas: herramientasDe(agent),
    maxAcciones: agent.maxAcciones,
    timeoutMs: agent.timeoutMs,
    sistema:
      agent.prompt({
        agentName: input.agentName,
        negocio: input.negocio,
        modoSimulacion: simulacion,
      }) + bloqueDeCompaneros(input.companeros ?? []),
    contexto,
    ...(input.colaboracion ? { colaboracion: input.colaboracion } : {}),
    ...(input.cadena ? { cadena: input.cadena } : {}),
    etiquetaDePaso,
    detalleDePaso,
    // Las credenciales de las plataformas nunca entran en el contexto en claro:
    // viven dentro de los adaptadores. No hay nada que tapar en el texto.
    limpiarSecretos: (texto) => texto,
    describirSolicitud,
    // La misma que usan las herramientas de este paquete al pasar por la puerta
    // de aprobación: una decisión guardada tiene que poder encontrarse.
    huella: (toolSlug, entrada) => huellaAccion(cuentas.taskId, toolSlug, entrada),
    aprobaciones: cuentas.approvals,
    conexionId: cuentas.conexionId,
    motivoAprobacion: "cambia cuánto se gasta en publicidad",
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

/**
 * Lo que lee la persona antes de pulsar Aprobar.
 *
 * Las herramientas que tocan dinero ya escriben su propio resumen con la cifra
 * al mes (ver `tools/cambios.ts`); esto es la red por si el AI SDK corta una
 * llamada antes de que llegue a escribirlo. Aun así se dice la campaña y el
 * dinero, nunca el identificador a secas.
 */
export function describirSolicitud(toolName: string, entrada: unknown): string {
  const e = (entrada ?? {}) as Record<string, unknown>;
  const donde = NOMBRE_PLATAFORMA[e.plataforma as Plataforma] ?? "tu cuenta de anuncios";
  const campana = typeof e.campana_id === "string" ? e.campana_id : "?";
  const motivo = typeof e.motivo === "string" && e.motivo.trim() ? ` Motivo: ${e.motivo}` : "";
  switch (toolName) {
    case "ads_cambiar_presupuesto":
      return `Cambiar a ${String(e.diario ?? "?")} al día el presupuesto de la campaña ${campana} en ${donde}.${motivo}`;
    case "ads_pausar_campana":
      return `Pausar la campaña ${campana} en ${donde}: deja de gastar y de mostrarse.${motivo}`;
    case "ads_activar_campana":
      return `Reactivar la campaña ${campana} en ${donde}: vuelve a gastar.${motivo}`;
    default:
      return `${toolName}: ${JSON.stringify(entrada).slice(0, 160)}`;
  }
}
