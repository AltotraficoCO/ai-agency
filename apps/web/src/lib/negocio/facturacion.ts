import "server-only";

/**
 * Recargas sobre la base de datos: crear la orden y aplicar lo que diga Wompi.
 *
 * Un evento llega más de una vez y puede llegar desordenado. Por eso todo pasa
 * por `decidirTransaccion` con la fila bloqueada, dentro de una transacción: si
 * algo falla, ni cambia la orden ni se abona, y el reintento de Wompi lo aplica.
 */
import { randomUUID } from "node:crypto";
import { conEspacio, consultar } from "@/lib/db/pool";
import { decidirTransaccion, type Cotizacion, type EstadoRecarga } from "@strappy/core/recargas";
import type { TransaccionWompi } from "@strappy/core/wompi";

export async function crearOrdenDeRecarga(entrada: {
  workspaceId: string;
  usuarioId: string;
  cotizacion: Cotizacion;
}): Promise<{ referencia: string }> {
  const referencia = `strappy-${randomUUID()}`;
  const { cotizacion } = entrada;
  await conEspacio(entrada.workspaceId, async (scope) => {
    await scope.query(
      `insert into public.credit_topups
         (workspace_id, reference, usd_amount, credits, trm, amount_in_cents, requested_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entrada.workspaceId,
        referencia,
        cotizacion.usd,
        cotizacion.creditos,
        cotizacion.trm,
        cotizacion.centavos,
        entrada.usuarioId,
      ],
    );
  });
  return { referencia };
}

export type ResultadoEvento =
  | "abonada"
  | "anotada"
  | "sin_cambios"
  | "desconocida"
  | "importe_distinto"
  | "revertida_tras_abonar";

export async function aplicarTransaccion(transaccion: TransaccionWompi): Promise<ResultadoEvento> {
  // El evento llega sin sesión: la referencia es lo único que dice de quién es.
  const [dueno] = await consultar<{ workspace_id: string }>(
    `select workspace_id from public.credit_topups where reference = $1`,
    [transaccion.referencia],
  );
  if (!dueno) return "desconocida";

  return conEspacio(dueno.workspace_id, async (scope) => {
    const { rows } = await scope.query<{
      id: string;
      credits: string;
      amount_in_cents: string;
      currency: string;
      credited_at: string | null;
    }>(
      `select id, credits, amount_in_cents, currency, credited_at
         from public.credit_topups where reference = $1 for update`,
      [transaccion.referencia],
    );
    const orden = rows[0];
    if (!orden) return "desconocida";

    const accion = decidirTransaccion(
      {
        centavos: Number(orden.amount_in_cents),
        moneda: orden.currency,
        abonada: orden.credited_at !== null,
      },
      transaccion,
    );

    const anotarEstado = (estado: EstadoRecarga) =>
      scope.query(
        `update public.credit_topups
            set status = $2, provider_transaction_id = $3, payment_method = $4
          where id = $1`,
        [orden.id, estado, transaccion.id, transaccion.metodo],
      );

    const bitacora = (accionBitacora: string, detalle: Record<string, unknown>) =>
      scope.query(
        `insert into public.audit_log (workspace_id, actor_type, action, entity_type, entity_id, after)
         values ($1, 'system', $2, 'billing', $3, $4::jsonb)`,
        [dueno.workspace_id, accionBitacora, orden.id, JSON.stringify(detalle)],
      );

    switch (accion.tipo) {
      case "abonar": {
        await anotarEstado("approved");
        await scope.query(`update public.credit_topups set credited_at = now() where id = $1`, [orden.id]);
        await scope.query(
          `select applied from public.grant_credits($1, $2, $3::numeric, 'purchased', 'topup', $4, $5::jsonb)`,
          [
            dueno.workspace_id,
            `wompi:${transaccion.referencia}`,
            orden.credits,
            "Recarga de créditos",
            JSON.stringify({ transaccion: transaccion.id, metodo: transaccion.metodo }),
          ],
        );
        await bitacora("creditos.recarga", { creditos: Number(orden.credits), transaccion: transaccion.id });
        return "abonada";
      }
      case "anotar":
        await anotarEstado(accion.estado);
        return "anotada";
      case "importe_distinto":
        await bitacora("pago.importe_distinto", {
          esperado: Number(orden.amount_in_cents),
          recibido: transaccion.centavos,
          moneda: transaccion.moneda,
          transaccion: transaccion.id,
        });
        return "importe_distinto";
      case "revertida_tras_abonar":
        await anotarEstado(accion.estado);
        await bitacora("pago.revertido_tras_abonar", {
          creditos: Number(orden.credits),
          transaccion: transaccion.id,
        });
        return "revertida_tras_abonar";
      case "nada":
        return "sin_cambios";
    }
  });
}

export type RecargaDelHistorial = {
  readonly id: string;
  readonly fecha: string;
  readonly usd: number;
  readonly pesos: number;
  readonly creditos: number;
  readonly estado: EstadoRecarga;
  readonly automatica: boolean;
};

export async function recargasDelEspacio(workspaceId: string, limite = 12): Promise<RecargaDelHistorial[]> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      id: string;
      created_at: string;
      usd_amount: string;
      amount_in_cents: string;
      credits: string;
      status: EstadoRecarga;
      origin: string;
    }>(
      `select id, created_at, usd_amount, amount_in_cents, credits, status, origin
         from public.credit_topups
        where workspace_id = $1
        order by created_at desc
        limit $2`,
      [workspaceId, limite],
    );
    return rows.map((f) => ({
      id: f.id,
      fecha: new Date(f.created_at).toISOString(),
      usd: Number(f.usd_amount),
      pesos: Number(f.amount_in_cents) / 100,
      creditos: Number(f.credits),
      estado: f.status,
      automatica: f.origin === "auto",
    }));
  });
}

export type RecargaAutomatica = {
  readonly activa: boolean;
  readonly usd: number;
  readonly tarjeta: string | null;
  readonly motivoApagado: string | null;
};

export async function recargaAutomaticaDelEspacio(workspaceId: string): Promise<RecargaAutomatica> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      enabled: boolean;
      usd_amount: string;
      payment_source_id: string | null;
      card_label: string | null;
      disabled_reason: string | null;
    }>(
      `select enabled, usd_amount, payment_source_id, card_label, disabled_reason
         from public.credit_auto_topups where workspace_id = $1`,
      [workspaceId],
    );
    const fila = rows[0];
    return {
      activa: fila?.enabled ?? false,
      usd: Number(fila?.usd_amount ?? 20),
      tarjeta: fila?.payment_source_id ? (fila.card_label ?? "Tarjeta registrada") : null,
      motivoApagado: fila?.disabled_reason ?? null,
    };
  });
}

/**
 * Guarda la tarjeta y deja la recarga apagada: la autorización se dio para otra
 * tarjeta, así que cambiarla exige autorizar de nuevo.
 */
export async function guardarTarjeta(entrada: {
  workspaceId: string;
  fuenteDePago: number;
  etiqueta: string;
  correo: string;
}): Promise<void> {
  await conEspacio(entrada.workspaceId, async (scope) => {
    await scope.query(
      `insert into public.credit_auto_topups (workspace_id, payment_source_id, card_label, customer_email)
       values ($1, $2, $3, $4)
       on conflict (workspace_id) do update
         set enabled = false,
             payment_source_id = excluded.payment_source_id,
             card_label = excluded.card_label,
             customer_email = excluded.customer_email,
             disabled_reason = null`,
      [entrada.workspaceId, entrada.fuenteDePago, entrada.etiqueta, entrada.correo],
    );
  });
}

/** Devuelve `false` si no hay tarjeta. Encenderla deja constancia de quién autorizó. */
export async function fijarRecargaAutomatica(entrada: {
  workspaceId: string;
  usuarioId: string;
  activa: boolean;
  usd: number;
}): Promise<boolean> {
  return conEspacio(entrada.workspaceId, async (scope) => {
    const { rows } = await scope.query(
      `update public.credit_auto_topups
          set enabled = $2,
              usd_amount = $3,
              disabled_reason = null,
              authorized_by = case when $2 then $4::uuid else authorized_by end,
              authorized_at = case when $2 then now() else authorized_at end
        where workspace_id = $1 and payment_source_id is not null
        returning workspace_id`,
      [entrada.workspaceId, entrada.activa, entrada.usd, entrada.usuarioId],
    );
    if (rows.length === 0) return false;
    await scope.query(
      `insert into public.audit_log (workspace_id, actor_type, action, entity_type, after)
       values ($1, 'user', $2, 'billing', $3::jsonb)`,
      [
        entrada.workspaceId,
        entrada.activa ? "recarga_automatica.activada" : "recarga_automatica.desactivada",
        JSON.stringify({ usd: entrada.usd, usuario: entrada.usuarioId }),
      ],
    );
    return true;
  });
}

export async function olvidarTarjeta(workspaceId: string): Promise<void> {
  await conEspacio(workspaceId, async (scope) => {
    await scope.query(
      `update public.credit_auto_topups
          set enabled = false, payment_source_id = null, card_label = null, customer_email = null
        where workspace_id = $1`,
      [workspaceId],
    );
  });
}
