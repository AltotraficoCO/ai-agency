-- =============================================================================
-- 0038 · El Administrativo deja de tener la cara de un agente del cliente
-- =============================================================================
-- La 0037 le dio `/avatares/whatsapp/05.webp`, que en el espacio de Altotrafico
-- es EXACTAMENTE la cara de «Betty», un agente de WhatsApp del cliente. Ver al
-- mismo personaje atendiendo tu WhatsApp y llevandote la contabilidad rompe la
-- idea que vende el producto: que cada agente es alguien distinto.
--
-- Se le pasa a la 06, que hoy no usa ningun agente del espacio ni ninguna otra
-- ficha del catalogo. Quedan libres la 04 y la 10 para los que vengan.
--
-- Esto es un parche honesto, no la solucion: el Disenador, el Velocista, el
-- Administrativo y Reportes siguen con caras prestadas de la serie de WhatsApp,
-- mientras que el Webmaster y Marketing tienen personaje propio. El arreglo de
-- verdad son cuatro piezas nuevas en `public/agentes/` y cambiar estas lineas.
--
-- Reaplicarla es inocuo.
-- =============================================================================

update public.catalog_agents
   set avatar_url = '/avatares/whatsapp/06.webp',
       updated_at = now()
 where slug = 'administrativo'
   and avatar_url = '/avatares/whatsapp/05.webp';
