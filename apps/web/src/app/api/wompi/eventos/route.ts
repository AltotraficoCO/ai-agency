/**
 * Eventos de Wompi: lo único que abona créditos.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * TRES REGLAS QUE NO SE SALTAN
 * ════════════════════════════════════════════════════════════════════════════
 * 1. SE VERIFICA LA FIRMA. Sin ella, cualquiera con la URL puede regalarse
 *    créditos con un `curl`.
 * 2. TODO ES IDEMPOTENTE. Wompi reintenta y los eventos pueden repetirse: el
 *    abono depende de la orden, no del evento.
 * 3. SE RESPONDE 200 A LO QUE NO ENTENDEMOS. Solo un fallo nuestro devuelve 500,
 *    porque ahí el reintento (a los 30 min, 3 h y 24 h) es justo lo que queremos.
 */
import { eventoAutentico, transaccionDelEvento } from "@strappy/core/wompi";
import { aplicarTransaccion } from "@/lib/negocio/facturacion";
import { obtenerLlavesWompi } from "@/lib/plataforma/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const { eventos: secreto } = await obtenerLlavesWompi();
  if (!secreto) {
    return Response.json({ error: "Wompi no está configurado en esta instalación." }, { status: 503 });
  }

  let evento: unknown;
  try {
    evento = await peticion.json();
  } catch {
    return Response.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  if (!eventoAutentico(evento, secreto, peticion.headers.get("x-event-checksum"))) {
    return Response.json({ error: "Firma inválida." }, { status: 401 });
  }

  const transaccion = transaccionDelEvento(evento);
  if (!transaccion) return Response.json({ recibido: true });

  try {
    const resultado = await aplicarTransaccion(transaccion);
    if (resultado === "importe_distinto" || resultado === "revertida_tras_abonar") {
      console.error("[wompi] requiere revisión:", resultado, transaccion.referencia);
    } else if (resultado === "desconocida") {
      console.warn("[wompi] referencia desconocida:", transaccion.referencia);
    }
    return Response.json({ recibido: true });
  } catch (error) {
    console.error("[wompi] fallo al aplicar", transaccion.referencia, error);
    return Response.json({ error: "No se pudo procesar el evento." }, { status: 500 });
  }
}
