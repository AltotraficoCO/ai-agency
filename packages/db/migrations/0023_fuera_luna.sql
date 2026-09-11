-- =============================================================================
-- 0023 · Fuera GPT-5.6 Luna: no sirve para agentes con herramientas
-- =============================================================================
-- Comprobado contra OpenRouter con el prompt real del Webmaster (10 KB) y sus
-- 36 herramientas: Luna y Luna Pro devuelven SIEMPRE una respuesta vacia
-- (`content: null`, motivo `max_output_tokens`), con tope de 8k, de 32k, de 64k
-- y sin tope, y con el razonamiento apagado, al minimo o por defecto. Se gastan
-- todo el presupuesto razonando por dentro y no llegan a escribir ni a pedir
-- una herramienta. En la practica: la tarea termina «sin resumen» y con cero
-- acciones. Con un mensaje corto y sin herramientas si responden, que es lo que
-- despisto al probarlo.
--
-- En la misma prueba, y a la primera, pidieron las herramientas correctas:
--  · Claude Sonnet 5           → sitio_salud, sitio_leer_diseno, wp_listar_contenido
--  · DeepSeek V4 Flash         → las tres y wp_listar_plugins
--  · GLM-4.7-flash             → las tres
--
-- Reparto:
--  · Agentes del negocio (Webmaster): Claude Sonnet 5. Son pocas tareas al dia
--    y cada error cuesta caro (paginas mal hechas en el sitio del cliente).
--    DeepSeek V4 Flash de respaldo.
--  · Strap construyendo en lite: DeepSeek V4 Flash, que es barato, usa bien las
--    herramientas y sigue mejor las instrucciones largas que GLM.
--  · Luna desaparece tambien de las cadenas de respaldo de max.
-- =============================================================================

update public.model_tiers
   set provider        = 'anthropic',
       primary_model   = 'anthropic/claude-sonnet-5',
       fallback_models = array['deepseek/deepseek-v4-flash', 'zai/glm-4.7-flash'],
       max_tokens      = 16384,
       notes           = 'Agentes del negocio (worker del VPS). Claude Sonnet 5: pocas tareas al dia y cada error se ve en el sitio del cliente. Luna quedo descartado: con herramientas devuelve respuesta vacia'
 where task = 'negocio';

update public.model_tiers
   set provider        = 'deepseek',
       primary_model   = 'deepseek/deepseek-v4-flash',
       fallback_models = array['zai/glm-4.7-flash'],
       notes           = 'Construir agentes en lite: DeepSeek V4 Flash usa bien las herramientas y cuesta poco'
 where mode = 'lite' and task = 'build';

-- Ningun respaldo puede apuntar ya a Luna.
update public.model_tiers
   set fallback_models = array(
         select m from unnest(fallback_models) as m where m not like 'openai/gpt-5.6-luna%'
       )
 where exists (
   select 1 from unnest(fallback_models) as m where m like 'openai/gpt-5.6-luna%'
 );
