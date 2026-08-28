-- =============================================================================
-- 0001_core.sql · Identidad, tenencia y permisos
-- -----------------------------------------------------------------------------
-- Jerarquia: organizations > workspaces > memberships.
-- El workspace es la unidad de aislamiento (el "tenant"): TODA tabla de negocio
-- lleva workspace_id y todo indice compuesto empieza por el.
-- =============================================================================

-- En Supabase las extensiones viven en el esquema `extensions`. Los tipos y las
-- clases de operadores (vector, gin_trgm_ops...) se resuelven en el momento del
-- DDL, asi que `extensions` tiene que estar en el search_path AL APLICAR. En un
-- Postgres pelado el esquema no existe y la linea es inocua.
set search_path = public, extensions, pg_temp;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists btree_gin;
create extension if not exists btree_gist;

-- -----------------------------------------------------------------------------
-- Rol dedicado del worker.
-- El worker NO usa service_role (que hace BYPASSRLS y, ante un bug de join,
-- cruzaria tenants sin que nada lo detenga). Usa strappy_worker: un rol sujeto a
-- RLS que solo ve el workspace declarado con `SET LOCAL app.workspace_id`.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'strappy_worker') then
    create role strappy_worker nologin;
  end if;
end
$$;

grant usage on schema public to strappy_worker;

-- =============================================================================
-- Tablas
-- =============================================================================

create table if not exists public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  billing_email text,
  country       text not null default 'CO',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.organizations is
  'Entidad comercial/legal que agrupa espacios de trabajo. Es el sujeto de la facturacion; el aislamiento de datos NO ocurre aqui sino en workspaces.';

create table if not exists public.workspaces (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  slug            text not null,
  settings        jsonb not null default '{}'::jsonb,
  timezone        text not null default 'America/Bogota',
  locale          text not null default 'es-CO',
  status          text not null default 'active'
                    check (status in ('active','suspended','deleted')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, slug)
);

comment on table public.workspaces is
  'Unidad de aislamiento multi-tenant. Todo dato de negocio cuelga de un workspace_id y todas las politicas RLS se apoyan en is_member(workspace_id).';
comment on column public.workspaces.settings is
  'Preferencias libres del espacio (horario de atencion, marca, umbrales del motor). jsonb para no migrar el esquema en cada ajuste de producto.';

create table if not exists public.profiles (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  full_name            text,
  avatar_url           text,
  locale               text not null default 'es-CO',
  timezone             text not null default 'America/Bogota',
  default_workspace_id uuid references public.workspaces(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.profiles is
  'Datos de presentacion del usuario autenticado, 1:1 con auth.users. No contiene permisos: eso vive en memberships.';

create table if not exists public.memberships (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'agent'
                 check (role in ('owner','admin','builder','agent','analyst')),
  permissions  text[] not null default '{}'::text[],
  status       text not null default 'active'
                 check (status in ('active','suspended')),
  invited_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);

comment on table public.memberships is
  'Vinculo usuario<->espacio y unica fuente de verdad de autorizacion. role es un preset; permissions es el override fino.';
comment on column public.memberships.permissions is
  'Override sobre el preset: "algo.write" concede ese permiso extra; "!algo.write" lo revoca aunque el preset lo incluya. La revocacion siempre gana.';

create index if not exists memberships_user_idx on public.memberships (user_id, workspace_id);

create table if not exists public.invitations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text not null,
  role         text not null default 'agent'
                 check (role in ('owner','admin','builder','agent','analyst')),
  permissions  text[] not null default '{}'::text[],
  token_hash   text not null,
  invited_by   uuid references auth.users(id) on delete set null,
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.invitations is
  'Invitaciones pendientes a un espacio. Guarda solo el hash del token: el token en claro viaja por correo y nunca se persiste.';

create unique index if not exists invitations_pending_uniq
  on public.invitations (workspace_id, lower(email))
  where accepted_at is null and revoked_at is null;

create table if not exists public.teams (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  name             text not null,
  description      text,
  routing_strategy text not null default 'manual'
                     check (routing_strategy in ('manual','round_robin','least_busy')),
  is_default       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, name)
);

comment on table public.teams is
  'Grupos de agentes humanos para el reparto de la bandeja. routing_strategy decide como se asigna una conversacion escalada: manual, turno rotativo o menos ocupado.';

create unique index if not exists teams_one_default_idx
  on public.teams (workspace_id) where is_default;

create table if not exists public.team_members (
  workspace_id           uuid not null references public.workspaces(id) on delete cascade,
  team_id                uuid not null references public.teams(id) on delete cascade,
  user_id                uuid not null references auth.users(id) on delete cascade,
  is_lead                boolean not null default false,
  max_open_conversations integer,
  created_at             timestamptz not null default now(),
  primary key (team_id, user_id)
);

comment on table public.team_members is
  'Pertenencia de un usuario a un equipo. max_open_conversations alimenta la estrategia least_busy.';

create index if not exists team_members_ws_idx on public.team_members (workspace_id, user_id);

create table if not exists public.audit_log (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type   text not null default 'user'
                 check (actor_type in ('user','system','worker','agent')),
  action       text not null,
  entity_type  text,
  entity_id    text,
  before       jsonb,
  after        jsonb,
  ip           inet,
  user_agent   text,
  created_at   timestamptz not null default now()
);

comment on table public.audit_log is
  'Bitacora inmutable de acciones sensibles. Solo lectura para usuarios: unicamente el rol de servicio o el worker escriben aqui.';

create index if not exists audit_log_ws_created_idx
  on public.audit_log (workspace_id, created_at desc);
create index if not exists audit_log_ws_entity_idx
  on public.audit_log (workspace_id, entity_type, entity_id);

-- =============================================================================
-- Funciones de tenencia y permisos
-- Todas security definer con search_path fijado: evita secuestro por search_path.
-- =============================================================================

-- Workspace declarado por el worker en la transaccion en curso.
create or replace function public.current_workspace()
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select nullif(current_setting('app.workspace_id', true), '')::uuid;
$$;

comment on function public.current_workspace() is
  'Workspace activo declarado con SET LOCAL app.workspace_id. Base de las politicas RLS del rol strappy_worker.';

-- Guardia para funciones criticas ejecutadas por el worker.
create or replace function public.assert_workspace(ws uuid)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  declared uuid := public.current_workspace();
begin
  if declared is null then
    if current_user = 'strappy_worker' then
      raise exception 'app.workspace_id no declarado: use SET LOCAL app.workspace_id antes de operar'
        using errcode = '42501';
    end if;
    return; -- rol de servicio / postgres en tareas de mantenimiento
  end if;
  if declared <> ws then
    raise exception 'cruce de tenant bloqueado: app.workspace_id=% pero la operacion apunta a %', declared, ws
      using errcode = '42501';
  end if;
end;
$$;

comment on function public.assert_workspace(uuid) is
  'Aborta si el workspace_id de la operacion no coincide con app.workspace_id. Segunda barrera, independiente de RLS, contra bugs de join que crucen tenants.';

-- Presets de rol -> lista de permisos. IMMUTABLE para que el planificador la
-- pueda plegar dentro de las politicas RLS.
create or replace function public.role_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_role
    when 'owner' then array['*']
    when 'admin' then array[
      'workspace.read','workspace.manage',
      'members.read','members.manage',
      'billing.read',
      'agents.read','agents.write','agents.publish',
      'knowledge.read','knowledge.write',
      'tools.read','tools.write',
      'channels.read','channels.write',
      'inbox.read','inbox.write','inbox.assign','inbox.takeover',
      'contacts.read','contacts.write',
      'automations.read','automations.write',
      'analytics.read','catalog.subscribe','audit.read'
    ]
    when 'builder' then array[
      'workspace.read','members.read',
      'agents.read','agents.write','agents.publish',
      'knowledge.read','knowledge.write',
      'tools.read','tools.write',
      'channels.read','channels.write',
      'inbox.read',
      'contacts.read',
      'automations.read','automations.write',
      'analytics.read','catalog.subscribe'
    ]
    when 'agent' then array[
      'workspace.read',
      'agents.read','knowledge.read','channels.read',
      'inbox.read','inbox.write','inbox.assign','inbox.takeover',
      'contacts.read','contacts.write'
    ]
    when 'analyst' then array[
      'workspace.read','members.read',
      'agents.read','knowledge.read','tools.read','channels.read',
      'inbox.read','contacts.read','automations.read','analytics.read'
    ]
    else array[]::text[]
  end;
$$;

comment on function public.role_permissions(text) is
  'Expande un preset de rol a su lista de permisos. owner recibe el comodin "*". admin es todo salvo billing.manage y workspace.delete.';

create or replace function public.is_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

comment on function public.is_member(uuid) is
  'Verdadero si el usuario autenticado tiene membresia activa en el espacio. Base de TODA politica de lectura.';

create or replace function public.has_perm(ws uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and m.status = 'active'
      -- la revocacion explicita "!perm" gana siempre sobre el preset
      and not (('!' || perm) = any (m.permissions))
      and (
        perm = any (m.permissions)
        or perm = any (public.role_permissions(m.role))
        or '*' = any (public.role_permissions(m.role))
      )
  );
$$;

comment on function public.has_perm(uuid, text) is
  'Verdadero si el usuario tiene el permiso en el espacio, expandiendo preset + override. Base de TODA politica de escritura sensible.';

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.touch_updated_at() is 'Trigger generico que refresca updated_at en cada UPDATE.';

-- =============================================================================
-- Generador de politicas RLS
-- Aplicar el patron a mano en ~60 tablas invita a la omision silenciosa (una
-- tabla sin RLS = fuga entre tenants). Este generador impone el mismo patron en
-- todas: lectura por is_member, escritura por has_perm, worker acotado al
-- workspace declarado.
-- =============================================================================
create or replace function public.apply_tenant_rls(
  p_table       text,
  p_write_perm  text    default null,
  p_read_only   boolean default false,
  p_global_rows boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t         text := quote_ident(p_table);
  read_expr text;
  write_expr text;
  worker_expr text;
begin
  if p_global_rows then
    read_expr   := '(workspace_id is null or public.is_member(workspace_id))';
    worker_expr := '(workspace_id is null or workspace_id = public.current_workspace())';
  else
    read_expr   := 'public.is_member(workspace_id)';
    worker_expr := '(workspace_id = public.current_workspace())';
  end if;

  if p_write_perm is null then
    write_expr := 'public.is_member(workspace_id)';
  else
    write_expr := format('public.has_perm(workspace_id, %L)', p_write_perm);
  end if;

  execute format('alter table public.%s enable row level security', t);

  execute format('drop policy if exists %I on public.%s', p_table || '_read',   t);
  execute format('drop policy if exists %I on public.%s', p_table || '_write',  t);
  execute format('drop policy if exists %I on public.%s', p_table || '_worker', t);

  execute format(
    'create policy %I on public.%s for select to authenticated using (%s)',
    p_table || '_read', t, read_expr);

  if not p_read_only then
    execute format(
      'create policy %I on public.%s for all to authenticated using (%s) with check (%s)',
      p_table || '_write', t, write_expr, write_expr);
  end if;

  execute format(
    'create policy %I on public.%s for all to strappy_worker using (%s) with check (%s)',
    p_table || '_worker', t, worker_expr, worker_expr);

  execute format('grant select on public.%s to authenticated', t);
  if not p_read_only then
    execute format('grant insert, update, delete on public.%s to authenticated', t);
  end if;
  execute format('grant select, insert, update, delete on public.%s to strappy_worker', t);
end;
$$;

comment on function public.apply_tenant_rls(text, text, boolean, boolean) is
  'Aplica el patron RLS estandar a una tabla de negocio: SELECT con is_member, escritura con has_perm y acceso del worker limitado a app.workspace_id. p_read_only reserva la escritura al rol de servicio; p_global_rows admite filas con workspace_id nulo visibles para todos.';

revoke all on function public.apply_tenant_rls(text, text, boolean, boolean) from public, authenticated, strappy_worker;

-- =============================================================================
-- RLS
-- =============================================================================

alter table public.organizations enable row level security;
alter table public.workspaces    enable row level security;
alter table public.profiles      enable row level security;
alter table public.memberships   enable row level security;

grant select on public.organizations to authenticated;
grant select, update on public.workspaces to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.memberships to authenticated, strappy_worker;
grant select on public.workspaces, public.organizations to strappy_worker;

-- Idempotencia: reaplicar la migracion no debe chocar con politicas ya creadas.
drop policy if exists organizations_read   on public.organizations;
drop policy if exists organizations_write  on public.organizations;
drop policy if exists workspaces_read      on public.workspaces;
drop policy if exists workspaces_update    on public.workspaces;
drop policy if exists workspaces_delete    on public.workspaces;
drop policy if exists workspaces_worker    on public.workspaces;
drop policy if exists profiles_self        on public.profiles;
drop policy if exists profiles_teammates   on public.profiles;
drop policy if exists memberships_read     on public.memberships;
drop policy if exists memberships_manage   on public.memberships;
drop policy if exists memberships_worker   on public.memberships;

-- organizations: visible si el usuario es miembro de alguno de sus espacios.
create policy organizations_read on public.organizations
  for select to authenticated
  using (exists (
    select 1 from public.workspaces w
    where w.organization_id = organizations.id and public.is_member(w.id)
  ));

create policy organizations_write on public.organizations
  for update to authenticated
  using (exists (
    select 1 from public.workspaces w
    where w.organization_id = organizations.id and public.has_perm(w.id, 'billing.manage')
  ))
  with check (true);

-- workspaces: la propia fila usa id como workspace_id.
create policy workspaces_read on public.workspaces
  for select to authenticated using (public.is_member(id));
create policy workspaces_update on public.workspaces
  for update to authenticated
  using (public.has_perm(id, 'workspace.manage'))
  with check (public.has_perm(id, 'workspace.manage'));
create policy workspaces_delete on public.workspaces
  for delete to authenticated using (public.has_perm(id, 'workspace.delete'));
create policy workspaces_worker on public.workspaces
  for select to strappy_worker using (id = public.current_workspace());

-- profiles: cada quien ve y edita el suyo; ademas los companeros de espacio.
create policy profiles_self on public.profiles
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profiles_teammates on public.profiles
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.user_id = profiles.user_id and public.is_member(m.workspace_id)
  ));

-- memberships: lectura para miembros del espacio; gestion con members.manage.
create policy memberships_read on public.memberships
  for select to authenticated using (public.is_member(workspace_id));
create policy memberships_manage on public.memberships
  for all to authenticated
  using (public.has_perm(workspace_id, 'members.manage'))
  with check (public.has_perm(workspace_id, 'members.manage'));
create policy memberships_worker on public.memberships
  for select to strappy_worker using (workspace_id = public.current_workspace());
grant insert, update, delete on public.memberships to authenticated;

select public.apply_tenant_rls('invitations',  'members.manage');
select public.apply_tenant_rls('teams',        'workspace.manage');
select public.apply_tenant_rls('team_members', 'workspace.manage');
select public.apply_tenant_rls('audit_log',    null, true);

-- =============================================================================
-- Triggers de updated_at
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['organizations','workspaces','profiles','memberships','teams'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch', t);
  end loop;
end
$$;

-- =============================================================================
-- Alta de usuario: organizacion + espacio + membresia owner + perfil + equipo
-- =============================================================================

-- Punto de extension: las migraciones posteriores (facturacion) lo reemplazan
-- para sembrar cartera de creditos y suscripcion de prueba sin duplicar el alta.
create or replace function public.on_workspace_created(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return;
end;
$$;

comment on function public.on_workspace_created(uuid) is
  'Gancho ejecutado al crear un espacio. 0008_billing lo reemplaza para crear la cartera de creditos y la suscripcion de prueba.';

-- unaccent puede no estar disponible en todas las instalaciones; traduccion manual.
create or replace function public.unaccent_fallback(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select translate(
    coalesce(p_text, ''),
    'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
    'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC');
$$;

create or replace function public.slugify(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(
      trim(both '-' from regexp_replace(
        lower(unaccent_fallback(p_text)), '[^a-z0-9]+', '-', 'g')),
      ''),
    'espacio');
$$;

comment on function public.slugify(text) is 'Normaliza un texto a slug ASCII apto para URL.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_name text;
  v_org_id   uuid;
  v_ws_id    uuid;
  v_slug     text;
  v_suffix   int := 0;
begin
  v_org_name := coalesce(
    nullif(new.raw_user_meta_data->>'organization', ''),
    nullif(new.raw_user_meta_data->>'empresa', ''),
    nullif(split_part(new.email, '@', 1), ''),
    'Mi empresa');

  v_slug := public.slugify(v_org_name);
  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := public.slugify(v_org_name) || '-' || v_suffix::text;
  end loop;

  insert into public.organizations (name, slug, billing_email)
  values (v_org_name, v_slug, new.email)
  returning id into v_org_id;

  insert into public.workspaces (organization_id, name, slug)
  values (v_org_id, v_org_name, 'principal')
  returning id into v_ws_id;

  insert into public.profiles (user_id, full_name, default_workspace_id)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    v_ws_id)
  on conflict (user_id) do update set default_workspace_id = excluded.default_workspace_id;

  insert into public.memberships (workspace_id, user_id, role)
  values (v_ws_id, new.id, 'owner');

  insert into public.teams (workspace_id, name, routing_strategy, is_default)
  values (v_ws_id, 'General', 'round_robin', true);

  perform public.on_workspace_created(v_ws_id);

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Alta de usuario: crea organizacion, espacio "principal", perfil, membresia owner y equipo por defecto. Portado y ampliado del patron de OficinaIA.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
