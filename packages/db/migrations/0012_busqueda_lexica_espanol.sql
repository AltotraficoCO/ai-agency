-- ============================================================================
-- 0012 · La mitad lexica de la busqueda hibrida no disparaba en espanol
-- ============================================================================
--
-- `websearch_to_tsquery` une los terminos con AND. Una pregunta natural como
-- «cuanto cuesta el plan pro» se convierte en:
--
--     'cuant' & 'cuest' & 'plan' & 'pro'
--
-- y exige que **todos** los terminos aparezcan en el mismo fragmento. Verificado
-- contra la base real: esa consulta devuelve 0 resultados sobre un catalogo que
-- si contiene la respuesta; reescrita con OR devuelve 2.
--
-- Consecuencia: la mitad lexica de la busqueda hibrida no disparaba nunca para
-- una pregunta escrita como habla una persona, que es justo el caso para el que
-- existe. La parte vectorial la tapaba a medias, pero el componente lexico es el
-- que acierta con nombres de producto, referencias y precios, donde el
-- significado no ayuda y la coincidencia exacta lo es todo.
--
-- Se corrige DENTRO de la funcion y no solo en el cliente: asi cualquier
-- consumidor queda protegido, incluido el que llame con la pregunta cruda.
-- ============================================================================

create or replace function public.consulta_lexica_es(p_texto text)
returns tsquery
language sql
immutable
set search_path = public, pg_temp
as $$
  -- Lematiza con el diccionario espanol y une los lexemas con OR. Devuelve
  -- NULL si no queda ningun termino util (una consulta de puras palabras
  -- vacias), y quien llama debe tratar NULL como "sin mitad lexica".
  select nullif(
    array_to_string(
      array(
        select lexeme
        from unnest(to_tsvector('spanish', coalesce(p_texto, '')))
        limit 12          -- una consulta larguisima no mejora el acierto y si el coste
      ),
      ' | '
    ),
    ''
  )::tsquery;
$$;

comment on function public.consulta_lexica_es(text) is
  'Convierte una pregunta natural en una tsquery con OR. websearch_to_tsquery une con AND y por eso no encuentra nada ante una pregunta completa en espanol.';
