-- =============================================================================
-- 0050 · El Webmaster también trabaja sobre el repositorio de un sitio a medida
-- =============================================================================
-- Un sitio hecho en React, Next, Astro… no tiene una API de contenidos: su
-- verdad es el código en GitHub. El Webmaster lo edita por la API de GitHub y
-- sube cada cambio a la rama que el cliente elige con un botón.
--
-- El repositorio conectado NO necesita tabla: vive en public.connections como
-- el WordPress,
--   provider = 'github'
--   credentials_encrypted = {"token": "..."} o {"installationId": 123}
--                           (+ "bypassVistaPrevia" opcional)
--   metadata = {"url": "https://misitio.com", "tipo": "repo", "owner": "...",
--               "repo": "...", "rama_principal": "main", "nombre": "...",
--               "acceso": "token" | "app"}
--
-- Lo que sí es nuevo es la sesión de trabajo de cada encargo: la rama elegida,
-- los cambios aún sin subir, el PR abierto y la pregunta de la rama que espera
-- respuesta. El encargo se pausa cuando pregunta algo y lo retoma otro proceso;
-- sin esta fila, lo hecho hasta la pausa se perdería justo cuando el cliente
-- contesta.
-- =============================================================================

set search_path = public, extensions, pg_temp;

create table if not exists public.repo_sesiones (
  task_id       uuid primary key references public.agent_tasks(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  site_id       uuid not null references public.connections(id) on delete cascade,
  estado        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.repo_sesiones is
  'Trabajo en curso de un encargo del Webmaster sobre un repositorio: rama elegida, cambios sin subir, PR y pregunta pendiente. La escribe el worker; el cliente solo la lee.';
comment on column public.repo_sesiones.estado is
  'EstadoRepo de @strappy/webmaster. Los cambios sin subir van enteros (texto o base64): son el trabajo del agente entre una pausa y la siguiente.';

create index if not exists repo_sesiones_ws_idx
  on public.repo_sesiones (workspace_id, updated_at desc);

drop trigger if exists repo_sesiones_touch on public.repo_sesiones;
create trigger repo_sesiones_touch before update on public.repo_sesiones
  for each row execute function public.touch_updated_at();

select public.apply_tenant_rls('repo_sesiones', null, true);
