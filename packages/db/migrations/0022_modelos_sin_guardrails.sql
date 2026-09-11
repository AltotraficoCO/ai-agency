-- =============================================================================
-- 0022 · Reparto de modelos con las claves ya sin guardrails
-- =============================================================================
-- 0020 puso todo en GLM y DeepSeek porque las claves tenian guardrails; ya no
-- los tienen. Comprobado contra OpenRouter: responden GLM-4.7-flash, DeepSeek
-- V4 Flash, GPT-5.6 Luna Pro, Claude Sonnet 5, Claude Opus 5 y los embeddings.
--
-- El criterio es el de siempre: barato donde hay volumen, bueno donde
-- equivocarse sale caro.
--  · Conversar, clasificar, extraer, resumir y titular en lite: GLM-4.7-flash.
--    Son miles de mensajes de WhatsApp y GLM responde de sobra.
--  · Construir (Strap) y agentes del negocio (Webmaster): GPT-5.6 Luna Pro.
--    Cuesta como GLM (0,20/1,20 USD por Mtok) y sigue instrucciones largas y
--    usa herramientas mucho mejor: con GLM, «crea un blog» acabo en tres
--    entradas vacias.
--  · Max: Claude Sonnet 5, y Opus 5 al construir, como en la semilla (0010).
--    Titular no justifica un modelo caro ni en max.
-- Todas las tarifas existen ya (0010 para GLM, DeepSeek y Claude; 0021 para
-- Luna Pro).
-- =============================================================================

-- Lite · volumen
update public.model_tiers
   set provider        = 'zai',
       primary_model   = 'zai/glm-4.7-flash',
       fallback_models = array['deepseek/deepseek-v4-flash']
 where mode = 'lite' and task in ('chat', 'classify', 'extract', 'summarize', 'title');

-- Lite · construir agentes (Strap)
update public.model_tiers
   set provider        = 'openai',
       primary_model   = 'openai/gpt-5.6-luna-pro',
       fallback_models = array['zai/glm-4.7-flash', 'deepseek/deepseek-v4-flash'],
       notes           = 'Construir con GPT-5.6 Luna Pro: cuesta como GLM y sigue mucho mejor las instrucciones largas'
 where mode = 'lite' and task = 'build';

-- Max · calidad
update public.model_tiers
   set provider        = 'anthropic',
       primary_model   = 'anthropic/claude-sonnet-5',
       fallback_models = array['openai/gpt-5.6-luna-pro', 'zai/glm-4.7-flash']
 where mode = 'max' and task in ('chat', 'classify', 'extract', 'summarize');

update public.model_tiers
   set provider        = 'anthropic',
       primary_model   = 'anthropic/claude-opus-5',
       fallback_models = array['anthropic/claude-sonnet-5', 'openai/gpt-5.6-luna-pro'],
       notes           = 'Meta-agente en modo max'
 where mode = 'max' and task = 'build';

update public.model_tiers
   set provider        = 'zai',
       primary_model   = 'zai/glm-4.7-flash',
       fallback_models = array['deepseek/deepseek-v4-flash'],
       notes           = 'Titular no justifica un modelo caro ni en modo max'
 where mode = 'max' and task = 'title';

-- Agentes del negocio (worker del VPS): ahora si pueden tener respaldo.
update public.model_tiers
   set provider        = 'openai',
       primary_model   = 'openai/gpt-5.6-luna-pro',
       fallback_models = array['zai/glm-4.7-flash'],
       notes           = 'Agentes del negocio (worker del VPS): GPT-5.6 Luna Pro, con GLM de respaldo'
 where task = 'negocio';
