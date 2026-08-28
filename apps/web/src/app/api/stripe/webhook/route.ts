/**
 * Webhook de Stripe.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * TRES REGLAS QUE NO SE SALTAN
 * ════════════════════════════════════════════════════════════════════════════
 * 1. SE VERIFICA LA FIRMA. Sin ella, cualquiera con la URL puede regalarse
 *    créditos con un `curl`. Por eso hace falta el cuerpo CRUDO (`req.text()`)
 *    y no `req.json()`: la firma se calcula sobre los bytes exactos.
 * 2. TODO ES IDEMPOTENTE. Stripe reintenta ante cualquier respuesta que no sea
 *    2xx y a veces repite eventos sin motivo. Cada efecto se reclama con el
 *    identificador del evento en `credit_idempotency`.
 * 3. SE RESPONDE 200 A LO QUE NO ENTENDEMOS. Un 500 por un evento que no
 *    tratamos hace que Stripe reintente durante días y acabe desactivando el
 *    endpoint, y entonces se pierden los que sí importan.
 */
import type Stripe from "stripe";
import {
  abonarRecarga,
  anotarEnBitacora,
  espacioDeClienteStripe,
  fijarPlan,
  renovarPeriodo,
  vincularClienteStripe,
} from "@/lib/negocio/facturacion";
import { planPorPrecioStripe, recargaPorPrecioStripe } from "@/lib/negocio/planes";
import { hayWebhookConfigurado, obtenerStripe } from "@/lib/negocio/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const stripe = await obtenerStripe();
  const secreto = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!stripe || !hayWebhookConfigurado() || !secreto) {
    // 503, no 500: no es un fallo, es que esta instalación no tiene Stripe.
    return Response.json({ error: "Stripe no está configurado en esta instalación." }, { status: 503 });
  }

  const firma = peticion.headers.get("stripe-signature");
  if (!firma) return Response.json({ error: "Falta la firma." }, { status: 400 });

  const crudo = await peticion.text();
  let evento: Stripe.Event;
  try {
    evento = await stripe.webhooks.constructEventAsync(crudo, firma, secreto);
  } catch (error) {
    return Response.json(
      { error: `Firma inválida: ${error instanceof Error ? error.message : "desconocido"}` },
      { status: 400 },
    );
  }

  try {
    await procesar(evento);
  } catch (error) {
    // Aquí sí conviene el 500: es un fallo nuestro y el reintento de Stripe
    // es exactamente lo que queremos.
    console.error("[stripe] fallo al procesar", evento.type, error);
    return Response.json({ error: "No se pudo procesar el evento." }, { status: 500 });
  }

  return Response.json({ recibido: true });
}

async function procesar(evento: Stripe.Event): Promise<void> {
  switch (evento.type) {
    case "checkout.session.completed":
      return alCompletarPago(evento.data.object, evento.id);

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return alCambiarSuscripcion(evento.data.object, evento.type);

    case "invoice.paid":
    case "invoice.payment_succeeded":
      return alPagarFactura(evento.data.object, evento.id);

    case "invoice.payment_failed":
      return alFallarPago(evento.data.object);

    default:
      // Ni error ni silencio: queda anotado que llegó y no se trató.
      console.info("[stripe] evento no tratado:", evento.type);
  }
}

async function alCompletarPago(sesion: Stripe.Checkout.Session, eventoId: string): Promise<void> {
  const workspaceId = sesion.metadata?.["workspace_id"];
  if (!workspaceId) return;

  const cliente = texto(sesion.customer);
  if (cliente) {
    await vincularClienteStripe({
      workspaceId,
      clienteStripe: cliente,
      suscripcionStripe: texto(sesion.subscription),
    });
  }

  if (sesion.metadata?.["tipo"] === "recarga") {
    const creditos = Number(sesion.metadata?.["creditos"] ?? 0);
    if (creditos > 0) {
      // Créditos comprados: van al bolsillo que NO caduca.
      await abonarRecarga({ workspaceId, eventoId, creditos, descripcion: "Recarga de créditos" });
      await anotarEnBitacora({
        workspaceId,
        accion: "creditos.recarga",
        entidadId: sesion.id,
        detalle: { creditos, nota: "Los créditos comprados no caducan." },
      });
    }
  }
}

async function alCambiarSuscripcion(
  suscripcion: Stripe.Subscription,
  tipo: string,
): Promise<void> {
  const workspaceId =
    suscripcion.metadata?.["workspace_id"] ?? (await espacioDeClienteStripe(texto(suscripcion.customer) ?? ""));
  if (!workspaceId) return;

  if (tipo === "customer.subscription.deleted") {
    // Cancelar no borra: baja al plan Free. La bandeja y el histórico siguen.
    await fijarPlan({ workspaceId, plan: "trial", estado: "cancelled" });
    await anotarEnBitacora({ workspaceId, accion: "plan.cancelado", entidadId: suscripcion.id });
    return;
  }

  const precio = suscripcion.items?.data?.[0]?.price?.id ?? null;
  const plan = planPorPrecioStripe(precio);
  if (!plan) {
    console.info("[stripe] precio sin plan conocido:", precio);
    return;
  }

  const periodo = periodoDe(suscripcion);
  await fijarPlan({
    workspaceId,
    plan: plan.clave,
    estado: estadoDe(suscripcion.status),
    suscripcionStripe: suscripcion.id,
    inicioPeriodo: periodo.inicio,
    finPeriodo: periodo.fin,
  });
}

async function alPagarFactura(factura: Stripe.Invoice, eventoId: string): Promise<void> {
  const cliente = texto(factura.customer);
  const workspaceId = cliente ? await espacioDeClienteStripe(cliente) : null;
  if (!workspaceId) return;

  const linea = factura.lines?.data?.[0];
  const precio = idDePrecioDeLinea(linea);

  // Una factura puede ser de recarga (pago único) o de renovación del plan.
  const recarga = recargaPorPrecioStripe(precio);
  if (recarga) {
    await abonarRecarga({
      workspaceId,
      eventoId,
      creditos: recarga.creditos,
      descripcion: "Recarga de créditos",
    });
    return;
  }

  const plan = planPorPrecioStripe(precio);
  if (!plan) return;

  const inicio = segundosAFecha(linea?.period?.start) ?? new Date();
  const fin = segundosAFecha(linea?.period?.end) ?? mesSiguiente(inicio);

  // Aquí se repone `included_balance` y NO se toca `purchased_balance`.
  await renovarPeriodo({ workspaceId, eventoId, plan: plan.clave, inicio, fin });
  await fijarPlan({
    workspaceId,
    plan: plan.clave,
    estado: "active",
    inicioPeriodo: inicio,
    finPeriodo: fin,
  });
}

async function alFallarPago(factura: Stripe.Invoice): Promise<void> {
  const cliente = texto(factura.customer);
  const workspaceId = cliente ? await espacioDeClienteStripe(cliente) : null;
  if (!workspaceId) return;

  // `past_due` no apaga nada por sí solo: el bot para cuando se agota el saldo,
  // no cuando falla una tarjeta. Cortar la atención al cliente por un impago de
  // un día es desproporcionado y no acelera el cobro.
  await fijarPlan({ workspaceId, plan: "trial", estado: "past_due" });
  await anotarEnBitacora({ workspaceId, accion: "pago.fallido", entidadId: factura.id ?? undefined });
}

// ── Utilidades ──────────────────────────────────────────────────────────────

function texto(valor: unknown): string | null {
  if (typeof valor === "string") return valor;
  if (valor && typeof valor === "object" && "id" in valor) {
    const id = (valor as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

function estadoDe(estado: string): string {
  // Los estados de Stripe y los del CHECK de `subscriptions.status` no coinciden.
  switch (estado) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "paused":
      return "paused";
    default:
      return "cancelled";
  }
}

/**
 * El periodo de la suscripción.
 *
 * Stripe ha ido moviendo `current_period_start/end` entre la suscripción y sus
 * líneas según la versión de API. Se lee de forma defensiva de los dos sitios
 * en vez de fijar una versión: una factura mal fechada repone el saldo en el
 * día equivocado.
 */
function periodoDe(suscripcion: Stripe.Subscription): { inicio: Date | null; fin: Date | null } {
  const suelto = suscripcion as unknown as Record<string, unknown>;
  const item = suscripcion.items?.data?.[0] as unknown as Record<string, unknown> | undefined;
  const inicio =
    segundosAFecha(suelto["current_period_start"]) ?? segundosAFecha(item?.["current_period_start"]);
  const fin = segundosAFecha(suelto["current_period_end"]) ?? segundosAFecha(item?.["current_period_end"]);
  return { inicio, fin };
}

function idDePrecioDeLinea(linea: unknown): string | null {
  if (!linea || typeof linea !== "object") return null;
  const suelta = linea as Record<string, unknown>;
  const directo = texto((suelta["price"] as { id?: unknown } | undefined) ?? null);
  if (directo) return directo;
  const precios = suelta["pricing"] as { price_details?: { price?: unknown } } | undefined;
  return texto(precios?.price_details?.price ?? null);
}

function segundosAFecha(valor: unknown): Date | null {
  return typeof valor === "number" && Number.isFinite(valor) ? new Date(valor * 1000) : null;
}

function mesSiguiente(desde: Date): Date {
  const siguiente = new Date(desde);
  siguiente.setMonth(siguiente.getMonth() + 1);
  return siguiente;
}
