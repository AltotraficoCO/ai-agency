-- La ficha de Marketing se sembró sin eñe («campanas»), y así se veía en el
-- catálogo. El seed ya está corregido para instalaciones nuevas; esto arregla
-- las que ya lo tenían.
update public.catalog_agents
   set tagline = 'Redacta, publica y mide campañas',
       description = replace(description, 'mensajes de campana', 'mensajes de campaña')
 where slug = 'marketing';
