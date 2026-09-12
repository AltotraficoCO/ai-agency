-- =============================================================================
-- 0025 · El margen baja de 3,0x a 1,2x (20% sobre el coste del proveedor)
-- =============================================================================
-- Decision comercial de los socios (11-sep-2026): «nuestro margen es el 20%
-- sobre lo que nos cobra OpenRouter». La semilla 0010 tarifaba a 3,0x.
--
-- 1 credito sigue siendo 0,001 USD de precio de venta, asi que:
--     creditos_por_ktoken = usd_por_millon_de_tokens / 1.000 * 1,2 / 0,001
--                         = usd_por_millon_de_tokens * 1,2
-- Comprobacion: glm-4.7-flash entrada 0,07 USD/Mtok
--     0,07/1.000 = 0,00007 USD/ktok · x1,2 = 0,000084 USD · /0,001 = 0,084 creditos.
--
-- La lectura de cache sigue al 10% de la entrada (0,07 x 0,1 x 1,2 = 0,0084).
--
-- Costes por Mtok (USD, entrada/salida) verificados contra OpenRouter el
-- 11-sep-2026: GLM-4.7-flash 0,07/0,40 · DeepSeek V4 Flash 0,13/0,26 ·
-- Claude Sonnet 5 2,00/10,00 · Claude Opus 5 5,00/25,00 · GPT-5.6 Luna y Luna
-- Pro 0,20/1,20 · text-embedding-3-small 0,02.
--
-- `tool_call` (1 credito por invocacion) y `message_out` (0) NO se tocan: no
-- son coste de proveedor. WhatsApp sigue a cero porque Meta le cobra al cliente.
--
-- El tarifario es VERSIONADO y el trigger guard_credit_rate_immutable impide
-- editar una fila: se cierra la vigente con effective_to y se inserta la nueva
-- con el mismo instante. Asi el consumo de ayer se sigue valorando al precio de
-- ayer y no hay ni hueco ni solape (la vieja deja de cumplir `effective_to >
-- now()` justo cuando la nueva empieza a cumplir `effective_from <= now()`).
--
-- Reaplicar la migracion es inocuo: si la tarifa vigente ya es la nueva, no
-- cierra ni inserta nada.
-- =============================================================================

do $$
declare
  ahora timestamptz := now();
begin
  -- Tarifas nuevas, en creditos por ktoken = usd_por_Mtok * 1,2.
  create temporary table tarifas_nuevas (kind text, ref_key text, creditos numeric(16,6), descripcion text)
    on commit drop;

  insert into tarifas_nuevas (kind, ref_key, creditos, descripcion) values
    -- Lite · primario
    ('model_input',      'zai/glm-4.7-flash',             0.084000, 'GLM-4.7 Flash entrada (0,07 USD/Mtok x1,2)'),
    ('model_output',     'zai/glm-4.7-flash',             0.480000, 'GLM-4.7 Flash salida (0,40 USD/Mtok x1,2)'),
    ('model_cache_read', 'zai/glm-4.7-flash',             0.008400, 'GLM-4.7 Flash cache (10% de entrada)'),
    -- Lite · respaldo
    ('model_input',      'deepseek/deepseek-v4-flash',    0.156000, 'DeepSeek V4 Flash entrada (0,13 USD/Mtok x1,2)'),
    ('model_output',     'deepseek/deepseek-v4-flash',    0.312000, 'DeepSeek V4 Flash salida (0,26 USD/Mtok x1,2)'),
    ('model_cache_read', 'deepseek/deepseek-v4-flash',    0.015600, 'DeepSeek V4 Flash cache (10% de entrada)'),
    -- Max · primario
    ('model_input',      'anthropic/claude-sonnet-5',     2.400000, 'Claude Sonnet 5 entrada (2,00 USD/Mtok x1,2)'),
    ('model_output',     'anthropic/claude-sonnet-5',    12.000000, 'Claude Sonnet 5 salida (10,00 USD/Mtok x1,2)'),
    ('model_cache_read', 'anthropic/claude-sonnet-5',     0.240000, 'Claude Sonnet 5 cache (10% de entrada)'),
    -- Max · respaldo
    ('model_input',      'anthropic/claude-opus-5',       6.000000, 'Claude Opus 5 entrada (5,00 USD/Mtok x1,2)'),
    ('model_output',     'anthropic/claude-opus-5',      30.000000, 'Claude Opus 5 salida (25,00 USD/Mtok x1,2)'),
    ('model_cache_read', 'anthropic/claude-opus-5',       0.600000, 'Claude Opus 5 cache (10% de entrada)'),
    -- GPT-5.6 Luna (0019) y Luna Pro (0021)
    ('model_input',      'openai/gpt-5.6-luna',           0.240000, 'GPT-5.6 Luna entrada (0,20 USD/Mtok x1,2)'),
    ('model_output',     'openai/gpt-5.6-luna',           1.440000, 'GPT-5.6 Luna salida (1,20 USD/Mtok x1,2)'),
    ('model_cache_read', 'openai/gpt-5.6-luna',           0.024000, 'GPT-5.6 Luna cache (10% de entrada)'),
    ('model_input',      'openai/gpt-5.6-luna-pro',       0.240000, 'GPT-5.6 Luna Pro entrada (0,20 USD/Mtok x1,2)'),
    ('model_output',     'openai/gpt-5.6-luna-pro',       1.440000, 'GPT-5.6 Luna Pro salida (1,20 USD/Mtok x1,2)'),
    ('model_cache_read', 'openai/gpt-5.6-luna-pro',       0.024000, 'GPT-5.6 Luna Pro cache (10% de entrada)'),
    -- Embeddings
    ('embedding',        'openai/text-embedding-3-small', 0.024000, 'Embeddings (0,02 USD/Mtok x1,2)');

  -- Cierra solo lo que de verdad cambia de precio.
  update public.credit_rates r
     set effective_to = ahora
    from tarifas_nuevas n
   where r.kind = n.kind
     and r.ref_key = n.ref_key
     and r.effective_to is null
     and r.credits_per_unit is distinct from n.creditos;

  -- Inserta la nueva tarifa para cada concepto que se quedo sin vigente.
  insert into public.credit_rates (kind, ref_key, unit, credits_per_unit, description, effective_from)
  select n.kind, n.ref_key, 'ktoken', n.creditos, n.descripcion, ahora
    from tarifas_nuevas n
   where not exists (
     select 1
       from public.credit_rates r
      where r.kind = n.kind
        and r.ref_key = n.ref_key
        and r.effective_to is null
   );
end $$;
