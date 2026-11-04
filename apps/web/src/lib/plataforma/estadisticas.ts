import "server-only";

/**
 * Las cifras de venta de Strappy.
 *
 * Es una lectura transversal a todos los espacios, y por eso va sin rol acotado.
 * «Venta» es una recarga aprobada: los créditos dados a mano desde el panel no
 * pasan por `credit_topups`, así que no pueden inflar estas cifras.
 *
 * Los meses son los de Colombia, no los de cada cliente: es la contabilidad de
 * Strappy, y tiene que dar lo mismo la mire quien la mire.
 */
import { consultar } from "@/lib/db/pool";

export type MesDeVentas = {
  readonly mes: string;
  readonly usd: number;
  readonly pesos: number;
  readonly recargas: number;
  readonly clientes: number;
};

/** Rellena los meses sin ventas: un mes en cero también es un dato. */
export function completarMeses(filas: readonly MesDeVentas[], ahora: Date, cuantos = 12): MesDeVentas[] {
  const porMes = new Map(filas.map((f) => [f.mes, f]));
  const [anio, mes] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit" })
    .format(ahora)
    .split("-")
    .map(Number) as [number, number];
  const salida: MesDeVentas[] = [];
  for (let i = cuantos - 1; i >= 0; i--) {
    const fecha = new Date(Date.UTC(anio, mes - 1 - i, 1));
    const clave = `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}`;
    salida.push(porMes.get(clave) ?? { mes: clave, usd: 0, pesos: 0, recargas: 0, clientes: 0 });
  }
  return salida;
}

/** Variación frente al mes anterior. `null` si no había con qué comparar. */
export function variacion(actual: number, anterior: number): number | null {
  return anterior > 0 ? (actual - anterior) / anterior : null;
}

export type Estadisticas = {
  readonly meses: readonly MesDeVentas[];
  readonly actual: MesDeVentas;
  readonly variacionMes: number | null;
  readonly ventasTotalUsd: number;
  readonly ticketMedioUsd: number;
  readonly espacios: { total: number; nuevosMes: number; pagaron: number; suspendidos: number; conAutomatica: number };
  readonly automaticasMesUsd: number;
  readonly creditos: { vendidosMes: number; consumidosMes: number; saldoVivo: number };
  readonly mejores: readonly { id: string; nombre: string; usd: number }[];
};

export async function estadisticasDeVenta(ahora = new Date()): Promise<Estadisticas> {
  const INICIO_MES = `(date_trunc('month', now() at time zone 'America/Bogota') at time zone 'America/Bogota')`;

  const filas = await consultar<{ mes: string; usd: string; pesos: string; recargas: string; clientes: string }>(
    `select to_char(credited_at at time zone 'America/Bogota', 'YYYY-MM') as mes,
            sum(usd_amount) as usd,
            sum(amount_in_cents) / 100 as pesos,
            count(*) as recargas,
            count(distinct workspace_id) as clientes
       from public.credit_topups
      where status = 'approved' and credited_at is not null
      group by 1`,
  );
  const todas = filas.map((f) => ({
    mes: f.mes,
    usd: Number(f.usd),
    pesos: Number(f.pesos),
    recargas: Number(f.recargas),
    clientes: Number(f.clientes),
  }));
  const meses = completarMeses(todas, ahora);
  const actual = meses[meses.length - 1]!;
  const anterior = meses[meses.length - 2]!;

  const ventasTotalUsd = todas.reduce((s, f) => s + f.usd, 0);
  const recargasTotal = todas.reduce((s, f) => s + f.recargas, 0);

  const [espacios] = await consultar<Record<"total" | "nuevos" | "pagaron" | "suspendidos" | "automatica", string>>(
    `select (select count(*) from public.workspaces where status <> 'deleted') as total,
            (select count(*) from public.workspaces where status <> 'deleted' and created_at >= ${INICIO_MES}) as nuevos,
            (select count(distinct workspace_id) from public.credit_topups where status = 'approved') as pagaron,
            (select count(*) from public.workspaces where status = 'suspended') as suspendidos,
            (select count(*) from public.credit_auto_topups where enabled) as automatica`,
  );

  const [automaticas] = await consultar<{ usd: string }>(
    `select coalesce(sum(usd_amount), 0) as usd from public.credit_topups
      where status = 'approved' and origin = 'auto' and credited_at >= ${INICIO_MES}`,
  );

  const [creditos] = await consultar<{ vendidos: string; consumidos: string; vivo: string }>(
    `select (select coalesce(sum(credits), 0) from public.credit_topups
              where status = 'approved' and credited_at >= ${INICIO_MES}) as vendidos,
            (select coalesce(sum(amount), 0) from public.credit_ledger
              where direction = 'debit' and source <> 'admin_adjustment' and created_at >= ${INICIO_MES}) as consumidos,
            (select coalesce(sum(included_balance + purchased_balance), 0) from public.credit_wallets) as vivo`,
  );

  const mejores = await consultar<{ id: string; name: string; usd: string }>(
    `select w.id, w.name, sum(t.usd_amount) as usd
       from public.credit_topups t
       join public.workspaces w on w.id = t.workspace_id
      where t.status = 'approved' and t.credited_at >= now() - interval '12 months'
      group by w.id, w.name
      order by usd desc
      limit 5`,
  );

  return {
    meses,
    actual,
    variacionMes: variacion(actual.usd, anterior.usd),
    ventasTotalUsd,
    ticketMedioUsd: recargasTotal > 0 ? ventasTotalUsd / recargasTotal : 0,
    espacios: {
      total: Number(espacios?.total ?? 0),
      nuevosMes: Number(espacios?.nuevos ?? 0),
      pagaron: Number(espacios?.pagaron ?? 0),
      suspendidos: Number(espacios?.suspendidos ?? 0),
      conAutomatica: Number(espacios?.automatica ?? 0),
    },
    automaticasMesUsd: Number(automaticas?.usd ?? 0),
    creditos: {
      vendidosMes: Number(creditos?.vendidos ?? 0),
      consumidosMes: Number(creditos?.consumidos ?? 0),
      saldoVivo: Number(creditos?.vivo ?? 0),
    },
    mejores: mejores.map((m) => ({ id: m.id, nombre: m.name, usd: Number(m.usd) })),
  };
}

export async function ultimasAcciones(limite = 15, workspaceId?: string) {
  const filas = await consultar<{
    id: string;
    actor_email: string;
    action: string;
    detail: Record<string, unknown>;
    created_at: string;
  }>(
    `select id, actor_email, action, detail, created_at
       from public.platform_audit_log
      where ($1::uuid is null or workspace_id = $1)
      order by created_at desc
      limit $2`,
    [workspaceId ?? null, limite],
  );
  return filas;
}
