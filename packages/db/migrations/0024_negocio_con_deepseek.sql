-- =============================================================================
-- 0024 · Los agentes del negocio pasan a DeepSeek V4 Flash
-- =============================================================================
-- Decision del cliente por coste: el mismo encargo («crea un blog… en
-- Elementor») costo 1.489 creditos con Claude Sonnet 5 y unos 113 con un
-- modelo de la familia economica. DeepSeek V4 Flash cuesta 0,13/0,26 USD por
-- Mtok (0,39/0,78 creditos), unas 15 veces menos que Sonnet, y en la prueba
-- con el prompt real del Webmaster y sus herramientas pidio a la primera las
-- correctas: sitio_salud, sitio_leer_diseno, wp_listar_contenido y
-- wp_listar_plugins.
--
-- Claude Sonnet 5 queda de respaldo: si DeepSeek falla, el encargo se termina
-- igual. Si la calidad no convence, se vuelve a Sonnet cambiando esta fila.
-- =============================================================================

update public.model_tiers
   set provider        = 'deepseek',
       primary_model   = 'deepseek/deepseek-v4-flash',
       fallback_models = array['anthropic/claude-sonnet-5', 'zai/glm-4.7-flash'],
       notes           = 'Agentes del negocio (worker del VPS). DeepSeek V4 Flash por coste, con Claude Sonnet 5 de respaldo'
 where task = 'negocio';
