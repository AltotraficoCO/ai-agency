-- =============================================================================
-- 0029 · Un encargo ya no es siempre sobre un sitio web
-- =============================================================================
-- `agent_tasks` nacio para el Webmaster, el unico agente por encargo que habia:
-- por eso `site_id` es obligatorio y el worker deducia QUE agente ejecutaba la
-- tarea mirando el tipo del sitio. Con el agente de Marketing (@strappy/marketing)
-- eso ya no vale: su encargo apunta a una cuenta de publicidad, o a ninguna
-- conexion todavia, y el agente hay que saberlo, no adivinarlo.
--
-- Dos cambios, los dos compatibles con lo que ya existe:
--  · `site_id` pasa a ser opcional. Los encargos actuales lo siguen teniendo.
--  · `agente` dice quien lo ejecuta ('webmaster', 'marketing'…). Es el slug del
--    catalogo, el mismo de `agent_subscriptions.catalog_slug`, para que no haya
--    dos vocabularios. Lo existente se marca como 'webmaster', que es lo que
--    era; si llegara sin agente, el worker lo trata como Webmaster igual.
--
-- `task_approvals` y `site_backups` tambien exigian sitio: una aprobacion de
-- Marketing («sube el presupuesto de esta campana») cuelga de una conexion de
-- anuncios, y puede no haber ninguna cuando el encargo se crea. Se relajan las
-- dos columnas; las filas de hoy no cambian.
-- =============================================================================

alter table public.agent_tasks
  alter column site_id drop not null;

alter table public.agent_tasks
  add column if not exists agente text;

update public.agent_tasks
   set agente = 'webmaster'
 where agente is null;

alter table public.agent_tasks
  alter column agente set default 'webmaster';

comment on column public.agent_tasks.agente is
  'Quien ejecuta el encargo: el slug del catalogo (webmaster, marketing…). El worker enruta por aqui; antes lo deducia del tipo del sitio, que solo servia mientras el unico agente por encargo fuera el Webmaster.';
comment on column public.agent_tasks.site_id is
  'Conexion sobre la que se trabaja: el WordPress del Webmaster, la cuenta de anuncios de Marketing. Opcional: un encargo puede crearse antes de que el cliente conecte su plataforma.';

-- Un encargo de Marketing no tiene por que tener sitio, y su aprobacion cuelga
-- de la conexion de anuncios cuando la hay.
alter table public.task_approvals
  alter column site_id drop not null;

alter table public.site_backups
  alter column site_id drop not null;

-- La cola ordena por prioridad y fecha; el enrutado lee `agente` de la fila ya
-- reclamada, asi que no hace falta indice nuevo. Este si ayuda a la web, que
-- lista los encargos de un agente concreto.
create index if not exists agent_tasks_ws_agente_slug_idx
  on public.agent_tasks (workspace_id, agente, created_at desc);
