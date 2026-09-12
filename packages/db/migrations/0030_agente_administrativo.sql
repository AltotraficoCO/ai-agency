-- =============================================================================
-- 0030 · El agente Administrativo entra al catálogo
-- =============================================================================
-- Cuarto agente del lanzamiento (reunión del 11-sep-2026). Pedro describió el
-- puesto por la persona que lo hace hoy: «monta pagos, manda facturas, concilia
-- con los contadores, cierra caja», y el encargo que lo resume: «que al final
-- le diga: tenemos tanta plata, nos falta tanta plata».
--
-- La categoría es 'financiero', que cae en el departamento Financiero del menú
-- (packages/ui/src/layout/departamentos.ts), donde hoy no trabaja nadie. El
-- departamento se llamó Administración hasta que el cliente pidió Financiero,
-- que es como lo nombraron en la propia reunión: «yo lo metería como en
-- financiero» / «sí, en un departamento financiero».
--
-- `required_tools` son las herramientas que el MOTOR exige conectadas; las de
-- este agente viven en @strappy/administrativo y no en el registro de sistema,
-- así que la lista se queda vacía.
--
-- Se emite como insert idempotente: si alguien reaplica la migración, actualiza
-- en vez de fallar.
-- =============================================================================

insert into public.catalog_agents
  (slug, name, tagline, description, agent_type, category,
   required_tools, monthly_credits, setup_credits, position, spec_template)
values
  ('administrativo', 'Administrativo',
   'Lleva tus facturas y persigue tus cobros',
   'Te dice cuánto te deben y desde cuándo, qué vence esta semana y cuánto dinero entró. Prepara los recordatorios de cobro, emite facturas y registra los pagos en tu sistema de facturación. Nunca emite nada sin que lo apruebes.',
   'task', 'financiero',
   array[]::text[],
   0, 0, 40,
   '{"persona":{"tone":"cercano","language":"es-CO"},
     "goals":["decir cuanto le deben al negocio y desde cuando",
              "perseguir las facturas vencidas",
              "emitir facturas y registrar pagos cuando el cliente lo pida"],
     "guardrails":["nunca emitir una factura ni registrar un pago sin aprobacion humana",
                   "hablar en dinero y no en jerga contable",
                   "no volcar la lista entera de deudores: totales y las que mas pesan",
                   "nunca repetir identificaciones, direcciones ni telefonos de terceros",
                   "no inventar cifras: si un dato no se pudo leer, decirlo",
                   "no enviar mensajes: los recordatorios los manda el agente de Comunicaciones"]}'::jsonb)
on conflict (slug) do update
  set name           = excluded.name,
      tagline        = excluded.tagline,
      description    = excluded.description,
      agent_type     = excluded.agent_type,
      category       = excluded.category,
      required_tools = excluded.required_tools,
      position       = excluded.position,
      spec_template  = excluded.spec_template,
      updated_at     = now();
