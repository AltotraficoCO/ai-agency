/**
 * Embedded Signup v4.
 *
 * Es el momento más frágil de todo el producto: una persona no técnica
 * conectando su WhatsApp. Si el paso 4 falla y le pedimos empezar de cero,
 * abandona. Por eso el flujo es REANUDABLE: cada paso guarda su resultado y
 * al reintentar se retoma justo donde se quedó.
 *
 * Los pasos están ordenados por dependencia, no por gusto:
 *   1. El `code` de Meta caduca en ~30 s y es de un solo uso.
 *   2. Sin verificar permisos, los pasos siguientes fallan con errores opacos.
 *   3. Sin suscribir la app, la WABA existe pero no llega ni un webhook.
 *   4. Sin registrar el número, no se puede enviar nada.
 *   5. Leer el estado no es opcional: `payment_status` decide si el cliente
 *      podrá enviar mensajes de pago, y es la causa número uno de "conecté
 *      todo y no funciona".
 */
import { randomInt } from "node:crypto";
import { crearClienteWhatsApp, type ClienteWhatsApp } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import { GRAPH_API_VERSION, type PaymentStatus, type PhoneNumberInfo, type QualityRating, type MessagingTier } from "./types.js";

export const VERSION_SIGNUP = "v4";

export const PASOS_REGISTRO = [
  "intercambiar_codigo",
  "verificar_permisos",
  "suscribir_app",
  "registrar_numero",
  "leer_estado",
  "completado",
] as const;

export type PasoRegistro = (typeof PASOS_REGISTRO)[number];

/** Permisos sin los que el resto del flujo falla con errores incomprensibles. */
export const PERMISOS_REQUERIDOS = ["whatsapp_business_management", "whatsapp_business_messaging"];

/** Estado persistido del registro. Es lo que permite reanudar. */
export type EstadoRegistro = {
  paso: PasoRegistro;
  wabaId: string;
  phoneNumberId: string;
  signupVersion: string;
  /** Token del cliente, ya obtenido. El runtime lo cifra antes de guardarlo. */
  accessToken?: string;
  tokenExpiraEn?: Date | null;
  permisosConcedidos?: string[];
  appSuscrita?: boolean;
  numeroRegistrado?: boolean;
  /** PIN generado. Se guarda cifrado: si se pierde, recuperarlo exige soporte de Meta. */
  pin?: string;
  resumen?: ResumenCuenta;
  /** Último error, en español, para poder mostrarlo y reintentar. */
  ultimoError?: { paso: PasoRegistro; mensaje: string; codigo?: number };
};

export type ResumenCuenta = {
  wabaId: string;
  nombreWaba?: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating: QualityRating;
  messagingTier: MessagingTier;
  codeVerificationStatus?: string;
  businessVerificationStatus: string;
  accountReviewStatus: string;
  /**
   * Estado del método de pago DEL CLIENTE. Operamos como Tech Provider: la
   * WABA es suya, el método de pago es suyo y Meta le cobra a él. Este dato
   * alimenta el bloque «Tu gasto en Meta» de la interfaz, que existe para que
   * no crea que ese cobro se lo hicimos nosotros.
   */
  paymentStatus: PaymentStatus;
};

export type DependenciasRegistro = {
  /** Credenciales de NUESTRA app de Meta, nunca del cliente. */
  app: { appId: string; appSecret: string };
  /** Persiste el estado tras CADA paso. Sin esto no hay reanudación posible. */
  guardarEstado(estado: EstadoRegistro): Promise<void>;
  /**
   * URL propia para los webhooks de esta WABA. Solo hace falta si otro producto
   * comparte la app de Meta; ver `suscribirApp`.
   */
  webhook?: { url: string; verifyToken: string };
  crearCliente?: (accessToken: string) => ClienteWhatsApp;
  /** PIN de dos pasos; por defecto, seis dígitos aleatorios criptográficos. */
  generarPin?: () => string;
  now?: () => Date;
};

export type ResultadoRegistro =
  | { ok: true; estado: EstadoRegistro; resumen: ResumenCuenta }
  | { ok: false; estado: EstadoRegistro; mensaje: string; reanudableEn: PasoRegistro };

/** Seis dígitos, siempre con ceros a la izquierda si toca. Meta exige exactamente 6. */
export function generarPinPorDefecto(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Ejecuta el registro desde `estado.paso`. Idempotente por paso: si ya hay
 * token, no se vuelve a intercambiar el `code` (que además solo sirve una vez).
 */
export async function ejecutarRegistro(
  entrada: {
    /** Solo obligatorio en el primer paso. */
    code?: string;
    estado: EstadoRegistro;
  },
  deps: DependenciasRegistro,
): Promise<ResultadoRegistro> {
  const now = deps.now ?? (() => new Date());
  const generarPin = deps.generarPin ?? generarPinPorDefecto;
  const estado: EstadoRegistro = { ...entrada.estado, signupVersion: VERSION_SIGNUP };

  const clienteApp = (token: string): ClienteWhatsApp =>
    deps.crearCliente ? deps.crearCliente(token) : crearClienteWhatsApp({ accessToken: token });

  const avanzar = async (paso: PasoRegistro): Promise<void> => {
    estado.paso = paso;
    delete estado.ultimoError;
    await deps.guardarEstado({ ...estado });
  };

  const fallar = async (paso: PasoRegistro, error: unknown): Promise<ResultadoRegistro> => {
    const mensaje = mensajeDeError(paso, error);
    estado.paso = paso;
    estado.ultimoError = {
      paso,
      mensaje,
      ...(error instanceof WhatsAppApiError ? { codigo: error.decision.code } : {}),
    };
    await deps.guardarEstado({ ...estado });
    return { ok: false, estado, mensaje, reanudableEn: paso };
  };

  // --- Paso 1: intercambiar el código por el token del cliente ---------------
  if (indice(estado.paso) <= indice("intercambiar_codigo") && !estado.accessToken) {
    if (!entrada.code) {
      return fallar(
        "intercambiar_codigo",
        new Error("Falta el código de autorización devuelto por Meta."),
      );
    }
    try {
      const api = clienteApp(`${deps.app.appId}|${deps.app.appSecret}`);
      const token = await api.intercambiarCodigo({
        appId: deps.app.appId,
        appSecret: deps.app.appSecret,
        code: entrada.code,
      });
      if (!token.access_token) throw new Error("Meta no devolvió un token de acceso.");
      estado.accessToken = token.access_token;
      // `expires_in` a 0 o ausente significa token de larga duración.
      estado.tokenExpiraEn = token.expires_in
        ? new Date(now().getTime() + token.expires_in * 1000)
        : null;
      await avanzar("verificar_permisos");
    } catch (error) {
      return fallar("intercambiar_codigo", error);
    }
  }

  const token = estado.accessToken;
  if (!token) return fallar("intercambiar_codigo", new Error("No hay token de acceso guardado."));
  const api = clienteApp(token);

  // --- Paso 2: verificar permisos con debug_token ---------------------------
  if (indice(estado.paso) <= indice("verificar_permisos")) {
    try {
      const info = await api.depurarToken({
        inputToken: token,
        appId: deps.app.appId,
        appSecret: deps.app.appSecret,
      });
      const datos = info.data;
      if (!datos?.is_valid) throw new Error("Meta considera que el token no es válido.");

      const concedidos = new Set<string>(datos.scopes ?? []);
      for (const g of datos.granular_scopes ?? []) if (g.scope) concedidos.add(g.scope);
      estado.permisosConcedidos = [...concedidos];

      const faltan = PERMISOS_REQUERIDOS.filter((p) => !concedidos.has(p));
      if (faltan.length > 0) {
        throw new Error(
          `Faltan permisos que Meta no concedió: ${faltan.join(", ")}. Vuelve a conectar aceptando todos los permisos.`,
        );
      }
      if (datos.expires_at && datos.expires_at > 0) {
        estado.tokenExpiraEn = new Date(datos.expires_at * 1000);
      }
      await avanzar("suscribir_app");
    } catch (error) {
      return fallar("verificar_permisos", error);
    }
  }

  // --- Paso 3: suscribir nuestra app a los webhooks de la WABA --------------
  if (indice(estado.paso) <= indice("suscribir_app")) {
    try {
      await api.suscribirApp(estado.wabaId, deps.webhook);
      estado.appSuscrita = true;
      await avanzar("registrar_numero");
    } catch (error) {
      return fallar("suscribir_app", error);
    }
  }

  // --- Paso 4: registrar el número con PIN de dos pasos ---------------------
  if (indice(estado.paso) <= indice("registrar_numero")) {
    try {
      // El PIN se genera UNA vez y se conserva: si se reintenta con un PIN
      // distinto, Meta rechaza el registro porque el número ya tiene uno.
      estado.pin ??= generarPin();
      await api.registrarNumero({ phoneNumberId: estado.phoneNumberId, pin: estado.pin });
      estado.numeroRegistrado = true;
      await avanzar("leer_estado");
    } catch (error) {
      // 133005/133006: el número ya está registrado con otro PIN. No es fatal
      // para el resto del flujo, pero sí requiere intervención del cliente.
      return fallar("registrar_numero", error);
    }
  }

  // --- Paso 5: leer calidad, nivel, verificación y estado de pago ----------
  if (indice(estado.paso) <= indice("leer_estado")) {
    try {
      const [waba, numero] = await Promise.all([
        api.leerWaba(estado.wabaId),
        api.leerNumero(estado.phoneNumberId),
      ]);
      estado.resumen = componerResumen({
        wabaId: estado.wabaId,
        phoneNumberId: estado.phoneNumberId,
        waba,
        numero,
      });
      await avanzar("completado");
    } catch (error) {
      return fallar("leer_estado", error);
    }
  }

  const resumen = estado.resumen;
  if (!resumen) return fallar("leer_estado", new Error("No se pudo leer el estado de la cuenta."));
  return { ok: true, estado, resumen };
}

function indice(paso: PasoRegistro): number {
  return PASOS_REGISTRO.indexOf(paso);
}

export function componerResumen(input: {
  wabaId: string;
  phoneNumberId: string;
  waba: { name?: string; account_review_status?: string; business_verification_status?: string; primary_funding_id?: string; account_status?: string };
  numero: PhoneNumberInfo;
}): ResumenCuenta {
  return {
    wabaId: input.wabaId,
    ...(input.waba.name ? { nombreWaba: input.waba.name } : {}),
    phoneNumberId: input.phoneNumberId,
    ...(input.numero.display_phone_number
      ? { displayPhoneNumber: input.numero.display_phone_number }
      : {}),
    ...(input.numero.verified_name ? { verifiedName: input.numero.verified_name } : {}),
    qualityRating: input.numero.quality_rating ?? "UNKNOWN",
    messagingTier: input.numero.messaging_limit_tier ?? "TIER_UNKNOWN",
    ...(input.numero.code_verification_status
      ? { codeVerificationStatus: input.numero.code_verification_status }
      : {}),
    businessVerificationStatus: normalizarVerificacion(input.waba.business_verification_status),
    accountReviewStatus: (input.waba.account_review_status ?? "PENDING").toLowerCase(),
    paymentStatus: normalizarPago(input.waba),
  };
}

function normalizarVerificacion(valor: string | undefined): string {
  switch ((valor ?? "").toLowerCase()) {
    case "verified":
      return "verified";
    case "pending":
    case "pending_need_more_info":
    case "pending_submission":
      return "pending";
    case "failed":
    case "rejected":
      return "failed";
    default:
      return "not_verified";
  }
}

/**
 * Meta no expone un `payment_status` limpio en todas las versiones: unas veces
 * llega en `account_status`, otras solo se deduce de si hay línea de crédito
 * (`primary_funding_id`). Se normaliza aquí para que el resto del sistema vea
 * un único vocabulario, el mismo que la restricción CHECK de la tabla.
 */
export function normalizarPago(waba: {
  account_status?: string;
  primary_funding_id?: string;
}): PaymentStatus {
  const estado = (waba.account_status ?? "").toLowerCase();
  if (estado.includes("suspend")) return "suspended";
  if (estado.includes("past_due") || estado.includes("overdue")) return "past_due";
  if (estado.includes("active")) return "active";
  if (waba.primary_funding_id) return "active";
  // Sin línea de crédito y sin estado declarado no sabemos nada; con estado
  // declarado pero sin financiación, el cliente no tiene método de pago.
  if (waba.account_status !== undefined) return "no_payment_method";
  return "unknown";
}

/**
 * Mensajes de fallo en español, por paso: el usuario ve esto, no un stack.
 * El encuadre importa tanto como el detalle: a partir del paso 3 lo esencial
 * es decirle que su cuenta YA quedó conectada y que solo hay que reintentar
 * desde ahí. Si cree que perdió todo, vuelve a empezar o abandona.
 */
function mensajeDeError(paso: PasoRegistro, error: unknown): string {
  const detalle =
    error instanceof WhatsAppApiError
      ? error.decision.mensajeUsuario
      : error instanceof Error
        ? error.message
        : String(error);
  switch (paso) {
    case "intercambiar_codigo":
      return `No pudimos completar la conexión con Meta. Vuelve a iniciar la conexión de WhatsApp. (${detalle})`;
    case "verificar_permisos":
      return `Meta no concedió todos los permisos necesarios. ${detalle}`;
    case "suscribir_app":
      return `Tu cuenta se conectó, pero no pudimos activar la recepción de mensajes. Reintenta desde aquí; no hace falta empezar de nuevo. (${detalle})`;
    case "registrar_numero":
      return `Tu cuenta se conectó, pero no pudimos activar el número para enviar mensajes. Reintenta desde aquí; no hace falta empezar de nuevo. (${detalle})`;
    case "leer_estado":
      return `Tu número quedó activo, pero no pudimos leer el estado de la cuenta. Reintenta en un momento. (${detalle})`;
    default:
      return detalle;
  }
}

/**
 * URL del alta por permisos, sin `config_id`.
 *
 * Embedded Signup solo funciona si la app de Meta es Tech Provider o BSP
 * aprobado; sin esa aprobación Meta rechaza el diálogo pidiendo un `config_id`
 * válido. Este diálogo clásico de OAuth pide los mismos permisos y sirve con
 * cualquier app que los tenga. La cuenta y el número no vienen en la respuesta:
 * se descubren después, a partir del token.
 */
export function urlOAuthPermisos(input: { appId: string; redirectUri: string; state: string }): string {
  const url = new URL(`https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", [...PERMISOS_REQUERIDOS, "business_management"].join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  return url.toString();
}

/** URL del flujo de Embedded Signup, para que la interfaz no arme cadenas a mano. */
export function urlEmbeddedSignup(input: {
  appId: string;
  configId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(`https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("config_id", input.configId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("override_default_response_type", "true");
  url.searchParams.set("state", input.state);
  return url.toString();
}
