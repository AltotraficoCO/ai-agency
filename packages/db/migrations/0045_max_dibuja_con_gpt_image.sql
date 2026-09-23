-- =============================================================================
-- 0045 · En modo Max el Diseñador dibuja con GPT Image 1
-- =============================================================================
-- La 0044 dejó el mismo generador en los dos modos porque en imagen no hay un
-- salto tan claro como en texto. Decisión del cliente: que Max también cambie
-- el generador, igual que cambia el modelo de razonamiento.
--
-- GPT Image 1 respeta mejor las composiciones pedidas con detalle (encuadre,
-- dónde va cada elemento, qué NO debe aparecer) a cambio de costar ~0,20 USD
-- por imagen contra los ~0,039 de Gemini: cinco veces más. Por eso está en
-- Max y no en Lite. Gemini queda de respaldo, que es lo contrario de la fila
-- de lite: cada modo prefiere el suyo y cae en el otro si falla.
--
-- El Diseñador cobra 100 créditos por imagen en los dos modos (fijo, en
-- `packages/disenador/src/loop.ts`). Con GPT Image 1 eso es coste, no margen:
-- 0,20 USD al 20% son ~240 créditos. Hay que decidir si Max cobra más por
-- imagen o si se asume; mientras tanto, cada portada en Max se hace a pérdida.
-- =============================================================================

update public.model_tiers
   set provider        = 'openai',
       primary_model   = 'openai/gpt-image-1',
       fallback_models = array['google/gemini-2.5-flash-image']::text[],
       notes           = 'Portadas del Diseñador en Max. GPT Image 1 respeta mejor composiciones pedidas con detalle; ~5x el coste de Gemini'
 where task = 'image'
   and mode = 'max';
