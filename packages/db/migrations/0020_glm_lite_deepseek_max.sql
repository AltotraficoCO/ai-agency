-- =============================================================================
-- 0020 · Lite con GLM-4.7-flash y Max con DeepSeek V4 Flash
-- =============================================================================
-- La clave de la cartera (OpenRouter) queda restringida a GLM-4.7-flash y
-- DeepSeek V4 Flash. Cualquier otro modelo en model_tiers fallaria: el motor
-- ejecuta el modelo primario, los de respaldo no se prueban solos. Por eso:
--  · lite, todas las tareas → GLM-4.7-flash (deshace 0019, que puso GPT-5.6
--    Luna al construir, y quita minimax de los respaldos);
--  · max, todas las tareas → DeepSeek V4 Flash (antes Claude Sonnet/Opus 5).
-- Los respaldos solo nombran modelos que la clave permite.
--
-- 'embed' no se toca: sigue en openai/text-embedding-3-small. Si la clave no
-- lo permite, el conocimiento se degrada a busqueda por palabras.
-- Las tarifas de ambos modelos ya existen desde la semilla (0010).
-- =============================================================================

update public.model_tiers
   set provider        = 'zai',
       primary_model   = 'zai/glm-4.7-flash',
       fallback_models = array['deepseek/deepseek-v4-flash'],
       notes           = case when task = 'build'
                           then 'Lite construye con GLM-4.7-flash; la clave de la cartera solo permite GLM y DeepSeek V4 Flash'
                           else notes end
 where mode = 'lite' and task <> 'embed';

update public.model_tiers
   set provider        = 'deepseek',
       primary_model   = 'deepseek/deepseek-v4-flash',
       fallback_models = array['zai/glm-4.7-flash'],
       notes           = 'Max con DeepSeek V4 Flash; la clave de la cartera solo permite GLM y DeepSeek V4 Flash'
 where mode = 'max' and task <> 'embed';
