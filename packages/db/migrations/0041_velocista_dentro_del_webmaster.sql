-- =============================================================================
-- 0041 · El Velocista se fusiona en el Webmaster
-- =============================================================================
-- Regla del 22-sep-2026: un agente llama a otro solo cuando el trabajo es de
-- otro oficio. Medir la velocidad, comprimir imágenes y activar la caché es
-- cuidar la web: mismo sitio, misma conexión, mismas aprobaciones. El
-- Velocista medía y para todo lo demás llamaba al Webmaster, así que pasa a
-- ser una capacidad suya. El código del paquete `velocista` se queda como
-- módulo del Webmaster; lo que se retira es el puesto.
--
-- Los encargos y el trabajo programado que ya existían se conservan: los
-- encargos con oficio «velocista» los ejecuta el Webmaster (el worker enruta
-- ese oficio a él); lo programado se pausa para que el cliente lo vuelva a
-- programar en el Webmaster si lo quiere.
-- =============================================================================

update public.catalog_agents
   set is_published = false,
       updated_at   = now()
 where slug = 'velocista';

update public.catalog_agents
   set description = 'Mantiene tu sitio, publica y corrige lo que le pides, vigila que no se caiga y que cargue rápido: mide con PageSpeed, te explica qué frena tu web y lo arregla con tu permiso.',
       updated_at  = now()
 where slug = 'webmaster'
   and description not like '%cargue rápido%';

update public.agent_subscriptions
   set status       = 'cancelled',
       cancelled_at = coalesce(cancelled_at, now())
 where catalog_slug = 'velocista'
   and status <> 'cancelled';

update public.agents a
   set status     = 'archived',
       updated_at = now()
  from public.agent_subscriptions s
 where s.agent_id = a.id
   and s.catalog_slug = 'velocista'
   and a.status <> 'archived';

update public.agent_schedules sch
   set activa       = false,
       motivo_pausa = coalesce(motivo_pausa, 'velocista_fusionado')
  from public.agents a
  join public.agent_subscriptions s on s.agent_id = a.id and s.catalog_slug = 'velocista'
 where sch.agent_id = a.id
   and sch.activa;
