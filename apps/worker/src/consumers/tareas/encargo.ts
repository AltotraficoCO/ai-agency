/**
 * El encargo en curso y las reglas pequeñas que todo el consumidor comparte.
 */
import type { ResultadoTarea } from "@strappy/agentes";
import type { MotorTarea, TareaReclamada } from "../../ports.js";
import type { RegistroDePasos } from "../pasos.js";

/**
 * Todo lo que un encargo arrastra mientras se ejecuta.
 *
 * Iba como siete parámetros posicionales repetidos en la firma de cada rama.
 * Varios eran del mismo tipo, así que cambiarlos de orden por error no daba
 * ningún aviso del compilador: compilaba y se comportaba mal.
 */
export type Encargo = {
  readonly tarea: TareaReclamada;
  readonly motor: MotorTarea;
  readonly registro: RegistroDePasos;
  readonly decir: (m: string) => void;
  /** Agentes que ya intervinieron, del primero al actual. Vacío si lo pidió una persona. */
  readonly cadena: readonly string[];
  /** Se dispara cuando el cliente para el encargo o lo reclama otro worker. */
  readonly senal: AbortSignal;
  /** Lo que gastan los compañeros. Se acumula para cobrarlo todo junto una vez. */
  readonly extra: {
    creditos: number;
    /**
     * El compañero que se quedó a un clic de terminar, con su conversación.
     * Se guarda en la evidencia del encargo para poder RETOMARLO cuando el
     * cliente apruebe, en vez de que empiece de cero.
     */
    colaboracionPendiente?: {
      slug: string;
      titulo: string;
      detalle: string;
      mensajes: readonly unknown[];
    };
  };
  /** El trabajo que le encarga un compañero, cuando no es el encargo del cliente. */
  readonly delegado?: { titulo: string; detalle: string };
};

/** Errores que no tiene sentido reintentar: fallarán igual la próxima vez. */
export function esDefinitivo(mensaje: string): boolean {
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
export function normalizarSlug(valor: string): string {
  return valor.trim().toLowerCase();
}

/** Quién ejecuta el encargo. Sin valor, el Webmaster: es lo que eran todos. */
export function agenteDeLaTarea(tarea: TareaReclamada): string {
  return normalizarSlug(tarea.agente ?? "webmaster") || "webmaster";
}

/**
 * Se devuelve como fallo del compañero, no como excepción: el que pidió ayuda
 * tiene que poder terminar su parte y contarlo. Tumbar un encargo que el
 * cliente ya aprobó por esto sería desproporcionado.
 */
export function oficioDesconocido(quien: string, e: Encargo): ResultadoTarea {
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
