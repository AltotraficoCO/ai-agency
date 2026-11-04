-- =============================================================================
-- 0054 · Panel de super admin
-- =============================================================================
-- Ajustes de TODA la plataforma y bitacora de lo que se hace desde el panel.
--
-- Ninguna de las dos tablas pertenece a un espacio: RLS encendido y sin politicas
-- ni permisos para los roles de cliente ni para `strappy_worker`. Solo las lee
-- el rol de servicio, que es con el que se conecta el panel tras comprobar que
-- quien pide es super admin.
-- =============================================================================
set search_path = public, extensions, pg_temp;

create table if not exists public.platform_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  -- Secretos, cifrados con APP_ENCRYPTION_KEY. Nunca vuelven a mostrarse completos.
  encrypted   text,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

comment on table public.platform_settings is
  'Ajustes globales editados desde /admin. Los secretos van cifrados en `encrypted`.';

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from public, anon, authenticated, strappy_worker;

create table if not exists public.platform_audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid,
  actor_email  text not null,
  action       text not null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  -- Nunca lleva un secreto: solo que cambio, no a que valor.
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.platform_audit_log is
  'Quien hizo que desde el panel de super admin. No guarda secretos.';

create index if not exists platform_audit_log_ws_idx
  on public.platform_audit_log (workspace_id, created_at desc);

alter table public.platform_audit_log enable row level security;
revoke all on public.platform_audit_log from public, anon, authenticated, strappy_worker;

-- Un espacio suspendido no ejecuta nada: para el motor es como no tener saldo.
create or replace function public.has_credits(p_workspace_id uuid, p_min numeric default 1)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select c.included_balance + c.purchased_balance - c.reserved_balance >= p_min
       from public.credit_wallets c
       join public.workspaces w on w.id = c.workspace_id
      where c.workspace_id = p_workspace_id and w.status = 'active'),
    false);
$$;
