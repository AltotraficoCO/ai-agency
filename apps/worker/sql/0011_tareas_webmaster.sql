-- =============================================================================
-- PROPUESTA · Cola de tareas por encargo, backups y aprobaciones
-- -----------------------------------------------------------------------------
-- Este archivo NO está en packages/db/migrations a propósito: ese directorio es
-- de otra corriente. Aquí queda la forma exacta que el worker necesita para que
-- se adopte tal cual (o se adapte y se ajusten los adaptadores de
-- src/adaptadores/postgres.ts, que es el único sitio que la conoce).
--
-- El sitio NO necesita tabla nueva: se guarda en public.connections, que ya
-- existe y ya es "credencial de un servicio externo con sobre cifrado".
--   provider = 'wordpress' | 'conector'
--   credentials_encrypted = sobre AES-256-GCM del JSON de credenciales
--   metadata = {"url": "...", "tipo": "wp"|"custom",
--               "agent_name": "Max", "primer_contacto": true}
-- `primer_contacto` es lo que activa el modo de simulación la primera vez.
-- =============================================================================

set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
-- Cola de tareas
-- -----------------------------------------------------------------------------
create table if not exists public.agent_tasks (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  agent_id         uuid references public.agents(id) on delete set null,
  site_id          uuid not null references public.connections(id) on delete cascade,

  titulo           text not null,
  detalle          text,
  prioridad        integer not null default 0,
  programada_para  timestamptz,

  estado           text not null default 'queued'
                     check (estado in ('queued','running','esperando_aprobacion','done','failed','cancelled')),
  intentos         integer not null default 0,
  worker_id        text,
  -- Arrendamiento: si el worker muere, otro recoge la tarea al expirar. Sin
  -- esto, una tarea de nueve minutos se queda en 'running' para siempre.
  lease_until      timestamptz,

  resumen          text,
  evidencia        jsonb,
  creditos         numeric(14,4) not null default 0,
  error            text,
  error_motivo     text,

  -- Conversación guardada cuando la tarea queda esperando un clic humano.
  -- Al reanudar se continúa desde aquí y no se vuelve a pagar la exploración.
  mensajes         jsonb,
  aprobaciones     jsonb,

  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);

comment on table public.agent_tasks is
  'Encargo del cliente a un agente de tipo tarea_por_encargo. La reclama el worker con FOR UPDATE SKIP LOCKED.';
comment on column public.agent_tasks.lease_until is
  'Hasta cuando este worker tiene la tarea. Expirado, otro worker puede recogerla: es lo que hace que la muerte de un proceso no cuelgue un encargo.';
comment on column public.agent_tasks.mensajes is
  'Conversacion serializada de un intento suspendido por aprobacion. Permite reanudar sin repetir la exploracion, que es la parte cara.';

-- El indice que hace barata la consulta de la cola.
create index if not exists agent_tasks_cola_idx
  on public.agent_tasks (prioridad desc, created_at)
  where estado in ('queued','running');
create index if not exists agent_tasks_ws_estado_idx
  on public.agent_tasks (workspace_id, estado, created_at desc);

-- -----------------------------------------------------------------------------
-- Backups: sin esto, revertir no es un boton
-- -----------------------------------------------------------------------------
create table if not exists public.site_backups (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  site_id       uuid not null references public.connections(id) on delete cascade,
  task_id       uuid references public.agent_tasks(id) on delete set null,
  alcance       text not null,
  snapshot      jsonb not null,
  created_at    timestamptz not null default now()
);

comment on table public.site_backups is
  'Estado ANTERIOR a una mutacion del sitio. Su id viaja en el resultado de la herramienta como backup_id.';
comment on column public.site_backups.alcance is
  'Que se guardo: "page:12", "plugins", "settings", "conector:pagina:inicio".';

create index if not exists site_backups_ws_site_idx
  on public.site_backups (workspace_id, site_id, created_at desc);
create index if not exists site_backups_task_idx
  on public.site_backups (task_id);

-- -----------------------------------------------------------------------------
-- Aprobaciones: la herramienta no ejecuta, propone
-- -----------------------------------------------------------------------------
create table if not exists public.task_approvals (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  task_id       uuid not null references public.agent_tasks(id) on delete cascade,
  site_id       uuid not null references public.connections(id) on delete cascade,
  -- Hash de (tarea + herramienta + entrada). Una aprobacion vale para
  -- EXACTAMENTE la accion aprobada, no para la siguiente parecida.
  huella        text not null,
  tool_slug     text not null,
  motivo        text not null,
  resumen       text not null,
  entrada       jsonb not null default '{}'::jsonb,
  decision      text check (decision is null or decision in ('aprobada','rechazada')),
  decidida_por  uuid references auth.users(id) on delete set null,
  decidida_en   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, task_id, huella)
);

comment on table public.task_approvals is
  'Solicitud de visto bueno humano para una accion sensible: portada, precios, checkout, plugins o usuarios. Sin decision, la accion no se ejecuto.';
comment on column public.task_approvals.huella is
  'Hash estable de la accion concreta. Si el modelo cambia un caracter de la entrada, hace falta otro clic: una aprobacion no es un cheque en blanco.';

create index if not exists task_approvals_pendientes_idx
  on public.task_approvals (workspace_id, created_at desc) where decision is null;

-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['agent_tasks','task_approvals'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch', t);
  end loop;
end
$$;

-- =============================================================================
-- RLS
-- =============================================================================
-- Las tareas las crea el cliente (necesita permiso de escritura); el estado, la
-- evidencia y los backups los escribe el worker y para el cliente son de solo
-- lectura. Las aprobaciones las decide una persona con permiso.
select public.apply_tenant_rls('agent_tasks', 'agents.write');
select public.apply_tenant_rls('site_backups', null, true);
select public.apply_tenant_rls('task_approvals', 'agents.write');
