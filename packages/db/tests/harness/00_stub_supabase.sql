-- Stub LOCAL de Supabase para validar las migraciones contra un Postgres pelado.
-- NO forma parte del esquema desplegado: supabase/ ya provee auth, roles y realtime.
do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

do $$
begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- pgvector no esta instalado en el Postgres local: tipo e indices simulados.
do $$
begin
  if not exists (select 1 from pg_type where typname='vector') then
    execute 'create domain public.vector as real[]';
  end if;
end $$;

-- Operador de distancia coseno simulado para poder ejecutar search_knowledge
-- sin pgvector. En produccion lo aporta la extension `vector`.
create or replace function public.vector_cosine_distance_stub(a public.vector, b public.vector)
returns double precision language sql immutable as $$ select 0.0::double precision $$;

do $$
begin
  if not exists (
    select 1 from pg_operator o
    join pg_type t on t.oid = o.oprleft
    where o.oprname = '<=>' and t.typname = 'vector') then
    execute 'create operator <=> (leftarg = public.vector, rightarg = public.vector, function = public.vector_cosine_distance_stub)';
  end if;
end $$;
