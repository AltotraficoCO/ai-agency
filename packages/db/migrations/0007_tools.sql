-- =============================================================================
-- 0007_tools.sql · Herramientas, conexiones y trazas de ejecucion
-- -----------------------------------------------------------------------------
-- tools.workspace_id NULO = herramienta de sistema, global y visible para todos
-- los espacios. Con valor = herramienta propia del cliente.
-- =============================================================================

-- En Supabase las extensiones viven en el esquema `extensions`. Los tipos y las
-- clases de operadores (vector, gin_trgm_ops...) se resuelven en el momento del
-- DDL, asi que `extensions` tiene que estar en el search_path AL APLICAR. En un
-- Postgres pelado el esquema no existe y la linea es inocua.
set search_path = public, extensions, pg_temp;

create table if not exists public.tools (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  slug          text not null,
  name          text not null,
  description   text,
  kind          text not null default 'http'
                  check (kind in ('http','builtin','mcp','sql','webhook','handover','schedule')),
  input_schema  jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  config        jsonb not null default '{}'::jsonb,
  connection_id uuid,
  requires_connection boolean not null default false,
  is_enabled    boolean not null default true,
  timeout_ms    integer not null default 15000,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.tools is
  'Herramienta invocable por un agente. workspace_id nulo significa herramienta de SISTEMA: global, mantenida por la plataforma y de solo lectura para los clientes. input_schema es el JSON Schema que se le entrega al modelo.';
comment on column public.tools.workspace_id is
  'Nulo = herramienta de sistema global. Con valor = herramienta propia del espacio.';

create unique index if not exists tools_ws_slug_uniq
  on public.tools (workspace_id, slug) where workspace_id is not null;
create unique index if not exists tools_system_slug_uniq
  on public.tools (slug) where workspace_id is null;
create index if not exists tools_ws_kind_idx on public.tools (workspace_id, kind, is_enabled);

-- Cerramos la referencia que 0003 dejo abierta.
alter table public.agent_tools drop constraint if exists agent_tools_tool_id_fkey;
alter table public.agent_tools
  add constraint agent_tools_tool_id_fkey
  foreign key (tool_id) references public.tools(id) on delete cascade;

-- -----------------------------------------------------------------------------
create table if not exists public.connections (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  provider       text not null,
  name           text not null,
  auth_type      text not null default 'api_key'
                   check (auth_type in ('api_key','oauth2','basic','bearer','none')),
  credentials_encrypted text,
  key_version    integer not null default 1,
  metadata       jsonb not null default '{}'::jsonb,
  scopes         text[] not null default '{}'::text[],
  expires_at     timestamptz,
  last_verified_at timestamptz,
  status         text not null default 'active'
                   check (status in ('active','expired','revoked','error')),
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, provider, name)
);

comment on table public.connections is
  'Credencial de un servicio externo. El secreto va cifrado en la aplicacion y NUNCA en claro; key_version identifica con que clave maestra se cifro para poder rotarla sin descifrar todo de golpe.';
comment on column public.connections.credentials_encrypted is
  'Sobre cifrado (texto base64). Postgres no lo descifra: la clave vive fuera de la base para que un volcado no sea una fuga de credenciales.';

create index if not exists connections_ws_provider_idx
  on public.connections (workspace_id, provider, status);

alter table public.tools drop constraint if exists tools_connection_id_fkey;
alter table public.tools
  add constraint tools_connection_id_fkey
  foreign key (connection_id) references public.connections(id) on delete set null;

-- -----------------------------------------------------------------------------
create table if not exists public.agent_runs (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  agent_id         uuid references public.agents(id) on delete set null,
  agent_version_id uuid references public.agent_versions(id) on delete set null,
  conversation_id  uuid references public.conversations(id) on delete cascade,
  message_id       uuid references public.messages(id) on delete set null,
  trigger          text not null default 'inbound'
                     check (trigger in ('inbound','schedule','automation','manual','retry','catalog_task')),

  status           text not null default 'running'
                     check (status in ('running','succeeded','failed','skipped','cancelled')),
  skip_reason      text
                     check (skip_reason is null or skip_reason in
                       ('no_credits','taken_over','bot_paused','bot_disabled','outside_hours','duplicate','contact_blocked','send_restricted')),

  mode             text check (mode is null or mode in ('lite','max')),
  model            text,
  fallback_used    boolean not null default false,

  input_tokens     integer not null default 0,
  output_tokens    integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  latency_ms       integer,
  ttft_ms          integer,
  credits          numeric(14,4) not null default 0,

  steps            integer not null default 0,
  error_code       text,
  error_detail     text,
  metadata         jsonb not null default '{}'::jsonb,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);

comment on table public.agent_runs is
  'Una ejecucion del agente sobre un turno de conversacion. Es la traza que explica por que el bot contesto o no. Solo lectura para usuarios: la escribe el motor.';
comment on column public.agent_runs.skip_reason is
  'Por que NO se ejecuto el agente. Sin este campo, "el bot no contesto" es indistinguible de "el bot fallo", que son incidencias completamente distintas: no_credits es facturacion, taken_over es comportamiento correcto y bot_paused es configuracion.';
comment on column public.agent_runs.cache_read_tokens is
  'Tokens servidos desde la cache de prompt del proveedor. Se cobran a tarifa distinta y por eso se contabilizan aparte de input_tokens.';

create index if not exists agent_runs_ws_started_idx
  on public.agent_runs (workspace_id, started_at desc);
create index if not exists agent_runs_ws_conv_idx
  on public.agent_runs (workspace_id, conversation_id, started_at desc);
create index if not exists agent_runs_ws_agent_idx
  on public.agent_runs (workspace_id, agent_id, started_at desc);
create index if not exists agent_runs_ws_skip_idx
  on public.agent_runs (workspace_id, skip_reason, started_at desc) where skip_reason is not null;

-- -----------------------------------------------------------------------------
create table if not exists public.tool_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  agent_run_id  uuid references public.agent_runs(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  tool_id       uuid references public.tools(id) on delete set null,
  connection_id uuid references public.connections(id) on delete set null,
  tool_slug     text not null,
  call_id       text,
  input         jsonb not null default '{}'::jsonb,
  output        jsonb,
  status        text not null default 'running'
                  check (status in ('running','succeeded','failed','timeout','rejected','awaiting_approval')),
  http_status   integer,
  error_code    text,
  error_detail  text,
  latency_ms    integer,
  credits       numeric(14,4) not null default 0,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

comment on table public.tool_runs is
  'Invocacion concreta de una herramienta dentro de una ejecucion de agente. Guarda entrada y salida para poder reproducir el fallo sin volver a llamar al servicio externo. Solo lectura para usuarios.';
comment on column public.tool_runs.tool_slug is
  'Slug denormalizado: si la herramienta se borra, la traza historica sigue diciendo que se invoco.';

create index if not exists tool_runs_ws_started_idx
  on public.tool_runs (workspace_id, started_at desc);
create index if not exists tool_runs_ws_run_idx
  on public.tool_runs (workspace_id, agent_run_id);
create index if not exists tool_runs_ws_status_idx
  on public.tool_runs (workspace_id, status, started_at desc) where status <> 'succeeded';

do $$
declare t text;
begin
  foreach t in array array['tools','connections'] loop
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
-- tools admite filas globales (workspace_id nulo): visibles para todos, pero la
-- politica de escritura exige has_perm(workspace_id,...) y con nulo nunca es
-- cierta, asi que un cliente no puede tocar una herramienta de sistema.
select public.apply_tenant_rls('tools', 'tools.write', false, true);
select public.apply_tenant_rls('connections', 'tools.write');
select public.apply_tenant_rls('agent_runs', null, true);
select public.apply_tenant_rls('tool_runs',  null, true);
