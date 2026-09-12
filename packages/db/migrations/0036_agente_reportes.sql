-- =============================================================================
-- 0036 · El agente de Reportes entra al catálogo
-- =============================================================================
-- Segundo puesto del departamento Financiero. Es el encargo que Pedro describió
-- en la reunión del 11-sep-2026: «que al final a usted le diga: tenemos tanta
-- plata, nos falta tanta plata».
--
-- Comparte código con el Administrativo (`@strappy/administrativo`: mismo puerto
-- de contabilidad, mismo adaptador de Alegra, mismo análisis), pero es un puesto
-- distinto y un oficio distinto: **solo lee**. No tiene las herramientas que
-- emiten facturas ni registran pagos, así que no puede tocar la contabilidad
-- aunque se lo pidan. Por eso tampoco necesita aprobaciones.
--
-- Necesita la misma conexión de Alegra que el Administrativo, y eso se dice
-- ANTES de contratarlo.
--
-- Se emite como insert idempotente: reaplicarla actualiza en vez de fallar.
-- =============================================================================

insert into public.catalog_agents
  (slug, name, tagline, description, agent_type, category,
   required_tools, monthly_credits, setup_credits, position, is_published, spec_template)
values
  ('reportes', 'Reportes',
   'Cada lunes te dice cómo va el negocio en una página',
   'Te cuenta cuánto entró, cuánto salió, cuánto te deben y desde cuándo, qué vence la semana que viene y quién te debe más, todo comparado con el periodo anterior. Solo mira: nunca toca tu contabilidad.',
   'task', 'financiero',
   array[]::text[],
   0, 0, 41, true,
   '{"persona":{"tone":"cercano","language":"es-CO"},
     "goals":["contar como va el negocio en una pagina",
              "comparar con el periodo anterior para que el dato sea noticia",
              "senalar lo mas urgente de cobrar"],
     "guardrails":["nunca escribir en la contabilidad: este agente solo lee",
                   "no inventar cifras ni redondearlas: se entregan tal como vienen",
                   "decir cuando un total quedo incompleto, porque un numero que parece completo hace decidir mal",
                   "hablar en dinero y no en jerga contable",
                   "nunca repetir identificaciones, direcciones ni telefonos de terceros"]}'::jsonb)
on conflict (slug) do update
  set name           = excluded.name,
      tagline        = excluded.tagline,
      description    = excluded.description,
      agent_type     = excluded.agent_type,
      category       = excluded.category,
      required_tools = excluded.required_tools,
      position       = excluded.position,
      is_published   = excluded.is_published,
      spec_template  = excluded.spec_template,
      updated_at     = now();
