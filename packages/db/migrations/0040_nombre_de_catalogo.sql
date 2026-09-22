-- =============================================================================
-- 0040 · Un agente contratado se llama como su puesto del catálogo
-- =============================================================================
-- Al contratar se podía poner nombre («Larry» al Velocista), y ese nombre se
-- guardaba en `agents.name` y en la identidad de su ficha. Desde el 22-sep el
-- nombre no se cambia ni al contratar ni en Instrucciones, pero los agentes
-- contratados antes seguían llamándose de dos maneras según la pantalla.
-- Aquí se devuelven todos a su nombre de catálogo. Los agentes de WhatsApp
-- (sin catalog_slug) no se tocan: esos se llaman como quiera la persona.
-- =============================================================================

update public.agents a
   set name = c.name,
       updated_at = now()
  from public.catalog_agents c
 where a.catalog_slug = c.slug
   and a.name is distinct from c.name;

update public.agent_drafts d
   set spec = jsonb_set(d.spec, '{identidad,nombre}', to_jsonb(c.name), true),
       updated_at = now()
  from public.agents a
  join public.catalog_agents c on c.slug = a.catalog_slug
 where d.agent_id = a.id
   and d.spec ? 'identidad'
   and d.spec #>> '{identidad,nombre}' is distinct from c.name;

update public.agent_versions v
   set spec = jsonb_set(v.spec, '{identidad,nombre}', to_jsonb(c.name), true)
  from public.agents a
  join public.catalog_agents c on c.slug = a.catalog_slug
 where v.agent_id = a.id
   and v.spec ? 'identidad'
   and v.spec #>> '{identidad,nombre}' is distinct from c.name;
