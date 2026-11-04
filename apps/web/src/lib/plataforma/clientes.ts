import "server-only";

/**
 * Los clientes de Strappy, vistos desde el panel. Lecturas transversales: quien
 * llega aquí ya pasó por `exigirSuperAdmin`.
 */
import { consultar } from "@/lib/db/pool";

export type ClienteEnLista = {
  readonly id: string;
  readonly nombre: string;
  readonly correo: string | null;
  readonly estado: string;
  readonly creadoEn: string;
  readonly saldo: number;
  readonly recargadoUsd: number;
  readonly ultimaRecarga: string | null;
  readonly consumido30: number;
  readonly automatica: boolean;
};

const CAMPOS = `
  w.id, w.name, w.status, w.created_at,
  (select u.email from public.memberships m
     join auth.users u on u.id = m.user_id
    where m.workspace_id = w.id and m.role = 'owner'
    order by m.created_at asc limit 1) as correo,
  coalesce(c.included_balance + c.purchased_balance, 0) as saldo,
  (select coalesce(sum(t.usd_amount), 0) from public.credit_topups t
    where t.workspace_id = w.id and t.status = 'approved') as recargado,
  (select max(t.credited_at) from public.credit_topups t
    where t.workspace_id = w.id and t.status = 'approved') as ultima,
  (select coalesce(sum(l.amount), 0) from public.credit_ledger l
    where l.workspace_id = w.id and l.direction = 'debit' and l.source <> 'admin_adjustment'
      and l.created_at >= now() - interval '30 days') as consumido,
  coalesce(a.enabled, false) as automatica`;

type Fila = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  correo: string | null;
  saldo: string;
  recargado: string;
  ultima: string | null;
  consumido: string;
  automatica: boolean;
};

function aCliente(f: Fila): ClienteEnLista {
  return {
    id: f.id,
    nombre: f.name,
    correo: f.correo,
    estado: f.status,
    creadoEn: f.created_at,
    saldo: Number(f.saldo),
    recargadoUsd: Number(f.recargado),
    ultimaRecarga: f.ultima,
    consumido30: Number(f.consumido),
    automatica: f.automatica,
  };
}

export const CLIENTES_POR_PAGINA = 25;

/** `%` y `_` del buscador son texto, no comodines. */
export function patronDeBusqueda(texto: string): string {
  return `%${texto.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listarClientes(entrada: { busqueda?: string; pagina?: number }) {
  const pagina = Math.max(1, entrada.pagina ?? 1);
  const busqueda = entrada.busqueda?.trim() ? patronDeBusqueda(entrada.busqueda) : null;
  const FILTRO = `w.status <> 'deleted' and (
    $1::text is null or w.name ilike $1 or exists (
      select 1 from public.memberships m join auth.users u on u.id = m.user_id
       where m.workspace_id = w.id and u.email ilike $1))`;

  const filas = await consultar<Fila>(
    `select ${CAMPOS}
       from public.workspaces w
       left join public.credit_wallets c on c.workspace_id = w.id
       left join public.credit_auto_topups a on a.workspace_id = w.id
      where ${FILTRO}
      order by w.created_at desc
      limit $2 offset $3`,
    [busqueda, CLIENTES_POR_PAGINA, (pagina - 1) * CLIENTES_POR_PAGINA],
  );
  const [cuenta] = await consultar<{ n: string }>(
    `select count(*) as n from public.workspaces w where ${FILTRO}`,
    [busqueda],
  );
  return { clientes: filas.map(aCliente), total: Number(cuenta?.n ?? 0), pagina };
}

export async function detalleDeCliente(id: string) {
  const [fila] = await consultar<Fila>(
    `select ${CAMPOS}
       from public.workspaces w
       left join public.credit_wallets c on c.workspace_id = w.id
       left join public.credit_auto_topups a on a.workspace_id = w.id
      where w.id = $1 and w.status <> 'deleted'`,
    [id],
  );
  if (!fila) return null;

  const recargas = await consultar<{
    id: string;
    created_at: string;
    usd_amount: string;
    amount_in_cents: string;
    status: string;
    origin: string;
    failure_reason: string | null;
  }>(
    `select id, created_at, usd_amount, amount_in_cents, status, origin, failure_reason
       from public.credit_topups where workspace_id = $1
      order by created_at desc limit 20`,
    [id],
  );
  const movimientos = await consultar<{
    id: string;
    created_at: string;
    direction: string;
    source: string;
    amount: string;
    description: string | null;
  }>(
    `select id, created_at, direction, source, amount, description
       from public.credit_ledger where workspace_id = $1
      order by created_at desc limit 15`,
    [id],
  );
  return { cliente: aCliente(fila), recargas, movimientos };
}
