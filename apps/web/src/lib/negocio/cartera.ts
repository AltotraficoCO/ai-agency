import "server-only";

/**
 * Cartera, plan y agentes contratados: todo lo que hace falta para responder
 * «¿cuánto pago este mes?» de un vistazo.
 *
 * La respuesta tiene TRES sumandos y ninguno es evidente por separado:
 *   1. la cuota del plan,
 *   2. el fijo mensual de cada agente del catálogo que tengas contratado,
 *   3. las recargas de crédito que hayas comprado en el periodo.
 *
 * En la competencia estos tres viven en tres pantallas distintas y el cliente
 * no puede sumarlos. Aquí se suman una vez, aquí, y la interfaz solo pinta.
 *
 * NO se suma nada de Meta. El gasto de WhatsApp lo cobra Meta directamente al
 * cliente y vive en `meta.ts`, con otro tipo, a propósito.
 */
import { conEspacio } from "@/lib/db/pool";
import { limitesDesdeAjustes, type LimitesGasto } from "./limites";
import { combinarFactura, type ResumenFactura } from "./factura";
import { planPorClave, creditosAUsd, type Plan } from "./planes";
import { estadoDelSaldo, proyectarConsumo, type EstadoSaldo, type Proyeccion } from "./creditos";

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
  readonly saldoIncluido: number;
  readonly saldoComprado: number;
  readonly reservado: number;
  /** Lo que el motor puede gastar ahora mismo. */
  readonly disponible: number;
  /** Créditos incluidos otorgados en el periodo. */
  readonly otorgados: number;
  readonly consumidosEnPeriodo: number;
  readonly inicioPeriodo: Date;
  readonly finPeriodo: Date;
  readonly proyeccion: Proyeccion;
  readonly estado: EstadoSaldo;
};

export type EstadoNegocio = {
  readonly cartera: Cartera;
  readonly plan: Plan;
  readonly estadoSuscripcion: string;
  readonly agentes: readonly AgenteContratado[];
  readonly factura: ResumenFactura;
  readonly limites: LimitesGasto;
};

type FilaCartera = {
  included_balance: string;
  purchased_balance: string;
  reserved_balance: string;
  included_granted: string;
  period_start: string;
  period_end: string;
};

/**
 * Un único viaje a la base por visita. Son cinco consultas por clave primaria o
 * por índice de espacio; el coste real es el ida y vuelta, no el trabajo.
 */
export async function estadoDelNegocio(workspaceId: string, ahora = new Date()): Promise<EstadoNegocio> {
  return conEspacio(workspaceId, async (scope) => {
    const [cartera, suscripcion, contratados, recargas, espacio] = await Promise.all([
      scope.query<FilaCartera>(
        `select included_balance, purchased_balance, reserved_balance, included_granted,
                period_start, period_end
           from public.credit_wallets where workspace_id = $1`,
        [workspaceId],
      ),
      scope.query<{ plan: string; status: string; current_period_start: string; current_period_end: string }>(
        `select plan, status, current_period_start, current_period_end
           from public.subscriptions where workspace_id = $1`,
        [workspaceId],
      ),
      scope.query<{
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
      ),
      scope.query<{ creditos: string | null }>(
        `select coalesce(sum(amount), 0) as creditos
           from public.credit_ledger
          where workspace_id = $1
            and direction = 'credit'
            and source = 'topup'
            and created_at >= (select period_start from public.credit_wallets where workspace_id = $1)`,
        [workspaceId],
      ),
      // `workspaces` usa su propio `id` como clave de espacio: la política del
      // worker es `id = current_workspace()`, así que esta lectura es legítima.
      scope.query<{ settings: unknown }>(`select settings from public.workspaces where id = $1`, [
        workspaceId,
      ]),
    ]);

    const w = cartera.rows[0];
    const inicioPeriodo = w ? new Date(w.period_start) : inicioDeMes(ahora);
    const finPeriodo = w ? new Date(w.period_end) : finDeMes(ahora);

    const saldoIncluido = num(w?.included_balance);
    const saldoComprado = num(w?.purchased_balance);
    const reservado = num(w?.reserved_balance);
    const otorgados = num(w?.included_granted);

    // Lo consumido del periodo es lo otorgado menos lo que queda del bolsillo
    // incluido. El comprado no entra: no caduca y no pertenece al periodo.
    const consumidos = Math.max(0, otorgados - saldoIncluido);
    const asignados = Math.max(otorgados, 1);

    const proyeccion = proyectarConsumo({
      consumidos,
      asignados,
      inicioPeriodo,
      finPeriodo,
      ahora,
    });

    const fila = suscripcion.rows[0];
    const plan = planPorClave(fila?.plan);

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
    const recargasUsd = creditosAUsd(num(recargas.rows[0]?.creditos));

    const limites = limitesDesdeAjustes(espacio.rows[0]?.settings ?? null);

    return {
      cartera: {
        saldoIncluido,
        saldoComprado,
        reservado,
        disponible: Math.max(0, saldoIncluido + saldoComprado - reservado),
        otorgados,
        consumidosEnPeriodo: consumidos,
        inicioPeriodo,
        finPeriodo,
        proyeccion,
        estado: estadoDelSaldo(consumidos, asignados),
      },
      plan,
      estadoSuscripcion: fila?.status ?? "trialing",
      agentes,
      factura: combinarFactura(plan, {
        planUsd: plan.precioUsd,
        agentesUsd,
        recargasUsd,
      }),
      limites,
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

function inicioDeMes(ahora: Date): Date {
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1));
}

function finDeMes(ahora: Date): Date {
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 1));
}
