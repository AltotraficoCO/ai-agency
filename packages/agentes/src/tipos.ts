/**
 * Lo que un agente por encargo devuelve, sea cual sea su oficio.
 *
 * Estos tipos salieron del bucle del Webmaster tal cual: la web, el worker y la
 * facturación ya hablan este vocabulario, y cambiarlo al generalizar habría
 * roto lo único que hoy factura. Un agente de Marketing produce exactamente la
 * misma forma de evidencia que uno de WordPress; lo que cambia es qué
 * herramientas usó.
 */
import type { ModelMessage } from "ai";

export type TareaEncargo = {
  readonly id: string;
  readonly titulo: string;
  readonly detalle: string | null;
};

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
// Aprobación humana
// ---------------------------------------------------------------------------

export type ApprovalDecision = "aprobada" | "rechazada";

export type ApprovalRequest = {
  readonly id: string;
  readonly decision: ApprovalDecision | null;
};

/**
 * La misma forma que declaran `@strappy/webmaster` y `@strappy/marketing`. Se
 * repite a propósito: TypeScript es estructural, así que los adaptadores que el
 * worker ya tiene encajan sin que ningún paquete dependa del otro.
 */
export interface ApprovalPort {
  check(input: {
    workspaceId: string;
    taskId: string;
    huella: string;
  }): Promise<ApprovalDecision | null>;
  request(input: {
    workspaceId: string;
    taskId: string;
    /**
     * Conexión sobre la que cuelga la aprobación. Null cuando todavía no hay
     * ninguna: un encargo de Marketing puede existir antes de que el cliente
     * conecte Google Ads, Facebook o TikTok.
     */
    siteId: string | null;
    huella: string;
    toolSlug: string;
    motivo: string;
    resumen: string;
    entrada: unknown;
  }): Promise<ApprovalRequest>;
}

// ---------------------------------------------------------------------------
// Registro de trabajo
// ---------------------------------------------------------------------------

export type EstadoPaso = "en_curso" | "hecho" | "error" | "esperando";

export type PasoTrabajo = {
  /** El `toolCallId`: estable dentro del encargo, sirve de clave y para fusionar. */
  readonly id: string;
  readonly herramienta: string;
  readonly etiqueta: string;
  readonly estado: EstadoPaso;
  readonly detalle: string | null;
  /** ISO 8601 del momento en que empezó el paso. */
  readonly en: string;
  /**
   * Quién dio el paso. Cuando un agente le pide ayuda a un compañero, los
   * pasos del compañero van al mismo encargo: sin esto el cliente ve una
   * lista en la que no se sabe quién hizo qué.
   */
  readonly agente?: { readonly slug: string; readonly nombre: string };
};
