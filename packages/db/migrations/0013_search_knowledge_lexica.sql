-- ============================================================================
-- 0013 · search_knowledge usa la consulta lexica corregida
-- ============================================================================
-- La funcion de 0006 llamaba a websearch_to_tsquery, que une los terminos con
-- AND. Aqui se reemite apoyandose en consulta_lexica_es (0012), que los une con
-- OR. Verificado contra la base real: la misma pregunta pasa de 0 resultados
-- lexicos a 2.
-- ============================================================================

-- El tipo `vector` vive en el esquema `extensions`, asi que tiene que estar en
-- el search_path AL APLICAR para que se resuelva en la FIRMA de la funcion.
-- Esto es independiente del `set search_path` de la propia funcion, que solo
-- rige en su ejecucion.
set search_path = public, extensions, pg_temp;

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
set search_path = public, extensions, pg_temp
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
                                 public.consulta_lexica_es(query)) desc
           )::integer as rnk
    from public.brain_chunks c, params p
    where c.brain_id = any (brain_ids)
      and query is not null and query <> ''
      and to_tsvector('spanish', c.content) @@ public.consulta_lexica_es(query)
    order by ts_rank_cd(to_tsvector('spanish', c.content),
                        public.consulta_lexica_es(query)) desc
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

comment on function public.search_knowledge(uuid[], text, extensions.vector, integer) is
  'Busqueda hibrida: fusiona por RRF la vecindad vectorial y la coincidencia lexica. La mitad lexica usa consulta_lexica_es, que une los terminos con OR; con websearch_to_tsquery (AND) una pregunta natural no encontraba nada.';
