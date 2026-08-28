/**
 * Errores de Meta traducidos a DECISIONES.
 *
 * Un código de error suelto no sirve de nada en una cola: lo que hace falta es
 * saber si se reintenta, si hay que pedir una plantilla, o si toca parar todo
 * porque el token murió. Reintentar un 131047 (fuera de ventana) mil veces solo
 * quema cuota; no reintentar un 130429 (límite de tasa) pierde el mensaje.
 */
import type { MetaErrorBody } from "./types.js";

export type AccionWhatsApp =
  /** Reintentar con retroceso exponencial. */
  | "reintentar"
  /** Error definitivo del mensaje: marcar fallido y seguir con la cola. */
  | "descartar"
  /** Fuera de la ventana de servicio: solo se puede reenganchar con plantilla. */
  | "requiere_plantilla"
  /** El token del cliente ya no vale: marcar la cuenta revocada y pausar su cola. */
  | "token_revocado"
  /** El número o la cuenta están inutilizables: pausar la cola de ese cliente. */
  | "pausar_cola";

export type DecisionError = {
  readonly code: number;
  readonly subcode?: number;
  readonly accion: AccionWhatsApp;
  readonly reintentar: boolean;
  /** Marca la cuenta como revocada en base de datos. */
  readonly marcarCuentaRevocada: boolean;
  /** Detiene la cola de envío de ese cliente hasta intervención. */
  readonly pausarCola: boolean;
  /** Texto ya redactado en español: la bandeja lo muestra tal cual. */
  readonly mensajeUsuario: string;
  /** Espera mínima sugerida antes del siguiente intento, si aplica. */
  readonly esperaSugeridaMs?: number;
};

type Regla = Omit<DecisionError, "code" | "subcode">;

const R = (
  accion: AccionWhatsApp,
  mensajeUsuario: string,
  extra: Partial<Regla> = {},
): Regla => ({
  accion,
  reintentar: accion === "reintentar",
  marcarCuentaRevocada: accion === "token_revocado",
  pausarCola: accion === "token_revocado" || accion === "pausar_cola",
  mensajeUsuario,
  ...extra,
});

/**
 * Tabla de códigos. Solo los que cambian la decisión; el resto cae en el
 * criterio por familia de `decidirPorCodigo`.
 */
const TABLA: Record<number, Regla> = {
  // --- Autenticación --------------------------------------------------------
  190: R(
    "token_revocado",
    "El acceso a WhatsApp caducó o fue revocado. Vuelve a conectar tu cuenta de WhatsApp para seguir enviando mensajes.",
  ),
  102: R(
    "token_revocado",
    "La sesión con Meta expiró. Vuelve a conectar tu cuenta de WhatsApp.",
  ),
  200: R(
    "pausar_cola",
    "Faltan permisos en la conexión con Meta. Vuelve a conectar tu cuenta concediendo todos los permisos solicitados.",
  ),
  10: R(
    "pausar_cola",
    "Meta no autoriza esta operación con los permisos actuales. Revisa la conexión de tu cuenta.",
  ),

  // --- Límites de tasa ------------------------------------------------------
  4: R("reintentar", "Meta está limitando el ritmo de envío. Lo reintentamos en unos segundos.", {
    esperaSugeridaMs: 60_000,
  }),
  80007: R("reintentar", "Se alcanzó el límite de peticiones de tu cuenta. Reintentando.", {
    esperaSugeridaMs: 60_000,
  }),
  130429: R(
    "reintentar",
    "Se alcanzó el límite de mensajes por segundo de tu número. El mensaje se enviará en breve.",
    { esperaSugeridaMs: 30_000 },
  ),
  131048: R(
    "reintentar",
    "Meta limitó temporalmente los envíos de tu número por calidad. Reintentaremos más tarde.",
    { esperaSugeridaMs: 15 * 60_000 },
  ),
  131056: R(
    "reintentar",
    "Demasiados mensajes seguidos a este contacto. Esperamos un momento antes de reintentar.",
    { esperaSugeridaMs: 60_000 },
  ),
  133016: R("reintentar", "El número está ocupado en otra operación. Reintentando.", {
    esperaSugeridaMs: 30_000,
  }),

  // --- Ventana de servicio --------------------------------------------------
  131047: R(
    "requiere_plantilla",
    "Pasaron más de 24 horas desde el último mensaje del contacto. Para retomar la conversación hay que enviar una plantilla aprobada.",
  ),
  131051: R("descartar", "Este tipo de mensaje no se admite en WhatsApp."),

  // --- Plantillas -----------------------------------------------------------
  132000: R(
    "descartar",
    "La plantilla no coincide con el número de variables esperado. Revisa la plantilla antes de volver a enviarla.",
  ),
  132001: R(
    "descartar",
    "La plantilla no existe o no está aprobada en el idioma solicitado. Revísala en tus plantillas.",
  ),
  132005: R("descartar", "El texto traducido de la plantilla supera el límite permitido."),
  132007: R("descartar", "El formato de la plantilla no cumple las reglas de Meta."),
  132012: R("descartar", "Los valores enviados a la plantilla no cumplen su formato."),
  132015: R("descartar", "La plantilla está pausada por baja calidad y no se puede usar ahora."),
  132016: R("descartar", "La plantilla fue deshabilitada por Meta por baja calidad."),
  132068: R("descartar", "El flujo asociado a la plantilla está bloqueado."),
  132069: R("descartar", "El flujo asociado a la plantilla está despublicado."),

  // --- Destinatario ---------------------------------------------------------
  131026: R(
    "descartar",
    "No se pudo entregar el mensaje: el número puede no tener WhatsApp o no acepta este tipo de mensaje.",
  ),
  131052: R("descartar", "No se pudo descargar el archivo adjunto."),
  131053: R("descartar", "El archivo adjunto no se pudo subir a WhatsApp."),
  131009: R("descartar", "Uno de los datos del mensaje no cumple el formato que exige WhatsApp."),
  100: R("descartar", "Meta rechazó la petición por un parámetro no válido."),

  // --- Cuenta / número ------------------------------------------------------
  131031: R(
    "pausar_cola",
    "Tu cuenta de WhatsApp fue bloqueada por Meta. Revisa el estado de tu cuenta en el Administrador de WhatsApp.",
  ),
  131042: R(
    "pausar_cola",
    "Meta no puede cobrar tu cuenta de WhatsApp. Revisa el método de pago en tu Administrador de Meta: el cobro lo hace Meta directamente, no nosotros.",
  ),
  133010: R("pausar_cola", "El número no está registrado en WhatsApp Cloud. Vuelve a registrarlo."),
  133004: R("reintentar", "El servicio de WhatsApp no está disponible ahora mismo. Reintentando.", {
    esperaSugeridaMs: 2 * 60_000,
  }),

  // --- Fallos del servidor de Meta -----------------------------------------
  1: R("reintentar", "Meta devolvió un error temporal. Reintentando.", { esperaSugeridaMs: 5_000 }),
  2: R("reintentar", "El servicio de Meta no está disponible. Reintentando.", {
    esperaSugeridaMs: 10_000,
  }),
  131000: R("reintentar", "Error temporal de WhatsApp. Reintentando.", { esperaSugeridaMs: 5_000 }),
  131016: R("reintentar", "El servicio de WhatsApp está en mantenimiento. Reintentando.", {
    esperaSugeridaMs: 60_000,
  }),
};

const DESCONOCIDO: Regla = R(
  "descartar",
  "WhatsApp rechazó el mensaje por un motivo no reconocido. Lo registramos para revisarlo.",
);

/** Decide qué hacer con un código de error de Meta. */
export function decidirPorCodigo(code: number, subcode?: number): DecisionError {
  const regla = TABLA[code] ?? porFamilia(code) ?? DESCONOCIDO;
  return subcode === undefined ? { code, ...regla } : { code, subcode, ...regla };
}

/**
 * Criterio por familia para códigos que no están en la tabla. Los rangos son
 * los que documenta Meta: 131xxx/132xxx son errores de mensajería, 133xxx de
 * registro del número.
 */
function porFamilia(code: number): Regla | undefined {
  if (code >= 132000 && code < 133000) {
    return R("descartar", "La plantilla tiene un problema y no se puede enviar tal cual.");
  }
  if (code >= 133000 && code < 134000) {
    return R("pausar_cola", "Hay un problema con el registro de tu número de WhatsApp.");
  }
  return undefined;
}

/** Lee el cuerpo de error de Meta y decide. Tolera cuerpos vacíos o rotos. */
export function decidirPorRespuesta(body: unknown, httpStatus: number): DecisionError {
  const error = (body as MetaErrorBody | null)?.error;
  if (typeof error?.code === "number") {
    return decidirPorCodigo(error.code, error.error_subcode);
  }
  // Sin cuerpo interpretable: decidimos por el estado HTTP.
  if (httpStatus === 429) {
    return { code: 130429, ...(TABLA[130429] as Regla) };
  }
  if (httpStatus >= 500) {
    return { code: 1, ...(TABLA[1] as Regla) };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { code: 190, ...(TABLA[190] as Regla) };
  }
  return { code: httpStatus, ...DESCONOCIDO };
}

/** Error tipado que lanza el cliente. Lleva la decisión ya tomada. */
export class WhatsAppApiError extends Error {
  readonly decision: DecisionError;
  readonly httpStatus: number;
  readonly fbtraceId: string | undefined;
  readonly body: unknown;

  constructor(input: {
    decision: DecisionError;
    httpStatus: number;
    body: unknown;
    fbtraceId?: string;
  }) {
    super(`WhatsApp ${input.decision.code}: ${input.decision.mensajeUsuario}`);
    this.name = "WhatsAppApiError";
    this.decision = input.decision;
    this.httpStatus = input.httpStatus;
    this.fbtraceId = input.fbtraceId;
    this.body = input.body;
  }
}
