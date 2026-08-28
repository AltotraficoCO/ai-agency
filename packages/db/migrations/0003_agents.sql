-- =============================================================================
-- 0003_agents.sql · Agentes, versiones inmutables y catalogo
-- -----------------------------------------------------------------------------
-- Un agente es un puntero mutable (nombre, estado, version activa) sobre una
-- cadena de versiones INMUTABLES. Publicar = crear version nueva y mover el
-- puntero; nunca reescribir lo que ya salio a produccion.
-- =============================================================================

-- En Supabase las extensiones viven en el esquema `extensions`. Los tipos y las
-- clases de operadores (vector, gin_trgm_ops...) se resuelven en el momento del
-- DDL, asi que `extensions` tiene que estar en el search_path AL APLICAR. En un
-- Postgres pelado el esquema no existe y la linea es inocua.
set search_path = public, extensions, pg_temp;

create table if not exists public.agent_types (
  agent_type   text primary key,
  label        text not null,
  description  text,
  default_spec jsonb not null default '{}'::jsonb,
  is_enabled   boolean not null default true,
  created_at   timestamptz not null default now()
);

comment on table public.agent_types is
  'Registro global de tipos de agente (conversacional, tarea, clasificador...). Catalogo extensible: agents.agent_type lo referencia por texto.';

insert into public.agent_types (agent_type, label, description) values
  ('conversational', 'Conversacional', 'Atiende conversaciones en canales de mensajeria'),
  ('task',           'Por encargo',    'Ejecuta tareas puntuales sin conversacion continua'),
  ('classifier',     'Clasificador',   'Etiqueta o enruta sin responder al contacto'),
  ('meta',           'Meta-agente',    'Construye y configura otros agentes')
on conflict (agent_type) do nothing;

-- -----------------------------------------------------------------------------
create table if not exists public.company_profiles (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null unique references public.workspaces(id) on delete cascade,
  legal_name    text,
  brand_name    text,
  description   text,
  industry      text,
  website       text,
  address       text,
  city          text,
  country       text not null default 'CO',
  timezone      text,
  currency      text not null default 'COP',
  business_hours jsonb not null default '{}'::jsonb,
  contact_email text,
  contact_phone text,
  policies      jsonb not null default '{}'::jsonb,
  extra         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.company_profiles is
  'Ficha de la empresa, UNA por espacio y compartida por todos sus agentes. Se contesta una sola vez y se inyecta en el prompt compilado de cada agente.';

-- -----------------------------------------------------------------------------
create table if not exists public.agents (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  kind              text not null default 'own'
                      check (kind in ('own','catalog','system')),
  agent_type        text not null default 'conversational'
                      references public.agent_types(agent_type),
  catalog_slug      text,
  name              text not null,
  avatar_url        text,
  description       text,
  active_version_id uuid,
  status            text not null default 'draft'
                      check (status in ('draft','published','paused','archived')),
  mode              text not null default 'lite'
                      check (mode in ('lite','max')),
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.agents is
  'Puntero mutable a una cadena de versiones inmutables. kind distingue agente propio, instancia de un agente del catalogo y agente de sistema. active_version_id es lo que ejecuta el motor.';
comment on column public.agents.catalog_slug is
  'Slug del agente del catalogo del que procede esta instancia. Nulo en agentes propios.';
comment on column public.agents.mode is
  'lite o max: selecciona la fila de model_tiers con la que se resuelve el modelo en cada tarea.';

create index if not exists agents_ws_status_idx on public.agents (workspace_id, status, updated_at desc);
create index if not exists agents_ws_type_idx   on public.agents (workspace_id, agent_type);

-- Ahora que agents existe, cerramos las referencias que 0002 dejo abiertas.
alter table public.whatsapp_numbers
  drop constraint if exists whatsapp_numbers_agent_id_fkey;
alter table public.whatsapp_numbers
  add constraint whatsapp_numbers_agent_id_fkey
  foreign key (agent_id) references public.agents(id) on delete set null;

alter table public.channel_routing
  drop constraint if exists channel_routing_agent_id_fkey;
alter table public.channel_routing
  add constraint channel_routing_agent_id_fkey
  foreign key (agent_id) references public.agents(id) on delete set null;

-- -----------------------------------------------------------------------------
create table if not exists public.agent_versions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  agent_id        uuid not null references public.agents(id) on delete cascade,
  version         integer not null,
  spec            jsonb not null,
  compiled_prompt text not null,
  prompt_hash     text not null,
  model           text,
  changelog       text,
  status          text not null default 'published'
                    check (status in ('published','rolled_back')),
  published_by    uuid references auth.users(id) on delete set null,
  published_at    timestamptz not null default now(),
  unique (agent_id, version)
);

comment on table public.agent_versions is
  'Version publicada e INMUTABLE de un agente. Nunca se hace UPDATE de spec ni de compiled_prompt: revertir es publicar una version nueva. Sin esto no hay forma de auditar que prompt respondio una conversacion de hace un mes.';
comment on column public.agent_versions.prompt_hash is
  'Hash del prompt compilado. Permite deduplicar publicaciones identicas y trazar en agent_runs con que texto exacto se respondio.';

create index if not exists agent_versions_ws_agent_idx
  on public.agent_versions (workspace_id, agent_id, version desc);

alter table public.agents drop constraint if exists agents_active_version_id_fkey;
alter table public.agents
  add constraint agents_active_version_id_fkey
  foreign key (active_version_id) references public.agent_versions(id) on delete set null;

-- Barrera de inmutabilidad. Solo se admite marcar rolled_back.
create or replace function public.guard_agent_version_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'las versiones de agente no se borran (agent_id=%, version=%)', old.agent_id, old.version
      using errcode = '42501';
  end if;

  if new.spec            is distinct from old.spec
     or new.compiled_prompt is distinct from old.compiled_prompt
     or new.prompt_hash  is distinct from old.prompt_hash
     or new.version      is distinct from old.version
     or new.agent_id     is distinct from old.agent_id
     or new.workspace_id is distinct from old.workspace_id
     or new.model        is distinct from old.model
  then
    raise exception 'agent_versions es inmutable: publique una version nueva en lugar de editar la % del agente %', old.version, old.agent_id
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_agent_version_immutable() is
  'Impide UPDATE sobre el contenido de una version publicada y cualquier DELETE. Solo deja cambiar status a rolled_back.';

drop trigger if exists agent_versions_immutable on public.agent_versions;
create trigger agent_versions_immutable
  before update or delete on public.agent_versions
  for each row execute function public.guard_agent_version_immutable();

-- Numeracion automatica de versiones por agente.
create or replace function public.assign_agent_version_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.version is null or new.version = 0 then
    select coalesce(max(v.version), 0) + 1 into new.version
    from public.agent_versions v where v.agent_id = new.agent_id;
  end if;
  return new;
end;
$$;

drop trigger if exists agent_versions_number on public.agent_versions;
create trigger agent_versions_number
  before insert on public.agent_versions
  for each row execute function public.assign_agent_version_number();

alter table public.agent_versions alter column version drop not null;

-- -----------------------------------------------------------------------------
create table if not exists public.agent_drafts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id     uuid references public.agents(id) on delete cascade,
  spec         jsonb not null default '{}'::jsonb,
  phase        text not null default 'discovery'
                 check (phase in ('discovery','company','persona','knowledge','tools','channels','review','published')),
  progress     jsonb not null default '{}'::jsonb,
  thread_id    uuid,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.agent_drafts is
  'Borrador persistente del meta-agente. La construccion de un agente es una conversacion larga que sobrevive a recargas y cambios de dispositivo: spec se va rellenando y phase indica en que punto del guion va.';

create index if not exists agent_drafts_ws_idx on public.agent_drafts (workspace_id, updated_at desc);
create unique index if not exists agent_drafts_agent_uniq
  on public.agent_drafts (workspace_id, agent_id) where agent_id is not null;

-- -----------------------------------------------------------------------------
create table if not exists public.agent_variables (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id     uuid not null references public.agents(id) on delete cascade,
  key          text not null,
  label        text,
  value_type   text not null default 'text'
                 check (value_type in ('text','number','boolean','date','json','secret')),
  default_value jsonb,
  is_required  boolean not null default false,
  scope        text not null default 'agent'
                 check (scope in ('agent','conversation','contact')),
  description  text,
  created_at   timestamptz not null default now(),
  unique (agent_id, key)
);

comment on table public.agent_variables is
  'Declaracion de las variables que el agente puede leer y escribir. scope decide donde vive el valor: fijo del agente, por conversacion o en la ficha del contacto.';

create index if not exists agent_variables_ws_idx on public.agent_variables (workspace_id, agent_id);

-- -----------------------------------------------------------------------------
create table if not exists public.agent_tools (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id     uuid not null references public.agents(id) on delete cascade,
  tool_id      uuid not null,
  is_enabled   boolean not null default true,
  config       jsonb not null default '{}'::jsonb,
  auto_approve boolean not null default true,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (agent_id, tool_id)
);

comment on table public.agent_tools is
  'Herramientas habilitadas para un agente y su configuracion por agente. auto_approve en false exige confirmacion humana antes de ejecutar. La clave foranea a tools se anade en 0007.';

create index if not exists agent_tools_ws_idx on public.agent_tools (workspace_id, agent_id);

-- -----------------------------------------------------------------------------
create table if not exists public.agent_brains (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id     uuid not null references public.agents(id) on delete cascade,
  brain_id     uuid not null,
  top_k        integer not null default 3 check (top_k between 1 and 20),
  threshold    numeric(4,3) not null default 0.60 check (threshold between 0 and 1),
  is_enabled   boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (agent_id, brain_id)
);

comment on table public.agent_brains is
  'Bases de conocimiento conectadas a un agente. top_k=3 y threshold=0.60 por defecto: traer mas fragmentos diluye el prompt y baja la precision mas de lo que ayuda. La clave foranea a brains se anade en 0006.';

create index if not exists agent_brains_ws_idx on public.agent_brains (workspace_id, agent_id);

-- -----------------------------------------------------------------------------
-- Catalogo global de agentes contratables. Sin workspace_id: es producto, no
-- dato de cliente.
-- -----------------------------------------------------------------------------
create table if not exists public.catalog_agents (
  slug            text primary key,
  name            text not null,
  tagline         text,
  description     text,
  agent_type      text not null references public.agent_types(agent_type),
  category        text not null default 'general',
  avatar_url      text,
  spec_template   jsonb not null default '{}'::jsonb,
  required_tools  text[] not null default '{}'::text[],
  monthly_credits integer not null default 0,
  setup_credits   integer not null default 0,
  is_published    boolean not null default true,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.catalog_agents is
  'Catalogo GLOBAL de agentes contratables. No lleva workspace_id porque es parte del producto; contratar uno crea un agents(kind=catalog) en el espacio del cliente.';

create table if not exists public.agent_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  catalog_slug  text not null references public.catalog_agents(slug) on delete restrict,
  agent_id      uuid references public.agents(id) on delete set null,
  status        text not null default 'active'
                  check (status in ('active','paused','cancelled')),
  started_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  settings      jsonb not null default '{}'::jsonb,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (workspace_id, catalog_slug)
);

comment on table public.agent_subscriptions is
  'Contratacion de un agente del catalogo por un espacio. Une la fila global de catalog_agents con la instancia concreta en agents.';

create index if not exists agent_subscriptions_ws_idx
  on public.agent_subscriptions (workspace_id, status);

-- =============================================================================
-- RLS
-- =============================================================================
select public.apply_tenant_rls('company_profiles',    'agents.write');
select public.apply_tenant_rls('agents',              'agents.write');
select public.apply_tenant_rls('agent_versions',      'agents.publish');
select public.apply_tenant_rls('agent_drafts',        'agents.write');
select public.apply_tenant_rls('agent_variables',     'agents.write');
select public.apply_tenant_rls('agent_tools',         'agents.write');
select public.apply_tenant_rls('agent_brains',        'agents.write');
select public.apply_tenant_rls('agent_subscriptions', 'catalog.subscribe');

-- Registros globales: lectura para todos, escritura solo por rol de servicio.
alter table public.agent_types    enable row level security;
alter table public.catalog_agents enable row level security;
drop policy if exists agent_types_read on public.agent_types;
drop policy if exists catalog_agents_read on public.catalog_agents;
create policy agent_types_read on public.agent_types
  for select to authenticated, strappy_worker using (true);
create policy catalog_agents_read on public.catalog_agents
  for select to authenticated, strappy_worker using (is_published);
grant select on public.agent_types, public.catalog_agents to authenticated, strappy_worker;

do $$
declare t text;
begin
  foreach t in array array['company_profiles','agents','agent_drafts','catalog_agents'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch', t);
  end loop;
end
$$;
