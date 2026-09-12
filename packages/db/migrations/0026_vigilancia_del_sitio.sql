-- =============================================================================
-- 0026 · El Webmaster vigila el sitio y avisa solo
-- =============================================================================
-- Hasta ahora nadie miraba el sitio del cliente si el cliente no pedia un
-- encargo: si su web se caia un domingo, se enteraba el lunes por un cliente
-- suyo. Estas dos tablas son lo que hace falta para que el Webmaster lo mire
-- solo cada pocos minutos y avise UNA vez cuando algo cambia.
--
-- No se toca `connections`: la vigilancia es estado del worker sobre un sitio,
-- no credenciales, y mezclarla con el sobre cifrado obligaria a reescribir esa
-- fila cada quince minutos.
--
-- La vigilancia NO gasta creditos: son peticiones HTTP, no llamadas al modelo.
-- Solo se cobra si el cliente pide un encargo a partir de un aviso.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Estado de la vigilancia de cada sitio
-- -----------------------------------------------------------------------------
create table if not exists public.site_monitor (
  site_id       uuid primary key references public.connections(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  activa        boolean not null default true,
  -- Cada cuanto se comprueba. Quince minutos es el equilibrio entre enterarse
  -- pronto y no castigar el hosting del cliente con trafico propio.
  cada_minutos  integer not null default 15 check (cada_minutos between 5 and 1440),

  -- Memoria entre rondas (EstadoVigilancia de packages/webmaster/src/vigilancia):
  -- si esta caido, desde cuando, que umbral del certificado ya se aviso y
  -- cuando se hizo por ultima vez cada comprobacion cara.
  estado        jsonb not null default '{}'::jsonb,
  ultimo_chequeo jsonb,

  proxima_en    timestamptz not null default now(),
  -- Arrendamiento, igual que en la cola de tareas: si un worker muere a mitad
  -- de una comprobacion, otro la recoge al expirar en vez de quedarse la fila
  -- bloqueada para siempre.
  lease_until   timestamptz,
  worker_id     text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.site_monitor is
  'Vigilancia proactiva de un sitio conectado: cada cuanto se comprueba, cuando toca la proxima y que se recuerda de la anterior. La escribe el worker; para el cliente es de solo lectura.';
comment on column public.site_monitor.estado is
  'Memoria de la vigilancia: caida confirmada, sospecha sin confirmar, umbral del certificado ya avisado y fecha de las comprobaciones caras. Su forma la define packages/webmaster/src/vigilancia/decidir.ts.';
comment on column public.site_monitor.proxima_en is
  'Cuando toca la siguiente ronda. El worker reclama por esta columna con FOR UPDATE SKIP LOCKED.';

create index if not exists site_monitor_pendientes_idx
  on public.site_monitor (proxima_en)
  where activa;
create index if not exists site_monitor_ws_idx
  on public.site_monitor (workspace_id);

-- -----------------------------------------------------------------------------
-- Avisos: uno por cambio de estado, no uno por ronda
-- -----------------------------------------------------------------------------
create table if not exists public.site_alerts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  site_id       uuid not null references public.connections(id) on delete cascade,

  -- Identifica el aviso concreto e incluye el momento del CAMBIO, no el de la
  -- comprobacion: repetir la ronda no crea un aviso nuevo.
  clave         text not null,
  severidad     text not null check (severidad in ('grave','aviso','bueno')),
  titulo        text not null,
  cuerpo        text not null,
  -- Que se puede hacer. Es la diferencia entre un aviso y una alarma.
  propuesta     text,
  datos         jsonb not null default '{}'::jsonb,

  -- Para el dia que los avisos salgan tambien por WhatsApp: aqui se marca que
  -- ya se enviaron por fuera, sin tocar el resto.
  enviado_en    timestamptz,
  leido_en      timestamptz,
  created_at    timestamptz not null default now(),

  unique (site_id, clave)
);

comment on table public.site_alerts is
  'Aviso del Webmaster sobre un sitio vigilado. Unico por (sitio, clave): el worker inserta con ON CONFLICT DO NOTHING, asi que reintentar una ronda no duplica avisos.';
comment on column public.site_alerts.enviado_en is
  'Cuando se entrego por un canal externo (WhatsApp, correo). Null = solo se ve dentro de Strappy.';

create index if not exists site_alerts_ws_idx
  on public.site_alerts (workspace_id, created_at desc);
create index if not exists site_alerts_sin_leer_idx
  on public.site_alerts (workspace_id, created_at desc)
  where leido_en is null;

-- -----------------------------------------------------------------------------
do $$
begin
  execute 'drop trigger if exists site_monitor_touch on public.site_monitor';
  execute 'create trigger site_monitor_touch before update on public.site_monitor
             for each row execute function public.touch_updated_at()';
end
$$;

-- =============================================================================
-- RLS
-- =============================================================================
-- Las dos las escribe el worker. El cliente las lee, y ademas marca un aviso
-- como leido, que es lo unico que puede escribir: por eso `site_alerts` no va
-- en solo lectura y `site_monitor` si.
select public.apply_tenant_rls('site_monitor', null, true);
select public.apply_tenant_rls('site_alerts', 'agents.write');
