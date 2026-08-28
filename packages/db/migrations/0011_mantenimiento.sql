-- ============================================================================
-- 0011 · Mantenimiento automatico de particiones
-- ============================================================================
--
-- `webhook_events` y `credit_ledger` estan particionadas por mes. Las funciones
-- que crean y purgan particiones existen desde 0005, pero hasta ahora no las
-- llamaba nadie: si nadie las ejecuta, **las inserciones del mes siguiente
-- fallan el dia 1**, y eso significa perder mensajes entrantes y cobros.
--
-- Aqui se programan de dos formas complementarias, porque cada una cubre el
-- fallo de la otra:
--
--   1. pg_cron, si la extension esta disponible (lo esta en Supabase).
--   2. Una red de seguridad en la propia insercion: si aun asi faltara la
--      particion, se crea al vuelo en lugar de fallar.
--
-- La red de seguridad no sustituye al cron: crear una particion dentro de una
-- insercion toma un lock fuerte sobre la tabla padre. Es aceptable una vez al
-- mes como ultimo recurso, no como mecanismo habitual.
-- ============================================================================

-- ── 1 · Programacion con pg_cron ────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;

    -- Dia 20 de cada mes: hay margen de sobra antes del cambio de mes y, si
    -- una ejecucion falla, quedan diez dias para darse cuenta.
    perform cron.schedule(
      'strappy-crear-particiones',
      '0 3 20 * *',
      $cmd$select public.ensure_month_partitions(2)$cmd$
    );

    -- Purga de webhooks crudos: retencion de 30 dias.
    perform cron.schedule(
      'strappy-purgar-webhooks',
      '0 4 * * 0',
      $cmd$select public.drop_expired_webhook_partitions(30)$cmd$
    );

    raise notice 'Mantenimiento programado con pg_cron';
  else
    raise warning 'pg_cron no disponible: programa ensure_month_partitions(2) mensualmente desde el worker o fallaran las inserciones del mes siguiente';
  end if;
exception when insufficient_privilege then
  raise warning 'Sin permisos para programar pg_cron: hazlo desde el panel de Supabase o desde el worker';
end $$;

-- ── 2 · Red de seguridad ────────────────────────────────────────────────────
-- Reintenta la insercion tras crear la particion que falta. Solo actua cuando
-- el cron ya ha fallado, asi que su coste no aparece en la operacion normal.
create or replace function public.crear_particion_faltante()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_month_partitions(2);
  return null;   -- el llamante reintenta
end;
$$;

comment on function public.crear_particion_faltante() is
  'Ultimo recurso si el cron de particiones no corrio. Crear una particion toma un lock fuerte sobre la tabla padre: sirve una vez al mes, no como mecanismo habitual.';

-- ── 3 · Diagnostico ─────────────────────────────────────────────────────────
-- Para vigilar desde el panel: si devuelve algo, hay que actuar antes del dia 1.
create or replace function public.particiones_pendientes()
returns table (tabla text, mes date, falta boolean)
language sql
stable
set search_path = public
as $$
  with meses as (
    select date_trunc('month', current_date + (n || ' month')::interval)::date as mes
    from generate_series(0, 2) as n
  ),
  padres as (select unnest(array['webhook_events','credit_ledger']) as tabla)
  select p.tabla,
         m.mes,
         not exists (
           select 1 from pg_class c
           where c.relname = p.tabla || '_' || to_char(m.mes, 'YYYYMM')
             and c.relkind = 'r'
         ) as falta
  from padres p cross join meses m
  order by p.tabla, m.mes;
$$;

comment on function public.particiones_pendientes() is
  'Devuelve las particiones de los proximos tres meses y si falta alguna. Si `falta` es cierto para el mes que viene, hay que crearla antes del dia 1.';
