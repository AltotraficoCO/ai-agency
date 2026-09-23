/**
 * `CreditLedgerPort` sobre la función SQL `charge_credits`.
 *
 * Toda la lógica delicada —reclamar la clave de idempotencia antes de tocar el
 * saldo, bloquear la cartera, valorar con la tarifa vigente, escribir el asiento
 * y descontar en la misma transacción— vive en la base de datos. Aquí solo se
 * traduce.
 *
 * La traducción que importa: `applied = false, reason = 'duplicate'` NO es un
 * error. Significa «este cobro ya estaba hecho», y el motor debe seguir como si
 * hubiera cobrado, sin volver a intentarlo y sin sumarlo dos veces al total.
 */
import type { CreditEntry, CreditChargeResult, CreditLedgerPort, RateTable } from '@strappy/core';
import type { TenantScope } from '../client.js';
import type { ChargeItem, ChargeResult } from '../types.js';
import { aNumero } from './util.js';

/**
 * Tarifa de una unidad de crédito.
 *
 * El motor ya calcula cuántos créditos cuesta un paso (con la tabla que sale de
 * `credit_rates`), así que al libro solo le queda cobrar esa cantidad exacta.
 * `charge_credits` valora por tarifa, no admite un importe suelto: hace falta
 * una tarifa de 1 crédito por unidad. Se busca por orden de preferencia y se
 * memoriza, porque es la misma en todas las llamadas del proceso.
 */
const TARIFAS_UNITARIAS: readonly { kind: string; refKey: string }[] = [
  { kind: 'platform_credit', refKey: '*' },
  { kind: 'tool_call', refKey: '*' },
];

export class SinTarifaUnitariaError extends Error {
  constructor() {
    super(
      'No hay ninguna tarifa de 1 crédito por unidad en credit_rates. ' +
        'Sin ella el libro no puede cobrar un importe ya calculado.',
    );
    this.name = 'SinTarifaUnitariaError';
  }
}

export type OpcionesLibro = {
  /** Se cachea entre llamadas para no consultar `credit_rates` en cada cobro. */
  tarifaUnitaria?: { kind: string; refKey: string };
};

export function crearCreditLedger(
  scope: TenantScope,
  opciones: OpcionesLibro = {},
): CreditLedgerPort & { tarifaUnitaria(): Promise<{ kind: string; refKey: string }> } {
  const ws = scope.workspaceId;
  let unitaria = opciones.tarifaUnitaria ?? null;

  async function resolverUnitaria(): Promise<{ kind: string; refKey: string }> {
    if (unitaria) return unitaria;
    const { rows } = await scope.query<{ kind: string; ref_key: string }>(
      `select kind, ref_key
         from public.credit_rates
        where unit in ('unit', 'run')
          and credits_per_unit = 1
          and effective_from <= now()
          and (effective_to is null or effective_to > now())`,
      [],
    );
    const disponibles = new Set(rows.map((r) => `${r.kind}|${r.ref_key}`));
    const elegida = TARIFAS_UNITARIAS.find((t) => disponibles.has(`${t.kind}|${t.refKey}`));
    if (!elegida) throw new SinTarifaUnitariaError();
    unitaria = elegida;
    return elegida;
  }

  return {
    tarifaUnitaria: resolverUnitaria,

    async charge(entry: CreditEntry): Promise<CreditChargeResult> {
      scope.assertSameWorkspace(entry.workspaceId);
      const creditos = Math.max(0, Math.ceil(entry.credits));
      if (creditos === 0) {
        return { applied: false, balance: await saldo(scope, ws) };
      }

      const tarifa = await resolverUnitaria();
      const items: ChargeItem[] = [
        { kind: tarifa.kind, ref_key: tarifa.refKey, quantity: creditos },
      ];

      const { rows } = await scope.query<ChargeResult>(
        `select * from public.charge_credits(
           $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9::jsonb, now(), false)`,
        [
          ws,
          entry.idempotencyKey,
          JSON.stringify(items),
          origenDe(entry),
          entry.conversationId ? 'conversation' : null,
          entry.conversationId ?? null,
          entry.agentRunId ?? null,
          descripcionDe(entry),
          JSON.stringify({ tipo: entry.kind, ...(entry.metadata ?? {}) }),
        ],
      );
      const fila = rows[0];
      if (!fila) throw new Error('charge_credits no devolvió ninguna fila.');

      // `duplicate` y `no_credits` comparten forma pero no significado: el
      // primero ya cobró, el segundo no pudo. Los dos devuelven applied=false,
      // y el motor solo suma al total cuando applied es true.
      return { applied: fila.applied === true, balance: aNumero(fila.balance_after) };
    },

    async balance(workspaceId: string): Promise<number> {
      scope.assertSameWorkspace(workspaceId);
      return saldo(scope, ws);
    },
  };
}

function origenDe(entry: CreditEntry): string {
  switch (entry.kind) {
    case 'model':
      return 'agent_run';
    case 'tool':
      return 'tool_run';
    case 'channel':
      return 'message_out';
    case 'adjustment':
      return 'adjustment';
  }
}

function descripcionDe(entry: CreditEntry): string | null {
  const modelo = entry.metadata?.['model'];
  if (typeof modelo === 'string') return `Modelo ${modelo}`;
  return null;
}

async function saldo(scope: TenantScope, ws: string): Promise<number> {
  const { rows } = await scope.query<{ disponible: string | null }>(
    `select included_balance + purchased_balance - reserved_balance as disponible
       from public.credit_wallets
      where workspace_id = $1`,
    [ws],
  );
  return aNumero(rows[0]?.disponible);
}

/**
 * Construye la `RateTable` del motor a partir de `credit_rates`.
 *
 * La conversión es la identidad, y no por casualidad: el motor tarifica en
 * dólares de venta por millón de tokens y luego divide por 0,001 USD para pasar
 * a créditos, lo que da exactamente los créditos por mil tokens que guarda
 * `credit_rates.credits_per_unit`. Mantener las dos tablas sincronizadas sería
 * garantizar que un día divergen; por eso hay una sola y esta función la lee.
 */
export async function cargarTarifas(scope: TenantScope): Promise<RateTable> {
  const { rows } = await scope.query<{
    kind: string;
    ref_key: string;
    credits_per_unit: string;
  }>(
    `select kind, ref_key, credits_per_unit
       from public.credit_rates
      where kind in ('model_input', 'model_output', 'model_cache_read')
        and effective_from <= now()
        and (effective_to is null or effective_to > now())
      order by effective_from asc`,
    [],
  );

  const models: Record<string, { input: number; output: number; cacheRead?: number }> = {};
  for (const fila of rows) {
    const actual = models[fila.ref_key] ?? { input: 0, output: 0 };
    const valor = aNumero(fila.credits_per_unit);
    if (fila.kind === 'model_input') actual.input = valor;
    if (fila.kind === 'model_output') actual.output = valor;
    if (fila.kind === 'model_cache_read') actual.cacheRead = valor;
    models[fila.ref_key] = actual;
  }

  return {
    models,
    // Un modelo que no está en la tabla se cobra caro a propósito: el error
    // barato es cobrar de más y darse cuenta, no regalar tokens en silencio.
    fallback: { input: 6, output: 30, cacheRead: 0.6 },
  };
}

/**
 * Lo que se cobra por UNA imagen, según el generador que la dibuja.
 *
 * El precio de una imagen no es fijo: en Lite la dibuja Gemini y en Max
 * GPT Image 1, que cuesta cinco veces más. Cobrar lo mismo por las dos era
 * regalar las de Max. Así que la tarifa sale de `credit_rates` (kind
 * `model_image`) por identificador de modelo, igual que la de los tokens.
 *
 * Si el generador no tiene fila propia se usa la comodín `*`, que está puesta
 * al precio del caro a propósito. Si no hubiera ni comodín se devuelve `null`
 * y quien llama decide: el bucle del Diseñador cae entonces en su constante de
 * respaldo en vez de dibujar gratis.
 */
export async function cargarTarifaDeImagen(
  scope: TenantScope,
  modelo: string,
): Promise<number | null> {
  const { rows } = await scope.query<{ ref_key: string; credits_per_unit: string }>(
    `select ref_key, credits_per_unit
       from public.credit_rates
      where kind = 'model_image'
        and ref_key in ($1, '*')
        and effective_from <= now()
        and (effective_to is null or effective_to > now())
      order by case when ref_key = $1 then 0 else 1 end,
               effective_from desc
      limit 1`,
    [modelo],
  );
  const fila = rows[0];
  return fila ? aNumero(fila.credits_per_unit) : null;
}
