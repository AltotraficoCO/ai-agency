-- =============================================================================
-- 0047 · El modo Max de los agentes pasa a GPT-6 Luna
-- =============================================================================
-- Decisión del cliente (22-sep-2026), tomada sabiendo lo que sigue: dentro de
-- la familia GPT-6, Luna es el escalón de ENTRADA (Luna < Sol < Astra), no el
-- de frontera. Se le ofrecieron Astra (el buque insignia, 10/50 USD por Mtok)
-- y Sol (2/10, el mismo precio que Sonnet 5) y eligió Luna igual.
--
-- Queda escrito porque tiene una consecuencia que se va a notar: Luna cuesta
-- 0,10/0,50 USD por Mtok, VEINTE veces menos que Sonnet 5 y menos que el
-- DeepSeek de Lite en entrada. Un encargo en Max sale ahora más barato que en
-- Lite, y en encargos largos con muchas herramientas razonará peor que el
-- Sonnet que restauró la portada de Vox el 22-sep. Si eso se nota, el cambio
-- se deshace poniendo `anthropic/claude-sonnet-5` de primario otra vez.
--
-- A favor de Luna: un millón de tokens de contexto (Sonnet 5 tiene 200k), que
-- en encargos del Webmaster con muchas páginas leídas no es poca cosa.
--
-- Sonnet 5 queda de RESPALDO, no fuera: si Luna falla o se satura, el encargo
-- cae en el modelo que ya sabemos que aguanta, no en el barato de Lite.
-- =============================================================================

update public.model_tiers
   set provider        = 'openai',
       primary_model   = 'openai/gpt-6-luna',
       fallback_models = array['anthropic/claude-sonnet-5']::text[],
       notes           = 'Agentes del negocio en modo Max (worker del VPS). GPT-6 Luna por decisión del cliente: 1M de contexto y coste bajo; Sonnet 5 de respaldo'
 where task = 'negocio'
   and mode = 'max';

-- Tarifas de venta con el margen del 20% de la 0025 (usd_por_Mtok x 1,2),
-- verificadas contra OpenRouter el 22-sep-2026: entrada 0,10 y salida 0,50.
-- La lectura de caché va al 10% de la entrada, como el resto de la tabla.
insert into public.credit_rates (kind, ref_key, unit, credits_per_unit, description, effective_from) values
  ('model_input',      'openai/gpt-6-luna', 'ktoken', 0.120000, 'GPT-6 Luna entrada (0,10 USD/Mtok x1,2)', '2026-09-22T00:00:00Z'),
  ('model_output',     'openai/gpt-6-luna', 'ktoken', 0.600000, 'GPT-6 Luna salida (0,50 USD/Mtok x1,2)',  '2026-09-22T00:00:00Z'),
  ('model_cache_read', 'openai/gpt-6-luna', 'ktoken', 0.012000, 'GPT-6 Luna cache (10% de entrada)',       '2026-09-22T00:00:00Z')
on conflict (kind, ref_key, effective_from) do nothing;
