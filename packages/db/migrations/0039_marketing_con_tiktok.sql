-- =============================================================================
-- 0039 · El agente de Marketing también mira TikTok
-- =============================================================================
-- La ficha de 0028 nombraba dos plataformas porque eran las dos que había
-- detrás de los puertos. Ya hay adaptador para las tres (Google Ads, Meta y
-- TikTok) y flujo de conexión para las tres en Ajustes → Canales, así que la
-- descripción que lee el cliente antes de contratar tiene que decirlo: si
-- alguien anuncia en TikTok y no lo ve en la ficha, no contrata.
--
-- `connections.provider` es texto libre y no tiene lista cerrada, así que la
-- plataforma nueva no necesita ningún cambio de esquema: las filas de
-- `tiktok_ads` se guardan como las de las otras dos.
-- =============================================================================

update public.catalog_agents
   set tagline     = 'Vigila en qué se va tu inversión en anuncios',
       description = 'Revisa tus campañas de Google Ads, de Facebook e Instagram y de TikTok, te dice cuánto te cuesta cada cliente y cuál campaña gasta sin traer nada, y propone los cambios de presupuesto. Nunca mueve tu dinero sin que lo apruebes.',
       updated_at  = now()
 where slug = 'marketing';
