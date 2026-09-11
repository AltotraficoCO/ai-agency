-- =============================================================================
-- 0021 · Los agentes del negocio tienen su propia fila de modelo
-- =============================================================================
-- Hay dos claves de OpenRouter con guardrails distintos:
--  · la de la web (Vercel): WhatsApp y Strap, solo GLM-4.7-flash y DeepSeek
--    V4 Flash (filas chat, build, summarize… — ver 0020);
--  · la del worker (VPS): agentes del negocio como el Webmaster, solo GPT-5.6
--    Luna Pro. Comprobado contra OpenRouter: el guardrail bloquea
--    openai/gpt-5.6-luna y deja pasar openai/gpt-5.6-luna-pro.
-- Hasta ahora el worker leia la fila 'build', la misma que Strap, y no podia
-- usar un modelo distinto al de la web. Desde aqui lee 'negocio'.
--
-- Sin respaldos: la clave del worker no permite otro modelo.
-- =============================================================================

insert into public.model_tiers (mode, task, provider, primary_model, fallback_models, params, max_tokens, notes) values
  ('lite', 'negocio', 'openai', 'openai/gpt-5.6-luna-pro', array[]::text[], '{"temperature":0.5}', 16384,
   'Agentes del negocio (worker del VPS). Su clave de OpenRouter solo permite GPT-5.6 Luna Pro'),
  ('max',  'negocio', 'openai', 'openai/gpt-5.6-luna-pro', array[]::text[], '{"temperature":0.5}', 16384,
   'Agentes del negocio (worker del VPS). Su clave de OpenRouter solo permite GPT-5.6 Luna Pro')
on conflict (mode, task) do update
  set provider        = excluded.provider,
      primary_model   = excluded.primary_model,
      fallback_models = excluded.fallback_models,
      params          = excluded.params,
      max_tokens      = excluded.max_tokens,
      notes           = excluded.notes,
      updated_at      = now();

-- Tarifa con el 3,0x de la semilla (0010): OpenRouter cobra 0,20 USD/Mtok de
-- entrada y 1,20 de salida, lo mismo que GPT-5.6 Luna (0019). Las filas de
-- tarifa son inmutables: solo se insertan si no existen.
insert into public.credit_rates (kind, ref_key, unit, credits_per_unit, description, effective_from)
select v.kind, v.ref_key, 'ktoken', v.credits, v.descripcion, '2026-09-11T00:00:00Z'
  from (values
    ('model_input',      'openai/gpt-5.6-luna-pro', 0.600000, 'GPT-5.6 Luna Pro entrada (0,20 USD/Mtok x3)'),
    ('model_output',     'openai/gpt-5.6-luna-pro', 3.600000, 'GPT-5.6 Luna Pro salida (1,20 USD/Mtok x3)'),
    ('model_cache_read', 'openai/gpt-5.6-luna-pro', 0.060000, 'GPT-5.6 Luna Pro cache (10% de entrada)')
  ) as v(kind, ref_key, credits, descripcion)
 where not exists (
   select 1 from public.credit_rates r
    where r.kind = v.kind and r.ref_key = v.ref_key and r.effective_to is null
 );
