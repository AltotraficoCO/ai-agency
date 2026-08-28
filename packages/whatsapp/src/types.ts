/**
 * Tipos de la Graph API de WhatsApp Cloud.
 *
 * Son la forma CRUDA de Meta y no salen de este paquete: el motor solo ve los
 * tipos normalizados de `@strappy/core`. Si algún día un `phone_number_id`
 * aparece fuera de `packages/whatsapp`, la abstracción de canal se rompió.
 */

/** Versión de la Graph API. Única constante: subir de versión se hace AQUÍ y en ningún otro sitio. */
export const GRAPH_API_VERSION = "v23.0";
export const GRAPH_BASE_URL = "https://graph.facebook.com";

/** Nivel de mensajería que Meta asigna a un número. Determina destinatarios únicos por 24h. */
export type MessagingTier =
  | "TIER_50"
  | "TIER_250"
  | "TIER_1K"
  | "TIER_10K"
  | "TIER_100K"
  | "TIER_UNLIMITED"
  | "TIER_UNKNOWN";

export type QualityRating = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";

/** Estado del método de pago de la WABA. El cliente paga a Meta, no a nosotros. */
export type PaymentStatus =
  | "unknown"
  | "active"
  | "past_due"
  | "suspended"
  | "no_payment_method";

/** Credenciales que el runtime descifra e inyecta. El adaptador nunca las persiste. */
export type WhatsAppCredentials = {
  /** Token del cliente (System User de su WABA), obtenido en Embedded Signup. */
  readonly accessToken: string;
  /** Número emisor. Es también la clave de enrutado del webhook. */
  readonly phoneNumberId: string;
  readonly wabaId?: string;
  /** Secreto de la app de Meta, para validar `X-Hub-Signature-256`. */
  readonly appSecret?: string;
  readonly businessId?: string;
};

// --- Errores de Meta ---------------------------------------------------------

export type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_data?: { messaging_product?: string; details?: string };
    fbtrace_id?: string;
  };
};

// --- Webhook -----------------------------------------------------------------

export type WhatsAppWebhookPayload = {
  object?: string;
  entry?: WebhookEntry[];
};

export type WebhookEntry = {
  id?: string;
  changes?: WebhookChange[];
};

export type WebhookChange = {
  field?: string;
  value?: WebhookValue;
};

export type WebhookValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { profile?: { name?: string }; wa_id?: string }[];
  messages?: WhatsAppInboundRaw[];
  statuses?: WhatsAppStatusRaw[];
  errors?: MetaErrorBody["error"][];
};

export type WhatsAppMediaRef = {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
};

export type WhatsAppInboundRaw = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  context?: { id?: string; from?: string; forwarded?: boolean };
  text?: { body?: string };
  image?: WhatsAppMediaRef;
  audio?: WhatsAppMediaRef;
  video?: WhatsAppMediaRef;
  document?: WhatsAppMediaRef;
  sticker?: WhatsAppMediaRef;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: { name?: { formatted_name?: string }; phones?: { phone?: string }[] }[];
  reaction?: { message_id?: string; emoji?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
    nfm_reply?: { name?: string; response_json?: string };
  };
  button?: { text?: string; payload?: string };
  order?: unknown;
  system?: { body?: string };
  errors?: MetaErrorBody["error"][];
};

export type WhatsAppStatusRaw = {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  conversation?: { id?: string; origin?: { type?: string }; expiration_timestamp?: string };
  pricing?: { billable?: boolean; pricing_model?: string; category?: string };
  errors?: MetaErrorBody["error"][];
};

// --- Envío -------------------------------------------------------------------

export type SendResult = {
  messaging_product?: string;
  contacts?: { input?: string; wa_id?: string }[];
  messages?: { id?: string; message_status?: string }[];
};

export type TemplateComponentParam =
  | { type: "text"; text: string }
  | { type: "currency"; currency: { fallback_value: string; code: string; amount_1000: number } }
  | { type: "date_time"; date_time: { fallback_value: string } }
  | { type: "image"; image: { link?: string; id?: string } }
  | { type: "document"; document: { link?: string; id?: string; filename?: string } }
  | { type: "video"; video: { link?: string; id?: string } };

export type TemplateComponent = {
  type: "header" | "body" | "footer" | "button";
  sub_type?: "quick_reply" | "url" | "copy_code";
  index?: string;
  parameters?: TemplateComponentParam[];
};

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export type TemplateStatus =
  | "APPROVED"
  | "PENDING"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED"
  | "IN_APPEAL"
  | "PENDING_DELETION";

export type MetaTemplate = {
  id?: string;
  name?: string;
  language?: string;
  status?: TemplateStatus;
  category?: TemplateCategory;
  quality_score?: { score?: string };
  rejected_reason?: string;
  components?: {
    type?: string;
    format?: string;
    text?: string;
    example?: Record<string, unknown>;
    buttons?: { type?: string; text?: string; url?: string }[];
  }[];
};

// --- Registro / Embedded Signup ---------------------------------------------

export type DebugTokenInfo = {
  data?: {
    app_id?: string;
    type?: string;
    application?: string;
    /** 0 = token de larga duración sin caducidad declarada. */
    expires_at?: number;
    data_access_expires_at?: number;
    is_valid?: boolean;
    scopes?: string[];
    granular_scopes?: { scope?: string; target_ids?: string[] }[];
    user_id?: string;
  };
};

export type PhoneNumberInfo = {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: QualityRating;
  code_verification_status?: string;
  platform_type?: string;
  throughput?: { level?: string };
  messaging_limit_tier?: MessagingTier;
};

export type WabaInfo = {
  id?: string;
  name?: string;
  currency?: string;
  timezone_id?: string;
  account_review_status?: string;
  business_verification_status?: string;
  message_template_namespace?: string;
  /** Meta lo expone en algunas versiones; se normaliza en `signup.ts`. */
  account_status?: string;
  primary_funding_id?: string;
};

// --- Analíticas --------------------------------------------------------------

export type ConversationAnalyticsRaw = {
  conversation_analytics?: {
    data?: {
      data_points?: {
        start?: number;
        end?: number;
        conversation?: number;
        cost?: number;
        conversation_type?: string;
        conversation_category?: string;
        conversation_direction?: string;
        phone_number?: string;
        country?: string;
      }[];
    }[];
  };
};
