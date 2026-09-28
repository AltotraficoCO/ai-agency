-- =============================================================================
-- 0051 · El rol de la aplicación puede usar pgvector
-- =============================================================================
-- pgvector vive en el esquema `extensions` (0006), y Supabase da permiso de uso
-- sobre ese esquema a sus propios roles, no a `strappy_worker` (0001), que es
-- el rol al que BAJAN la web y el worker en cada transacción de un espacio.
--
-- Sin esto, nada que nombre el tipo `vector` funciona con ese rol:
--   · guardar fragmentos del conocimiento («permission denied for schema
--     extensions»), también en modo solo texto con el vector a NULL, así que
--     ninguna fuente se aprendía;
--   · `search_knowledge`, que es security invoker y recibe un `vector`, así que
--     los agentes respondían sin conocimiento.
--
-- Solo USAGE: permite usar el tipo, sus operadores y sus funciones. No permite
-- crear ni tocar nada del esquema.
-- =============================================================================

grant usage on schema extensions to strappy_worker;
grant usage on schema extensions to authenticated;
