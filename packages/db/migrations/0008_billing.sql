-- =============================================================================
-- 0008_billing.sql · Suscripciones, creditos y consumo
-- -----------------------------------------------------------------------------
-- UNIDAD DE CUENTA
--   1 credito = 0,001 USD de PRECIO DE VENTA (1.000 creditos = 1 USD).
--   Las tarifas se guardan ya con margen aplicado, nunca al coste del proveedor:
--   MARGEN = 3,0x sobre el coste del modelo.
--   De ahi la formula usada en 0010_seed:
--       creditos_por_ktoken = usd_por_millon_de_tokens x 3
--   (usd/Mtok / 1.000 = usd/ktok; x3 de margen; / 0,001 para pasar a creditos.)
--   El multiplicador cubre el coste de plataforma (almacenamiento, embeddings,
--   ingesta, soporte) y deja margen aunque el proveedor suba precios sin aviso.
-- =============================================================================

-- En Supabase las extensiones viven en el esquema `extensions`. Los tipos y las
-- clases de operadores (vector, gin_trgm_ops...) se resuelven en el momento del
-- DDL, asi que `extensions` tiene que estar en el search_path AL APLICAR. En un
-- Postgres pelado el esquema no existe y la linea es inocua.
set search_path = public, extensions, pg_temp;

create table if not exists public.subscriptions (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null unique references public.workspaces(id) on delete cascade,
  organization_id   uuid references public.organizations(id) on delete cascade,
  plan              text not null default 'trial'
                      check (plan in ('trial','starter','growth','business','enterprise')),
  status            text not null default 'trialing'
                      check (status in ('trialing','active','past_due','paused','cancelled')),
  provider          text not null default 'internal',
  external_id       text,
  seats             integer not null default 1 check (seats >= 1),
  included_credits_monthly numeric(16,4) not null default 0,
  currency          text not null default 'USD',
  price_amount      numeric(12,2) not null default 0,
  current_period_start timestamptz not null default date_trunc('month', now()),
  current_period_end   timestamptz not null default date_trunc('month', now()) + interval '1 month',
  trial_ends_at     timestamptz,
  cancel_at         timestamptz,
  cancelled_at      timestamptz,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.subscriptions is
  'Plan contratado por un espacio. included_credits_monthly es la asignacion que se repone cada periodo; los creditos comprados aparte no caducan con el periodo.';

-- -----------------------------------------------------------------------------
create table if not exists public.credit_wallets (
  workspace_id      uuid primary key references public.workspaces(id) on delete cascade,
  included_balance  numeric(16,4) not null default 0,
  purchased_balance numeric(16,4) not null default 0,
  reserved_balance  numeric(16,4) not null default 0 check (reserved_balance >= 0),
  included_granted  numeric(16,4) not null default 0,
  low_balance_threshold numeric(16,4) not null default 1000,
  period_start      timestamptz not null default date_trunc('month', now()),
  period_end        timestamptz not null default date_trunc('month', now()) + interval '1 month',
  updated_at        timestamptz not null default now()
);

comment on table public.credit_wallets is
  'Cartera de creditos del espacio. Tres saldos separados a proposito: el incluido caduca al cerrar el periodo, el comprado no, y el reservado cubre lo comprometido por ejecuciones en vuelo.';
comment on column public.credit_wallets.included_balance is
  'Creditos del plan del periodo en curso. Se consume ANTES que el comprado para que el cliente no pague por lo que ya tenia incluido.';
comment on column public.credit_wallets.reserved_balance is
  'Creditos comprometidos por ejecuciones aun sin cerrar. Evita que dos ejecuciones simultaneas gasten el mismo saldo.';

-- -----------------------------------------------------------------------------
-- credit_rates: tarifario VERSIONADO. Una fila nunca se edita: se cierra
-- (effective_to) y se crea otra. Sin esto, cambiar un precio reescribiria el
-- coste historico y las facturas del mes pasado dejarian de cuadrar.
-- -----------------------------------------------------------------------------
create table if not exists public.credit_rates (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null,
  ref_key          text not null default '*',
  unit             text not null default 'unit'
                     check (unit in ('unit','ktoken','message','minute','run','mb')),
  credits_per_unit numeric(16,6) not null check (credits_per_unit >= 0),
  description      text,
  effective_from   timestamptz not null default now(),
  effective_to     timestamptz,
  created_at       timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

comment on table public.credit_rates is
  'Tarifario versionado por effective_from. Regla innegociable: una tarifa vigente NO se edita; se cierra con effective_to y se inserta una nueva. Asi el consumo de ayer se sigue valorando con el precio de ayer.';
comment on column public.credit_rates.kind is
  'Concepto tarifado: model_input, model_output, model_cache_read, message_out, embedding, tool_call...';
comment on column public.credit_rates.ref_key is
  'Clave dentro del concepto (identificador del modelo, del canal...). "*" es la tarifa por defecto del concepto.';

create unique index if not exists credit_rates_version_uniq
  on public.credit_rates (kind, ref_key, effective_from);
create index if not exists credit_rates_lookup_idx
  on public.credit_rates (kind, ref_key, effective_from desc);

create or replace function public.guard_credit_rate_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.credits_per_unit is distinct from old.credits_per_unit
     or new.kind is distinct from old.kind
     or new.ref_key is distinct from old.ref_key
     or new.unit is distinct from old.unit
     or new.effective_from is distinct from old.effective_from then
    raise exception 'credit_rates es versionada: cierre la fila con effective_to e inserte una nueva'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists credit_rates_immutable on public.credit_rates;
create trigger credit_rates_immutable
  before update on public.credit_rates
  for each row execute function public.guard_credit_rate_immutable();

-- -----------------------------------------------------------------------------
create table if not exists public.model_tiers (
  mode            text not null check (mode in ('lite','max')),
  task            text not null,
  provider        text not null,
  primary_model   text not null,
  fallback_models text[] not null default '{}'::text[],
  params          jsonb not null default '{}'::jsonb,
  max_tokens      integer,
  notes           text,
  updated_at      timestamptz not null default now(),
  primary key (mode, task)
);

comment on table public.model_tiers is
  'Declara, por modo (lite/max) y por tarea, el modelo primario y su cadena de respaldo. El motor no lleva nombres de modelo escritos en el codigo: los lee de aqui, de modo que cambiar de proveedor tras una caida es un UPDATE y no un despliegue.';
comment on column public.model_tiers.fallback_models is
  'Cadena de respaldo en orden. Se recorre ante error, saturacion o timeout del primario; agent_runs.fallback_used deja constancia.';

-- -----------------------------------------------------------------------------
-- credit_ledger: particionado por mes. Es la contabilidad, crece sin limite y
-- se consulta casi siempre por periodo.
-- -----------------------------------------------------------------------------
create table if not exists public.credit_ledger (
  id              uuid not null default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  direction       text not null check (direction in ('debit','credit')),
  source          text not null,
  amount          numeric(16,4) not null check (amount >= 0),
  from_included   numeric(16,4) not null default 0,
  from_purchased  numeric(16,4) not null default 0,
  balance_after   numeric(16,4) not null default 0,
  idempotency_key text not null,
  rate_snapshot   jsonb not null default '[]'::jsonb,
  ref_type        text,
  ref_id          uuid,
  agent_run_id    uuid,
  description     text,
  metadata        jsonb not null default '{}'::jsonb,
  primary key (id, created_at)
) partition by range (created_at);

comment on table public.credit_ledger is
  'Libro mayor de creditos, particionado por mes. Cada particion lleva un unico LOCAL sobre (workspace_id, idempotency_key): un reintento del motor nunca cobra dos veces. Solo lectura para usuarios.';
comment on column public.credit_ledger.idempotency_key is
  'Clave estable derivada de la operacion (p.ej. agent_run:<uuid>). El unico vive en la particion y no en la tabla padre porque Postgres obligaria a meter created_at en la clave, y created_at cambia en cada reintento: justo lo que romperia la idempotencia.';
comment on column public.credit_ledger.rate_snapshot is
  'Copia de las tarifas aplicadas en el momento del cobro. Permite reconstruir la factura aunque el tarifario cambie despues.';

create index if not exists credit_ledger_ws_created_idx
  on public.credit_ledger (workspace_id, created_at desc);
create index if not exists credit_ledger_created_brin
  on public.credit_ledger using brin (created_at);
create index if not exists credit_ledger_ws_ref_idx
  on public.credit_ledger (workspace_id, ref_type, ref_id);

select public.ensure_month_partitions(2);

-- -----------------------------------------------------------------------------
create table if not exists public.usage_daily (
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  day            date not null,
  agent_id       uuid references public.agents(id) on delete set null,
  conversations_started integer not null default 0,
  conversations_active  integer not null default 0,
  messages_in    integer not null default 0,
  messages_out   integer not null default 0,
  agent_runs     integer not null default 0,
  agent_runs_skipped integer not null default 0,
  tool_runs      integer not null default 0,
  input_tokens   bigint not null default 0,
  output_tokens  bigint not null default 0,
  cache_tokens   bigint not null default 0,
  credits_spent  numeric(16,4) not null default 0,
  handovers      integer not null default 0,
  avg_latency_ms integer,
  updated_at     timestamptz not null default now(),
  primary key (workspace_id, day, agent_id)
);

comment on table public.usage_daily is
  'Agregado diario de consumo por espacio y agente. Los paneles leen de aqui: recorrer messages y agent_runs en vivo para pintar una grafica de 90 dias no escala.';

-- -----------------------------------------------------------------------------
create table if not exists public.waba_analytics_daily (
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  day             date not null,
  waba_id         text not null,
  phone_number_id text not null default '*',
  country         text not null default '*',
  conversation_category text not null default '*',
  sent            integer not null default 0,
  delivered       integer not null default 0,
  read            integer not null default 0,
  failed          integer not null default 0,
  conversations   integer not null default 0,
  cost_usd        numeric(12,4) not null default 0,
  raw             jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now(),
  primary key (workspace_id, day, waba_id, phone_number_id, country, conversation_category)
);

comment on table public.waba_analytics_daily is
  'Metricas y coste que factura Meta por conversacion de WhatsApp, sincronizadas a diario. Se guardan aparte de usage_daily porque son coste del proveedor, no consumo de creditos del cliente.';

-- =============================================================================
-- charge_credits · cobro atomico e idempotente
-- =============================================================================
create or replace function public.resolve_credit_rate(
  p_kind text,
  p_ref_key text,
  p_at timestamptz default now()
)
returns public.credit_rates
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.*
  from public.credit_rates r
  where r.kind = p_kind
    and r.ref_key in (coalesce(p_ref_key, '*'), '*')
    and r.effective_from <= p_at
    and (r.effective_to is null or r.effective_to > p_at)
  order by (r.ref_key = coalesce(p_ref_key, '*')) desc, r.effective_from desc
  limit 1;
$$;

comment on function public.resolve_credit_rate(text, text, timestamptz) is
  'Devuelve la tarifa vigente para un concepto en un instante dado, prefiriendo la especifica del ref_key sobre la generica "*".';


-- ── Claves de cobro ya aplicadas ────────────────────────────────────────────
-- Sin particionar A PROPOSITO. El unico de credit_ledger es local a cada
-- particion mensual, porque Postgres exige que un unico global incluya la
-- columna de particion, y esa columna es la fecha, que cambia en cada
-- reintento: la idempotencia solo valdria dentro del mismo mes y un reintento
-- que cruzara la medianoche del dia 1 podria cobrar dos veces. Esta tabla no
-- se particiona, admite un unico GLOBAL, y es la barrera real.
create table if not exists public.credit_idempotency (
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null,
  created_at      timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

comment on table public.credit_idempotency is
  'Claves de cobro ya aplicadas. Sin particionar: es lo que permite un unico global y evita el doble cobro al cambiar de mes.';

select public.apply_tenant_rls('credit_idempotency', 'billing.read', true, false);

create or replace function public.charge_credits(
  p_workspace_id    uuid,
  p_idempotency_key text,
  p_items           jsonb,
  p_source          text default 'agent_run',
  p_ref_type        text default null,
  p_ref_id          uuid default null,
  p_agent_run_id    uuid default null,
  p_description     text default null,
  p_metadata        jsonb default '{}'::jsonb,
  p_occurred_at     timestamptz default now(),
  p_allow_negative  boolean default false
)
returns table (
  applied        boolean,
  reason         text,
  credits        numeric,
  from_included  numeric,
  from_purchased numeric,
  balance_after  numeric,
  ledger_id      uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w              public.credit_wallets%rowtype;
  v_item         jsonb;
  v_rate         public.credit_rates%rowtype;
  v_qty          numeric;
  v_total        numeric := 0;
  v_snapshot     jsonb := '[]'::jsonb;
  v_from_inc     numeric := 0;
  v_from_pur     numeric := 0;
  v_available    numeric;
  v_ledger_id    uuid;
begin
  -- Barrera independiente de RLS contra cruces de tenant.
  perform public.assert_workspace(p_workspace_id);

  if p_idempotency_key is null or p_idempotency_key = '' then
    raise exception 'charge_credits exige idempotency_key' using errcode = '22023';
  end if;

  -- Reclama la clave ANTES de tocar el saldo. Si ya estaba, es un reintento y
  -- no se cobra nada. Esta barrera es global, no por particion.
  insert into public.credit_idempotency (workspace_id, idempotency_key)
  values (p_workspace_id, p_idempotency_key)
  on conflict (workspace_id, idempotency_key) do nothing;

  if not found then
    return query select false, 'duplicate'::text, 0::numeric, 0::numeric, 0::numeric,
                        (select included_balance + purchased_balance
                           from public.credit_wallets where workspace_id = p_workspace_id),
                        null::uuid;
    return;
  end if;

  -- Serializa todo el cobro sobre la cartera. Dos ejecuciones simultaneas del
  -- mismo espacio se ponen en fila aqui y no pueden gastar el mismo saldo.
  select * into w from public.credit_wallets
   where workspace_id = p_workspace_id for update;

  if not found then
    insert into public.credit_wallets (workspace_id) values (p_workspace_id)
    on conflict (workspace_id) do nothing;
    select * into w from public.credit_wallets
     where workspace_id = p_workspace_id for update;
  end if;

  -- Valoracion: cada linea con la tarifa VIGENTE en p_occurred_at.
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    if v_qty <= 0 then
      continue;
    end if;

    v_rate := public.resolve_credit_rate(
      v_item->>'kind', v_item->>'ref_key', p_occurred_at);

    if v_rate.id is null then
      raise exception 'sin tarifa vigente para kind=% ref_key=% en %',
        v_item->>'kind', v_item->>'ref_key', p_occurred_at using errcode = '22023';
    end if;

    v_total := v_total + (v_qty * v_rate.credits_per_unit);
    v_snapshot := v_snapshot || jsonb_build_array(jsonb_build_object(
      'kind', v_rate.kind, 'ref_key', v_rate.ref_key, 'unit', v_rate.unit,
      'quantity', v_qty, 'credits_per_unit', v_rate.credits_per_unit,
      'rate_id', v_rate.id, 'effective_from', v_rate.effective_from));
  end loop;

  v_total := round(v_total, 4);
  v_available := w.included_balance + w.purchased_balance - w.reserved_balance;

  if v_total > v_available and not p_allow_negative then
    return query select false, 'no_credits'::text, v_total, 0::numeric, 0::numeric,
                        (w.included_balance + w.purchased_balance), null::uuid;
    return;
  end if;

  -- Primero el saldo incluido, despues el comprado.
  v_from_inc := least(greatest(w.included_balance, 0), v_total);
  v_from_pur := v_total - v_from_inc;

  -- El unico (workspace_id, idempotency_key) vive en la particion, de modo que
  -- el ON CONFLICT va sin objetivo. Si la fila ya existia no se inserta nada y
  -- la cartera NO se toca: un reintento jamas cobra dos veces.
  insert into public.credit_ledger (
    created_at, workspace_id, direction, source, amount,
    from_included, from_purchased, balance_after, idempotency_key,
    rate_snapshot, ref_type, ref_id, agent_run_id, description, metadata)
  values (
    p_occurred_at, p_workspace_id, 'debit', p_source, v_total,
    v_from_inc, v_from_pur,
    (w.included_balance + w.purchased_balance) - v_total, p_idempotency_key,
    v_snapshot, p_ref_type, p_ref_id, p_agent_run_id, p_description,
    coalesce(p_metadata, '{}'::jsonb))
  on conflict do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    return query select false, 'duplicate'::text, v_total, 0::numeric, 0::numeric,
                        (w.included_balance + w.purchased_balance), null::uuid;
    return;
  end if;

  update public.credit_wallets
  set included_balance  = included_balance - v_from_inc,
      purchased_balance = purchased_balance - v_from_pur,
      updated_at        = now()
  where workspace_id = p_workspace_id;

  return query select true, null::text, v_total, v_from_inc, v_from_pur,
                      (w.included_balance + w.purchased_balance) - v_total, v_ledger_id;
end;
$$;

comment on function public.charge_credits(uuid, text, jsonb, text, text, uuid, uuid, text, jsonb, timestamptz, boolean) is
  'Cobro atomico: bloquea la cartera con FOR UPDATE, valora las lineas con la tarifa vigente, descuenta primero del saldo incluido y luego del comprado, y asienta en el libro mayor con ON CONFLICT DO NOTHING. Devuelve applied=false con reason=no_credits (sin saldo, el motor anota skip_reason) o reason=duplicate (reintento ya cobrado).';

create or replace function public.grant_credits(
  p_workspace_id uuid,
  p_idempotency_key text,
  p_amount numeric,
  p_bucket text default 'purchased',
  p_source text default 'topup',
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (applied boolean, balance_after numeric, ledger_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.credit_wallets%rowtype;
  v_ledger_id uuid;
begin
  perform public.assert_workspace(p_workspace_id);

  if p_amount is null or p_amount <= 0 then
    raise exception 'grant_credits exige un importe positivo' using errcode = '22023';
  end if;
  if p_bucket not in ('included','purchased') then
    raise exception 'bucket invalido: %', p_bucket using errcode = '22023';
  end if;

  insert into public.credit_wallets (workspace_id) values (p_workspace_id)
  on conflict (workspace_id) do nothing;

  select * into w from public.credit_wallets
   where workspace_id = p_workspace_id for update;

  insert into public.credit_ledger (
    workspace_id, direction, source, amount,
    from_included, from_purchased, balance_after, idempotency_key, description, metadata)
  values (
    p_workspace_id, 'credit', p_source, p_amount,
    case when p_bucket = 'included' then p_amount else 0 end,
    case when p_bucket = 'purchased' then p_amount else 0 end,
    w.included_balance + w.purchased_balance + p_amount, p_idempotency_key,
    p_description, coalesce(p_metadata, '{}'::jsonb))
  on conflict do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    return query select false, (w.included_balance + w.purchased_balance), null::uuid;
    return;
  end if;

  update public.credit_wallets
  set included_balance  = included_balance  + case when p_bucket = 'included'  then p_amount else 0 end,
      purchased_balance = purchased_balance + case when p_bucket = 'purchased' then p_amount else 0 end,
      included_granted  = included_granted  + case when p_bucket = 'included'  then p_amount else 0 end,
      updated_at = now()
  where workspace_id = p_workspace_id;

  return query select true, (w.included_balance + w.purchased_balance + p_amount), v_ledger_id;
end;
$$;

comment on function public.grant_credits(uuid, text, numeric, text, text, text, jsonb) is
  'Abono idempotente de creditos (recarga o reposicion del plan). Misma barrera de idempotencia que charge_credits.';

create or replace function public.has_credits(p_workspace_id uuid, p_min numeric default 1)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select w.included_balance + w.purchased_balance - w.reserved_balance >= p_min
     from public.credit_wallets w where w.workspace_id = p_workspace_id),
    false);
$$;

comment on function public.has_credits(uuid, numeric) is
  'Comprobacion barata previa a ejecutar un agente. Si devuelve falso el motor registra agent_runs.skip_reason = no_credits.';

-- =============================================================================
-- Gancho de alta: cartera + suscripcion de prueba.
-- Reemplaza el stub definido en 0001.
-- =============================================================================
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

  insert into public.subscriptions (
    workspace_id, organization_id, plan, status,
    included_credits_monthly, trial_ends_at)
  values (p_workspace_id, v_org, 'trial', 'trialing', 5000, now() + interval '14 days')
  on conflict (workspace_id) do nothing;

  insert into public.credit_wallets (workspace_id, included_balance, included_granted)
  values (p_workspace_id, 5000, 5000)
  on conflict (workspace_id) do nothing;
end;
$$;

comment on function public.on_workspace_created(uuid) is
  'Al crear un espacio: suscripcion de prueba de 14 dias y 5.000 creditos incluidos (5 USD de valor de venta) para que el cliente pueda probar el producto sin tarjeta.';

do $$
declare t text;
begin
  foreach t in array array['subscriptions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch', t);
  end loop;
end
$$;

-- =============================================================================
-- RLS
-- =============================================================================
select public.apply_tenant_rls('subscriptions',        null, true);
select public.apply_tenant_rls('credit_wallets',       null, true);
select public.apply_tenant_rls('credit_ledger',        null, true);
select public.apply_tenant_rls('usage_daily',          null, true);
select public.apply_tenant_rls('waba_analytics_daily', null, true);

-- Tarifario y modelos: catalogo global de solo lectura.
alter table public.credit_rates enable row level security;
alter table public.model_tiers  enable row level security;
drop policy if exists credit_rates_read on public.credit_rates;
drop policy if exists model_tiers_read  on public.model_tiers;
create policy credit_rates_read on public.credit_rates
  for select to authenticated, strappy_worker using (true);
create policy model_tiers_read on public.model_tiers
  for select to authenticated, strappy_worker using (true);
grant select on public.credit_rates, public.model_tiers to authenticated, strappy_worker;

-- El worker cobra: necesita ejecutar las funciones, no escribir las tablas.
grant execute on function
  public.charge_credits(uuid, text, jsonb, text, text, uuid, uuid, text, jsonb, timestamptz, boolean),
  public.grant_credits(uuid, text, numeric, text, text, text, jsonb),
  public.has_credits(uuid, numeric),
  public.resolve_credit_rate(text, text, timestamptz)
  to strappy_worker;
