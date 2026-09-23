-- =============================================================================
-- 0044 · El Diseñador tiene con qué dibujar
-- =============================================================================
-- El Webmaster ya le pide la portada al Diseñador cuando escribe una entrada,
-- y el Diseñador está en el catálogo desde la 0033. Pero `model_tiers` no
-- tenía ninguna fila para la tarea `image`: el worker resolvía el modelo, no
-- lo encontraba y se quedaba «sin generador de imágenes». El agente existía,
-- se le podía contratar y cobrar, y no podía hacer su trabajo.
--
-- Gemini 2.5 Flash Image (Nano Banana) por dos razones: escribe texto dentro
-- de la imagen sin deformarlo, que es lo que hace falta en una portada con
-- titular, y cuesta ~0,039 USD por imagen. El Diseñador cobra 100 créditos
-- por imagen (fijo, en `packages/disenador/src/loop.ts`), que al margen del
-- 20% serían ~47: hay holgura para el reintento cuando la primera no encaja.
-- Conviene mirar el consumo real de las primeras y ajustar esa constante.
--
-- Max usa el mismo: en imagen no hay un «modelo de frontera» que justifique
-- multiplicar el coste por cinco para una portada de blog.
-- =============================================================================

insert into public.model_tiers (mode, task, provider, primary_model, fallback_models, params, max_tokens, notes) values
  ('lite', 'image', 'google', 'google/gemini-2.5-flash-image', array['openai/gpt-image-1']::text[], '{}', null,
   'Portadas y piezas del Diseñador. Gemini 2.5 Flash Image escribe texto legible dentro de la imagen'),
  ('max',  'image', 'google', 'google/gemini-2.5-flash-image', array['openai/gpt-image-1']::text[], '{}', null,
   'Portadas y piezas del Diseñador. El mismo que lite: en imagen no compensa multiplicar el coste')
on conflict (mode, task) do update
  set provider        = excluded.provider,
      primary_model   = excluded.primary_model,
      fallback_models = excluded.fallback_models,
      notes           = excluded.notes;
