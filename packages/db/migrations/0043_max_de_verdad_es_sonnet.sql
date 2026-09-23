-- =============================================================================
-- 0043 · El modo Max de los agentes vuelve a ser Claude Sonnet 5
-- =============================================================================
-- La 0024 pasó los agentes del negocio a DeepSeek V4 Flash por coste, pero su
-- `where task = 'negocio'` alcanzó a las DOS filas: la de `lite` y la de
-- `max`. Resultado: encender Max cambiaba el modo pero no el modelo, y el
-- cliente pagaba por «el modelo más capaz» recibiendo el mismo de siempre.
--
-- Lite se queda con DeepSeek, que es lo que quería la 0024. Max vuelve a ser
-- Claude Sonnet 5, que es lo único que justifica ofrecerlo: acierta más a la
-- primera en encargos largos con muchas herramientas, que es justo donde el
-- barato se pasa de alcance o se salta una instrucción.
-- =============================================================================

update public.model_tiers
   set provider        = 'anthropic',
       primary_model   = 'anthropic/claude-sonnet-5',
       fallback_models = array['deepseek/deepseek-v4-flash'],
       notes           = 'Agentes del negocio en modo Max (worker del VPS). Claude Sonnet 5: acierta más a la primera en encargos largos; DeepSeek de respaldo'
 where task = 'negocio'
   and mode = 'max';
