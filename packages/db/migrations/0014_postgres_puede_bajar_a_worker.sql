-- -----------------------------------------------------------------------------
-- El rol de conexión tiene que poder BAJAR a strappy_worker.
--
-- `conEspacio()` abre cada transacción con `SET LOCAL ROLE strappy_worker`. En
-- local se conecta un superusuario y eso siempre funciona; en Supabase se
-- conecta `postgres`, que NO es superusuario.
--
-- Desde Postgres 16, quien crea un rol recibe una membresía implícita con ADMIN
-- pero con SET e INHERIT en falso: puede administrarlo, no convertirse en él.
-- El resultado en producción era `permission denied to set role
-- "strappy_worker"` en cuanto un usuario real abría cualquier pantalla.
--
-- Se concede SET y se deja INHERIT en falso a propósito: `postgres` no debe
-- heredar los permisos del worker, solo poder asumirlo dentro de la transacción.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    grant strappy_worker to postgres with set true, inherit false;
  end if;
end
$$;
