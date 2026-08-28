-- =============================================================================
-- 0005_ingest.sql · Ingesta cruda de webhooks
-- -----------------------------------------------------------------------------
-- Todo lo que entra se guarda tal cual ANTES de interpretarlo. Es la caja negra:
-- cuando un mensaje no aparece en la bandeja, la respuesta esta aqui.
-- Volumen alto y vida corta -> particionada por mes y retencion de 30 dias.
-- =============================================================================

-- En Supabase las extensiones viven en el esquema `extensions`. Los tipos y las
-- clases de operadores (vector, gin_trgm_ops...) se resuelven en el momento del
-- DDL, asi que `extensions` tiene que estar en el search_path AL APLICAR. En un
-- Postgres pelado el esquema no existe y la linea es inocua.
set search_path = public, extensions, pg_temp;

create table if not exists public.webhook_events (
  id            uuid not null default gen_random_uuid(),
  received_at   timestamptz not null default now(),
  provider      text not null default 'whatsapp',
  external_key  text,
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  channel_id    uuid,
  event_type    text,
  event_hash    text not null,
  signature_ok  boolean not null default false,
  payload       jsonb not null,
  headers       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending'
                  check (status in ('pending','processing','processed','skipped','failed')),
  attempts      integer not null default 0,
  process_error text,
  processed_at  timestamptz,
  primary key (id, received_at)
) partition by range (received_at);

comment on table public.webhook_events is
  'Cuerpo crudo de cada webhook recibido, particionado por mes en received_at. signature_ok registra si la firma del proveedor validaba; se guarda incluso cuando NO valida, porque una firma rota es justo lo que hay que poder investigar.';
comment on column public.webhook_events.event_hash is
  'Hash estable del evento (id del proveedor + tipo). Cada particion lleva un unico local sobre el: dos entregas del mismo evento dentro del mes no se procesan dos veces.';
comment on column public.webhook_events.workspace_id is
  'Nulo mientras el tenant no se ha resuelto. Las filas sin resolver solo son visibles para el rol de servicio, nunca para usuarios.';
comment on column public.webhook_events.external_key is
  'Clave con la que se busca en channel_routing (phone_number_id en WhatsApp).';

-- -----------------------------------------------------------------------------
-- Gestion de particiones mensuales
-- -----------------------------------------------------------------------------
create or replace function public.create_month_partition(
  p_parent text,
  p_month  date,
  p_unique_cols text[] default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := p_parent || '_' || to_char(v_start, 'YYYYMM');
begin
  if to_regclass('public.' || quote_ident(v_name)) is null then
    execute format(
      'create table public.%I partition of public.%I for values from (%L) to (%L)',
      v_name, p_parent, v_start, v_end);

    if p_unique_cols is not null then
      execute format(
        'create unique index %I on public.%I (%s)',
        v_name || '_uniq', v_name,
        (select string_agg(quote_ident(c), ', ') from unnest(p_unique_cols) c));
    end if;
  end if;
  return v_name;
end;
$$;

comment on function public.create_month_partition(text, date, text[]) is
  'Crea la particion mensual de una tabla particionada por rango y, opcionalmente, su unico LOCAL. El unico va en la particion y no en la tabla padre porque Postgres exigiria incluir la columna de particion en la clave, lo que anularia la deduplicacion.';

create or replace function public.ensure_month_partitions(p_months_ahead integer default 2)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i integer;
  m date;
begin
  for i in -1 .. p_months_ahead loop
    m := (date_trunc('month', now()) + make_interval(months => i))::date;
    perform public.create_month_partition('webhook_events', m, array['event_hash']);
    if to_regclass('public.credit_ledger') is not null then
      perform public.create_month_partition('credit_ledger', m, array['workspace_id','idempotency_key']);
    end if;
  end loop;
end;
$$;

comment on function public.ensure_month_partitions(integer) is
  'Crea las particiones del mes anterior, el actual y los proximos. Idempotente: llamar desde un cron diario y desde el arranque del worker.';

create or replace function public.drop_expired_webhook_partitions(p_keep_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  n integer := 0;
  cutoff date := (date_trunc('month', now() - make_interval(days => p_keep_days)))::date;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_inherits i on i.inhrelid = c.oid
    join pg_class p on p.oid = i.inhparent
    where p.relname = 'webhook_events'
  loop
    if to_date(right(r.relname, 6), 'YYYYMM') < cutoff then
      execute format('drop table public.%I', r.relname);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

comment on function public.drop_expired_webhook_partitions(integer) is
  'Retencion de 30 dias: elimina particiones enteras de webhook_events ya caducadas. DROP de particion en lugar de DELETE masivo, que en esta tabla bloquearia la ingesta.';

select public.ensure_month_partitions(2);

-- -----------------------------------------------------------------------------
-- Indices
-- BRIN sobre received_at: la tabla se escribe en orden cronologico estricto, asi
-- que un BRIN cuesta kilobytes donde un btree costaria cientos de megabytes.
-- -----------------------------------------------------------------------------
create index if not exists webhook_events_received_brin
  on public.webhook_events using brin (received_at) with (pages_per_range = 32);
create index if not exists webhook_events_ws_idx
  on public.webhook_events (workspace_id, received_at desc);
create index if not exists webhook_events_pending_idx
  on public.webhook_events (status, received_at) where status in ('pending','failed');
create index if not exists webhook_events_external_idx
  on public.webhook_events (external_key, received_at desc);

-- -----------------------------------------------------------------------------
-- Ingesta idempotente
-- -----------------------------------------------------------------------------
create or replace function public.ingest_webhook_event(
  p_provider     text,
  p_event_hash   text,
  p_payload      jsonb,
  p_signature_ok boolean,
  p_external_key text default null,
  p_event_type   text default null,
  p_headers      jsonb default '{}'::jsonb
)
returns table (event_id uuid, is_new boolean, workspace_id uuid, channel_id uuid, agent_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_route  public.channel_routing%rowtype;
  v_id     uuid;
begin
  if p_external_key is not null then
    -- Ruta caliente: UNA lectura por clave primaria para resolver el tenant.
    select * into v_route from public.channel_routing r where r.external_key = p_external_key;
  end if;

  insert into public.webhook_events (
    provider, external_key, workspace_id, channel_id, event_type,
    event_hash, signature_ok, payload, headers)
  values (
    p_provider, p_external_key, v_route.workspace_id, v_route.channel_id, p_event_type,
    p_event_hash, coalesce(p_signature_ok, false), p_payload, coalesce(p_headers, '{}'::jsonb))
  on conflict do nothing            -- sin objetivo: el unico vive en la particion
  returning id into v_id;

  return query select
    v_id,
    v_id is not null,
    v_route.workspace_id,
    v_route.channel_id,
    v_route.agent_id;
end;
$$;

comment on function public.ingest_webhook_event(text, text, jsonb, boolean, text, text, jsonb) is
  'Punto unico de entrada del webhook: resuelve el tenant con una lectura de channel_routing y guarda el evento de forma idempotente. Devuelve is_new=false cuando el evento ya se habia recibido, para que el llamador corte sin reprocesar.';

-- =============================================================================
-- RLS · solo lectura para usuarios; escribe el rol de servicio.
-- =============================================================================
select public.apply_tenant_rls('webhook_events', null, true);
