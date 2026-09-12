-- =============================================================================
-- 0037 · Cada agente del catálogo tiene cara
-- =============================================================================
-- `catalog_agents.avatar_url` existe desde 0003 y estaba VACÍO en los siete
-- agentes. La cara se pintaba desde un diccionario escrito a mano en la
-- interfaz, que solo conocía a webmaster y marketing: los cinco agentes nuevos
-- salían con el robot genérico, y cada agente nuevo obligaba a tocar código.
--
-- Desde aquí la cara es un dato. La interfaz la lee de esta columna y el
-- diccionario queda solo para el halo de color.
--
-- Las imágenes son las que ya existen en `apps/web/public`. Webmaster y
-- Marketing tienen personaje propio de plastilina; los demás toman prestada una
-- de la serie de WhatsApp, sin repetir, hasta que tengan el suyo. Queda dicho:
-- son prestadas, y sustituirlas es cambiar esta columna, no desplegar código.
-- =============================================================================

update public.catalog_agents set avatar_url = v.imagen, updated_at = now()
  from (values
    ('webmaster',      '/agentes/webmaster-plastilina.webp'),
    ('marketing',      '/agentes/marketing-plastilina.webp'),
    -- Prestadas de la serie de WhatsApp, una distinta cada una: dos agentes con
    -- la misma cara en la misma pantalla se confunden al mirarlos.
    ('disenador',      '/avatares/whatsapp/03.webp'),
    ('velocista',      '/avatares/whatsapp/07.webp'),
    ('administrativo', '/avatares/whatsapp/05.webp'),
    ('reportes',       '/avatares/whatsapp/09.webp'),
    ('recepcionista',  '/avatares/whatsapp/02.webp')
  ) as v(slug, imagen)
 where public.catalog_agents.slug = v.slug
   and public.catalog_agents.avatar_url is distinct from v.imagen;
