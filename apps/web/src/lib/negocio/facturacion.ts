import "server-only";

/**
 * Efectos de facturación sobre la base de datos.
 *
 * Todo lo que aquí se escribe lo dispara un webhook de Stripe, y un webhook
 * llega SIEMPRE más de una vez: Stripe reintenta ante cualquier respuesta que
 * no sea 2xx, y a veces manda el mismo evento dos veces sin que nadie falle.
 * Por eso cada efecto pasa por `credit_idempotency` con el identificador del
 * evento: reaplicar es gratis y no duplica saldo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA DEL CIERRE DE PERIODO
 * ────────────────────────────────────────────────────────────────────────────
 *   · `included_balance`  SE REPONE a la asignación del plan. Lo que sobró se
 *     pierde: es la asignación del mes, no un ahorro.
 *   · `purchased_balance` NO SE TOCA. Lo compró con dinero aparte y no caduca.
 *
 * Confundir los dos bolsillos es borrarle al cliente créditos que pagó.
 */
import type { TenantScope } from "@strappy/db";
import { conEspacio } from "@/lib/db/pool";
import { planPorClave, type ClavePlan } from "./planes";

/** Reclama la clave del evento. `false` = ya se aplicó y no hay que repetirlo. */
async function reclamar(scope: TenantScope, workspaceId: string, clave: string): Promise<boolean> {
  const { rows } = await scope.query<{ ok: boolean }>(
    `insert into public.credit_idempotency (workspace_id, idempotency_key)
     values ($1, $2)
     on conflict (workspace_id, idempotency_key) do nothing
     returning true as ok`,
    [workspaceId, clave],
  );
  return rows.length > 0;
}

/** Guarda el identificador de cliente y de suscripción de Stripe. */
export async function vincularClienteStripe(entrada: {
  workspaceId: string;
  clienteStripe: string;
  suscripcionStripe?: string | null;
}): Promise<void> {
  await conEspacio(entrada.workspaceId, async (scope) => {
    await scope.query(
      `update public.subscriptions
          set provider = 'stripe',
              external_id = coalesce($2, external_id),
              metadata = metadata || jsonb_build_object('stripe_customer_id', $3::text)
        where workspace_id = $1`,
      [entrada.workspaceId, entrada.suscripcionStripe ?? null, entrada.clienteStripe],
    );
  });
}

export async function clienteStripeDelEspacio(workspaceId: string): Promise<string | null> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{ cliente: string | null }>(
      `select metadata->>'stripe_customer_id' as cliente
         from public.subscriptions where workspace_id = $1`,
      [workspaceId],
    );
    return rows[0]?.cliente ?? null;
  });
}

/**
 * Abona una recarga. Idempotente por el identificador del evento de Stripe.
 * Va al bolsillo `purchased`, que no caduca nunca.
 */
export async function abonarRecarga(entrada: {
  workspaceId: string;
  eventoId: string;
  creditos: number;
  descripcion?: string;
}): Promise<{ aplicado: boolean; saldo: number }> {
  return conEspacio(entrada.workspaceId, async (scope) => {
    const { rows } = await scope.query<{ applied: boolean; balance_after: string }>(
      `select applied, balance_after
         from public.grant_credits($1, $2, $3::numeric, 'purchased', 'topup', $4, '{}'::jsonb)`,
      [
        entrada.workspaceId,
        `stripe:${entrada.eventoId}`,
        entrada.creditos,
        entrada.descripcion ?? "Recarga de créditos",
      ],
    );
    return { aplicado: rows[0]?.applied === true, saldo: Number(rows[0]?.balance_after ?? 0) };
  });
}

/** Cambia el plan del espacio y su estado. No toca saldos: eso lo hace la renovación. */
export async function fijarPlan(entrada: {
  workspaceId: string;
  plan: ClavePlan;
  estado: string;
  inicioPeriodo?: Date | null;
  finPeriodo?: Date | null;
  suscripcionStripe?: string | null;
}): Promise<void> {
  const plan = planPorClave(entrada.plan);
  await conEspacio(entrada.workspaceId, async (scope) => {
    await scope.query(
      `update public.subscriptions
          set plan = $2,
              status = $3,
              provider = 'stripe',
              external_id = coalesce($4, external_id),
              included_credits_monthly = $5,
              price_amount = $6,
              current_period_start = coalesce($7::timestamptz, current_period_start),
              current_period_end   = coalesce($8::timestamptz, current_period_end)
        where workspace_id = $1`,
      [
        entrada.workspaceId,
        plan.clave,
        entrada.estado,
        entrada.suscripcionStripe ?? null,
        plan.creditosIncluidos,
        plan.precioUsd,
        entrada.inicioPeriodo?.toISOString() ?? null,
        entrada.finPeriodo?.toISOString() ?? null,
      ],
    );
  });
}

/**
 * Cierra un periodo y abre el siguiente.
 *
 * `included_balance` pasa a valer exactamente la asignación del plan (no se
 * suma: se REPONE, para que lo no gastado no se acumule) y `purchased_balance`
 * se deja intacto. La operación queda anotada en el libro para que la diferencia
 * de saldo del día 1 tenga una explicación auditable.
 */
export async function renovarPeriodo(entrada: {
  workspaceId: string;
  eventoId: string;
  plan: ClavePlan;
  inicio: Date;
  fin: Date;
}): Promise<{ aplicado: boolean }> {
  const plan = planPorClave(entrada.plan);
  return conEspacio(entrada.workspaceId, async (scope) => {
    const clave = `renovacion:${entrada.eventoId}`;
    if (!(await reclamar(scope, entrada.workspaceId, clave))) return { aplicado: false };

    const previo = await scope.query<{ included_balance: string; purchased_balance: string }>(
      `select included_balance, purchased_balance
         from public.credit_wallets where workspace_id = $1 for update`,
      [entrada.workspaceId],
    );
    const incluidoPrevio = Number(previo.rows[0]?.included_balance ?? 0);
    const compradoPrevio = Number(previo.rows[0]?.purchased_balance ?? 0);

    await scope.query(
      `update public.credit_wallets
          set included_balance = $2::numeric,
              included_granted = $2::numeric,
              period_start = $3::timestamptz,
              period_end   = $4::timestamptz,
              updated_at = now()
        where workspace_id = $1`,
      [entrada.workspaceId, plan.creditosIncluidos, entrada.inicio.toISOString(), entrada.fin.toISOString()],
    );

    await scope.query(
      `insert into public.credit_ledger
         (workspace_id, direction, source, amount, from_included, from_purchased,
          balance_after, idempotency_key, description, metadata)
       values ($1, 'credit', 'plan_renewal', $2::numeric, $2::numeric, 0,
               $3::numeric, $4, $5, $6::jsonb)
       on conflict do nothing`,
      [
        entrada.workspaceId,
        plan.creditosIncluidos,
        plan.creditosIncluidos + compradoPrevio,
        clave,
        `Renovación del plan ${plan.nombre}`,
        JSON.stringify({
          incluido_previo: incluidoPrevio,
          comprado_conservado: compradoPrevio,
          nota: "El saldo comprado no caduca y no se toca en la renovación.",
        }),
      ],
    );

    return { aplicado: true };
  });
}

/** Registra en la bitácora un hecho de facturación. Solo lectura para el cliente. */
export async function anotarEnBitacora(entrada: {
  workspaceId: string;
  accion: string;
  entidad?: string;
  entidadId?: string;
  detalle?: Record<string, unknown>;
}): Promise<void> {
  await conEspacio(entrada.workspaceId, async (scope) => {
    await scope.query(
      `insert into public.audit_log (workspace_id, actor_type, action, entity_type, entity_id, after)
       values ($1, 'system', $2, $3, $4, $5::jsonb)`,
      [
        entrada.workspaceId,
        entrada.accion,
        entrada.entidad ?? "billing",
        entrada.entidadId ?? null,
        JSON.stringify(entrada.detalle ?? {}),
      ],
    );
  });
}

/** Espacio dueño de un cliente de Stripe, para los eventos que no traen metadatos. */
export async function espacioDeClienteStripe(clienteStripe: string): Promise<string | null> {
  const { consultar } = await import("@/lib/db/pool");
  const filas = await consultar<{ workspace_id: string }>(
    `select workspace_id from public.subscriptions
      where metadata->>'stripe_customer_id' = $1
      limit 1`,
    [clienteStripe],
  );
  return filas[0]?.workspace_id ?? null;
}
