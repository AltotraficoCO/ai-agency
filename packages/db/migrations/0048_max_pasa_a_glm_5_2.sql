-- =============================================================================
-- 0048 · El modo Max de los agentes pasa a GLM 5.2
-- =============================================================================
-- La 0047 puso GPT-6 Luna hace veinte minutos. El cliente cambia a GLM 5.2
-- antes de que Luna llegara a correr un encargo real, así que no hay medición
-- que comparar: es una decisión de producto, no una corrección.
--
-- Qué gana y qué cuesta, con los precios verificados contra OpenRouter el
-- 22-sep-2026 (USD por millón de tokens, entrada/salida):
--   · GLM 5.2        0,6496 / 2,0416 · contexto 1.048.576
--   · GPT-6 Luna     0,10   / 0,50   · contexto 1.050.000
--   · Sonnet 5       2,00   / 10,00  · contexto 200.000
-- Sale unas seis veces más caro que Luna y sigue costando la tercera parte
-- que Sonnet 5, conservando el millón de tokens de contexto que en encargos
-- largos del Webmaster es lo que evita que el agente pierda el hilo.
--
-- El identificador es `z-ai/glm-5.2`, CON guion: así lo publica OpenRouter.
-- Ojo con esto, porque la semilla 0010 escribió `zai/glm-4.7-flash` sin guion
-- y ese identificador no existe en el proveedor (ver la corrección más abajo).
--
-- Sonnet 5 sigue de respaldo: si GLM falla o se satura, el encargo cae en el
-- modelo que ya sabemos que aguanta.
-- =============================================================================

update public.model_tiers
   set provider        = 'z-ai',
       primary_model   = 'z-ai/glm-5.2',
       fallback_models = array['anthropic/claude-sonnet-5']::text[],
       notes           = 'Agentes del negocio en modo Max (worker del VPS). GLM 5.2 por decisión del cliente: 1M de contexto a un tercio del coste de Sonnet 5, que queda de respaldo'
 where task = 'negocio'
   and mode = 'max';

-- Tarifas de venta con el margen del 20% de la 0025 (usd_por_Mtok x 1,2).
insert into public.credit_rates (kind, ref_key, unit, credits_per_unit, description, effective_from) values
  ('model_input',      'z-ai/glm-5.2', 'ktoken', 0.779520, 'GLM 5.2 entrada (0,6496 USD/Mtok x1,2)', '2026-09-22T00:00:00Z'),
  ('model_output',     'z-ai/glm-5.2', 'ktoken', 2.449920, 'GLM 5.2 salida (2,0416 USD/Mtok x1,2)',  '2026-09-22T00:00:00Z'),
  ('model_cache_read', 'z-ai/glm-5.2', 'ktoken', 0.077952, 'GLM 5.2 cache (10% de entrada)',         '2026-09-22T00:00:00Z')
on conflict (kind, ref_key, effective_from) do nothing;

-- Corrección de paso: el identificador de GLM sin guion no existe.
--
-- La semilla 0010 tarifó `zai/glm-4.7-flash` y varias filas de `model_tiers`
-- lo llevan de primario o de respaldo. En OpenRouter ese modelo es
-- `z-ai/glm-4.7-flash`: pedirlo sin guion devuelve un 404, así que el respaldo
-- de Lite no era un respaldo, era un segundo fallo. Se arregla el tier y se
-- tarifa el identificador bueno con los mismos precios de la semilla, para que
-- el día que se use no se cobre con la tarifa cara de los modelos desconocidos.
update public.model_tiers
   set primary_model = 'z-ai/glm-4.7-flash'
 where primary_model = 'zai/glm-4.7-flash';

update public.model_tiers
   set fallback_models = array_replace(fallback_models, 'zai/glm-4.7-flash', 'z-ai/glm-4.7-flash')
 where 'zai/glm-4.7-flash' = any(fallback_models);

insert into public.credit_rates (kind, ref_key, unit, credits_per_unit, description, effective_from) values
  ('model_input',      'z-ai/glm-4.7-flash', 'ktoken', 0.084000, 'GLM-4.7 Flash entrada (0,07 USD/Mtok x1,2)', '2026-09-22T00:00:00Z'),
  ('model_output',     'z-ai/glm-4.7-flash', 'ktoken', 0.480000, 'GLM-4.7 Flash salida (0,40 USD/Mtok x1,2)',  '2026-09-22T00:00:00Z'),
  ('model_cache_read', 'z-ai/glm-4.7-flash', 'ktoken', 0.008400, 'GLM-4.7 Flash cache (10% de entrada)',       '2026-09-22T00:00:00Z')
on conflict (kind, ref_key, effective_from) do nothing;
