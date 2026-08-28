/**
 * Recepción del webhook de Meta.
 *
 * POR QUÉ SIEMPRE SE RESPONDE 200 (salvo firma inválida)
 * ------------------------------------------------------
 * Meta no distingue entre "tu base de datos está caída" y "tu endpoint está
 * roto": si un webhook devuelve 5xx de forma repetida, Meta DESACTIVA la
 * suscripción de esa WABA. Como somos Tech Provider y todas las WABA de
 * nuestros clientes apuntan a la misma URL, un fallo interno propagado como
 * 5xx tumbaría a todos los clientes a la vez, y volver a suscribir cada WABA
 * es manual. Por eso el handler hace lo mínimo —verificar, deduplicar,
 * encolar— y devuelve 200 aunque el procesamiento posterior falle: el evento
 * ya está guardado crudo y se reprocesa desde nuestra cola, no desde Meta.
 *
 * La única excepción es la firma inválida: ahí devolvemos 401/403 porque la
 * petición no viene de Meta y admitirla sería aceptar eventos falsificados.
 *
 * OBJETIVO: menos de 200 ms. Nada de red, nada de LLM, nada de joins.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { WhatsAppWebhookPayload } from "./types.js";

export const CABECERA_FIRMA = "x-hub-signature-256";

/**
 * Valida `X-Hub-Signature-256` sobre el CUERPO CRUDO.
 *
 * Nunca sobre el JSON reserializado: `JSON.parse` + `JSON.stringify` cambia el
 * orden de claves, el escapado unicode y los espacios, y la firma deja de
 * cuadrar (o peor, alguien "arregla" el problema desactivando la validación).
 */
export function verificarFirma(input: {
  cuerpoCrudo: string | Uint8Array;
  cabecera: string | null | undefined;
  appSecret: string;
}): boolean {
  const { cabecera, appSecret } = input;
  if (!cabecera || !appSecret) return false;

  const prefijo = "sha256=";
  if (!cabecera.startsWith(prefijo)) return false;
  const recibida = cabecera.slice(prefijo.length).trim();
  // Una firma de sha256 son 64 caracteres hexadecimales; cualquier otra cosa
  // se descarta antes de tocar `Buffer.from`, que ignora caracteres inválidos.
  if (!/^[0-9a-f]{64}$/i.test(recibida)) return false;

  const cuerpo =
    typeof input.cuerpoCrudo === "string" ? Buffer.from(input.cuerpoCrudo, "utf8") : Buffer.from(input.cuerpoCrudo);
  const esperada = createHmac("sha256", appSecret).update(cuerpo).digest();
  const recibidaBuf = Buffer.from(recibida, "hex");

  if (recibidaBuf.length !== esperada.length) return false;
  // Comparación en tiempo constante: un `===` filtra el prefijo correcto byte
  // a byte y permite forjar la firma con suficientes intentos.
  return timingSafeEqual(recibidaBuf, esperada);
}

/** Verificación GET del endpoint. Meta la repite cada vez que se reconfigura. */
export function verificarChallenge(input: {
  query: Record<string, string | string[] | undefined> | URLSearchParams;
  verifyToken: string;
}): { ok: true; challenge: string } | { ok: false; motivo: string } {
  const leer = (clave: string): string | undefined => {
    if (input.query instanceof URLSearchParams) return input.query.get(clave) ?? undefined;
    const v = input.query[clave];
    return Array.isArray(v) ? v[0] : v;
  };

  const mode = leer("hub.mode");
  const token = leer("hub.verify_token");
  const challenge = leer("hub.challenge");

  if (mode !== "subscribe") return { ok: false, motivo: "El modo de verificación no es subscribe." };
  if (!token || !input.verifyToken) return { ok: false, motivo: "Falta el token de verificación." };

  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(input.verifyToken, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, motivo: "El token de verificación no coincide." };
  }
  if (!challenge) return { ok: false, motivo: "Falta hub.challenge." };
  return { ok: true, challenge };
}

/**
 * Hash estable de un evento, para deduplicar.
 *
 * Meta reenvía el mismo evento cuando no ve el 200 a tiempo, así que el mismo
 * `wamid` puede llegar varias veces. El hash combina el id del proveedor y el
 * tipo, porque para un mismo `wamid` llegan un mensaje y varios estados
 * distintos: si el hash fuese solo el `wamid`, el recibo de "leído" se
 * descartaría como duplicado del mensaje.
 */
export function hashEvento(input: {
  externalId: string;
  tipo: string;
  /** Discrimina reenvíos legítimos de estados con la misma marca de tiempo. */
  marca?: string;
}): string {
  return createHash("sha256")
    .update([input.externalId, input.tipo, input.marca ?? ""].join("|"))
    .digest("hex");
}

export type EventoWebhook = {
  /** `phone_number_id`: la clave con la que se resuelve el tenant en `channel_routing`. */
  externalKey: string | undefined;
  /** `message` o `status.<estado>`. */
  tipo: string;
  externalId: string;
  eventHash: string;
  /** Fragmento crudo, tal cual llegó. Se guarda para auditoría y reproceso. */
  raw: unknown;
};

/**
 * Descompone la carga en eventos deduplicables SIN interpretar el contenido.
 * Interpretar los mensajes es trabajo del adaptador, fuera de la ruta caliente.
 */
export function extraerEventos(payload: unknown): EventoWebhook[] {
  const carga = payload as WhatsAppWebhookPayload | null;
  const eventos: EventoWebhook[] = [];

  for (const entry of carga?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const externalKey = value?.metadata?.phone_number_id;

      for (const mensaje of value?.messages ?? []) {
        if (!mensaje.id) continue;
        eventos.push({
          externalKey,
          tipo: "message",
          externalId: mensaje.id,
          eventHash: hashEvento({ externalId: mensaje.id, tipo: "message" }),
          raw: { field: change.field, value: { ...value, messages: [mensaje], statuses: undefined } },
        });
      }

      for (const estado of value?.statuses ?? []) {
        if (!estado.id) continue;
        const tipo = `status.${estado.status ?? "desconocido"}`;
        eventos.push({
          externalKey,
          tipo,
          externalId: estado.id,
          eventHash: hashEvento({ externalId: estado.id, tipo }),
          raw: { field: change.field, value: { ...value, statuses: [estado], messages: undefined } },
        });
      }
    }
  }

  return eventos;
}

// --- Handler delgado ---------------------------------------------------------

export type ResultadoWebhook = {
  /** Lo que debe devolver la ruta HTTP. */
  status: 200 | 401;
  body: string;
  firmaOk: boolean;
  encolados: EventoWebhook[];
  duplicados: EventoWebhook[];
};

export type PuertosWebhook = {
  /**
   * Guarda el evento crudo y devuelve `false` si ya existía.
   * Debe apoyarse en el único sobre `event_hash` de `webhook_events`: la
   * deduplicación la decide la base de datos, no una comprobación previa que
   * dos peticiones simultáneas pasarían a la vez.
   */
  registrarEvento(evento: EventoWebhook & { firmaOk: boolean; payload: unknown }): Promise<boolean>;
  /** Encola el procesamiento. No debe esperar a que termine. */
  encolar(evento: EventoWebhook): Promise<void>;
  /** Se llama con cualquier fallo interno: se registra, pero NO cambia el 200. */
  registrarFallo?(error: unknown): void;
};

/**
 * Punto de entrada del webhook, pensado para responder en menos de 200 ms.
 * La ruta de `apps/web` solo tiene que leer el cuerpo crudo y llamar aquí.
 */
export async function recibirWebhook(input: {
  cuerpoCrudo: string;
  cabeceraFirma: string | null | undefined;
  appSecret: string;
  puertos: PuertosWebhook;
}): Promise<ResultadoWebhook> {
  const firmaOk = verificarFirma({
    cuerpoCrudo: input.cuerpoCrudo,
    cabecera: input.cabeceraFirma,
    appSecret: input.appSecret,
  });

  // Firma inválida: no viene de Meta. Es el único caso en que no devolvemos 200.
  if (!firmaOk) {
    return { status: 401, body: "firma inválida", firmaOk: false, encolados: [], duplicados: [] };
  }

  const encolados: EventoWebhook[] = [];
  const duplicados: EventoWebhook[] = [];

  try {
    const payload = JSON.parse(input.cuerpoCrudo) as unknown;
    for (const evento of extraerEventos(payload)) {
      const nuevo = await input.puertos.registrarEvento({ ...evento, firmaOk: true, payload });
      if (!nuevo) {
        duplicados.push(evento);
        continue;
      }
      await input.puertos.encolar(evento);
      encolados.push(evento);
    }
  } catch (error) {
    // Un fallo aquí NO puede salir como 5xx: Meta desactivaría el webhook de
    // la WABA y con él el canal de todos los clientes que comparten esta URL.
    input.puertos.registrarFallo?.(error);
  }

  return { status: 200, body: "EVENT_RECEIVED", firmaOk: true, encolados, duplicados };
}
