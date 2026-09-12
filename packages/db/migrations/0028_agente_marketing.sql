-- =============================================================================
-- 0028 · El agente de Marketing pasa a ser el que vigila la inversión en anuncios
-- =============================================================================
-- La ficha sembrada en 0010 describía a un Marketing que redactaba campañas y
-- segmentaba contactos de WhatsApp. Lo que se va a lanzar (reunión del
-- 11-sep-2026) es otra cosa y más concreta: un agente que mira Google Ads y
-- Facebook e Instagram, dice dónde se está yendo el dinero sin traer clientes y
-- propone los cambios, que solo se ejecutan cuando una persona los aprueba.
--
-- La categoría se queda en 'crecimiento': ya cae en el departamento de
-- Marketing del menú (packages/ui/src/layout/departamentos.ts) y cambiarla
-- movería de sitio a los agentes ya contratados sin ganar nada.
--
-- `required_tools` son las herramientas que el MOTOR exige conectadas; las de
-- este agente viven en @strappy/marketing y no en el registro de sistema, así
-- que aquí solo queda el conocimiento del negocio, que sí es de sistema.
-- =============================================================================

update public.catalog_agents
   set name          = 'Marketing',
       tagline       = 'Vigila en qué se va tu inversión en anuncios',
       description   = 'Revisa tus campañas de Google Ads y de Facebook e Instagram, te dice cuánto te cuesta cada cliente y cuál campaña gasta sin traer nada, y propone los cambios de presupuesto. Nunca mueve tu dinero sin que lo apruebes.',
       agent_type    = 'task',
       category      = 'crecimiento',
       required_tools = array['search_knowledge'],
       position      = 30,
       spec_template = '{"persona":{"tone":"cercano","language":"es-CO"},
     "goals":["vigilar el gasto en anuncios","encontrar campanas que no traen clientes","proponer cambios de presupuesto con cifras"],
     "guardrails":["nunca cambiar presupuestos ni pausar campanas sin aprobacion humana",
                   "nunca subir un presupuesto mas del triple de una vez",
                   "hablar en dinero y no en siglas publicitarias",
                   "no inventar cifras: si un dato no se pudo leer, decirlo"]}'::jsonb,
       updated_at    = now()
 where slug = 'marketing';
