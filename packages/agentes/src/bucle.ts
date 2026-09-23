/**
 * El bucle de herramientas de un agente por encargo, sin oficio.
 *
 * Esto es, palabra por palabra, lo que hacía `ejecutarTareaWebmaster`: lo que
 * no era de WordPress se movió aquí y lo que sí lo era se quedó allí, inyectado
 * como contexto. Cada regla de este archivo está porque un agente falló de esa
 * forma exacta contra un sistema real:
 *
 *  · el tope de acciones, porque un encargo mal entendido se come el saldo;
 *  · el freno de repeticiones, porque un modelo que no entiende un error repite
 *    la misma llamada doce veces y el cliente paga las doce;
 *  · parar tras una pregunta, porque seguir sin la respuesta es adivinar;
 *  · el registro de pasos en vivo, porque el cliente no ve el bucle: ve lo que
 *    su empleado está haciendo ahora mismo;
 *  · el timeout duro, porque el `timeout` del AI SDK acota cada llamada al
 *    proveedor, no el bucle entero.
 *
 * Quien llama monta el contexto de su oficio (el sitio de WordPress, las
 * cuentas de publicidad) y decide cómo se cuentan sus pasos y cómo se limpian
 * sus secretos. Aquí no se sabe qué es un plugin ni qué es una campaña.
 */
import {
  generateText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type Tool,
  type ToolApprovalResponse,
  type ToolExecutionOptions,
  type ToolSet,
} from "ai";
import {
  redactSecrets,
  toAiToolSet,
  type ToolContext,
  type ToolDef,
  type ToolInvocationLog,
} from "@strappy/tools";
import { creditsForUsage, normalizeUsage, type RateTable } from "@strappy/core";
import { crearHerramientaDeColaboracion, type ColaboracionPort } from "./colaboracion.js";
import { extraerResumen, quitarRazonamiento, recortar } from "./texto.js";
import type {
  AccionRegistrada,
  ApprovalPort,
  CapturaEvidencia,
  Evidencia,
  PasoTrabajo,
  ResultadoTarea,
  SolicitudAprobacion,
  TareaEncargo,
  UsoAgregado,
} from "./tipos.js";

// ---------------------------------------------------------------------------
// Filtro de herramientas: deny by default
// ---------------------------------------------------------------------------

function coincide(patron: string, slug: string): boolean {
  if (!patron.includes("*")) return patron === slug;
  const partes = patron.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${partes.join(".*")}$`).test(slug);
}

/** Las herramientas del catálogo del paquete que este agente tiene permitidas. */
export function filtrarHerramientas(
  todas: readonly ToolDef<never, unknown>[],
  patrones: readonly string[],
): readonly ToolDef<never, unknown>[] {
  return todas.filter((t) => patrones.some((p) => coincide(p, t.slug)));
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/** Lo que cambia de un oficio a otro. Todo lo demás es igual para cualquiera. */
export type OficioDelAgente = {
  /** Para mensajes de error y registro; no lo ve el cliente. */
  readonly slug: string;
  /** Ya filtradas: son las únicas que el modelo va a ver. */
  readonly herramientas: readonly ToolDef<never, unknown>[];
  readonly maxAcciones: number;
  readonly timeoutMs: number;
  /** El prompt de sistema, ya renderizado por el paquete del oficio. */
  readonly sistema: string;
  /** Contexto inyectado a las herramientas. Nunca puede venir del modelo. */
  readonly contexto: ToolContext;
  /** Cómo se cuenta cada herramienta en el registro de trabajo. */
  etiquetaDePaso(herramienta: string, entrada?: unknown): string;
  detalleDePaso(entrada: unknown): string | null;
  /** Última red antes de que un texto llegue al cliente. */
  limpiarSecretos(texto: string): string;
  /** Lo que ve el cliente en la tarjeta de aprobación. */
  describirSolicitud(herramienta: string, entrada: unknown): string;
  /**
   * La huella con la que se identifica una acción aprobable.
   *
   * La pone el oficio y NO el armazón: cada paquete ya la calcula a su manera
   * (el Webmaster con el hash entero, Marketing recortado) y sus herramientas,
   * el worker y la web resuelven las decisiones guardadas con esa misma forma.
   * Imponer aquí un formato distinto dejaría todas las aprobaciones colgadas
   * sin que nadie viera un error: la acción se pediría y nunca se encontraría
   * la decisión.
   */
  huella(toolSlug: string, entrada: unknown): string;
  /** Dónde registrar las aprobaciones y sobre qué conexión cuelgan. */
  readonly aprobaciones: ApprovalPort;
  /** Null si el encargo aún no cuelga de ninguna conexión del cliente. */
  readonly conexionId: string | null;
  /**
   * Por qué se pide el visto bueno cuando lo corta el AI SDK y no es una
   * propuesta del propio agente. Lo pone el oficio porque no es lo mismo tocar
   * la administración de un WordPress que mover el presupuesto de una campaña.
   */
  readonly motivoAprobacion?: string;
  /** Evidencia visual recogida por las herramientas del oficio, si tiene. */
  capturas?(): readonly CapturaEvidencia[];
  /**
   * Con quién puede contar este agente dentro de la empresa del cliente.
   *
   * Sin esto el agente trabaja solo, que es como trabajaba hasta ahora. Con
   * esto puede encargarle una parte a un compañero contratado, y el armazón le
   * añade la herramienta para hacerlo.
   */
  readonly colaboracion?: ColaboracionPort;
  /**
   * Los agentes que ya intervinieron en esta cadena, del primero al actual.
   * Vacío cuando el encargo lo pidió una persona.
   */
  readonly cadena?: readonly string[];
};

export type EjecucionAgente = {
  readonly oficio: OficioDelAgente;
  readonly model: LanguageModel;
  /** Identificador del modelo tal cual se pide al proveedor. Para tarificar. */
  readonly modelId: string;
  readonly rates: RateTable;
  readonly workspaceId: string;
  readonly tarea: TareaEncargo;
  /** Primer contacto: el agente mira y propone, no cambia nada. */
  readonly simulacion: boolean;
  /** Cómo se llama el agente en este espacio: firma cada paso del registro. */
  readonly agentName?: string;
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
};

// ---------------------------------------------------------------------------
// Envoltorios de herramientas
// ---------------------------------------------------------------------------

/**
 * Envuelve las herramientas para contar en vivo qué se está haciendo.
 *
 * Se hace en la frontera del AI SDK y no en `onInvocation` porque ese solo
 * avisa al terminar y sin `toolCallId`: sin él no se puede decir «esto que
 * empezó hace un momento ya terminó», y el registro saldría duplicado.
 */
function conRegistroDePasos(
  tools: ToolSet,
  oficio: OficioDelAgente,
  avisar: (paso: Omit<PasoTrabajo, "en">) => void,
): ToolSet {
  const envuelto: ToolSet = {};
  for (const [nombre, herramienta] of Object.entries(tools)) {
    const ejecutar = herramienta.execute as
      | ((entrada: unknown, opciones: ToolExecutionOptions) => Promise<unknown>)
      | undefined;
    if (!ejecutar) {
      envuelto[nombre] = herramienta;
      continue;
    }
    const conRegistro: Tool = {
      ...herramienta,
      execute: async (entrada: unknown, opciones: ToolExecutionOptions) => {
        const base = {
          id: opciones.toolCallId,
          herramienta: nombre,
          etiqueta: oficio.etiquetaDePaso(nombre, entrada),
          detalle: oficio.detalleDePaso(entrada),
        };
        avisar({ ...base, estado: "en_curso" });
        try {
          const salida = await ejecutar(entrada, opciones);
          const espera =
            (salida as { requiere_aprobacion?: unknown } | null)?.requiere_aprobacion === true;
          avisar({ ...base, estado: espera ? "esperando" : "hecho" });
          return salida;
        } catch (error) {
          avisar({
            ...base,
            estado: "error",
            detalle: recortar(error instanceof Error ? error.message : String(error)),
          });
          throw error;
        }
      },
    };
    envuelto[nombre] = conRegistro;
  }
  return envuelto;
}

/** Veces que la misma llamada puede fallar antes de parar la tarea. */
const MAX_FALLOS_IGUALES = 3;

type Freno = { readonly herramienta: string; readonly veces: number; readonly error: string };

/**
 * Freno de repeticiones: cuenta los fallos por huella exacta (herramienta +
 * entrada normalizada). Sin él, un modelo que no entiende un error repetía la
 * misma llamada hasta el tope de acciones —doce «Invalid post ID» seguidos— y
 * el cliente pagaba cada una.
 *
 * Al segundo fallo igual el error que ve el modelo le prohíbe repetir; al
 * tercero, `alFrenar` marca la tarea para que `stopWhen` la corte. Un acierto
 * con esa misma huella pone su cuenta a cero.
 */
function conFrenoDeRepeticiones(
  tools: ToolSet,
  huella: (nombre: string, entrada: unknown) => string,
  alFrenar: (freno: Freno) => void,
): ToolSet {
  const fallos = new Map<string, number>();
  const envuelto: ToolSet = {};
  for (const [nombre, herramienta] of Object.entries(tools)) {
    const ejecutar = herramienta.execute as
      | ((entrada: unknown, opciones: ToolExecutionOptions) => Promise<unknown>)
      | undefined;
    if (!ejecutar) {
      envuelto[nombre] = herramienta;
      continue;
    }
    envuelto[nombre] = {
      ...herramienta,
      execute: async (entrada: unknown, opciones: ToolExecutionOptions) => {
        const clave = huella(nombre, entrada);
        try {
          const salida = await ejecutar(entrada, opciones);
          fallos.delete(clave);
          return salida;
        } catch (error) {
          const veces = (fallos.get(clave) ?? 0) + 1;
          fallos.set(clave, veces);
          if (veces < 2) throw error;
          const mensaje = error instanceof Error ? error.message : String(error);
          if (veces >= MAX_FALLOS_IGUALES) alFrenar({ herramienta: nombre, veces, error: mensaje });
          throw new Error(
            `Ya intentaste exactamente esto y falló ${veces} veces con: ${mensaje}. No lo repitas: cambia de enfoque (otra herramienta, otro id, otro tipo) o termina explicando el problema.`,
          );
        }
      },
    } satisfies Tool;
  }
  return envuelto;
}

/** Lo que lee el cliente cuando el freno para la tarea. */
function resumenDeFreno(freno: Freno, oficio: OficioDelAgente): string {
  const etiqueta = oficio.etiquetaDePaso(freno.herramienta);
  return `Me detuve porque «${etiqueta}» falló ${freno.veces} veces con exactamente la misma petición: ${recortar(freno.error, 300)}. Repetirla no iba a cambiar el resultado y solo gastaba saldo.`;
}

/**
 * Rondas extra cuando el modelo vuelve a proponer una acción que una persona ya
 * decidió. Acotadas: un modelo que insiste sin fin no debe comerse el saldo.
 */
const MAX_RONDAS_DECIDIDAS = 3;

/**
 * Pasos que se le dan al agente para cerrar cuando se fue sin RESUMEN.
 *
 * Suficientes para rematar lo que dejó a medias, cortos para que una ronda de
 * cortesía no se convierta en otro encargo entero a cuenta del cliente.
 */
const PASOS_PARA_CERRAR = 8;

// ---------------------------------------------------------------------------
// El bucle
// ---------------------------------------------------------------------------

export async function ejecutarTareaDeAgente(input: EjecucionAgente): Promise<ResultadoTarea> {
  const { oficio, tarea } = input;
  const log = input.onEvento ?? (() => {});
  const simulacion = input.simulacion;

  const acciones: AccionRegistrada[] = [];
  const backups: string[] = [];
  const pendientes: SolicitudAprobacion[] = [];

  // Una pregunta al cliente detiene el bucle en ese paso: seguir trabajando sin
  // la respuesta es justo adivinar lo que el cliente no dijo.
  let hayPregunta = false;

  const anotar = (l: ToolInvocationLog): void => {
    const salida = l.output as Record<string, unknown> | undefined;
    const backupId = typeof salida?.backup_id === "string" ? salida.backup_id : undefined;
    if (backupId) backups.push(backupId);
    if (l.slug === "preguntar_al_cliente" && salida?.requiere_aprobacion === true) hayPregunta = true;
    if (salida?.requiere_aprobacion === true) {
      // Una herramienta normal deja UNA solicitud. La de pedir ayuda a un
      // compañero puede traer varias de golpe, porque el compañero hizo varias
      // cosas que piden botón: van en `solicitudes` y todas tienen que quedar
      // colgadas de este encargo, o el cliente aprobaría una y el resto se
      // quedaría esperando para siempre.
      const varias = Array.isArray(salida.solicitudes)
        ? salida.solicitudes.filter((v): v is string => typeof v === "string")
        : [];
      const ids = varias.length
        ? varias
        : typeof salida.solicitud_id === "string"
          ? [salida.solicitud_id]
          : [];
      for (const id of ids) {
        pendientes.push({ id, herramienta: l.slug, motivo: String(salida.motivo ?? "") });
      }
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

  // Registro de trabajo: nunca debe poder romper la tarea ni filtrar un secreto.
  const avisar = (paso: Omit<PasoTrabajo, "en">): void => {
    if (!input.alAvanzar) return;
    try {
      input.alAvanzar({
        ...paso,
        detalle: paso.detalle ? oficio.limpiarSecretos(paso.detalle) : null,
        en: new Date().toISOString(),
        agente: { slug: oficio.slug, nombre: input.agentName ?? oficio.slug },
      });
    } catch {
      // Quien escucha es el worker guardando en la base: si falla, el trabajo sigue.
    }
  };

  let freno: Freno | null = null;

  // El freno va por fuera del registro: el paso muestra el error real del
  // sistema del cliente y solo el modelo lee el aviso de «no lo repitas».
  // Pedir ayuda a un compañero es una herramienta más: pasa por el registro de
  // trabajo, por el freno y por el tope de acciones, igual que las demás. Se
  // añade aquí y no en el catálogo de cada paquete porque el puerto lleva el
  // espacio del cliente y la cadena de llamadas, y eso no puede viajar por un
  // catálogo compartido donde el modelo podría influir.
  // Quien trabaja para otro agente no habla con el cliente: le responde a
  // quien lo llamó. Si pudiera preguntar, el encargo del que llamó se quedaría
  // esperando una respuesta que el cliente no sabe a qué viene.
  const ayudando = (oficio.cadena?.length ?? 0) > 0;
  const propias = ayudando
    ? oficio.herramientas.filter((h) => h.slug !== "preguntar_al_cliente")
    : oficio.herramientas;
  const herramientas = oficio.colaboracion
    ? [
        ...propias,
        crearHerramientaDeColaboracion({
          puerto: oficio.colaboracion,
          slugPropio: oficio.slug,
          cadena: oficio.cadena ?? [],
        }) as (typeof oficio.herramientas)[number],
      ]
    : propias;
  const sistema = ayudando
    ? `${oficio.sistema}\n\nESTÁS AYUDANDO A UN COMPAÑERO (${oficio.cadena!.join(" → ")}): este encargo te lo pidió otro agente, no el cliente. No le preguntes nada al cliente ni le saludes: haz lo que te pidieron con lo que te dieron, y si te falta algo, termina con un RESUMEN que diga exactamente qué necesitas para que quien te llamó se lo pida al cliente.`
    : oficio.sistema;

  const tools: ToolSet = conFrenoDeRepeticiones(
    conRegistroDePasos(toAiToolSet(herramientas, { onInvocation: anotar }), oficio, avisar),
    (nombre, entrada) => oficio.huella(nombre, entrada),
    (f) => {
      freno ??= f;
    },
  );

  // Timeout duro: el `timeout` del AI SDK acota cada llamada al proveedor, no
  // el bucle entero. La señal sí lo acota, y es lo que promete el catálogo.
  const propia = AbortSignal.timeout(oficio.timeoutMs);
  const señal = input.abortSignal ? AbortSignal.any([propia, input.abortSignal]) : propia;

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
  } else if (input.mensajesPrevios?.length && mensajes.at(-1)?.role !== "user") {
    // Se reanuda una aprobación de la propia herramienta: ahí no hay respuesta
    // que inyectar. Sin este aviso el modelo lee su propio "no lo reintentes"
    // del intento anterior y cierra sin hacer nada. Si lo último ya es un
    // mensaje del cliente —la respuesta a una pregunta—, sobra.
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
    capturas: oficio.capturas?.() ?? [],
    backups,
    aprobacionesPendientes: pendientes,
    pasos,
    uso,
    creditos,
    modelo: input.modelId,
    simulacion,
  });

  /** Suma tokens, créditos y pasos de una tanda. Se llama desde dos sitios. */
  const contabilizar = (lista: readonly { usage: unknown }[]): void => {
    pasos += lista.length;
    for (const paso of lista) {
      const n = normalizeUsage(paso.usage as Parameters<typeof normalizeUsage>[0]);
      uso = {
        inputTokens: uso.inputTokens + n.inputTokens,
        outputTokens: uso.outputTokens + n.outputTokens,
        cacheReadTokens: uso.cacheReadTokens + (n.cacheReadTokens ?? 0),
        cacheWriteTokens: uso.cacheWriteTokens + (n.cacheWriteTokens ?? 0),
      };
      creditos += creditsForUsage(input.rates, input.modelId, n).credits;
    }
  };

  try {
    let textoFinal = "";

    for (let ronda = 0; ; ronda++) {
      const resultado = await generateText({
        model: input.model,
        system: sistema,
        messages: mensajes,
        tools,
        // El tope de acciones del catálogo. No es una sugerencia: es lo que
        // impide que una tarea mal entendida se coma el saldo del cliente. Y
        // tras una pregunta al cliente se para: la respuesta decide lo demás.
        // Y tras el mismo fallo tres veces, también: insistir no lo arregla.
        stopWhen: [stepCountIs(oficio.maxAcciones), () => hayPregunta, () => freno !== null],
        experimental_context: oficio.contexto,
        abortSignal: señal,
        timeout: oficio.timeoutMs,
      });

      contabilizar(resultado.steps);
      mensajes.push(...resultado.response.messages);
      textoFinal = resultado.text;
      if (freno) break;

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
        const registro = await oficio.aprobaciones.request({
          workspaceId: input.workspaceId,
          taskId: tarea.id,
          siteId: oficio.conexionId,
          huella: oficio.huella(s.toolCall.toolName, s.toolCall.input),
          toolSlug: s.toolCall.toolName,
          motivo: propuesta
            ? "necesito tu confirmación antes de seguir"
            : (oficio.motivoAprobacion ?? "es una operación que necesita tu visto bueno"),
          resumen: propuesta || oficio.describirSolicitud(s.toolCall.toolName, s.toolCall.input),
          // La entrada se guarda y se le enseña a una persona: nunca con
          // credenciales dentro, aunque el modelo las haya copiado.
          entrada: redactSecrets(s.toolCall.input),
        });
        avisar({
          id: s.toolCall.toolCallId,
          herramienta: s.toolCall.toolName,
          etiqueta: oficio.etiquetaDePaso(s.toolCall.toolName, s.toolCall.input),
          // Aprobada de antes: se ejecutará enseguida y el envoltorio la marcará en curso.
          estado: registro.decision === "rechazada" ? "error" : "esperando",
          detalle:
            registro.decision === "rechazada"
              ? "Rechazado por una persona"
              : oficio.detalleDePaso(s.toolCall.input),
        });
        if (registro.decision) {
          // Misma acción que una persona ya decidió: se contesta con esa decisión.
          yaDecididas.push({
            type: "tool-approval-response",
            approvalId: s.approvalId,
            approved: registro.decision === "aprobada",
            ...(registro.decision === "aprobada"
              ? {}
              : { reason: "Una persona ya rechazó esta acción." }),
          });
        } else {
          pendientes.push({
            id: registro.id,
            herramienta: s.toolCall.toolName,
            motivo: propuesta
              ? "confirmación del cliente"
              : (oficio.motivoAprobacion ?? "operación que necesita visto bueno"),
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

    /**
     * Una ronda más si el agente se fue sin cerrar.
     *
     * El modelo termina la conversación cuando responde sin llamar a ninguna
     * herramienta, y eso incluye responder pensando en voz alta: «voy a
     * intentar hacer clic en el extracto…». Sin esta ronda ese pensamiento se
     * guardaba como RESUMEN y el encargo se marcaba HECHO sin estarlo. Le pasó
     * al Webmaster dos veces seguidas con el blog de Vox, y al cliente le
     * llegó un encargo «terminado» que no había hecho lo que pidió.
     *
     * Se le devuelve el turno UNA vez, con sus herramientas: si le faltaba
     * trabajo lo termina, y si ya estaba, lo cuenta. Si tampoco así cierra, el
     * resumen lo dice en vez de disfrazar una divagación de conclusión.
     */
    // Si se acabó el tope de acciones NO se le dan más: ese tope existe justo
    // para que una tarea mal entendida no se coma el saldo del cliente, y una
    // ronda de cortesía por encima sería saltárselo.
    if (
      !freno &&
      pendientes.length === 0 &&
      pasos < oficio.maxAcciones &&
      !textoFinal.includes("RESUMEN:")
    ) {
      mensajes.push({
        role: "user",
        content:
          "No cerraste el encargo: tu último mensaje es un pensamiento en voz alta, no un RESUMEN. " +
          "Si te quedaba trabajo, termínalo ahora con tus herramientas. Si lo que ibas a hacer era " +
          "solo comprobar algo y no te deja, déjalo: una comprobación fallida no es la tarea. " +
          "Cierra SIEMPRE con una línea que empiece por RESUMEN: y diga qué cambiaste de verdad y " +
          "qué quedó sin hacer.",
      });
      const cierre = await generateText({
        model: input.model,
        system: sistema,
        messages: mensajes,
        tools,
        stopWhen: [stepCountIs(PASOS_PARA_CERRAR), () => freno !== null],
        experimental_context: oficio.contexto,
        abortSignal: señal,
        timeout: oficio.timeoutMs,
      });
      contabilizar(cierre.steps);
      mensajes.push(...cierre.response.messages);
      if (cierre.text.trim()) textoFinal = cierre.text;
    }

    // Las herramientas también se venden: su coste declarado se suma aparte
    // del de los tokens, que es lo que separa el precio del coste.
    for (const a of acciones) {
      const def = oficio.herramientas.find((t) => t.slug === a.herramienta);
      creditos += input.rates.tools?.[a.herramienta] ?? def?.creditCost ?? 0;
    }

    if (freno) {
      return {
        estado: "fallida",
        motivo: "tope_acciones",
        error: oficio.limpiarSecretos(resumenDeFreno(freno, oficio)),
        evidencia: evidencia(),
      };
    }

    const texto = oficio.limpiarSecretos(quitarRazonamiento(textoFinal));
    const esperando = pendientes.length > 0;
    const resumen =
      esperando && !texto.includes("RESUMEN:")
        ? "Necesito tu aprobación para continuar. Revisa la propuesta y pulsa Aprobar o Rechazar."
        : extraerResumen(texto, simulacion);

    if (esperando) {
      return { estado: "esperando_aprobacion", resumen, evidencia: evidencia(), mensajes };
    }
    return { estado: "completada", resumen, evidencia: evidencia() };
  } catch (error) {
    const abortada = señal.aborted || (error instanceof Error && error.name === "AbortError");
    const mensaje = error instanceof Error ? error.message : String(error);
    return {
      estado: "fallida",
      motivo: abortada ? "timeout" : "error",
      error: oficio.limpiarSecretos(mensaje.slice(0, 500)),
      evidencia: evidencia(),
    };
  }
}
