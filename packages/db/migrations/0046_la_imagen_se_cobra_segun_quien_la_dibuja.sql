-- =============================================================================
-- 0046 · Una imagen cuesta lo que cuesta el generador que la dibuja
-- =============================================================================
-- La 0045 dejó el problema escrito: en Max el Diseñador dibuja con GPT Image 1
-- (~0,20 USD por imagen) pero cobraba los mismos 100 créditos fijos que en
-- Lite con Gemini (~0,039 USD). Cada portada en Max se hacía a pérdida.
--
-- Decisión del cliente: «la idea es que yo no pierda». Así que la imagen deja
-- de tener precio fijo en el código y pasa a tarifarse como todo lo demás en
-- Strappy: desde `credit_rates`, por identificador de modelo, con el margen
-- dentro. Cambiar de generador vuelve a ser cambiar una fila de `model_tiers`
-- y no tocar TypeScript.
--
-- El `kind` nuevo es `model_image` y la unidad es `unit` (una imagen entregada,
-- no tokens). Lo lee `cargarTarifaDeImagen` y viaja por dos vías: la que el
-- agente le dice al cliente antes de dibujar, y la que el bucle cobra de
-- verdad. Son el mismo número a propósito.
--
-- Precios de venta (margen del 20% de la 0025, con el coste verificado contra
-- OpenRouter el 22-sep-2026):
--   · google/gemini-2.5-flash-image  0,039 USD → 47 créditos de coste.
--     Se queda en 100, que es lo que ya se cobra hoy: no hay razón para
--     bajarle el precio al cliente y el colchón paga los reintentos, que
--     también cuestan aunque la imagen salga mal y se descarte.
--   · openai/gpt-image-1             0,200 USD → 240 créditos de coste.
--     Se cobran 250 por el mismo colchón. Max cuesta más porque el generador
--     cuesta más, igual que Max cuesta más en texto.
--
-- Un generador que no esté en esta tabla se cobra al precio del caro (250): el
-- error barato es cobrar de más y que se note, no regalar imágenes en silencio.
--
-- El tarifario es VERSIONADO (trigger guard_credit_rate_immutable): estas filas
-- se insertan, nunca se editan. Reaplicar la migración es inocuo.
-- =============================================================================

insert into public.credit_rates (kind, ref_key, unit, credits_per_unit, description, effective_from) values
  ('model_image', 'google/gemini-2.5-flash-image', 'unit', 100.000000, 'Imagen del Disenador en Lite (coste 0,039 USD x1,2 = 47; colchon para reintentos)', '2026-09-22T00:00:00Z'),
  ('model_image', 'openai/gpt-image-1',            'unit', 250.000000, 'Imagen del Disenador en Max (coste 0,200 USD x1,2 = 240; colchon para reintentos)',  '2026-09-22T00:00:00Z'),
  ('model_image', '*',                             'unit', 250.000000, 'Generador de imagen sin tarifa propia: se cobra al precio del caro',                 '2026-09-22T00:00:00Z')
on conflict (kind, ref_key, effective_from) do nothing;
