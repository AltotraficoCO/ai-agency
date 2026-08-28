-- =============================================================================
-- 0002_channels.sql · Canales de mensajeria
-- -----------------------------------------------------------------------------
-- El registro de canales es extensible: `kind` es texto libre, no un enum, para
-- que anadir Instagram, Telegram o webchat no exija una migracion de tipo.
-- =============================================================================

-- En Supabase las extensiones viven en el esquema `extensions`. Los tipos y las
-- clases de operadores (vector, gin_trgm_ops...) se resuelven en el momento del
-- DDL, asi que `extensions` tiene que estar en el search_path AL APLICAR. En un
-- Postgres pelado el esquema no existe y la linea es inocua.
set search_path = public, extensions, pg_temp;

create table if not exists public.channel_kinds (
  kind        text primary key,
  label       text not null,
  is_enabled  boolean not null default true,
  capabilities jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.channel_kinds is
  'Registro global de tipos de canal. Es catalogo, no restriccion: channels.kind no lleva clave foranea para que un canal nuevo pueda existir antes de registrarse.';

insert into public.channel_kinds (kind, label, capabilities) values
  ('whatsapp', 'WhatsApp',  '{"media":true,"templates":true,"session_window_hours":24}'),
  ('webchat',  'Chat web',  '{"media":true,"templates":false}'),
  ('instagram','Instagram', '{"media":true,"templates":false,"session_window_hours":24}'),
  ('telegram', 'Telegram',  '{"media":true,"templates":false}')
on conflict (kind) do nothing;

create table if not exists public.channels (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind         text not null,
  name         text not null,
  status       text not null default 'pending'
                 check (status in ('pending','connected','degraded','disconnected','error')),
  settings     jsonb not null default '{}'::jsonb,
  status_detail text,
  connected_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.channels is
  'Instancia de un canal conectado a un espacio (una cuenta de WhatsApp, un widget web). kind es texto libre a proposito: el registro de canales es extensible.';

create index if not exists channels_ws_kind_idx on public.channels (workspace_id, kind, status);

create table if not exists public.whatsapp_accounts (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  channel_id            uuid not null references public.channels(id) on delete cascade,
  waba_id               text not null unique,
  business_id           text,
  name                  text,
  access_token_encrypted text,
  key_version           integer not null default 1,
  token_expires_at      timestamptz,
  payment_status        text not null default 'unknown'
                          check (payment_status in ('unknown','active','past_due','suspended','no_payment_method')),
  account_review_status text not null default 'pending'
                          check (account_review_status in ('pending','approved','rejected')),
  business_verification_status text not null default 'not_verified'
                          check (business_verification_status in ('not_verified','pending','verified','failed')),
  messaging_limit_tier  text,
  signup_version        text,
  webhook_subscribed    boolean not null default false,
  last_sync_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.whatsapp_accounts is
  'Cuenta de WhatsApp Business (WABA) conectada por Embedded Signup. waba_id es unico global: una WABA solo puede pertenecer a un espacio. El token va cifrado y versionado por key_version para poder rotar la clave sin releer todo.';
comment on column public.whatsapp_accounts.signup_version is
  'Version del flujo de Embedded Signup usada al conectar. Meta cambia el flujo y hay que saber con cual se dio de alta cada cuenta.';

create index if not exists whatsapp_accounts_ws_idx on public.whatsapp_accounts (workspace_id, channel_id);

create table if not exists public.whatsapp_numbers (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  account_id         uuid not null references public.whatsapp_accounts(id) on delete cascade,
  channel_id         uuid not null references public.channels(id) on delete cascade,
  phone_number_id    text not null unique,
  display_phone_number text not null,
  verified_name      text,
  quality_rating     text not null default 'UNKNOWN'
                       check (quality_rating in ('GREEN','YELLOW','RED','UNKNOWN')),
  messaging_tier     text not null default 'TIER_UNKNOWN',
  code_verification_status text,
  is_default         boolean not null default false,
  agent_id           uuid,
  status             text not null default 'active'
                       check (status in ('active','paused','disconnected')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.whatsapp_numbers is
  'Numero de telefono de una WABA. phone_number_id es unico GLOBAL porque es la clave que llega en el webhook de Meta y con la que se resuelve el tenant.';
comment on column public.whatsapp_numbers.agent_id is
  'Agente que atiende este numero. Sin clave foranea declarada aqui: agents se crea en 0003 y la restriccion se anade alli.';

create index if not exists whatsapp_numbers_ws_idx on public.whatsapp_numbers (workspace_id, account_id);
create unique index if not exists whatsapp_numbers_default_idx
  on public.whatsapp_numbers (workspace_id, account_id) where is_default;

-- -----------------------------------------------------------------------------
-- channel_routing: tabla plana de resolucion de tenant.
-- El webhook llega ~50 veces por segundo y debe resolver el tenant ANTES de
-- poder aplicar RLS. Un join de 3 tablas por evento es inaceptable; esta tabla
-- lo convierte en una unica lectura por clave primaria. La mantiene un trigger,
-- nunca la aplicacion.
-- -----------------------------------------------------------------------------
create table if not exists public.channel_routing (
  external_key text primary key,
  kind         text not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_id   uuid not null references public.channels(id) on delete cascade,
  agent_id     uuid,
  account_id   uuid,
  is_active    boolean not null default true,
  updated_at   timestamptz not null default now()
);

comment on table public.channel_routing is
  'Mapa plano external_key -> (workspace_id, channel_id, agent_id) mantenido por trigger. Permite resolver el tenant del webhook con UNA lectura por clave primaria en la ruta caliente. Para WhatsApp external_key es el phone_number_id.';
comment on column public.channel_routing.external_key is
  'Identificador que envia el proveedor en el webhook. WhatsApp: phone_number_id. Otros canales reutilizan la misma columna.';

create index if not exists channel_routing_ws_idx on public.channel_routing (workspace_id, kind);

create or replace function public.sync_channel_routing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.channel_routing where external_key = old.phone_number_id;
    return old;
  end if;

  if tg_op = 'UPDATE' and new.phone_number_id is distinct from old.phone_number_id then
    delete from public.channel_routing where external_key = old.phone_number_id;
  end if;

  insert into public.channel_routing (
    external_key, kind, workspace_id, channel_id, agent_id, account_id, is_active, updated_at)
  values (
    new.phone_number_id, 'whatsapp', new.workspace_id, new.channel_id,
    new.agent_id, new.account_id, new.status = 'active', now())
  on conflict (external_key) do update set
    kind         = excluded.kind,
    workspace_id = excluded.workspace_id,
    channel_id   = excluded.channel_id,
    agent_id     = excluded.agent_id,
    account_id   = excluded.account_id,
    is_active    = excluded.is_active,
    updated_at   = now();

  return new;
end;
$$;

comment on function public.sync_channel_routing() is
  'Mantiene channel_routing sincronizada con whatsapp_numbers. Unico escritor de la tabla de enrutado.';

drop trigger if exists whatsapp_numbers_routing on public.whatsapp_numbers;
create trigger whatsapp_numbers_routing
  after insert or update or delete on public.whatsapp_numbers
  for each row execute function public.sync_channel_routing();

-- =============================================================================
-- RLS
-- =============================================================================
select public.apply_tenant_rls('channels',          'channels.write');
select public.apply_tenant_rls('whatsapp_accounts', 'channels.write');
select public.apply_tenant_rls('whatsapp_numbers',  'channels.write');
-- channel_routing la escribe solo el trigger: para el usuario es de solo lectura.
select public.apply_tenant_rls('channel_routing',   null, true);

-- El catalogo de tipos de canal es global y de solo lectura para los usuarios.
alter table public.channel_kinds enable row level security;
drop policy if exists channel_kinds_read on public.channel_kinds;
create policy channel_kinds_read on public.channel_kinds
  for select to authenticated, strappy_worker using (true);
grant select on public.channel_kinds to authenticated, strappy_worker;

do $$
declare t text;
begin
  foreach t in array array['channels','whatsapp_accounts','whatsapp_numbers'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch', t);
  end loop;
end
$$;
