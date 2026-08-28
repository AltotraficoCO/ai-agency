/**
 * El webhook de WhatsApp.
 *
 * Esta ruta es deliberadamente TONTA: verifica, guarda crudo y responde. Toda
 * la inteligencia —firma, deduplicación, descomposición en eventos— vive en
 * `@strappy/whatsapp`, que se puede probar sin servidor y sin base de datos.
 *
 * TRES COSAS QUE NO SE PUEDEN CAMBIAR SIN ROMPER ALGO:
 *
 * 1. `await peticion.text()`, NUNCA `peticion.json()`. La firma de Meta se
 *    calcula sobre los bytes exactos que envió; `JSON.parse` + `JSON.stringify`
 *    reordena claves y cambia el escapado, y a partir de ahí ninguna firma
 *    cuadra. El error se ve como «firma inválida» y se «arregla» desactivando
 *    la validación, que es cómo se acaba aceptando eventos falsificados.
 *
 * 2. Se responde 200 aunque el procesamiento falle. Meta desactiva la
 *    suscripción de una WABA que devuelve 5xx repetidamente, y como Tech
 *    Provider todas las WABA de todos los clientes apuntan a esta misma URL: un
 *    error interno propagado como 5xx tumbaría a todos a la vez, y volver a
 *    suscribir cada WABA es manual. La única excepción es la firma inválida.
 *
 * 3. La deduplicación la decide la BASE, con el único sobre `event_hash` de
 *    cada partición de `webhook_events`. No hay `select` previo: dos entregas
 *    simultáneas del mismo evento lo pasarían las dos.
 */
import { after } from "next/server";
import {
  CABECERA_FIRMA,
  recibirWebhook,
  verificarChallenge,
  type EventoWebhook,
  type PuertosWebhook,
} from "@strappy/whatsapp";
import { consultar } from "@/lib/db/pool";
import { materializarEvento } from "@/lib/bandeja/ingesta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verificación del endpoint. Meta la repite cada vez que se reconfigura. */
export async function GET(peticion: Request) {
  const resultado = verificarChallenge({
    query: new URL(peticion.url).searchParams,
    verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? "",
  });

  if (!resultado.ok) {
    return new Response(resultado.motivo, { status: 403 });
  }
  // Meta espera el challenge en texto plano, sin comillas ni JSON.
  return new Response(resultado.challenge, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

type EventoIngestado = { evento: EventoWebhook; eventoId: string };

export async function POST(peticion: Request) {
  // El cuerpo CRUDO. Ver la nota 1 de la cabecera.
  const cuerpoCrudo = await peticion.text();
  const cabeceraFirma = peticion.headers.get(CABECERA_FIRMA);

  const ingestados: EventoIngestado[] = [];

  const puertos: PuertosWebhook = {
    async registrarEvento(evento) {
      // `ingest_webhook_event` hace las dos cosas de una vez: resuelve el
      // tenant con UNA lectura de `channel_routing` por clave primaria e
      // inserta con `on conflict do nothing`. `is_new` viene de mirar si el
      // insert devolvió fila, no de haber consultado antes.
      const filas = await consultar<{ event_id: string | null; is_new: boolean }>(
        `select event_id, is_new
           from public.ingest_webhook_event($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb)`,
        [
          "whatsapp",
          evento.eventHash,
          JSON.stringify(evento.payload),
          evento.firmaOk,
          evento.externalKey ?? null,
          evento.tipo,
          JSON.stringify({ firma: cabeceraFirma ? "presente" : "ausente" }),
        ],
      );
      const fila = filas[0];
      if (!fila?.is_new || !fila.event_id) return false;
      ingestados.push({ evento, eventoId: fila.event_id });
      return true;
    },

    async encolar() {
      // El evento ya quedó en `webhook_events` con estado `pending`, que ES la
      // cola (índice `webhook_events_pending_idx`). Aquí no se espera a nadie:
      // el trabajo real ocurre en `after()`, después de responder a Meta.
    },

    registrarFallo(error) {
      console.error("webhook de WhatsApp:", error);
    },
  };

  const resultado = await recibirWebhook({
    cuerpoCrudo,
    cabeceraFirma,
    appSecret: process.env.META_APP_SECRET ?? "",
    puertos,
  });

  if (resultado.status === 200 && ingestados.length > 0) {
    after(async () => {
      for (const { evento, eventoId } of ingestados) {
        if (evento.tipo !== "message" || !evento.externalKey) continue;
        try {
          await materializarEvento({
            eventoId,
            externalKey: evento.externalKey,
            raw: evento.raw,
          });
        } catch (error) {
          // El crudo ya está guardado: se reprocesa desde nuestra cola, no
          // desde Meta. Fallar aquí no puede cambiar el 200 ya enviado.
          console.error("no pude materializar el evento", eventoId, error);
          await consultar(
            `update public.webhook_events
                set status = 'failed', attempts = attempts + 1, process_error = $2
              where id = $1`,
            [eventoId, error instanceof Error ? error.message : String(error)],
          ).catch(() => undefined);
        }
      }
    });
  }

  return new Response(resultado.body, {
    status: resultado.status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
