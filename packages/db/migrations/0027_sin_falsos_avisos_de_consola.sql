-- =============================================================================
-- 0027 · Fuera los avisos de consola del criterio viejo
-- =============================================================================
-- En su PRIMERA ronda, la vigilancia avisó de «Hay un fallo en la portada» a un
-- sitio sano: portada 200 en 170 ms, credenciales bien y certificado con 70
-- dias. Lo unico que habia era UN mensaje en la consola del navegador,
-- «Failed to load resource: … 404», es decir un archivo que la plantilla pide
-- y no existe. El propio Webmaster ya lo habia visto antes y lo descarto como
-- irrelevante.
--
-- El criterio nuevo (packages/webmaster/src/vigilancia/decidir.ts) separa las
-- excepciones de JavaScript, que avisan desde la primera, de los archivos que
-- no llegan, que solo avisan a partir de cinco.
--
-- Estos avisos se BORRAN en vez de marcarse como leidos: son falsos, y dejar
-- un historial de alarmas que no existieron es justo lo que hace que el cliente
-- deje de creerse las que si importan. Solo se tocan los de clave `consola:%`
-- anteriores a esta migracion; los de caida, certificado, credenciales y
-- complementos se quedan como estan.
--
-- Reaplicarla es inocuo: los avisos del criterio nuevo llevan clave
-- `consola:js:<n>` o `consola:recursos:<n>` y son posteriores a esta fecha.
-- =============================================================================

delete from public.site_alerts
 where clave like 'consola:%'
   and created_at < now();

-- La vigilancia recuerda cuando aviso de consola por ultima vez para no repetir
-- lo mismo cada semana. Ese recuerdo lo dejo puesto el aviso falso, asi que el
-- sitio se quedaria callado hasta una semana despues aunque apareciera una
-- excepcion de verdad. Se borra la marca, no el resto del estado: lo que sabe
-- de caidas, certificado y complementos sigue intacto.
update public.site_monitor
   set estado = estado - 'consolaAvisadaEn',
       updated_at = now()
 where estado ? 'consolaAvisadaEn';
