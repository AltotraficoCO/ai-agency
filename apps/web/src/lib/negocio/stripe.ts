import "server-only";

/**
 * Stripe: cobro del plan, portal del cliente y recargas de crédito.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SIN CLAVE DE STRIPE, LA APLICACIÓN NO SE ROMPE
 * ════════════════════════════════════════════════════════════════════════════
 * Un desarrollador que clona el repositorio no tiene claves de Stripe, y un
 * comercial que enseña el producto tampoco. Si la pantalla de facturación
 * reventase sin `STRIPE_SECRET_KEY`, nadie podría ver el producto. Por eso:
 *
 *   · el cliente se construye PEREZOSAMENTE, nunca al importar el módulo;
 *   · `hayStripe()` es la única comprobación, y la interfaz la usa para
 *     explicarse en vez de para esconderse;
 *   · toda función que necesite la clave devuelve un resultado con `ok: false`
 *     y un motivo legible, no una excepción.
 *
 * El módulo `stripe` se importa de forma diferida por la misma razón: cargarlo
 * en el arranque de un despliegue sin claves no aporta nada.
 */
import type Stripe from "stripe";

export function hayStripe(): boolean {
  return Boolean(process.env["STRIPE_SECRET_KEY"]);
}

export function hayWebhookConfigurado(): boolean {
  return Boolean(process.env["STRIPE_WEBHOOK_SECRET"]);
}

let cliente: Stripe | null = null;

export async function obtenerStripe(): Promise<Stripe | null> {
  const clave = process.env["STRIPE_SECRET_KEY"];
  if (!clave) return null;
  if (cliente) return cliente;
  const { default: StripeSdk } = await import("stripe");
  cliente = new StripeSdk(clave, { typescript: true });
  return cliente;
}

export type ResultadoSesion =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly motivo: string };

const SIN_CLAVE: ResultadoSesion = {
  ok: false,
  motivo:
    "Stripe todavía no está configurado en esta instalación. Faltan STRIPE_SECRET_KEY y los identificadores de precio.",
};

function urlBase(): string {
  return process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";
}

/** Suscripción a un plan. `precioEnv` es el nombre de la variable, no el precio. */
export async function sesionDeSuscripcion(entrada: {
  workspaceId: string;
  correo: string;
  precioEnv: string;
  clientePrevio?: string | null;
}): Promise<ResultadoSesion> {
  const stripe = await obtenerStripe();
  const precio = process.env[entrada.precioEnv];
  if (!stripe || !precio) return SIN_CLAVE;

  const sesion = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: precio, quantity: 1 }],
    success_url: `${urlBase()}/ajustes/facturacion?resultado=ok`,
    cancel_url: `${urlBase()}/ajustes/facturacion?resultado=cancelado`,
    ...(entrada.clientePrevio ? { customer: entrada.clientePrevio } : { customer_email: entrada.correo }),
    // El espacio viaja en los metadatos: el webhook llega sin sesión de usuario
    // y es lo único que le dice a qué cartera abonar.
    metadata: { workspace_id: entrada.workspaceId, tipo: "suscripcion" },
    subscription_data: { metadata: { workspace_id: entrada.workspaceId } },
  });

  return sesion.url ? { ok: true, url: sesion.url } : { ok: false, motivo: "Stripe no devolvió URL." };
}

/**
 * Recarga de créditos: pago único.
 *
 * Los créditos comprados NO caducan. Se abonan al bolsillo `purchased`, que la
 * renovación del periodo no toca. Esa es toda la diferencia con los incluidos,
 * y está en `charge_credits`: primero se gasta lo incluido y solo después lo
 * comprado, para que el cliente no queme lo que pagó teniendo saldo de plan.
 */
export async function sesionDeRecarga(entrada: {
  workspaceId: string;
  correo: string;
  precioEnv: string;
  creditos: number;
  clientePrevio?: string | null;
}): Promise<ResultadoSesion> {
  const stripe = await obtenerStripe();
  const precio = process.env[entrada.precioEnv];
  if (!stripe || !precio) return SIN_CLAVE;

  const sesion = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: precio, quantity: 1 }],
    success_url: `${urlBase()}/ajustes/facturacion?resultado=recargado`,
    cancel_url: `${urlBase()}/ajustes/facturacion?resultado=cancelado`,
    ...(entrada.clientePrevio ? { customer: entrada.clientePrevio } : { customer_email: entrada.correo }),
    metadata: {
      workspace_id: entrada.workspaceId,
      tipo: "recarga",
      creditos: String(entrada.creditos),
    },
  });

  return sesion.url ? { ok: true, url: sesion.url } : { ok: false, motivo: "Stripe no devolvió URL." };
}

/** Portal del cliente: método de pago, facturas y cancelación, gestionados por Stripe. */
export async function sesionDePortal(clienteStripe: string | null): Promise<ResultadoSesion> {
  const stripe = await obtenerStripe();
  if (!stripe) return SIN_CLAVE;
  if (!clienteStripe) {
    return { ok: false, motivo: "Todavía no hay ningún pago asociado a este espacio." };
  }
  const sesion = await stripe.billingPortal.sessions.create({
    customer: clienteStripe,
    return_url: `${urlBase()}/ajustes/facturacion`,
  });
  return { ok: true, url: sesion.url };
}

/** Facturas del espacio. Devuelve lista vacía —no error— si no hay Stripe. */
export type Factura = {
  readonly id: string;
  readonly numero: string;
  readonly fecha: string;
  readonly totalUsd: number;
  readonly estado: string;
  readonly urlPdf: string | null;
};

export async function facturasDelCliente(clienteStripe: string | null): Promise<Factura[]> {
  const stripe = await obtenerStripe();
  if (!stripe || !clienteStripe) return [];
  const lista = await stripe.invoices.list({ customer: clienteStripe, limit: 12 });
  return lista.data.map((f) => ({
    id: f.id ?? "",
    numero: f.number ?? f.id ?? "",
    fecha: new Date((f.created ?? 0) * 1000).toISOString(),
    totalUsd: (f.total ?? 0) / 100,
    estado: f.status ?? "desconocido",
    urlPdf: f.invoice_pdf ?? null,
  }));
}
