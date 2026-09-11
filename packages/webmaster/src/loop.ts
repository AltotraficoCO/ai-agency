/**
 * El bucle de herramientas del Webmaster.
 *
 * Esto es lo que sustituye a OpenCode. El proyecto anterior arrancaba un
 * binario de unos 100 MB por tarea, tardaba entre dos y cinco segundos en
 * levantar y —lo que de verdad lo hacía inviable aquí— no devolvía consumo de
 * tokens: con un sistema de créditos, un agente cuyo gasto no se puede medir
 * no se puede vender. El AI SDK v6 da `usage` normalizado por paso, y eso es
 * exactamente lo que hace falta para cobrar.
 *
 * Del modelo de sandbox del original se conserva lo esencial y se mejora lo
 * que se puede: las credenciales viajan en el contexto inyectado por el
 * runtime y nunca en el prompt, las herramientas están denegadas por defecto
 * (solo se exponen las que el agente declara), toda entrada y salida pasa por
 * el filtro de secretos antes de persistirse, y hay un tope duro de tiempo.
 * El HOME desechable ya no hace falta: no se lanza ningún proceso hijo.
 */
import {
  generateText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type ToolApprovalResponse,
  type ToolSet,
} from "ai";
import {
  redactSecrets,
  toAiToolSet,
  type ToolDef,
  type ToolInvocationLog,
} from "@strappy/tools";
import { creditsForUsage, normalizeUsage, type RateTable } from "@strappy/core";
import type { SkillAgentDef } from "./agent.js";
import type { WebmasterContext } from "./context.js";
import type { ColectorCapturas, SitioContext } from "./ports.js";
import { huellaAccion } from "./aprobacion.js";
import { HERRAMIENTAS_WEBMASTER } from "./tools/index.js";

// ---------------------------------------------------------------------------
// Filtro de herramientas: deny by default
// ---------------------------------------------------------------------------

function coincide(patron: string, slug: string): boolean {
  if (!patron.includes("*")) return patron === slug;
  const partes = patron.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${partes.join(".*")}$`).test(slug);
}

export function herramientasDe(agent: SkillAgentDef): readonly ToolDef<never, unknown>[] {
  return HERRAMIENTAS_WEBMASTER.filter((t) =>
    agent.allowedToolPatterns.some((p) => coincide(p, t.slug)),
  );
}

// ---------------------------------------------------------------------------
// Evidencia
// ---------------------------------------------------------------------------

export type AccionRegistrada = {
  readonly herramienta: string;
  readonly entrada: unknown;
  readonly salida?: unknown;
  readonly simulada: boolean;
  readonly duracionMs: number;
  readonly error?: string;
  readonly backupId?: string;
};

export type CapturaEvidencia = {
  readonly herramienta: string;
  readonly mimeType: string;
  readonly url: string;
  readonly titulo: string;
  readonly base64: string;
};

export type SolicitudAprobacion = {
  readonly id: string;
  readonly herramienta: string;
  readonly motivo: string;
};

export type UsoAgregado = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
};

export type Evidencia = {
  readonly acciones: readonly AccionRegistrada[];
  readonly capturas: readonly CapturaEvidencia[];
  readonly backups: readonly string[];
  readonly aprobacionesPendientes: readonly SolicitudAprobacion[];
  readonly pasos: number;
  readonly uso: UsoAgregado;
  readonly creditos: number;
  readonly modelo: string;
  readonly simulacion: boolean;
};

export type ResultadoTarea =
  | { readonly estado: "completada"; readonly resumen: string; readonly evidencia: Evidencia }
  | {
      readonly estado: "esperando_aprobacion";
      readonly resumen: string;
      readonly evidencia: Evidencia;
      /** Conversación completa: se guarda para reanudar cuando alguien decida. */
      readonly mensajes: readonly ModelMessage[];
    }
  | {
      readonly estado: "fallida";
      readonly error: string;
      readonly motivo: "timeout" | "tope_acciones" | "error";
      readonly evidencia: Evidencia;
    };

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export type TareaEncargo = {
  readonly id: string;
  readonly titulo: string;
  readonly detalle: string | null;
};

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
};

// ---------------------------------------------------------------------------
// El bucle
// ---------------------------------------------------------------------------

export async function ejecutarTareaWebmaster(input: EjecucionInput): Promise<ResultadoTarea> {
  const { agent, sitio, tarea } = input;
  const log = input.onEvento ?? (() => {});
  const simulacion = Boolean(sitio.primerContacto);

  const acciones: AccionRegistrada[] = [];
  const capturas: CapturaEvidencia[] = [];
  const backups: string[] = [];
  const pendientes: SolicitudAprobacion[] = [];

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

  const anotar = (l: ToolInvocationLog): void => {
    const salida = l.output as Record<string, unknown> | undefined;
    const backupId = typeof salida?.backup_id === "string" ? salida.backup_id : undefined;
    if (backupId) backups.push(backupId);
    if (salida?.requiere_aprobacion === true && typeof salida.solicitud_id === "string") {
      pendientes.push({
        id: salida.solicitud_id,
        herramienta: l.slug,
        motivo: String(salida.motivo ?? ""),
      });
    }
    acciones.push({
      herramienta: l.slug,
      entrada: l.input,
      ...(l.output !== undefined ? { salida: l.output } : {}),
      simulada: l.simulated,
      duracionMs: l.durationMs,
      ...(l.error ? { error: l.error } : {}),
      ...(backupId ? { backupId } : {}),
    });
    log(`${l.slug} · ${l.error ? `error: ${l.error}` : `${l.durationMs} ms`}`);
  };

  const tools: ToolSet = toAiToolSet(herramientasDe(agent), { onInvocation: anotar });

  // Timeout duro: el `timeout` del AI SDK acota cada llamada al proveedor, no
  // el bucle entero. La señal sí lo acota, y es lo que promete el catálogo.
  const propia = AbortSignal.timeout(agent.timeoutMs);
  const señal = input.abortSignal ? AbortSignal.any([propia, input.abortSignal]) : propia;

  const sistema = agent.prompt({
    agentName: input.agentName,
    siteUrl: urlVisible(sitio),
    modoSimulacion: simulacion,
  });

  const mensajes: ModelMessage[] = [...(input.mensajesPrevios ?? [])];
  if (mensajes.length === 0) {
    mensajes.push({
      role: "user",
      content:
        `TAREA APROBADA POR EL CLIENTE:\n` +
        `Título: ${tarea.titulo}\n` +
        `Detalle: ${tarea.detalle ?? "(sin detalle adicional)"}\n\n` +
        `Ejecútala ahora siguiendo tu método de trabajo.`,
    });
  }
  if (input.aprobaciones?.length) {
    // Las respuestas del AI SDK tienen que ser el ÚLTIMO mensaje: el SDK solo
    // ejecuta una herramienta aprobada si la conversación termina justo en ese
    // mensaje de herramienta. Poner detrás el aviso de reanudación le hacía
    // ignorar la aprobación; el modelo la volvía a pedir con la misma huella,
    // ya aprobada, y la tarea quedaba "en espera" sin botones que pulsar.
    mensajes.push({ role: "tool", content: [...input.aprobaciones] });
  } else if (input.mensajesPrevios?.length) {
    // Se reanuda una aprobación de la propia herramienta (portada, precios):
    // ahí no hay respuesta que inyectar. Sin este aviso el modelo lee su propio
    // "no lo reintentes" del intento anterior y cierra sin hacer nada.
    mensajes.push({
      role: "user",
      content:
        "REANUDACIÓN: una persona ya decidió sobre lo que quedó esperando aprobación. " +
        "Vuelve a intentar exactamente la acción que dejaste pendiente. Si sigue sin " +
        "aprobación, la herramienta te lo dirá otra vez y entonces sí lo dejas. " +
        "Termina la tarea y cierra con RESUMEN.",
    });
  }

  let uso: UsoAgregado = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  let creditos = 0;
  let pasos = 0;

  const evidencia = (): Evidencia => ({
    acciones,
    capturas,
    backups,
    aprobacionesPendientes: pendientes,
    pasos,
    uso,
    creditos,
    modelo: input.modelId,
    simulacion,
  });

  try {
    let textoFinal = "";

    for (let ronda = 0; ; ronda++) {
      const resultado = await generateText({
        model: input.model,
        system: sistema,
        messages: mensajes,
        tools,
        // El tope de acciones del catálogo. No es una sugerencia: es lo que
        // impide que una tarea mal entendida se coma el saldo del cliente.
        stopWhen: stepCountIs(agent.maxAcciones),
        experimental_context: contexto,
        abortSignal: señal,
        timeout: agent.timeoutMs,
      });

      pasos += resultado.steps.length;
      for (const paso of resultado.steps) {
        const n = normalizeUsage(paso.usage);
        uso = {
          inputTokens: uso.inputTokens + n.inputTokens,
          outputTokens: uso.outputTokens + n.outputTokens,
          cacheReadTokens: uso.cacheReadTokens + (n.cacheReadTokens ?? 0),
          cacheWriteTokens: uso.cacheWriteTokens + (n.cacheWriteTokens ?? 0),
        };
        creditos += creditsForUsage(input.rates, input.modelId, n).credits;
      }
      mensajes.push(...resultado.response.messages);
      textoFinal = resultado.text;

      // ¿El AI SDK cortó alguna herramienta sensible antes de ejecutarla?
      const solicitudes = resultado.content.filter(
        (p): p is Extract<typeof p, { type: "tool-approval-request" }> =>
          p.type === "tool-approval-request",
      );
      const yaDecididas: ToolApprovalResponse[] = [];
      for (const s of solicitudes) {
        // `pedir_aprobacion` es la pregunta del propio agente: al cliente se le
        // enseña su propuesta, no el nombre de una herramienta.
        const propuesta =
          s.toolCall.toolName === "pedir_aprobacion"
            ? String((s.toolCall.input as { propuesta?: unknown } | undefined)?.propuesta ?? "").trim()
            : "";
        const registro = await sitio.approvals.request({
          workspaceId: input.workspaceId,
          taskId: sitio.taskId,
          siteId: sitio.siteId,
          huella: huellaAccion(sitio.taskId, s.toolCall.toolName, s.toolCall.input),
          toolSlug: s.toolCall.toolName,
          motivo: propuesta
            ? "necesito tu confirmación antes de seguir"
            : "es una operación de administración del sitio",
          resumen: propuesta || describirSolicitud(s.toolCall.toolName, s.toolCall.input),
          entrada: redactSecrets(s.toolCall.input),
        });
        if (registro.decision) {
          // Misma acción que una persona ya decidió: se contesta con esa decisión.
          yaDecididas.push({
            type: "tool-approval-response",
            approvalId: s.approvalId,
            approved: registro.decision === "aprobada",
            ...(registro.decision === "aprobada" ? {} : { reason: "Una persona ya rechazó esta acción." }),
          });
        } else {
          pendientes.push({
            id: registro.id,
            herramienta: s.toolCall.toolName,
            motivo: propuesta ? "confirmación del cliente" : "operación de administración del sitio",
          });
        }
      }

      // Si todo lo que se cortó ya estaba decidido, esperar un clic sería
      // dejar la tarea colgada de un botón que nadie puede ver: se sigue.
      if (yaDecididas.length > 0 && pendientes.length === 0 && ronda < MAX_RONDAS_DECIDIDAS) {
        mensajes.push({ role: "tool", content: yaDecididas });
        continue;
      }
      break;
    }

    // Las herramientas también se venden: su coste declarado se suma aparte
    // del de los tokens, que es lo que separa el precio del coste.
    for (const a of acciones) {
      const def = HERRAMIENTAS_WEBMASTER.find((t) => t.slug === a.herramienta);
      creditos += input.rates.tools?.[a.herramienta] ?? def?.creditCost ?? 0;
    }

    const texto = limpiarSecretos(quitarRazonamiento(textoFinal), sitio);
    const esperando = pendientes.length > 0;
    const resumen =
      esperando && !texto.includes("RESUMEN:")
        ? "Necesito tu aprobación para continuar. Revisa la propuesta y pulsa Aprobar o Rechazar."
        : extraerResumen(texto, simulacion);

    if (esperando) {
      return {
        estado: "esperando_aprobacion",
        resumen,
        evidencia: evidencia(),
        mensajes,
      };
    }
    return { estado: "completada", resumen, evidencia: evidencia() };
  } catch (error) {
    const abortada = señal.aborted || (error instanceof Error && error.name === "AbortError");
    const mensaje = error instanceof Error ? error.message : String(error);
    return {
      estado: "fallida",
      motivo: abortada ? "timeout" : "error",
      error: limpiarSecretos(mensaje.slice(0, 500), sitio),
      evidencia: evidencia(),
    };
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Rondas extra cuando el modelo vuelve a proponer una acción que una persona ya
 * decidió. Acotadas: un modelo que insiste sin fin no debe comerse el saldo.
 */
const MAX_RONDAS_DECIDIDAS = 3;

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
 * Quita el razonamiento que algunos modelos (GLM, DeepSeek) escriben dentro del
 * texto con etiquetas <think>. Si llega sin la etiqueta de apertura —pasa
 * cuando el proveedor recorta el principio—, se descarta todo hasta la última
 * de cierre: lo que va antes es el borrador, no la respuesta.
 */
export function quitarRazonamiento(texto: string): string {
  let limpio = texto.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const cierre = limpio.toLowerCase().lastIndexOf("</think>");
  if (cierre >= 0) limpio = limpio.slice(cierre + "</think>".length);
  return limpio.replace(/<\/?think>/gi, "").trim();
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

/** El cierre obligatorio. Si el modelo no lo dio, se dice, no se inventa. */
export function extraerResumen(texto: string, simulacion: boolean): string {
  const i = texto.lastIndexOf("RESUMEN:");
  if (i >= 0) return texto.slice(i + "RESUMEN:".length).trim();
  if (texto) return texto;
  return simulacion
    ? "La exploración terminó sin un plan escrito."
    : "La tarea terminó sin resumen del agente.";
}
