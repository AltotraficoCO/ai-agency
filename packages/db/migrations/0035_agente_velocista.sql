-- =============================================================================
-- 0035 · El Velocista entra al catálogo
-- =============================================================================
-- Ampliación del departamento de Desarrollo, que hasta ahora solo tenía al
-- Webmaster. El cliente lo pidió así: «Desarrollo solamente tiene un agente de
-- webmaster, pero debería tener más… algo para que la persona entre y diga:
-- wow, sí, vale la pena contratar».
--
-- De todo el catálogo diseñado (docs/producto/catalogo-de-agentes.md) este es de
-- los que se pueden entregar ya: mide con PageSpeed Insights, cuya clave es
-- gratuita y no exige ningún trámite de aprobación, y arregla sobre el WordPress
-- que ya sabemos tocar.
--
-- La categoría es 'desarrollo', que ya cae en ese departamento del menú
-- (packages/ui/src/layout/departamentos.ts).
--
-- `required_tools` son las herramientas que el MOTOR exige conectadas; las de
-- este agente viven en @strappy/velocista y no en el registro de sistema, así
-- que la lista queda vacía.
--
-- Se emite como insert idempotente: si alguien reaplica la migración, actualiza
-- en vez de fallar.
-- =============================================================================

insert into public.catalog_agents
  (slug, name, tagline, description, agent_type, category,
   required_tools, monthly_credits, setup_credits, position, spec_template)
values
  ('velocista', 'Velocista',
   'Hace que tu página cargue rápido, que es lo que decide si te compran',
   'Mide cuánto tarda tu web en abrir en un celular, te explica en castellano qué la está frenando (imágenes pesadas, falta de caché, el servidor) y arregla lo que se puede arreglar sin tocar tu diseño. Después vuelve a medir y te enseña el antes y el después. Nunca instala nada sin que lo apruebes.',
   'task', 'desarrollo',
   array[]::text[],
   0, 0, 50,
   '{"persona":{"tone":"cercano","language":"es-CO"},
     "goals":["medir la velocidad real de las paginas que importan",
              "explicar sin jerga que esta frenando la web",
              "activar la cache y proponer los arreglos que valen la pena",
              "volver a medir y ensenar el antes y el despues"],
     "guardrails":["nunca opinar de velocidad sin haber medido en esta misma tarea",
                   "nunca instalar ni activar nada sin aprobacion humana y sin copia previa",
                   "nunca desactivar un complemento por su cuenta: puede ser el que cobra",
                   "distinguir siempre si una cifra viene de gente real o de una prueba",
                   "decir cuando algo es del hosting y no se arregla desde WordPress",
                   "no prometer mejoras que no se midieron"]}'::jsonb)
on conflict (slug) do update
  set name           = excluded.name,
      tagline        = excluded.tagline,
      description    = excluded.description,
      agent_type     = excluded.agent_type,
      category       = excluded.category,
      required_tools = excluded.required_tools,
      position       = excluded.position,
      spec_template  = excluded.spec_template,
      updated_at     = now();
