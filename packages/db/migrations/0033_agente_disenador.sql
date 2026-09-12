-- =============================================================================
-- 0033 · El Diseñador entra al catálogo, y con él los modelos de imagen
-- =============================================================================
-- Primer agente de la ampliación del catálogo (docs/producto/catalogo-de-agentes.md).
-- Se eligió el primero por una razón concreta: la colaboración entre agentes ya
-- existe (`pedir_ayuda_a_companero`) pero no había a quién pedirle ayuda. El
-- Diseñador es el compañero natural del Webmaster —escribe el artículo y le
-- encarga la portada— y no depende de ningún trámite con terceros.
--
-- La categoría es 'diseno', que ya cae en el departamento de Desarrollo del
-- menú (packages/ui/src/layout/departamentos.ts).
--
-- `required_tools` son las herramientas que el MOTOR exige conectadas; las de
-- este agente viven en @strappy/disenador y no en el registro de sistema, así
-- que la lista se queda vacía.
-- =============================================================================

insert into public.catalog_agents
  (slug, name, tagline, description, agent_type, category,
   required_tools, monthly_credits, setup_credits, position, spec_template)
values
  ('disenador', 'Diseñador',
   'Te hace las imágenes que tu web y tus redes necesitan',
   'Crea portadas para tus artículos, piezas para tus publicaciones y cabeceras para tus páginas, con los colores reales de tu marca (los mide de tu propia web). Te las enseña antes y las sube a tu sitio cuando las apruebas. El Webmaster puede pedirle la portada de un artículo mientras lo escribe.',
   'task', 'diseno',
   array[]::text[],
   0, 0, 25,
   '{"persona":{"tone":"cercano","language":"es-CO"},
     "goals":["hacer imagenes con los colores reales de la marca del cliente",
              "entregar la imagen subida al sitio y con su id, no una descripcion",
              "ayudar al Webmaster con las portadas de sus articulos"],
     "guardrails":["nunca subir una imagen al sitio del cliente sin aprobacion humana",
                   "nunca reemplazar una imagen existente salvo que el cliente lo pida",
                   "toda imagen subida lleva texto alternativo",
                   "no dibujar variaciones de mas: cada imagen cuesta creditos y hay tope por encargo",
                   "no escribir texto largo dentro de la imagen ni inventar logotipos",
                   "decirlo cuando no se pudieron medir los colores del sitio"]}'::jsonb)
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

-- -----------------------------------------------------------------------------
-- El modelo de imagen, como todos: en datos, nunca en el código
-- -----------------------------------------------------------------------------
-- Fila `imagen`, la que resuelve `ModelTask = "image"` (packages/db/src/adapters/
-- model-table.ts). El worker la lee igual que lee `negocio` para el texto.
--
-- google/gemini-3.1-flash-image es el más barato de los que devuelven imagen en
-- OpenRouter a 12-sep-2026 (comprobado contra su catálogo público). Sin cadena
-- de respaldo a propósito: si un día falla, es mejor que el agente lo diga a que
-- entregue una imagen de otro modelo con otro aspecto sin avisar.
insert into public.model_tiers (mode, task, provider, primary_model, fallback_models, params, max_tokens, notes) values
  ('lite', 'imagen', 'google', 'google/gemini-3.1-flash-image', array[]::text[], '{}', null,
   'Imágenes del agente Diseñador. El modelo de texto sale de la fila negocio; este solo dibuja'),
  ('max',  'imagen', 'google', 'google/gemini-3.1-flash-image', array[]::text[], '{}', null,
   'Imágenes del agente Diseñador. Mismo modelo en max: la calidad de una portada no mejora por pagar el doble')
on conflict (mode, task) do update
  set provider        = excluded.provider,
      primary_model   = excluded.primary_model,
      fallback_models = excluded.fallback_models,
      notes           = excluded.notes,
      updated_at      = now();

-- -----------------------------------------------------------------------------
-- Lo que se le cobra al cliente por una imagen
-- -----------------------------------------------------------------------------
-- Una imagen NO se tarifica por tokens de conversación: se cobra por pieza, con
-- el mismo margen del 20% que el resto (migración 0025).
--
--   OpenRouter cobra 0,00006 USD por token de imagen de salida y una imagen de
--   Gemini son ~1.290 tokens → 0,0774 USD de coste.
--   0,0774 x 1,2 = 0,0929 USD de venta → 93 créditos (1 crédito = 0,001 USD).
--
-- Se cobran 100, redondeando hacia arriba: el tamaño real en tokens varía con la
-- proporción de la imagen, y el error barato es cobrar de más y ajustarlo
-- después, no regalar imágenes en silencio. Es también lo que declara la
-- herramienta `img_generar` en el código, que es lo que hoy aplica el cobro; esta
-- fila lo deja documentado y listo para cuando `cargarTarifas` lea `tool_call`.
insert into public.credit_rates (kind, ref_key, unit, credits_per_unit, description, effective_from)
select 'tool_call', 'img_generar', 'run', 100.000000,
       'Una imagen del Diseñador (~1.290 tokens a 0,00006 USD x1,2, redondeado al alza)',
       '2026-09-12T00:00:00Z'
 where not exists (
   select 1 from public.credit_rates r
    where r.kind = 'tool_call' and r.ref_key = 'img_generar' and r.effective_to is null
 );
