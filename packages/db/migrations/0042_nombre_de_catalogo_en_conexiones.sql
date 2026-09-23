-- =============================================================================
-- 0042 · Las conexiones también recuerdan el nombre viejo del agente
-- =============================================================================
-- La 0040 devolvió a los agentes de catálogo su nombre de puesto en `agents`
-- y en su ficha, pero cada conexión (el WordPress, Alegra, las cuentas de
-- anuncios) guardó en su `metadata.agent_name` una copia del nombre que se le
-- puso al contratar («Jaime», «Larry»), y de ahí lo leen los avisos de
-- vigilancia y los encargos que no llevan el agente enganchado. Aquí se
-- sustituye esa copia por el nombre de catálogo del agente que trabaja sobre
-- esa conexión en ese espacio. Los espacios sin ese agente contratado no se
-- tocan: el worker ya usa un nombre de respaldo digno.
-- =============================================================================

with nombre_por_espacio as (
  select s.workspace_id,
         case
           when s.catalog_slug in ('webmaster','velocista','disenador') then 'wordpress'
           when s.catalog_slug in ('administrativo','reportes') then 'alegra'
           when s.catalog_slug = 'marketing' then 'ads'
         end as familia,
         min(c.name) as nombre
    from public.agent_subscriptions s
    join public.catalog_agents c on c.slug = s.catalog_slug
   where s.status <> 'cancelled'
     and s.catalog_slug in ('webmaster','administrativo','marketing')
   group by s.workspace_id, 2
)
update public.connections x
   set metadata = x.metadata || jsonb_build_object('agent_name', n.nombre),
       updated_at = now()
  from nombre_por_espacio n
 where n.workspace_id = x.workspace_id
   and n.familia is not null
   and (
        (n.familia = 'wordpress' and x.provider = 'wordpress')
     or (n.familia = 'alegra'    and x.provider = 'alegra')
     or (n.familia = 'ads'       and x.provider in ('google_ads','meta_ads','tiktok_ads'))
   )
   and coalesce(x.metadata->>'agent_name', '') is distinct from n.nombre;
