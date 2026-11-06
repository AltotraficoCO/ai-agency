/**
 * Recarga automática sobre Postgres. El worker se conecta como rol de servicio
 * y cruza espacios a propósito: tiene que encontrar quién se quedó sin saldo.
 */
import { randomUUID } from "node:crypto";
import { aplicarClaveDeCartera, leerAjustesDeCobro, type AjustesDeCobro } from "@strappy/db/adapters";
import {
  ORDEN_PENDIENTE_CADUCA_MS,
  type EstadoRecarga,
  type MotivoApagado,
} from "@strappy/core/recargas";
import type { CandidataRecarga, RecargasAutomaticasPort } from "../consumers/recargas.js";
import type { SqlPool } from "../ports.js";

export class RecargasAutomaticasPostgres implements RecargasAutomaticasPort {
  readonly #pool: SqlPool;

  #ajustes: { valor: AjustesDeCobro; hasta: number } | null = null;

  constructor(pool: SqlPool) {
    this.#pool = pool;
  }

  /**
   * El worker consulta cada pocos segundos: un cambio del panel tarda hasta un
   * minuto. De paso deja la clave de la cartera de modelos en el entorno, que
   * es donde la leen el motor, el estudio y los embeddings.
   */
  async ajustes(): Promise<AjustesDeCobro> {
    if (this.#ajustes && this.#ajustes.hasta > Date.now()) return this.#ajustes.valor;
    const valor = await leerAjustesDeCobro((texto, valores) => this.#pool.query(texto, valores));
    aplicarClaveDeCartera(valor.cartera);
    this.#ajustes = { valor, hasta: Date.now() + 60_000 };
    return valor;
  }

  async candidatas(limite: number, umbral: number): Promise<readonly CandidataRecarga[]> {
    const { rows } = await this.#pool.query<{
      workspace_id: string;
      usd_amount: string;
      payment_source_id: string;
      customer_email: string;
      disponible: string;
    }>(
      `select a.workspace_id, a.usd_amount, a.payment_source_id, a.customer_email,
              w.included_balance + w.purchased_balance - w.reserved_balance as disponible
         from public.credit_auto_topups a
         join public.credit_wallets w using (workspace_id)
         join public.workspaces e on e.id = a.workspace_id
        where a.enabled
          and e.status = 'active'
          and a.payment_source_id is not null
          and a.customer_email is not null
          and w.included_balance + w.purchased_balance - w.reserved_balance < $1
        order by w.updated_at asc
        limit $2`,
      [umbral, limite],
    );
    return rows.map((f) => ({
      workspaceId: f.workspace_id,
      usd: Number(f.usd_amount),
      fuenteDePago: Number(f.payment_source_id),
      correo: f.customer_email,
      disponible: Number(f.disponible),
    }));
  }

  async recientes(workspaceId: string) {
    const { rows } = await this.#pool.query<{ status: EstadoRecarga; created_at: string }>(
      `select status, created_at from public.credit_topups
        where workspace_id = $1 and origin = 'auto' and created_at >= now() - interval '24 hours'
        order by created_at desc`,
      [workspaceId],
    );
    return rows.map((f) => ({ estado: f.status, creadaEn: new Date(f.created_at) }));
  }

  async crearOrden(entrada: {
    workspaceId: string;
    usd: number;
    creditos: number;
    trm: number;
    centavos: number;
  }): Promise<{ referencia: string } | null> {
    const referencia = `strappy-auto-${randomUUID()}`;
    const { rows } = await this.#pool.query(
      `insert into public.credit_topups
         (workspace_id, reference, usd_amount, credits, trm, amount_in_cents, origin)
       values ($1, $2, $3, $4, $5, $6, 'auto')
       on conflict do nothing
       returning id`,
      [entrada.workspaceId, referencia, entrada.usd, entrada.creditos, entrada.trm, entrada.centavos],
    );
    return rows.length > 0 ? { referencia } : null;
  }

  async marcarFallida(referencia: string, motivo: string): Promise<void> {
    await this.#pool.query(
      `update public.credit_topups set status = 'error', failure_reason = left($2, 500)
        where reference = $1 and credited_at is null`,
      [referencia, motivo],
    );
  }

  async caducarPendientes(): Promise<void> {
    await this.#pool.query(
      `update public.credit_topups set status = 'error'
        where origin = 'auto' and status = 'pending' and credited_at is null
          and created_at < now() - ($1::bigint * interval '1 millisecond')`,
      [ORDEN_PENDIENTE_CADUCA_MS],
    );
  }

  async apagar(workspaceId: string, motivo: MotivoApagado): Promise<void> {
    await this.#pool.query(
      `update public.credit_auto_topups set enabled = false, disabled_reason = $2 where workspace_id = $1`,
      [workspaceId, motivo],
    );
    await this.#pool.query(
      `insert into public.audit_log (workspace_id, actor_type, action, entity_type, after)
       values ($1, 'system', 'recarga_automatica.apagada', 'billing', $2::jsonb)`,
      [workspaceId, JSON.stringify({ motivo })],
    );
  }
}
