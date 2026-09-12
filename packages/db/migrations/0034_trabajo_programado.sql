-- =============================================================================
-- 0034 · Trabajo programado: los agentes trabajan sin que se lo pidan
-- =============================================================================
-- Hasta ahora un agente solo se movia si el cliente escribia un encargo. Lo
-- unico proactivo era la vigilancia del sitio, y esta construida a mano para ese
-- caso. Esta tabla es la que convierte a los agentes en empleados: «cada manana
-- revisa que vence», «todos los lunes mandame el informe».
--
-- Lo que se guarda es la CADENCIA, no un cron: el cliente dice cada manana, los
-- lunes o el dia 1, y eso se lee igual en la pantalla que en la base. El cron
-- solo lo entiende quien lo escribe.
--
-- El programador NO ejecuta agentes: cuando llega la hora inserta una fila en
-- `agent_tasks`, igual que si el cliente la hubiera escrito, y la ejecuta el
-- consumidor de tareas de siempre. Asi el trabajo programado hereda gratis todo
-- lo que ya existe: enrutado por agente, aprobaciones, registro de trabajo en
-- vivo, cobro de creditos y reintentos.
--
-- Cada ejecucion CUESTA CREDITOS, porque es un encargo normal. Por eso el
-- programador se pausa solo cuando el espacio se queda sin saldo, en vez de
-- dejar un reguero de encargos fallidos.
-- =============================================================================

create table if not exists public.agent_schedules (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  -- El agente contratado del cliente, con el nombre que el le puso.
  agent_id      uuid not null references public.agents(id) on delete cascade,
  -- Quien lo ejecuta: el mismo slug del catalogo que usa `agent_tasks.agente`.
  agente        text not null,

  titulo        text not null,
  -- El encargo que se repetira, tal cual lo escribio el cliente.
  detalle       text not null,

  -- --------------------------------------------------------------------------
  -- Cadencia declarativa
  -- --------------------------------------------------------------------------
  frecuencia    text not null check (frecuencia in ('diaria','semanal','mensual')),
  hora          smallint not null default 8 check (hora between 0 and 23),
  minuto        smallint not null default 0 check (minuto between 0 and 59),
  -- Solo semanal. 1 = lunes … 7 = domingo, como se numeran los dias en la calle.
  dia_semana    smallint check (dia_semana between 1 and 7),
  -- Solo mensual. Hasta 28: el 29, el 30 y el 31 no existen todos los meses, y
  -- un «cada dia 31» que se salta febrero no es lo que nadie quiere decir.
  dia_mes       smallint check (dia_mes between 1 and 28),
  -- La hora es la del cliente. Sin esto, «cada lunes a las 8» seria a las 3 de
  -- la madrugada para un negocio colombiano.
  zona_horaria  text not null default 'America/Bogota',

  -- Coherencia: lo semanal necesita dia de la semana y lo mensual dia del mes.
  constraint agent_schedules_cadencia_coherente check (
    (frecuencia = 'diaria'  and dia_semana is null and dia_mes is null) or
    (frecuencia = 'semanal' and dia_semana is not null and dia_mes is null) or
    (frecuencia = 'mensual' and dia_mes is not null and dia_semana is null)
  ),

  -- --------------------------------------------------------------------------
  -- Estado
  -- --------------------------------------------------------------------------
  activa        boolean not null default true,
  -- Por que se apago sola: 'sin_creditos', 'agente_de_baja'. Null = la apago el
  -- cliente, o esta activa. Sirve para explicarlo en la pantalla y para saber
  -- que se puede reanudar cuando recargue.
  motivo_pausa  text,

  proxima_en    timestamptz not null default now(),
  ultima_en     timestamptz,
  -- El ultimo encargo que creo, para poder enlazarlo desde la pantalla.
  ultimo_task_id uuid references public.agent_tasks(id) on delete set null,

  -- Arrendamiento, igual que en la cola de tareas y en la vigilancia: si un
  -- worker muere justo al crear el encargo, otro lo recoge al expirar en vez de
  -- dejar la fila bloqueada para siempre.
  lease_until   timestamptz,
  worker_id     text,

  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.agent_schedules is
  'Trabajo que un agente repite solo. El worker no lo ejecuta aqui: cuando llega la hora inserta un encargo en agent_tasks y lo hace el consumidor de tareas de siempre.';
comment on column public.agent_schedules.zona_horaria is
  'Zona IANA del cliente. La hora guardada es la de SU reloj: el calculo de la proxima ejecucion vive en packages/core/src/schedule/cadencia.ts.';
comment on column public.agent_schedules.proxima_en is
  'Cuando toca la proxima. El worker reclama por esta columna con FOR UPDATE SKIP LOCKED. Al reclamar se recalcula desde AHORA, nunca sumando el intervalo: un worker apagado tres dias no dispara tres encargos al volver.';
comment on column public.agent_schedules.motivo_pausa is
  'Por que se apago sola: sin_creditos, agente_de_baja. Null si la apago el cliente o si esta activa.';

create index if not exists agent_schedules_pendientes_idx
  on public.agent_schedules (proxima_en)
  where activa;
create index if not exists agent_schedules_ws_idx
  on public.agent_schedules (workspace_id, created_at desc);
create index if not exists agent_schedules_agente_idx
  on public.agent_schedules (workspace_id, agent_id);

-- -----------------------------------------------------------------------------
do $$
begin
  execute 'drop trigger if exists agent_schedules_touch on public.agent_schedules';
  execute 'create trigger agent_schedules_touch before update on public.agent_schedules
             for each row execute function public.touch_updated_at()';
end
$$;

-- =============================================================================
-- RLS
-- =============================================================================
-- El cliente crea, pausa y quita su trabajo programado: es suyo, no del worker.
-- Mismo permiso con el que encarga trabajo, porque programar un encargo es
-- encargarlo muchas veces.
select public.apply_tenant_rls('agent_schedules', 'agents.write');
