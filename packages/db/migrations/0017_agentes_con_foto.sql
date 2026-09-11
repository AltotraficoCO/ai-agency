-- ============================================================================
-- 0017 · En WhatsApp no se contratan agentes, se crean. Y cada uno tiene cara.
-- ============================================================================
-- Decisión de producto (2026-09-11): la Recepcionista sale del catálogo. Los
-- agentes que atienden por WhatsApp los crea la persona con Strap; el catálogo
-- solo ofrece agentes del negocio (Webmaster, Marketing). Quien ya la hubiera
-- contratado conserva su agente: no se borra nada, solo deja de ofrecerse.
--
-- Además, cada agente de WhatsApp lleva una foto de plastilina
-- (`/avatares/whatsapp/01..10.webp`). Los que ya existían sin foto reciben una
-- repartida de forma estable por su id: la misma migración aplicada dos veces
-- asigna lo mismo, y la que ya tiene foto no se toca.
-- ============================================================================

update public.catalog_agents
   set is_published = false,
       updated_at = now()
 where slug = 'recepcionista'
   and is_published;

update public.agents
   set avatar_url = '/avatares/whatsapp/'
                    || lpad(((abs(hashtext(id::text)) % 10) + 1)::text, 2, '0')
                    || '.webp',
       updated_at = now()
 where agent_type = 'conversational'
   and (avatar_url is null or avatar_url = '');
