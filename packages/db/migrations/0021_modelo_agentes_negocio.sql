-- =============================================================================
-- 0021 · Los agentes del negocio tienen su propia fila de modelo
-- =============================================================================
-- Hay dos claves de OpenRouter con guardrails distintos:
--  · la de la web (Vercel): WhatsApp y Strap, solo GLM-4.7-flash y DeepSeek
--    V4 Flash (filas chat, build, summarize… — ver 0020);
--  · la del worker (VPS): agentes del negocio como el Webmaster, solo GPT-5.6
--    Luna.
-- Hasta ahora el worker leia la fila 'build', la misma que Strap, y no podia
-- usar un modelo distinto al de la web. Desde aqui lee 'negocio'.
--
-- Sin respaldos: la clave del worker no permite otro modelo. La tarifa de
-- GPT-5.6 Luna existe desde 0019.
-- =============================================================================

insert into public.model_tiers (mode, task, provider, primary_model, fallback_models, params, max_tokens, notes) values
  ('lite', 'negocio', 'openai', 'openai/gpt-5.6-luna', array[]::text[], '{"temperature":0.5}', 16384,
   'Agentes del negocio (worker del VPS). Su clave de OpenRouter solo permite GPT-5.6 Luna'),
  ('max',  'negocio', 'openai', 'openai/gpt-5.6-luna', array[]::text[], '{"temperature":0.5}', 16384,
   'Agentes del negocio (worker del VPS). Su clave de OpenRouter solo permite GPT-5.6 Luna')
on conflict (mode, task) do update
  set provider        = excluded.provider,
      primary_model   = excluded.primary_model,
      fallback_models = excluded.fallback_models,
      params          = excluded.params,
      max_tokens      = excluded.max_tokens,
      notes           = excluded.notes,
      updated_at      = now();
