-- =============================================================================
-- 0019 · El modo lite construye con GPT-5.6 Luna
-- =============================================================================
-- Con GLM-4.7-flash el Webmaster seguia mal las instrucciones largas: pedido
-- «crea un blog», publico tres entradas con solo un hero. La fila 'lite','build'
-- es la que usan los agentes que trabajan con herramientas (Webmaster) y el
-- meta-agente al construir; chat, clasificacion y resto siguen en GLM.
--
-- GLM y DeepSeek quedan de respaldo: si Luna falla, la tarea no se cae.
-- =============================================================================

update public.model_tiers
   set provider        = 'openai',
       primary_model   = 'openai/gpt-5.6-luna',
       fallback_models = array['zai/glm-4.7-flash', 'deepseek/deepseek-v4-flash'],
       notes           = 'Lite construye con GPT-5.6 Luna: sigue instrucciones largas y usa herramientas mucho mejor que GLM-4.7-flash, a unos 0,20/1,20 USD por Mtok'
 where mode = 'lite' and task = 'build';

-- Tarifa con el mismo 3,0x de la semilla (0010): 0,20 USD/Mtok de entrada y
-- 1,20 de salida en OpenRouter. Las filas de tarifa son inmutables, asi que
-- solo se insertan si no existen.
insert into public.credit_rates (kind, ref_key, unit, credits_per_unit, description, effective_from)
select v.kind, v.ref_key, 'ktoken', v.credits, v.descripcion, '2026-09-11T00:00:00Z'
  from (values
    ('model_input',      'openai/gpt-5.6-luna', 0.600000, 'GPT-5.6 Luna entrada (0,20 USD/Mtok x3)'),
    ('model_output',     'openai/gpt-5.6-luna', 3.600000, 'GPT-5.6 Luna salida (1,20 USD/Mtok x3)'),
    ('model_cache_read', 'openai/gpt-5.6-luna', 0.060000, 'GPT-5.6 Luna cache (10% de entrada)')
  ) as v(kind, ref_key, credits, descripcion)
 where not exists (
   select 1 from public.credit_rates r
    where r.kind = v.kind and r.ref_key = v.ref_key and r.effective_to is null
 );
