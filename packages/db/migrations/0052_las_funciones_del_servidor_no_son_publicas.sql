-- =============================================================================
-- 0052 · Las funciones del servidor no son públicas
-- =============================================================================
-- Tres agujeros de la misma familia, encontrados en la revisión de seguridad
-- del 28-oct-2026:
--
-- 1. Postgres concede EXECUTE a PUBLIC sobre cada función nueva, y Supabase
--    además lo concede a `anon` y `authenticated`. Como el esquema `public`
--    está expuesto por PostgREST y el registro está abierto, cualquiera con
--    una cuenta podía llamar a `grant_credits` (créditos infinitos), a
--    `charge_credits` contra otro espacio, o a `drop_expired_webhook_partitions`
--    con días negativos (borrar los eventos de todos los clientes). Ninguna de
--    estas funciones la llama la web ni el worker por REST: van por `pg` como
--    `strappy_worker`. Se revocan todas y se cambia el permiso por defecto para
--    que una función futura nazca privada.
--
-- 2. `assert_workspace` devolvía en silencio cuando no había `app.workspace_id`
--    y el rol no era `strappy_worker`, pensando en tareas de mantenimiento como
--    `postgres`. Una petición REST llega exactamente así. Ahora, con un rol de
--    la API (`anon`, `authenticated`) y sin espacio declarado, aborta.
--
-- 3. La política `memberships_manage` dejaba a quien tiene `members.manage`
--    (un `admin`) cambiar cualquier columna de la tabla, incluidas `role` y
--    `permissions`: se ascendía a `owner` con un PATCH. Un trigger impide
--    conceder lo que uno no tiene, tocar al owner sin serlo, y editarse a uno
--    mismo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · Revocar las funciones del servidor
-- -----------------------------------------------------------------------------
revoke all on function public.charge_credits(uuid, text, jsonb, text, text, uuid, uuid, text, jsonb, timestamptz, boolean)
  from public, anon, authenticated;
revoke all on function public.grant_credits(uuid, text, numeric, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.has_credits(uuid, numeric)
  from public, anon, authenticated;
revoke all on function public.resolve_credit_rate(text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.on_workspace_created(uuid)
  from public, anon, authenticated;
revoke all on function public.create_month_partition(text, date, text[])
  from public, anon, authenticated;
revoke all on function public.ensure_month_partitions(integer)
  from public, anon, authenticated;
revoke all on function public.drop_expired_webhook_partitions(integer)
  from public, anon, authenticated;
revoke all on function public.ingest_webhook_event(text, text, jsonb, boolean, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.particiones_pendientes()
  from public, anon, authenticated;
revoke all on function public.assert_workspace(uuid)
  from public, anon, authenticated;
revoke all on function public.apply_tenant_rls(text, text, boolean, boolean)
  from public, anon, authenticated;

-- Lo que la web y el worker sí ejecutan como strappy_worker.
grant execute on function public.ingest_webhook_event(text, text, jsonb, boolean, text, text, jsonb)
  to strappy_worker;
grant execute on function public.assert_workspace(uuid) to strappy_worker;

-- Las funciones futuras nacen privadas. Quien deba ser público lo dirá con un
-- GRANT explícito en su migración.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;

-- Las que sostienen las políticas RLS deben seguir siendo ejecutables por los
-- roles de la API, porque la política corre como el usuario que consulta.
grant execute on function public.is_member(uuid) to anon, authenticated, strappy_worker;
grant execute on function public.has_perm(uuid, text) to anon, authenticated, strappy_worker;
grant execute on function public.role_permissions(text) to anon, authenticated, strappy_worker;
grant execute on function public.current_workspace() to anon, authenticated, strappy_worker;

-- -----------------------------------------------------------------------------
-- 2 · assert_workspace falla cerrado con los roles de la API
-- -----------------------------------------------------------------------------
create or replace function public.assert_workspace(ws uuid)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  declared uuid := public.current_workspace();
begin
  if declared is null then
    if current_user in ('strappy_worker', 'anon', 'authenticated') then
      raise exception 'app.workspace_id no declarado: use SET LOCAL app.workspace_id antes de operar'
        using errcode = '42501';
    end if;
    return; -- rol de servicio / postgres en tareas de mantenimiento
  end if;
  if declared <> ws then
    raise exception 'cruce de tenant bloqueado: app.workspace_id=% pero la operacion apunta a %', declared, ws
      using errcode = '42501';
  end if;
end;
$$;

-- Días de retención: nunca negativos ni cero, que vaciaban todas las particiones.
create or replace function public.drop_expired_webhook_partitions(p_keep_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cutoff date := date_trunc('month', now() - make_interval(days => greatest(p_keep_days, 1)))::date;
  r record;
  n integer := 0;
begin
  for r in
    select c.relname
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    join pg_namespace ns on ns.oid = p.relnamespace
    where ns.nspname = 'public' and p.relname = 'webhook_events'
      and c.relname ~ '^webhook_events_\d{6}$'
      and to_date(substring(c.relname from '\d{6}$'), 'YYYYMM') < date_trunc('month', cutoff)::date
  loop
    execute format('drop table if exists public.%I', r.relname);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.drop_expired_webhook_partitions(integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3 · Nadie se asciende a sí mismo
-- -----------------------------------------------------------------------------
-- Corre solo cuando actúa un usuario de la API (rol `authenticated`). El
-- trigger de alta (`handle_new_user`), las migraciones y el worker siguen
-- creando y editando membresías como hasta ahora.
--
-- SECURITY INVOKER a propósito: con DEFINER, `current_user` sería el dueño de
-- la función y la guardia no sabría que quien escribe es `authenticated`. La
-- lectura de `memberships` que hace pasa por RLS, y un miembro siempre ve las
-- membresías de su espacio (`memberships_read`).
create or replace function public.guard_membership_privileges()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_ws uuid := coalesce(new.workspace_id, old.workspace_id);
  v_actor_es_owner boolean;
  v_reservados text[] := array['*', 'billing.manage', 'workspace.delete'];
begin
  if current_user <> 'authenticated' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_actor_es_owner := exists (
    select 1 from public.memberships m
     where m.workspace_id = v_ws and m.user_id = v_actor
       and m.status = 'active' and m.role = 'owner');

  -- Uno no edita su propia membresía: ni rol, ni permisos, ni estado.
  if tg_op = 'UPDATE' and old.user_id = v_actor then
    raise exception 'no puedes cambiar tu propia membresia' using errcode = '42501';
  end if;

  -- Tocar a un owner (cambiarlo, quitarle el rol, borrarlo) es cosa de owners.
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' and not v_actor_es_owner then
    raise exception 'solo un owner puede modificar a otro owner' using errcode = '42501';
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    -- Conceder owner, o permisos reservados al owner, exige serlo.
    if new.role = 'owner' and not v_actor_es_owner then
      raise exception 'solo un owner puede nombrar owners' using errcode = '42501';
    end if;
    if new.permissions && v_reservados and not v_actor_es_owner then
      raise exception 'solo un owner puede conceder permisos de facturacion o borrado' using errcode = '42501';
    end if;
    -- Y no se cambia de espacio una membresía.
    if tg_op = 'UPDATE' and (new.workspace_id <> old.workspace_id or new.user_id <> old.user_id) then
      raise exception 'una membresia no se mueve de espacio ni de usuario' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.guard_membership_privileges() from public, anon, authenticated;

drop trigger if exists guard_membership_privileges on public.memberships;
create trigger guard_membership_privileges
  before insert or update or delete on public.memberships
  for each row execute function public.guard_membership_privileges();

comment on function public.guard_membership_privileges() is
  'Impide que un usuario de la API se ascienda, toque a un owner sin serlo, o edite su propia membresia.';
