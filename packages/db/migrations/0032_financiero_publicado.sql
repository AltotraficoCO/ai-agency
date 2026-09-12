-- =============================================================================
-- 0032 · El agente financiero vuelve al catálogo
-- =============================================================================
-- La 0031 lo despublicó porque el worker no sabía ejecutar su oficio: estaba
-- construido y probado, pero un encargo suyo no habría hecho nada. Ya tiene su
-- bucle (`@strappy/administrativo/loop`), el worker lo enruta y se le puede
-- delegar trabajo desde otro agente, así que se puede ofrecer.
--
-- Sigue sin poder trabajar hasta que el cliente conecte su sistema de
-- facturación, y eso se dice ANTES de contratarlo (la ficha lista «Alegra» como
-- conexión necesaria) y también durante el encargo, con sus palabras, en vez de
-- fallar con un error técnico.
--
-- Reaplicarla es inocuo.
-- =============================================================================

update public.catalog_agents
   set is_published = true,
       updated_at   = now()
 where slug = 'administrativo';
