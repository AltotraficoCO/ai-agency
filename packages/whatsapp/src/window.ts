/**
 * La ventana de servicio de 24 horas.
 *
 * Vive AQUÍ y en ningún otro sitio. El motor solo conoce
 * `conversations.send_restriction_until`, un instante genérico, y pregunta al
 * canal con `canSend()`. Nunca sabe que ese instante viene de una regla de
 * WhatsApp, ni que la alternativa se llama "plantilla".
 */
import type { SendRestriction } from "@strappy/core";

export const VENTANA_SERVICIO_MS = 24 * 60 * 60 * 1000;

/** Instante hasta el que se puede escribir libremente tras un mensaje entrante. */
export function calcularFinDeVentana(ultimoEntrante: Date): Date {
  return new Date(ultimoEntrante.getTime() + VENTANA_SERVICIO_MS);
}

export const CODIGO_VENTANA_CERRADA = "whatsapp.ventana_cerrada";

/**
 * Restricción ya redactada en español. El motor y la bandeja la muestran tal
 * cual, sin interpretarla: por eso el texto se escribe aquí y no en la UI.
 */
export function restriccionVentanaCerrada(expiresAt?: Date): SendRestriction {
  return {
    code: CODIGO_VENTANA_CERRADA,
    message:
      "Pasaron más de 24 horas desde el último mensaje de este contacto. WhatsApp solo permite retomar la conversación con una plantilla aprobada.",
    ...(expiresAt ? { expiresAt } : {}),
    alternative: { kind: "plantilla", label: "Enviar una plantilla aprobada" },
  };
}

export const CODIGO_NUMERO_PAUSADO = "whatsapp.numero_pausado";

export function restriccionNumeroPausado(motivo: string): SendRestriction {
  return { code: CODIGO_NUMERO_PAUSADO, message: motivo };
}

/** ¿Sigue abierta la ventana a la hora `ahora`? */
export function ventanaAbierta(finDeVentana: Date | null | undefined, ahora: Date): boolean {
  return finDeVentana != null && finDeVentana.getTime() > ahora.getTime();
}
