import "server-only";

/**
 * Cartera y agentes contratados: cuánto queda, cuánto se gastó y cuánto se pagó.
 *
 * NO se suma nada de Meta. El gasto de WhatsApp lo cobra Meta directamente al
 * cliente y vive en `meta.ts`, con otro tipo, a propósito.
 */
import { conEspacio } from "@/lib/db/pool";
import { obtenerConfigCobro } from "@/lib/plataforma/config";
import { limitesDesdeAjustes, type LimitesGasto } from "./limites";
import { combinarFactura, type ResumenFactura } from "./factura";
import { creditosAUsd, diasDeSaldo, estadoDelSaldo, type EstadoSaldo } from "./creditos";

export type AgenteContratado = {
  readonly slug: string;
  readonly nombre: string;
  readonly tagline: string | null;
  readonly estado: "active" | "paused" | "cancelled";
  readonly agenteId: string | null;
  /** Fijo mensual del agente, en créditos. Vive en `catalog_agents`, no en código. */
  readonly creditosMensuales: number;
  /** El mismo fijo, en dólares. */
  readonly costeUsd: number;
  readonly desde: string;
};

export type Cartera = {
  /** Lo que el motor puede gastar ahora mismo. */
  readonly disponible: number;
  readonly reservado: number;
  readonly consumidosEnMes: number;
  readonly inicioMes: Date;
  /** Para cuántos días alcanza al ritmo reciente. `null` si aún no se puede saber. */
  readonly diasDeSaldo: number | null;
  readonly estado: EstadoSaldo;
  /** Identifica la última recarga; abre un ciclo nuevo de avisos. */
  readonly cicloDeAvisos: string;
};

export type EstadoNegocio = {
  readonly cartera: Cartera;
  readonly agentes: readonly AgenteContratado[];
  readonly factura: ResumenFactura;
  readonly limites: LimitesGasto;
};

type FilaCartera = {
  included_balance: string;
  purchased_balance: string;
  reserved_balance: string;
};

/**
 * Un único viaje a la base por visita. El mes es el natural en la zona horaria
 * del espacio: es el que el cliente tiene en la cabeza al leer «este mes».
 */
export async function estadoDelNegocio(workspaceId: string): Promise<EstadoNegocio> {
  const config = await obtenerConfigCobro();
  return conEspacio(workspaceId, async (scope) => {
    const cartera = await scope.query<FilaCartera>(
      `select included_balance, purchased_balance, reserved_balance
         from public.credit_wallets where workspace_id = $1`,
      [workspaceId],
    );
    const contratados = await scope.query<{
      slug: string;
      name: string;
      tagline: string | null;
      status: string;
      agent_id: string | null;
      monthly_credits: number;
      started_at: string;
    }>(
      `select c.slug, c.name, c.tagline, s.status, s.agent_id, c.monthly_credits, s.started_at
         from public.agent_subscriptions s
         join public.catalog_agents c on c.slug = s.catalog_slug
        where s.workspace_id = $1
        order by s.started_at asc`,
      [workspaceId],
    );
    const movimientos = await scope.query<{
      inicio_mes: string;
      gastado_mes: string;
      gastado_30: string;
      primer_gasto_30: string | null;
    }>(
      `with mes as (
         select date_trunc('month', now() at time zone timezone) at time zone timezone as inicio
           from public.workspaces where id = $1
       )
       select (select inicio from mes) as inicio_mes,
              coalesce(sum(amount) filter (where created_at >= (select inicio from mes)), 0) as gastado_mes,
              coalesce(sum(amount) filter (where created_at >= now() - interval '30 days'), 0) as gastado_30,
              min(created_at) filter (where created_at >= now() - interval '30 days') as primer_gasto_30
         from public.credit_ledger
        where workspace_id = $1 and direction = 'debit' and source <> 'admin_adjustment'
          and created_at >= least((select inicio from mes), now() - interval '30 days')`,
      [workspaceId],
    );
    const recargas = await scope.query<{
      recargado_mes: string;
      ultima: string | null;
    }>(
      `select coalesce(sum(usd_amount) filter (
                where credited_at >= (
                  select date_trunc('month', now() at time zone timezone) at time zone timezone
                    from public.workspaces where id = $1)
              ), 0) as recargado_mes,
              max(credited_at) as ultima
         from public.credit_topups
        where workspace_id = $1 and credited_at is not null`,
      [workspaceId],
    );
    // `workspaces` usa su propio `id` como clave de espacio: la política del
    // worker es `id = current_workspace()`, así que esta lectura es legítima.
    const espacio = await scope.query<{ settings: unknown }>(
      `select settings from public.workspaces where id = $1`,
      [workspaceId],
    );

    const w = cartera.rows[0];
    const saldo = num(w?.included_balance) + num(w?.purchased_balance);
    const reservado = num(w?.reserved_balance);
    const disponible = Math.max(0, saldo - reservado);

    const m = movimientos.rows[0];
    const r = recargas.rows[0];
    const primerGasto = m?.primer_gasto_30 ? new Date(m.primer_gasto_30).getTime() : null;
    const diasDeHistorial = primerGasto === null ? 0 : (Date.now() - primerGasto) / 86_400_000;

    const agentes: AgenteContratado[] = contratados.rows.map((f) => ({
      slug: f.slug,
      nombre: f.name,
      tagline: f.tagline,
      estado: (f.status as AgenteContratado["estado"]) ?? "active",
      agenteId: f.agent_id,
      creditosMensuales: Number(f.monthly_credits ?? 0),
      costeUsd: creditosAUsd(Number(f.monthly_credits ?? 0)),
      desde: f.started_at,
    }));

    const agentesUsd = agentes
      .filter((a) => a.estado === "active")
      .reduce((total, a) => total + a.costeUsd, 0);

    return {
      cartera: {
        disponible,
        reservado,
        consumidosEnMes: num(m?.gastado_mes),
        inicioMes: m?.inicio_mes ? new Date(m.inicio_mes) : new Date(),
        diasDeSaldo: diasDeSaldo({ disponible, gastados: num(m?.gastado_30), diasDeHistorial }),
        estado: estadoDelSaldo({
          disponible,
          umbralAviso: config.umbralAviso,
          haRecargado: Boolean(r?.ultima),
        }),
        cicloDeAvisos: r?.ultima ? new Date(r.ultima).toISOString() : "inicial",
      },
      agentes,
      factura: combinarFactura({ agentesUsd, recargasUsd: num(r?.recargado_mes) }),
      limites: limitesDesdeAjustes(espacio.rows[0]?.settings ?? null),
    };
  });
}

/** Nombre, zona horaria y ajustes libres del espacio. */
export async function ajustesDelEspacio(workspaceId: string): Promise<{
  nombre: string;
  zonaHoraria: string;
  settings: Record<string, unknown>;
}> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{ name: string; timezone: string; settings: Record<string, unknown> }>(
      `select name, timezone, settings from public.workspaces where id = $1`,
      [workspaceId],
    );
    const fila = rows[0];
    return {
      nombre: fila?.name ?? "Mi espacio",
      zonaHoraria: fila?.timezone ?? "America/Bogota",
      settings: fila?.settings ?? {},
    };
  });
}

function num(valor: string | null | undefined): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}
