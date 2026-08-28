-- =============================================================================
-- 0006_knowledge.sql · Bases de conocimiento y busqueda hibrida
-- -----------------------------------------------------------------------------
-- Busqueda hibrida deliberada: vectorial + lexica fusionadas con RRF.
-- En espanol el componente lexico sube mucho la precision con nombres de
-- producto, referencias y precios, que el embedding tiende a difuminar
-- ("Ref. X-240" y "Ref. X-420" son casi el mismo vector, no el mismo texto).
-- =============================================================================

-- En Supabase las extensiones viven en el esquema `extensions`. Los tipos y las
-- clases de operadores (vector, gin_trgm_ops...) se resuelven en el momento del
-- DDL, asi que `extensions` tiene que estar en el search_path AL APLICAR. En un
-- Postgres pelado el esquema no existe y la linea es inocua.
set search_path = public, extensions, pg_temp;

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table if not exists public.brains (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  description  text,
  language     text not null default 'spanish',
  embedding_model text not null default 'text-embedding-3-small',
  chunk_size   integer not null default 800,
  chunk_overlap integer not null default 120,
  status       text not null default 'ready'
                 check (status in ('ready','indexing','error')),
  chunk_count  integer not null default 0,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, name)
);

comment on table public.brains is
  'Base de conocimiento de un espacio. Agrupa fuentes y fragmentos; un agente puede conectar varias mediante agent_brains.';
comment on column public.brains.language is
  'Configuracion de texto de Postgres para el indice lexico. spanish por defecto: aplica lematizacion y palabras vacias del castellano.';

-- Cerramos la referencia que 0003 dejo abierta.
alter table public.agent_brains drop constraint if exists agent_brains_brain_id_fkey;
alter table public.agent_brains
  add constraint agent_brains_brain_id_fkey
  foreign key (brain_id) references public.brains(id) on delete cascade;

-- -----------------------------------------------------------------------------
create table if not exists public.brain_sources (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brain_id     uuid not null references public.brains(id) on delete cascade,
  kind         text not null default 'text'
                 check (kind in ('text','file','url','sitemap','faq','table','notion','gdrive')),
  title        text not null,
  uri          text,
  storage_path text,
  mime_type    text,
  raw_content  text,
  content_hash text,
  metadata     jsonb not null default '{}'::jsonb,
  status       text not null default 'pending'
                 check (status in ('pending','indexing','indexed','error','stale')),
  error_detail text,
  chunk_count  integer not null default 0,
  indexed_at   timestamptz,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.brain_sources is
  'Documento o fuente que alimenta una base de conocimiento.';
comment on column public.brain_sources.content_hash is
  'Hash del contenido descargado. Si no cambio respecto al ultimo indexado, se salta el reindexado: sin esto, revisar 400 URL cada noche cuesta 400 pasadas de embeddings inutiles.';

create index if not exists brain_sources_ws_brain_idx
  on public.brain_sources (workspace_id, brain_id, status);
create unique index if not exists brain_sources_uri_uniq
  on public.brain_sources (workspace_id, brain_id, uri) where uri is not null;

-- -----------------------------------------------------------------------------
create table if not exists public.brain_chunks (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brain_id     uuid not null references public.brains(id) on delete cascade,
  source_id    uuid not null references public.brain_sources(id) on delete cascade,
  position     integer not null default 0,
  content      text not null,
  token_count  integer,
  embedding    vector(1536),
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.brain_chunks is
  'Fragmento indexado. Lleva a la vez el vector y el texto porque la recuperacion es hibrida: HNSW para lo semantico, GIN sobre to_tsvector(spanish) para lo literal.';

create index if not exists brain_chunks_ws_source_idx
  on public.brain_chunks (workspace_id, source_id, position);
create index if not exists brain_chunks_ws_brain_idx
  on public.brain_chunks (workspace_id, brain_id);

-- HNSW con distancia coseno: recuperacion aproximada en milisegundos.
create index if not exists brain_chunks_embedding_hnsw
  on public.brain_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Indice lexico en espanol.
create index if not exists brain_chunks_content_fts
  on public.brain_chunks using gin (to_tsvector('spanish', content));

-- =============================================================================
-- search_knowledge · fusion RRF de resultados vectoriales y lexicos
-- -----------------------------------------------------------------------------
-- RRF (reciprocal rank fusion): score = sum(1 / (k_const + rango)) sobre cada
-- lista. Fusiona por POSICION, no por puntuacion, y por eso no hace falta
-- normalizar la distancia coseno contra el ts_rank, que viven en escalas
-- incomparables.
-- =============================================================================
create or replace function public.search_knowledge(
  brain_ids uuid[],
  query     text,
  qvec      vector(1536),
  k         integer default 8
)
returns table (
  chunk_id  uuid,
  source_id uuid,
  brain_id  uuid,
  content   text,
  score     double precision,
  vec_rank  integer,
  lex_rank  integer,
  distance  double precision,
  metadata  jsonb
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with params as (
    select 60::double precision as k_const,      -- constante clasica de RRF
           greatest(coalesce(k, 8), 1) as k_out,
           greatest(coalesce(k, 8), 1) * 4 as k_pool
  ),
  vec as (
    select c.id, c.source_id, c.brain_id, c.content, c.metadata,
           (c.embedding <=> qvec)::double precision as distance,
           row_number() over (order by c.embedding <=> qvec)::integer as rnk
    from public.brain_chunks c, params p
    where c.brain_id = any (brain_ids)
      and c.embedding is not null
      and qvec is not null
    order by c.embedding <=> qvec
    limit (select k_pool from params)
  ),
  lex as (
    select c.id, c.source_id, c.brain_id, c.content, c.metadata,
           row_number() over (
             order by ts_rank_cd(to_tsvector('spanish', c.content),
                                 websearch_to_tsquery('spanish', query)) desc
           )::integer as rnk
    from public.brain_chunks c, params p
    where c.brain_id = any (brain_ids)
      and query is not null and query <> ''
      and to_tsvector('spanish', c.content) @@ websearch_to_tsquery('spanish', query)
    order by ts_rank_cd(to_tsvector('spanish', c.content),
                        websearch_to_tsquery('spanish', query)) desc
    limit (select k_pool from params)
  ),
  fused as (
    select
      coalesce(v.id, l.id)               as chunk_id,
      coalesce(v.source_id, l.source_id) as source_id,
      coalesce(v.brain_id, l.brain_id)   as brain_id,
      coalesce(v.content, l.content)     as content,
      coalesce(v.metadata, l.metadata)   as metadata,
      v.distance                         as distance,
      v.rnk                              as vec_rank,
      l.rnk                              as lex_rank,
      coalesce(1.0 / ((select k_const from params) + v.rnk), 0.0)
      + coalesce(1.0 / ((select k_const from params) + l.rnk), 0.0) as score
    from vec v
    full outer join lex l on l.id = v.id
  )
  select chunk_id, source_id, brain_id, content, score, vec_rank, lex_rank, distance, metadata
  from fused
  order by score desc, distance asc nulls last
  limit (select k_out from params);
$$;

comment on function public.search_knowledge(uuid[], text, vector, integer) is
  'Recuperacion hibrida sobre varias bases: fusiona la lista vectorial (HNSW coseno) y la lexica (tsvector espanol) con reciprocal rank fusion. security invoker a proposito: la RLS de brain_chunks sigue filtrando por workspace, la funcion no es un agujero para leer el conocimiento de otro tenant.';

-- Mantiene el contador de fragmentos sin recontar la tabla en cada lectura.
create or replace function public.refresh_brain_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_brain  uuid := coalesce(new.brain_id, old.brain_id);
  v_source uuid := coalesce(new.source_id, old.source_id);
begin
  update public.brain_sources s
  set chunk_count = (select count(*) from public.brain_chunks c where c.source_id = v_source)
  where s.id = v_source;

  update public.brains b
  set chunk_count = (select count(*) from public.brain_chunks c where c.brain_id = v_brain)
  where b.id = v_brain;

  return null;
end;
$$;

drop trigger if exists brain_chunks_counts on public.brain_chunks;
create trigger brain_chunks_counts
  after insert or delete on public.brain_chunks
  for each row execute function public.refresh_brain_counts();

do $$
declare t text;
begin
  foreach t in array array['brains','brain_sources'] loop
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
select public.apply_tenant_rls('brains',        'knowledge.write');
select public.apply_tenant_rls('brain_sources', 'knowledge.write');
select public.apply_tenant_rls('brain_chunks',  'knowledge.write');
