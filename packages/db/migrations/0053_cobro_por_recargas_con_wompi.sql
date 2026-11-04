-- =============================================================================
-- 0053 · El cobro es por recarga de creditos, con Wompi
-- =============================================================================
-- Se acaban los planes: el cliente recarga el monto que quiera, desde 15 USD, y
-- sus agentes gastan de ese saldo. No hay cuota, ni renovacion, ni regalo de
-- bienvenida.
--
-- Wompi solo cobra en pesos y el credito se vende en dolares, asi que cada orden
-- guarda la TRM con la que se cotizo. El abono sale SIEMPRE de esta fila, nunca
-- de lo que diga el evento: el evento solo confirma que se pago lo cotizado.
--
-- `subscriptions` se queda sin uso comercial. No se borra: el historico apunta a
-- ella y quitarla no aporta nada.
-- =============================================================================
set search_path = public, extensions, pg_temp;

create table if not exists public.credit_topups (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  -- La referencia que viaja a Wompi y vuelve en el evento.
  reference       text not null unique,
  usd_amount      numeric(12,2) not null check (usd_amount > 0),
  credits         numeric(16,4) not null check (credits > 0),
  -- Pesos por dolar con los que se cotizo.
  trm             numeric(12,2) not null check (trm > 0),
  amount_in_cents bigint not null check (amount_in_cents > 0),
  currency        text not null default 'COP',
  status          text not null default 'pending'
                    check (status in ('pending','approved','declined','voided','error')),
  origin          text not null default 'manual' check (origin in ('manual','auto')),
  provider        text not null default 'wompi',
  provider_transaction_id text,
  payment_method  text,
  failure_reason  text,
  requested_by    uuid,
  -- Se llena una sola vez. Es lo que impide abonar dos veces la misma orden,
  -- tambien si el reintento del evento cae en otro mes (el unico del libro mayor
  -- es local a cada particion mensual).
  credited_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.credit_topups is
  'Ordenes de recarga. Se crean al cotizar y se confirman con el evento de la pasarela; los creditos abonados salen de esta fila, no del evento.';

create index if not exists credit_topups_ws_created_idx
  on public.credit_topups (workspace_id, created_at desc);

select public.apply_tenant_rls('credit_topups', null, true);

drop trigger if exists credit_topups_touch on public.credit_topups;
create trigger credit_topups_touch
  before update on public.credit_topups
  for each row execute function public.touch_updated_at();

-- Una sola recarga automatica en vuelo por espacio. Es la barrera real contra
-- cargar dos veces la tarjeta si dos procesos deciden cobrar a la vez.
create unique index if not exists credit_topups_auto_en_vuelo
  on public.credit_topups (workspace_id)
  where origin = 'auto' and status = 'pending';

-- -----------------------------------------------------------------------------
-- Recarga automatica. Lo que se guarda de la tarjeta es el identificador de la
-- fuente de pago en Wompi y un texto para reconocerla: nunca el numero.
-- authorized_* es la constancia de quien autorizo el cargo y por cuanto.
-- -----------------------------------------------------------------------------
create table if not exists public.credit_auto_topups (
  workspace_id      uuid primary key references public.workspaces(id) on delete cascade,
  enabled           boolean not null default false,
  usd_amount        numeric(12,2) not null default 20 check (usd_amount > 0),
  payment_source_id bigint,
  card_label        text,
  customer_email    text,
  authorized_by     uuid,
  authorized_at     timestamptz,
  -- Por que se apago sola: tarjeta_rechazada o tope_diario. Se muestra al cliente.
  disabled_reason   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (not enabled or payment_source_id is not null)
);

comment on table public.credit_auto_topups is
  'Recarga automatica por espacio. Sin tarjeta registrada no puede estar encendida.';

select public.apply_tenant_rls('credit_auto_topups', null, true);

drop trigger if exists credit_auto_topups_touch on public.credit_auto_topups;
create trigger credit_auto_topups_touch
  before update on public.credit_auto_topups
  for each row execute function public.touch_updated_at();

-- Un espacio nuevo nace sin creditos. Los que ya existen conservan su saldo.
create or replace function public.on_workspace_created(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.workspaces where id = p_workspace_id;

  insert into public.subscriptions (workspace_id, organization_id, plan, status, included_credits_monthly)
  values (p_workspace_id, v_org, 'trial', 'active', 0)
  on conflict (workspace_id) do nothing;

  insert into public.credit_wallets (workspace_id)
  values (p_workspace_id)
  on conflict (workspace_id) do nothing;
end;
$$;

comment on function public.on_workspace_created(uuid) is
  'Al crear un espacio: cartera en cero. Los creditos llegan con la primera recarga.';

revoke all on function public.on_workspace_created(uuid) from public, anon, authenticated;
