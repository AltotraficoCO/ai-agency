-- =============================================================================
-- 0010_seed.sql · Datos iniciales de plataforma (globales, sin tenant)
-- -----------------------------------------------------------------------------
-- Idempotente: se puede reaplicar sin duplicar nada.
-- =============================================================================

-- En Supabase las extensiones viven en el esquema `extensions`. Los tipos y las
-- clases de operadores (vector, gin_trgm_ops...) se resuelven en el momento del
-- DDL, asi que `extensions` tiene que estar en el search_path AL APLICAR. En un
-- Postgres pelado el esquema no existe y la linea es inocua.
set search_path = public, extensions, pg_temp;

-- =============================================================================
-- 1 · Tarifario
-- -----------------------------------------------------------------------------
-- 1 credito = 0,001 USD de precio de venta.  MARGEN = 3,0x sobre coste.
--     creditos_por_ktoken = usd_por_millon_de_tokens x 3
-- Comprobacion: glm-4.7-flash entrada 0,07 USD/Mtok
--     0,07/1.000 = 0,00007 USD/ktok · x3 = 0,00021 USD · /0,001 = 0,21 creditos.
--
-- El 3,0x no es codicia: sobre el coste del modelo hay que pagar embeddings,
-- almacenamiento de conocimiento, ingesta de webhooks, Realtime y soporte, y
-- absorber subidas de precio del proveedor sin retarifar a los clientes.
--
-- La lectura de cache se factura al 10% de la entrada, que es aproximadamente
-- lo que cobran los proveedores por prompt cacheado.
--
-- effective_from fijo en 2026-01-01 para que reaplicar la semilla sea inocuo.
-- Para cambiar un precio NO se edita esta fila: se pone su effective_to y se
-- inserta otra (lo impide el trigger guard_credit_rate_immutable).
-- =============================================================================
insert into public.credit_rates (kind, ref_key, unit, credits_per_unit, description, effective_from) values
  -- Lite · primario
  ('model_input',      'zai/glm-4.7-flash',            'ktoken', 0.210000, 'GLM-4.7 Flash entrada (0,07 USD/Mtok x3)',      '2026-01-01T00:00:00Z'),
  ('model_output',     'zai/glm-4.7-flash',            'ktoken', 1.200000, 'GLM-4.7 Flash salida (0,40 USD/Mtok x3)',       '2026-01-01T00:00:00Z'),
  ('model_cache_read', 'zai/glm-4.7-flash',            'ktoken', 0.021000, 'GLM-4.7 Flash cache (10% de entrada)',          '2026-01-01T00:00:00Z'),
  -- Lite · respaldo
  ('model_input',      'deepseek/deepseek-v4-flash',   'ktoken', 0.390000, 'DeepSeek V4 Flash entrada (0,13 USD/Mtok x3)',  '2026-01-01T00:00:00Z'),
  ('model_output',     'deepseek/deepseek-v4-flash',   'ktoken', 0.780000, 'DeepSeek V4 Flash salida (0,26 USD/Mtok x3)',   '2026-01-01T00:00:00Z'),
  ('model_cache_read', 'deepseek/deepseek-v4-flash',   'ktoken', 0.039000, 'DeepSeek V4 Flash cache (10% de entrada)',      '2026-01-01T00:00:00Z'),
  -- Max · primario
  ('model_input',      'anthropic/claude-sonnet-5',    'ktoken',  6.000000, 'Claude Sonnet 5 entrada (2,00 USD/Mtok x3)',   '2026-01-01T00:00:00Z'),
  ('model_output',     'anthropic/claude-sonnet-5',    'ktoken', 30.000000, 'Claude Sonnet 5 salida (10,00 USD/Mtok x3)',   '2026-01-01T00:00:00Z'),
  ('model_cache_read', 'anthropic/claude-sonnet-5',    'ktoken',  0.600000, 'Claude Sonnet 5 cache (10% de entrada)',       '2026-01-01T00:00:00Z'),
  -- Max · respaldo
  ('model_input',      'anthropic/claude-opus-5',      'ktoken', 15.000000, 'Claude Opus 5 entrada (5,00 USD/Mtok x3)',     '2026-01-01T00:00:00Z'),
  ('model_output',     'anthropic/claude-opus-5',      'ktoken', 75.000000, 'Claude Opus 5 salida (25,00 USD/Mtok x3)',     '2026-01-01T00:00:00Z'),
  ('model_cache_read', 'anthropic/claude-opus-5',      'ktoken',  1.500000, 'Claude Opus 5 cache (10% de entrada)',         '2026-01-01T00:00:00Z'),
  -- Embeddings
  ('embedding',        'openai/text-embedding-3-small','ktoken',  0.060000, 'Embeddings (0,02 USD/Mtok x3)',                '2026-01-01T00:00:00Z'),
  -- Conceptos de plataforma
  ('tool_call',        '*',                            'run',     1.000000, 'Invocacion de herramienta (0,001 USD)',        '2026-01-01T00:00:00Z'),
  -- WhatsApp va a CERO a proposito, no por olvido: operamos como Tech Provider,
  -- el WABA y el metodo de pago son del cliente y Meta le cobra a el directamente.
  -- Cobrarle aqui seria cobrarle dos veces por el mismo mensaje. Su gasto real en
  -- Meta se le muestra aparte, leido de waba_analytics_daily.
  ('message_out',      'whatsapp',                     'message', 0.000000, 'Lo cobra Meta directamente al cliente; nosotros no revendemos mensajeria', '2026-01-01T00:00:00Z'),
  ('message_out',      '*',                            'message', 0.000000, 'Canales sin coste por mensaje',                '2026-01-01T00:00:00Z')
on conflict (kind, ref_key, effective_from) do nothing;

-- =============================================================================
-- 2 · Modelos por modo y tarea
-- =============================================================================
insert into public.model_tiers (mode, task, provider, primary_model, fallback_models, params, max_tokens, notes) values
  ('lite','chat',      'zai',      'zai/glm-4.7-flash',            array['deepseek/deepseek-v4-flash'],                          '{"temperature":0.4}', 2048, 'Respuesta conversacional en modo economico'),
  ('lite','classify',  'zai',      'zai/glm-4.7-flash',            array['deepseek/deepseek-v4-flash'],                          '{"temperature":0.0}',  256, 'Clasificacion de intencion y enrutado'),
  ('lite','extract',   'zai',      'zai/glm-4.7-flash',            array['deepseek/deepseek-v4-flash'],                          '{"temperature":0.0}', 1024, 'Extraccion estructurada'),
  ('lite','summarize', 'zai',      'zai/glm-4.7-flash',            array['deepseek/deepseek-v4-flash'],                          '{"temperature":0.2}', 1024, 'Resumen del hilo'),
  ('lite','title',     'zai',      'zai/glm-4.7-flash',            array['deepseek/deepseek-v4-flash'],                          '{"temperature":0.3}',   64, 'Titulo corto de conversacion'),
  ('lite','build',     'zai',      'zai/glm-4.7-flash',            array['deepseek/deepseek-v4-flash','minimax/minimax-m2.7'],   '{"temperature":0.5}', 8192, 'Lite es la familia economica tambien al construir: es lo que sostiene el margen del plan gratuito. Que modelo concreto rinde mejor construyendo en espanol se decide con evaluaciones sobre conversaciones reales, no por precio ni por intuicion'),
  ('lite','embed',     'openai',   'openai/text-embedding-3-small',array[]::text[],                                              '{}',                  null, 'Embeddings de conocimiento'),
  ('max','chat',       'anthropic','anthropic/claude-sonnet-5',    array['anthropic/claude-opus-5','zai/glm-4.7-flash'],         '{"temperature":0.4}', 4096, 'Respuesta conversacional de maxima calidad'),
  ('max','classify',   'anthropic','anthropic/claude-sonnet-5',    array['zai/glm-4.7-flash'],                                   '{"temperature":0.0}',  256, null),
  ('max','extract',    'anthropic','anthropic/claude-sonnet-5',    array['anthropic/claude-opus-5'],                             '{"temperature":0.0}', 2048, null),
  ('max','summarize',  'anthropic','anthropic/claude-sonnet-5',    array['zai/glm-4.7-flash'],                                   '{"temperature":0.2}', 2048, null),
  ('max','title',      'zai',      'zai/glm-4.7-flash',            array['anthropic/claude-sonnet-5'],                           '{"temperature":0.3}',   64, 'Titular no justifica un modelo caro ni en modo max'),
  ('max','build',      'anthropic','anthropic/claude-opus-5',      array['anthropic/claude-sonnet-5'],                           '{"temperature":0.5}',16384, 'Meta-agente en modo max'),
  ('max','embed',      'openai',   'openai/text-embedding-3-small',array[]::text[],                                              '{}',                  null, 'El embedding no cambia por modo: cambiarlo obligaria a reindexar todo')
on conflict (mode, task) do nothing;

-- =============================================================================
-- 3 · Herramientas de sistema (workspace_id nulo = globales)
-- =============================================================================
insert into public.tools (workspace_id, slug, name, description, kind, input_schema) values
  (null, 'handover_to_human', 'Pasar a un humano',
   'Escala la conversacion a una persona y silencia al bot.', 'handover',
   '{"type":"object","properties":{"reason":{"type":"string"},"team":{"type":"string"}},"required":["reason"]}'),
  (null, 'search_knowledge', 'Buscar en el conocimiento',
   'Busca en las bases conectadas al agente con recuperacion hibrida.', 'builtin',
   '{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}'),
  (null, 'save_contact_data', 'Guardar datos del contacto',
   'Escribe propiedades en la ficha del contacto.', 'builtin',
   '{"type":"object","properties":{"properties":{"type":"object"}},"required":["properties"]}'),
  (null, 'schedule_followup', 'Programar seguimiento',
   'Agenda una nueva ejecucion del agente en el futuro.', 'schedule',
   '{"type":"object","properties":{"delay_minutes":{"type":"integer"},"note":{"type":"string"}},"required":["delay_minutes"]}'),
  (null, 'tag_conversation', 'Etiquetar conversacion',
   'Aplica una etiqueta del espacio a la conversacion en curso.', 'builtin',
   '{"type":"object","properties":{"tag":{"type":"string"}},"required":["tag"]}')
on conflict (slug) where workspace_id is null do nothing;

-- =============================================================================
-- 4 · Catalogo de agentes contratables
-- =============================================================================
insert into public.catalog_agents
  (slug, name, tagline, description, agent_type, category, required_tools, monthly_credits, setup_credits, position, spec_template)
values
  ('recepcionista', 'Recepcionista',
   'Atiende, califica y agenda por WhatsApp',
   'Responde a todo el que escribe, resuelve dudas frecuentes con el conocimiento del negocio, toma los datos del interesado y agenda o escala a una persona cuando hace falta.',
   'conversational', 'ventas',
   array['handover_to_human','search_knowledge','save_contact_data','schedule_followup'],
   0, 0, 10,
   '{"persona":{"tone":"cercano","language":"es-CO"},
     "goals":["resolver dudas frecuentes","tomar datos de contacto","agendar o escalar"],
     "guardrails":["no inventar precios","no prometer plazos sin confirmar"],
     "handover":{"on_request":true,"on_complaint":true}}'),

  ('webmaster', 'Webmaster',
   'Vigila y mantiene tu sitio web',
   'Revisa disponibilidad, certificados y formularios del sitio, avisa cuando algo se cae y ejecuta tareas de mantenimiento por encargo.',
   'task', 'operaciones',
   array['handover_to_human'],
   0, 0, 20,
   '{"persona":{"tone":"neutro","language":"es-CO"},
     "goals":["detectar caidas","mantener el sitio al dia","reportar cambios"],
     "guardrails":["hacer copia antes de cualquier cambio","pedir aprobacion en cambios visibles"],
     "schedule":{"cron":"0 */6 * * *"}}'),

  ('marketing', 'Marketing',
   'Redacta, publica y mide campanas',
   'Prepara contenidos y mensajes de campana, segmenta contactos por lo aprendido en las conversaciones y reporta resultados.',
   'task', 'crecimiento',
   array['search_knowledge','save_contact_data'],
   0, 0, 30,
   '{"persona":{"tone":"cercano","language":"es-CO"},
     "goals":["proponer contenidos","segmentar contactos","medir resultados"],
     "guardrails":["respetar bajas y opt-out","no enviar fuera del horario del espacio"]}')
on conflict (slug) do nothing;

-- =============================================================================
-- 5 · Particiones del mes en curso y siguientes
-- =============================================================================
select public.ensure_month_partitions(3);
