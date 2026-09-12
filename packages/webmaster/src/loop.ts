/**
 * El Webmaster, montado sobre el bucle común de los agentes por encargo.
 *
 * El bucle en sí —tope de acciones, freno de repeticiones, registro de trabajo
 * en vivo, aprobaciones del AI SDK, cobro por tokens y por herramienta, timeout
 * duro— vive ahora en `@strappy/agentes` y lo comparten todos los agentes que
 * trabajan por encargo. Aquí queda lo que de verdad es del Webmaster: el sitio
 * del cliente, sus credenciales, las capturas del navegador y cómo se describe
 * al cliente lo que hay que aprobar.
 *
 * Por qué se separó: el agente de Marketing necesitaba exactamente el mismo
 * bucle, y copiarlo habría significado dos sitios donde arreglar el próximo
 * fallo. Lo que NO cambió es el comportamiento: mismos textos, mismos límites,
 * misma evidencia. Es lo único que hoy factura.
 *
 * Esto es lo que sustituyó a OpenCode. El proyecto anterior arrancaba un
 * binario de unos 100 MB por tarea y no devolvía consumo de tokens: con un
 * sistema de créditos, un agente cuyo gasto no se puede medir no se puede
 * vender.
 */
import type { LanguageModel, ModelMessage, ToolApprovalResponse } from "ai";
import {
  bloqueDeCompaneros,
  ejecutarTareaDeAgente,
  filtrarHerramientas,
  type CapturaEvidencia,
  type ColaboracionPort,
  type Companero,
  type OficioDelAgente,
} from "@strappy/agentes";
import { redactSecrets, type ToolDef } from "@strappy/tools";
import type { RateTable } from "@strappy/core";
import type { SkillAgentDef } from "./agent.js";
import type { WebmasterContext } from "./context.js";
import type { ColectorCapturas, SitioContext } from "./ports.js";
import { huellaAccion } from "./aprobacion.js";
import { detalleDePaso, etiquetaDePaso, type PasoTrabajo } from "./pasos.js";
import { HERRAMIENTAS_WEBMASTER } from "./tools/index.js";

// Los tipos del resultado y de la evidencia son los del armazón común: la web,
// el worker y la facturación ya hablan ese vocabulario.
export type {
  AccionRegistrada,
  CapturaEvidencia,
  Evidencia,
  ResultadoTarea,
  SolicitudAprobacion,
  TareaEncargo,
  UsoAgregado,
} from "@strappy/agentes";
export { extraerResumen, quitarRazonamiento } from "@strappy/agentes";

import type { ResultadoTarea, TareaEncargo } from "@strappy/agentes";

// ---------------------------------------------------------------------------
// Filtro de herramientas: deny by default
// ---------------------------------------------------------------------------

export function herramientasDe(agent: SkillAgentDef): readonly ToolDef<never, unknown>[] {
  return filtrarHerramientas(HERRAMIENTAS_WEBMASTER, agent.allowedToolPatterns);
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export type EjecucionInput = {
  readonly agent: SkillAgentDef;
  readonly model: LanguageModel;
  /** Identificador del modelo tal cual se pide al proveedor. Para tarificar. */
  readonly modelId: string;
  readonly rates: RateTable;
  readonly workspaceId: string;
  readonly agentId?: string;
  readonly agentName: string;
  readonly sitio: SitioContext;
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

// ---------------------------------------------------------------------------
// El oficio de Webmaster
// ---------------------------------------------------------------------------

export async function ejecutarTareaWebmaster(input: EjecucionInput): Promise<ResultadoTarea> {
  const { agent, sitio, tarea } = input;
  const simulacion = Boolean(sitio.primerContacto);

  // Dónde se acumulan las capturas de ESTA ejecución. Va en el contexto y no en
  // una variable de módulo: dos tareas del mismo proceso no comparten evidencia.
  const capturas: CapturaEvidencia[] = [];
  const colector: ColectorCapturas = {
    push: (c) => {
      capturas.push({
        herramienta: c.herramienta,
        mimeType: c.mimeType,
        url: c.url,
        titulo: c.titulo,
        base64: c.base64,
      });
    },
  };

  const contexto: WebmasterContext = {
    workspaceId: input.workspaceId,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    agentRunId: tarea.id,
    dryRun: simulacion,
    scopes: agent.scopes,
    ports: {},
    now: () => new Date(),
    sitio: { ...sitio, capturas: colector },
  };

  const oficio: OficioDelAgente = {
    slug: agent.slug,
    herramientas: herramientasDe(agent),
    maxAcciones: agent.maxAcciones,
    timeoutMs: agent.timeoutMs,
    sistema:
      agent.prompt({
        agentName: input.agentName,
        siteUrl: urlVisible(sitio),
        modoSimulacion: simulacion,
      }) + bloqueDeCompaneros(input.companeros ?? []),
    contexto,
    ...(input.colaboracion ? { colaboracion: input.colaboracion } : {}),
    ...(input.cadena ? { cadena: input.cadena } : {}),
    etiquetaDePaso,
    detalleDePaso,
    limpiarSecretos: (texto) => limpiarSecretos(texto, sitio),
    describirSolicitud,
    // La misma que calculan las herramientas del Webmaster y con la que la web
    // resuelve las decisiones: si aquí se usara otra, ninguna aprobación se
    // volvería a encontrar y todo lo sensible quedaría colgado.
    huella: (toolSlug, entrada) => huellaAccion(sitio.taskId, toolSlug, entrada),
    aprobaciones: sitio.approvals,
    conexionId: sitio.siteId,
    motivoAprobacion: "es una operación de administración del sitio",
    capturas: () => capturas,
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

// ---------------------------------------------------------------------------
// Utilidades del oficio
// ---------------------------------------------------------------------------

/**
 * Lo que ve el cliente en la tarjeta de aprobación. "wp_instalar_plugin: espera
 * el visto bueno" no dice QUÉ plugin, y aprobar a ciegas no es aprobar.
 */
export function describirSolicitud(toolName: string, entrada: unknown): string {
  const e = (entrada ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) => String(v ?? "?");
  switch (toolName) {
    case "wp_instalar_plugin":
      return `Instalar y activar el plugin «${texto(e.slug)}».`;
    case "wp_cambiar_plugin":
      return `${e.estado === "active" ? "Activar" : "Desactivar"} el plugin «${texto(e.plugin)}».`;
    case "wp_eliminar_plugin":
      return `Eliminar el plugin «${texto(e.plugin)}».`;
    case "wp_crear_usuario":
      return `Crear el usuario «${texto(e.username)}» (${texto(e.email)}) con el rol ${texto(e.role)}.`;
    case "wp_cambiar_rol_usuario":
      return `Cambiar el rol del usuario ${texto(e.usuario_id)} a ${texto(e.role)}.`;
    default:
      return `${toolName}: ${JSON.stringify(redactSecrets(entrada)).slice(0, 160)}`;
  }
}

/** La URL que el agente puede nombrar. De las credenciales solo sale esto. */
export function urlVisible(sitio: SitioContext): string {
  if (sitio.wp) return sitio.wp.url;
  if (sitio.conector) return sitio.conector.baseUrl.replace(/\/(api\/)?[a-z]+\/v\d+\/?$/, "");
  return "(sitio sin conectar)";
}

/**
 * Última red antes de que un texto llegue al cliente. El filtro de secretos de
 * `@strappy/tools` cubre objetos por nombre de clave; esto cubre el caso de
 * que el modelo haya copiado literalmente una credencial en su respuesta.
 */
export function limpiarSecretos(texto: string, sitio: SitioContext): string {
  const secretos = [sitio.wp?.appPassword, sitio.conector?.token].filter(
    (s): s is string => typeof s === "string" && s.length >= 8,
  );
  return secretos.reduce((acc, s) => acc.split(s).join("«oculto»"), texto);
}
