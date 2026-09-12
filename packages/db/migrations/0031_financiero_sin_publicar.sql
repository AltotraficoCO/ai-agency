-- =============================================================================
-- 0031 · El agente financiero no se ofrece hasta que se pueda ejecutar
-- =============================================================================
-- La 0030 lo publicó en el catálogo, pero el worker todavía no sabe ejecutar su
-- oficio: solo tiene bucle el Webmaster y el de Marketing. Contratarlo hoy sería
-- vender un empleado que no puede trabajar, y el primer encargo terminaría en un
-- error.
--
-- Se deja creado y despublicado: su ficha, su categoría y su plantilla ya están
-- bien, así que enchufarlo el día que tenga bucle es poner `is_published` en
-- true, no volver a escribirlo.
--
-- Reaplicarla es inocuo.
-- =============================================================================

update public.catalog_agents
   set is_published = false,
       updated_at   = now()
 where slug = 'administrativo';
