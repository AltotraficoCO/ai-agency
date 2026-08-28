/**
 * Mensajes normalizados. Es la frontera entre los canales y el motor:
 * todo adaptador traduce a estos tipos, y el motor solo entiende estos tipos.
 */

export type MessageContent =
  | { kind: "text"; text: string }
  | { kind: "image"; mediaId: string; caption?: string }
  | { kind: "audio"; mediaId: string; durationMs?: number; transcript?: string }
  | { kind: "video"; mediaId: string; caption?: string }
  | { kind: "document"; mediaId: string; filename?: string }
  | { kind: "location"; latitude: number; longitude: number; label?: string }
  | { kind: "buttons"; text: string; options: { id: string; label: string }[] }
  | { kind: "unsupported"; describedAs: string };

export type InboundMessage = {
  /** Id del mensaje en el proveedor. Es la clave de idempotencia frente a reintentos. */
  externalId: string;
  /** Identificador del interlocutor dentro del canal (teléfono, id de sesión, correo…). */
  externalContactId: string;
  /** Nombre que el canal reporta, si lo hay. */
  contactName?: string;
  content: MessageContent;
  /** Reloj del proveedor. El orden se resuelve por aquí, no por la hora de llegada. */
  sentAt: Date;
  /** Mensaje al que responde, si el canal lo soporta. */
  replyToExternalId?: string;
  /** Carga original, para auditoría y reproceso. */
  raw: unknown;
};

export type OutboundMessage = {
  conversationId: string;
  externalContactId: string;
  content: MessageContent;
  replyToExternalId?: string;
};

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

export type DeliveryReceipt = {
  externalId: string;
  status: DeliveryStatus;
  at: Date;
  error?: { code: string; message: string };
};

/** Orden de progreso. Los recibos llegan desordenados, así que solo se avanza, nunca se retrocede. */
const RANK: Record<DeliveryStatus, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

export function isProgress(from: DeliveryStatus | null, to: DeliveryStatus): boolean {
  if (from === null) return true;
  if (from === "failed") return false;
  return RANK[to] > RANK[from];
}
