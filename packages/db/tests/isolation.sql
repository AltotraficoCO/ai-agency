-- =============================================================================
-- tests/isolation.sql · CRITERIO DE ACEPTACION del aislamiento multi-tenant
-- -----------------------------------------------------------------------------
-- Crea dos espacios de trabajo completos con datos en TODAS las tablas de
-- negocio y comprueba que ninguno ve ni toca nada del otro, ni como usuario ni
-- como worker. Si este fichero falla, la fase esta bloqueada.
--
--   psql -v ON_ERROR_STOP=1 -f packages/db/tests/isolation.sql "$DATABASE_URL"
--
-- Todo ocurre dentro de una transaccion que termina en ROLLBACK: no deja rastro.
-- Hay que ejecutarlo con un rol superusuario o propietario del esquema, porque
-- necesita hacer SET ROLE a authenticated y a strappy_worker.
-- =============================================================================

\set ON_ERROR_STOP on
\timing off

begin;

-- Los avisos de progreso deben verse: son el informe del test.
set local client_min_messages = notice;

create or replace function pg_temp.assert(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FALLO DE AISLAMIENTO: %', msg using errcode = 'P0001';
  end if;
end;
$$;

create or replace function pg_temp.login(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Siembra: una fila en cada tabla de negocio del espacio indicado.
-- -----------------------------------------------------------------------------
create or replace function pg_temp.seed_ws(p_ws uuid, p_tag text, p_user uuid)
returns void language plpgsql as $$
declare
  v_channel  uuid; v_acct uuid; v_agent uuid; v_ver uuid;
  v_contact  uuid; v_conv uuid; v_msg uuid; v_brain uuid; v_source uuid;
  v_tool     uuid; v_conn uuid; v_run uuid; v_team uuid; v_tag uuid;
  v_auto     uuid; v_schema uuid;
begin
  insert into public.channels (workspace_id, kind, name, status)
    values (p_ws, 'whatsapp', p_tag || ' WhatsApp', 'connected') returning id into v_channel;

  insert into public.whatsapp_accounts (workspace_id, channel_id, waba_id, name)
    values (p_ws, v_channel, 'waba-' || p_tag, p_tag) returning id into v_acct;

  insert into public.company_profiles (workspace_id, legal_name, brand_name)
    values (p_ws, p_tag || ' SAS', p_tag);

  insert into public.agents (workspace_id, name, agent_type)
    values (p_ws, p_tag || ' Bot', 'conversational') returning id into v_agent;

  insert into public.agent_versions (workspace_id, agent_id, spec, compiled_prompt, prompt_hash, changelog)
    values (p_ws, v_agent, jsonb_build_object('tag', p_tag), 'prompt de ' || p_tag,
            md5(p_tag), 'inicial') returning id into v_ver;
  update public.agents set active_version_id = v_ver, status = 'published' where id = v_agent;

  -- El numero dispara el trigger que mantiene channel_routing.
  insert into public.whatsapp_numbers
    (workspace_id, account_id, channel_id, phone_number_id, display_phone_number, agent_id, is_default)
    values (p_ws, v_acct, v_channel, 'pn-' || p_tag, '+57300' || length(p_tag)::text, v_agent, true);

  insert into public.agent_drafts (workspace_id, agent_id, spec) values (p_ws, v_agent, '{}'::jsonb);
  insert into public.agent_variables (workspace_id, agent_id, key) values (p_ws, v_agent, 'nombre');

  insert into public.brains (workspace_id, name) values (p_ws, p_tag || ' base') returning id into v_brain;
  insert into public.brain_sources (workspace_id, brain_id, title, raw_content, content_hash)
    values (p_ws, v_brain, p_tag || ' doc', 'contenido de ' || p_tag, md5(p_tag)) returning id into v_source;
  insert into public.brain_chunks (workspace_id, brain_id, source_id, content)
    values (p_ws, v_brain, v_source, 'fragmento secreto de ' || p_tag);
  insert into public.agent_brains (workspace_id, agent_id, brain_id) values (p_ws, v_agent, v_brain);

  insert into public.tools (workspace_id, slug, name) values (p_ws, 'propia', p_tag || ' herramienta')
    returning id into v_tool;
  insert into public.agent_tools (workspace_id, agent_id, tool_id) values (p_ws, v_agent, v_tool);
  insert into public.connections (workspace_id, provider, name, credentials_encrypted)
    values (p_ws, 'stripe', p_tag, 'cifrado-' || p_tag) returning id into v_conn;

  insert into public.contact_properties (workspace_id, key, label) values (p_ws, 'ciudad', 'Ciudad');
  insert into public.contacts (workspace_id, phone, name, properties)
    values (p_ws, '+5730000' || length(p_tag)::text, 'Cliente ' || p_tag,
            jsonb_build_object('ciudad', p_tag)) returning id into v_contact;

  insert into public.conversations (workspace_id, contact_id, channel_id, agent_id, external_key)
    values (p_ws, v_contact, v_channel, v_agent, 'conv-' || p_tag) returning id into v_conv;

  insert into public.messages
    (workspace_id, conversation_id, contact_id, channel_id, external_id, direction, author_type, content)
    values (p_ws, v_conv, v_contact, v_channel, 'wamid.compartido', 'inbound', 'contact',
            jsonb_build_object('text', 'secreto de ' || p_tag)) returning id into v_msg;

  insert into public.message_status_events (workspace_id, message_id, status) values (p_ws, v_msg, 'delivered');
  insert into public.media (workspace_id, message_id, mime_type, external_id)
    values (p_ws, v_msg, 'image/jpeg', 'media-' || p_tag);
  insert into public.conversation_events (workspace_id, conversation_id, type)
    values (p_ws, v_conv, 'conversation.created');
  insert into public.notes (workspace_id, conversation_id, body) values (p_ws, v_conv, 'nota de ' || p_tag);
  insert into public.tags (workspace_id, name) values (p_ws, 'urgente') returning id into v_tag;
  insert into public.taggings (workspace_id, tag_id, entity_type, entity_id)
    values (p_ws, v_tag, 'conversation', v_conv);
  insert into public.quick_replies (workspace_id, shortcut, title, body)
    values (p_ws, '/hola', 'Saludo', 'Hola desde ' || p_tag);

  insert into public.teams (workspace_id, name, routing_strategy)
    values (p_ws, p_tag || ' soporte', 'least_busy') returning id into v_team;
  insert into public.team_members (workspace_id, team_id, user_id) values (p_ws, v_team, p_user);
  insert into public.invitations (workspace_id, email, token_hash)
    values (p_ws, 'invitado@' || p_tag || '.test', md5(p_tag));
  insert into public.audit_log (workspace_id, actor_user_id, action) values (p_ws, p_user, 'workspace.seeded');

  insert into public.agent_runs (workspace_id, agent_id, agent_version_id, conversation_id, status, model)
    values (p_ws, v_agent, v_ver, v_conv, 'succeeded', 'zai/glm-4.7-flash') returning id into v_run;
  insert into public.tool_runs (workspace_id, agent_run_id, conversation_id, tool_id, tool_slug, status)
    values (p_ws, v_run, v_conv, v_tool, 'propia', 'succeeded');

  insert into public.webhook_events (workspace_id, channel_id, external_key, event_hash, payload, signature_ok)
    values (p_ws, v_channel, 'pn-' || p_tag, 'hash-' || p_tag,
            jsonb_build_object('secreto', p_tag), true);

  insert into public.usage_daily (workspace_id, day, agent_id, messages_in) values (p_ws, current_date, v_agent, 1);
  insert into public.waba_analytics_daily (workspace_id, day, waba_id, sent)
    values (p_ws, current_date, 'waba-' || p_tag, 10);

  insert into public.conversation_analysis (workspace_id, conversation_id, sentiment, summary)
    values (p_ws, v_conv, 'positive', 'resumen de ' || p_tag);
  insert into public.automations (workspace_id, name, trigger, actions)
    values (p_ws, 'regla ' || p_tag, '{"event":"message.received"}', '[{"type":"tag"}]')
    returning id into v_auto;
  insert into public.automation_runs (workspace_id, automation_id, conversation_id, status)
    values (p_ws, v_auto, v_conv, 'succeeded');
  insert into public.eval_cases (workspace_id, agent_id, name, input)
    values (p_ws, v_agent, 'caso ' || p_tag, '{"text":"hola"}');
  insert into public.extraction_schemas (workspace_id, agent_id, name, json_schema)
    values (p_ws, v_agent, 'pedido ' || p_tag, '{"type":"object"}') returning id into v_schema;
  insert into public.extractions (workspace_id, schema_id, conversation_id, data)
    values (p_ws, v_schema, v_conv, jsonb_build_object('tag', p_tag));

  insert into public.agent_subscriptions (workspace_id, catalog_slug, agent_id)
    values (p_ws, 'recepcionista', v_agent);
end;
$$;

-- -----------------------------------------------------------------------------
-- Lista de tablas de negocio: cualquier tabla de public con columna workspace_id.
-- Se calcula del catalogo, no de una lista escrita a mano, para que una tabla
-- nueva quede cubierta por el test el dia que se cree.
-- -----------------------------------------------------------------------------
create or replace function pg_temp.business_tables()
returns setof text language sql stable as $$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'workspace_id' and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public'
    and c.relkind in ('r','p')
    and c.relispartition = false
  order by 1;
$$;

-- =============================================================================
-- 1 · Cobertura: ninguna tabla de negocio sin RLS
-- =============================================================================
do $$
declare v_missing text;
begin
  select string_agg(t, ', ') into v_missing
  from pg_temp.business_tables() t
  where not (select c.relrowsecurity from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = t);

  perform pg_temp.assert(v_missing is null,
    'tablas de negocio sin row level security: ' || coalesce(v_missing, ''));

  raise notice '1 · RLS activo en las % tablas de negocio', (select count(*) from pg_temp.business_tables());
end;
$$;

-- Y ninguna sin politicas.
do $$
declare v_missing text;
begin
  select string_agg(t, ', ') into v_missing
  from pg_temp.business_tables() t
  where not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t);
  perform pg_temp.assert(v_missing is null, 'tablas con RLS pero sin politicas: ' || coalesce(v_missing, ''));
  raise notice '1b · Todas las tablas de negocio tienen politicas';
end;
$$;

-- =============================================================================
-- 2 · Dos espacios completos
-- =============================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'ana@alfa.test',  '{"organization":"Alfa"}'),
  ('22222222-2222-2222-2222-222222222222', 'beto@beta.test', '{"organization":"Beta"}');

do $$
declare v_a uuid; v_b uuid;
begin
  select w.id into v_a from public.workspaces w
    join public.memberships m on m.workspace_id = w.id
   where m.user_id = '11111111-1111-1111-1111-111111111111';
  select w.id into v_b from public.workspaces w
    join public.memberships m on m.workspace_id = w.id
   where m.user_id = '22222222-2222-2222-2222-222222222222';

  perform pg_temp.assert(v_a is not null and v_b is not null and v_a <> v_b,
    'el trigger de alta no creo dos espacios distintos');

  perform set_config('test.ws_a', v_a::text, true);
  perform set_config('test.ws_b', v_b::text, true);

  perform pg_temp.seed_ws(v_a, 'alfa', '11111111-1111-1111-1111-111111111111');
  perform pg_temp.seed_ws(v_b, 'beta', '22222222-2222-2222-2222-222222222222');

  raise notice '2 · Sembrados los espacios % y %', v_a, v_b;
end;
$$;

-- El mismo external_id existe en los DOS espacios: la barrera de idempotencia
-- es por espacio, no global. Si fuese global, el segundo tenant no podria ni
-- recibir mensajes.
do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.messages where external_id = 'wamid.compartido') = 2,
    'el unico de idempotencia deberia ser por espacio, no global');
  raise notice '2b · messages(workspace_id, external_id): unico por espacio';
end;
$$;

-- =============================================================================
-- 3 · Como usuario del espacio A: ni una fila del espacio B
-- =============================================================================
do $$
declare
  v_a uuid := current_setting('test.ws_a')::uuid;
  v_b uuid := current_setting('test.ws_b')::uuid;
  t text; n bigint; v_own bigint; v_seen int := 0;
begin
  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
  set local role authenticated;

  foreach t in array (select array_agg(x) from pg_temp.business_tables() x) loop
    -- Filas de OTRO espacio visibles: debe ser cero siempre.
    execute format(
      'select count(*) from public.%I where workspace_id is not null and workspace_id <> $1', t)
      into n using v_a;
    perform pg_temp.assert(n = 0,
      format('%s: el usuario de A ve %s filas de otro espacio', t, n));

    -- Y que el test no pase en vacio: en las tablas sembradas debe ver lo suyo.
    execute format('select count(*) from public.%I where workspace_id = $1', t) into v_own using v_a;
    if v_own > 0 then v_seen := v_seen + 1; end if;
  end loop;

  perform pg_temp.assert(v_seen >= 35,
    format('el test paso en vacio: solo %s tablas con datos propios visibles', v_seen));

  -- Comprobaciones de contenido, no solo de conteo.
  perform pg_temp.assert(
    (select count(*) from public.brain_chunks where content like '%beta%') = 0,
    'fuga de conocimiento del espacio B');
  perform pg_temp.assert(
    (select count(*) from public.connections where credentials_encrypted like '%beta%') = 0,
    'fuga de credenciales del espacio B');
  perform pg_temp.assert(
    (select count(*) from public.messages where content::text like '%beta%') = 0,
    'fuga de mensajes del espacio B');
  perform pg_temp.assert(
    (select count(*) from public.workspaces) = 1, 'el usuario de A ve mas de un espacio');
  perform pg_temp.assert(
    (select count(*) from public.organizations) = 1, 'el usuario de A ve otra organizacion');

  reset role;
  raise notice '3 · El usuario de A no ve nada de B (% tablas con datos propios)', v_seen;
end;
$$;

-- =============================================================================
-- 4 · Y simetricamente desde B
-- =============================================================================
do $$
declare
  v_b uuid := current_setting('test.ws_b')::uuid;
  t text; n bigint;
begin
  perform pg_temp.login('22222222-2222-2222-2222-222222222222');
  set local role authenticated;

  foreach t in array (select array_agg(x) from pg_temp.business_tables() x) loop
    execute format(
      'select count(*) from public.%I where workspace_id is not null and workspace_id <> $1', t)
      into n using v_b;
    perform pg_temp.assert(n = 0, format('%s: el usuario de B ve %s filas ajenas', t, n));
  end loop;

  perform pg_temp.assert(
    (select count(*) from public.brain_chunks where content like '%alfa%') = 0,
    'fuga de conocimiento del espacio A');

  reset role;
  raise notice '4 · El usuario de B no ve nada de A';
end;
$$;

-- =============================================================================
-- 5 · Escritura cruzada bloqueada
-- =============================================================================
do $$
declare
  v_b uuid := current_setting('test.ws_b')::uuid;
  v_ok boolean := false;
begin
  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
  set local role authenticated;

  begin
    insert into public.contacts (workspace_id, phone, name) values (v_b, '+573999', 'intruso');
  exception when insufficient_privilege or check_violation then
    v_ok := true;
  end;
  perform pg_temp.assert(v_ok, 'un usuario de A pudo insertar un contacto en el espacio B');

  v_ok := false;
  begin
    update public.workspaces set name = 'secuestrado' where id = v_b;
    v_ok := not found;   -- RLS lo convierte en "cero filas afectadas"
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform pg_temp.assert(v_ok, 'un usuario de A pudo renombrar el espacio B');

  reset role;
  raise notice '5 · Escritura cruzada bloqueada';
end;
$$;

-- =============================================================================
-- 6 · El worker: acotado a app.workspace_id, ciego sin el
-- =============================================================================
do $$
declare
  v_a uuid := current_setting('test.ws_a')::uuid;
  v_b uuid := current_setting('test.ws_b')::uuid;
  t text; n bigint; v_total bigint;
begin
  -- Sin declarar workspace no ve absolutamente nada.
  perform set_config('app.workspace_id', '', true);
  set local role strappy_worker;
  select count(*) into n from public.conversations;
  perform pg_temp.assert(n = 0, 'el worker ve conversaciones sin declarar app.workspace_id');
  reset role;

  -- Declarando A ve solo A.
  perform set_config('app.workspace_id', v_a::text, true);
  set local role strappy_worker;
  v_total := 0;
  foreach t in array (select array_agg(x) from pg_temp.business_tables() x) loop
    execute format(
      'select count(*) from public.%I where workspace_id is not null and workspace_id <> $1', t)
      into n using v_a;
    perform pg_temp.assert(n = 0, format('%s: el worker con A ve %s filas de otro espacio', t, n));
    execute format('select count(*) from public.%I where workspace_id = $1', t) into n using v_a;
    v_total := v_total + n;
  end loop;
  perform pg_temp.assert(v_total > 30, 'el worker con A no ve sus propios datos');
  reset role;

  raise notice '6 · El worker solo ve el workspace declarado (% filas propias)', v_total;
end;
$$;

-- La segunda barrera, independiente de RLS.
do $$
declare
  v_a uuid := current_setting('test.ws_a')::uuid;
  v_b uuid := current_setting('test.ws_b')::uuid;
  v_ok boolean := false;
begin
  perform set_config('app.workspace_id', v_a::text, true);
  begin
    perform public.assert_workspace(v_b);
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform pg_temp.assert(v_ok, 'assert_workspace no bloqueo el cruce de tenant');
  perform public.assert_workspace(v_a);   -- el correcto no debe fallar
  raise notice '6b · assert_workspace corta el cruce de tenant';
end;
$$;

-- =============================================================================
-- 7 · Presets y overrides de permisos
-- =============================================================================
do $$
declare
  v_a uuid := current_setting('test.ws_a')::uuid;
  v_u uuid := '33333333-3333-3333-3333-333333333333';
begin
  perform set_config('app.workspace_id', '', true);

  -- owner
  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
  perform pg_temp.assert(public.has_perm(v_a, 'billing.manage'), 'owner sin billing.manage');
  perform pg_temp.assert(public.has_perm(v_a, 'workspace.delete'), 'owner sin workspace.delete');

  -- Un segundo usuario al que iremos cambiando el rol.
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_u, 'caro@alfa.test', '{}');
  delete from public.memberships m where m.user_id = v_u;  -- el trigger le creo su propio espacio
  insert into public.memberships (workspace_id, user_id, role) values (v_a, v_u, 'admin');
  perform pg_temp.login(v_u);

  perform pg_temp.assert(public.is_member(v_a), 'la membresia invitada no es miembro');
  perform pg_temp.assert(public.has_perm(v_a, 'agents.write'), 'admin sin agents.write');
  perform pg_temp.assert(not public.has_perm(v_a, 'billing.manage'), 'admin CON billing.manage');
  perform pg_temp.assert(not public.has_perm(v_a, 'workspace.delete'), 'admin CON workspace.delete');

  update public.memberships set role = 'builder' where workspace_id = v_a and user_id = v_u;
  perform pg_temp.assert(public.has_perm(v_a, 'knowledge.write'), 'builder sin knowledge.write');
  perform pg_temp.assert(public.has_perm(v_a, 'inbox.read'),      'builder sin inbox.read');
  perform pg_temp.assert(not public.has_perm(v_a, 'inbox.write'), 'builder CON inbox.write');

  update public.memberships set role = 'agent' where workspace_id = v_a and user_id = v_u;
  perform pg_temp.assert(public.has_perm(v_a, 'inbox.takeover'),   'agent sin inbox.takeover');
  perform pg_temp.assert(public.has_perm(v_a, 'contacts.write'),   'agent sin contacts.write');
  perform pg_temp.assert(not public.has_perm(v_a, 'agents.write'), 'agent CON agents.write');

  update public.memberships set role = 'analyst' where workspace_id = v_a and user_id = v_u;
  perform pg_temp.assert(public.has_perm(v_a, 'analytics.read'),    'analyst sin analytics.read');
  perform pg_temp.assert(not public.has_perm(v_a, 'contacts.write'),'analyst CON contacts.write');

  -- Override: concesion puntual sobre el preset de solo lectura.
  update public.memberships set permissions = array['contacts.write']
   where workspace_id = v_a and user_id = v_u;
  perform pg_temp.assert(public.has_perm(v_a, 'contacts.write'), 'el override aditivo no concedio el permiso');

  -- Override: revocacion que gana al preset.
  update public.memberships set role = 'admin', permissions = array['!agents.write']
   where workspace_id = v_a and user_id = v_u;
  perform pg_temp.assert(not public.has_perm(v_a, 'agents.write'), 'la revocacion "!" no gano al preset');

  -- Membresia suspendida: deja de ser miembro.
  update public.memberships set status = 'suspended', permissions = '{}'
   where workspace_id = v_a and user_id = v_u;
  perform pg_temp.assert(not public.is_member(v_a),  'una membresia suspendida sigue siendo miembro');
  perform pg_temp.assert(not public.has_perm(v_a, 'inbox.read'), 'una membresia suspendida conserva permisos');

  raise notice '7 · Presets, overrides y suspension se comportan como se declaro';
end;
$$;

-- =============================================================================
-- 8 · Inmutabilidad de las versiones publicadas
-- =============================================================================
do $$
declare v_ok boolean := false; v_id uuid;
begin
  select id into v_id from public.agent_versions limit 1;

  begin
    update public.agent_versions set compiled_prompt = 'manipulado' where id = v_id;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.assert(v_ok, 'se pudo reescribir el prompt de una version publicada');

  v_ok := false;
  begin
    delete from public.agent_versions where id = v_id;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.assert(v_ok, 'se pudo borrar una version publicada');

  update public.agent_versions set status = 'rolled_back' where id = v_id;  -- esto SI se permite
  update public.agent_versions set status = 'published'  where id = v_id;

  raise notice '8 · agent_versions es inmutable';
end;
$$;

-- =============================================================================
-- 9 · Creditos: idempotencia, orden de consumo y falta de saldo
-- =============================================================================
do $$
declare
  v_a uuid := current_setting('test.ws_a')::uuid;
  r record; v_before numeric; v_after numeric;
begin
  perform set_config('app.workspace_id', v_a::text, true);

  select included_balance + purchased_balance into v_before
    from public.credit_wallets where workspace_id = v_a;
  perform pg_temp.assert(v_before = 5000, 'el alta no dejo 5.000 creditos incluidos');

  -- 10 ktokens de entrada + 2 de salida con GLM Flash = 10*0,21 + 2*1,20 = 4,50
  select * into r from public.charge_credits(
    v_a, 'agent_run:test-1',
    '[{"kind":"model_input","ref_key":"zai/glm-4.7-flash","quantity":10},
      {"kind":"model_output","ref_key":"zai/glm-4.7-flash","quantity":2}]'::jsonb);
  perform pg_temp.assert(r.applied, 'el primer cobro no se aplico');
  perform pg_temp.assert(r.credits = 4.5, format('tarifa mal resuelta: %s creditos en lugar de 4,5', r.credits));
  perform pg_temp.assert(r.from_included = 4.5, 'no se consumio primero el saldo incluido');
  perform pg_temp.assert(r.from_purchased = 0, 'se toco el saldo comprado habiendo incluido');

  -- Reintento con la MISMA clave: no debe volver a cobrar.
  select * into r from public.charge_credits(
    v_a, 'agent_run:test-1',
    '[{"kind":"model_input","ref_key":"zai/glm-4.7-flash","quantity":10},
      {"kind":"model_output","ref_key":"zai/glm-4.7-flash","quantity":2}]'::jsonb);
  perform pg_temp.assert(not r.applied and r.reason = 'duplicate', 'el reintento volvio a cobrar');

  select included_balance + purchased_balance into v_after
    from public.credit_wallets where workspace_id = v_a;
  perform pg_temp.assert(v_after = v_before - 4.5,
    format('el saldo no cuadra: %s, esperado %s', v_after, v_before - 4.5));
  perform pg_temp.assert(
    (select count(*) from public.credit_ledger
      where workspace_id = v_a and idempotency_key = 'agent_run:test-1') = 1,
    'el reintento dejo dos asientos en el libro mayor');

  -- Sin saldo: no cobra y devuelve el motivo que el motor anota como skip_reason.
  select * into r from public.charge_credits(
    v_a, 'agent_run:test-2',
    '[{"kind":"model_output","ref_key":"anthropic/claude-opus-5","quantity":100000}]'::jsonb);
  perform pg_temp.assert(not r.applied and r.reason = 'no_credits',
    'un cobro sin saldo se aplico igualmente');
  perform pg_temp.assert(
    (select included_balance + purchased_balance from public.credit_wallets where workspace_id = v_a) = v_after,
    'un cobro rechazado movio el saldo');

  -- Recarga idempotente.
  perform public.grant_credits(v_a, 'topup:test-1', 1000, 'purchased');
  perform public.grant_credits(v_a, 'topup:test-1', 1000, 'purchased');
  perform pg_temp.assert(
    (select purchased_balance from public.credit_wallets where workspace_id = v_a) = 1000,
    'la recarga se aplico dos veces');

  raise notice '9 · charge_credits es atomico e idempotente';
end;
$$;

-- El cobro tampoco puede cruzar tenants aunque el llamador se equivoque.
do $$
declare
  v_a uuid := current_setting('test.ws_a')::uuid;
  v_b uuid := current_setting('test.ws_b')::uuid;
  v_ok boolean := false;
begin
  perform set_config('app.workspace_id', v_a::text, true);
  begin
    perform public.charge_credits(v_b, 'agent_run:cruzado', '[]'::jsonb);
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.assert(v_ok, 'charge_credits cobro a un espacio distinto del declarado');
  raise notice '9b · charge_credits no cruza tenants';
end;
$$;

-- =============================================================================
-- 10 · Ruta caliente del webhook
-- =============================================================================
do $$
declare
  v_a uuid := current_setting('test.ws_a')::uuid;
  r record;
begin
  perform set_config('app.workspace_id', '', true);

  select * into r from public.channel_routing where external_key = 'pn-alfa';
  perform pg_temp.assert(r.workspace_id = v_a, 'el trigger no mantuvo channel_routing');
  perform pg_temp.assert(r.agent_id is not null, 'channel_routing sin agente resuelto');

  select * into r from public.ingest_webhook_event(
    'whatsapp', 'hash-nuevo', '{"x":1}'::jsonb, true, 'pn-alfa', 'messages');
  perform pg_temp.assert(r.is_new, 'el primer evento no se registro');
  perform pg_temp.assert(r.workspace_id = v_a, 'el evento no resolvio el tenant correcto');

  select * into r from public.ingest_webhook_event(
    'whatsapp', 'hash-nuevo', '{"x":1}'::jsonb, true, 'pn-alfa', 'messages');
  perform pg_temp.assert(not r.is_new, 'el evento duplicado se registro dos veces');

  -- Al desconectar el numero, el enrutado deja de estar activo.
  update public.whatsapp_numbers set status = 'disconnected' where phone_number_id = 'pn-alfa';
  perform pg_temp.assert(
    (select not is_active from public.channel_routing where external_key = 'pn-alfa'),
    'el enrutado no siguio el estado del numero');

  raise notice '10 · channel_routing e ingesta idempotente correctos';
end;
$$;

-- =============================================================================
do $$
begin
  raise notice '';
  raise notice '================================================';
  raise notice '  AISLAMIENTO MULTI-TENANT: TODAS LAS PRUEBAS OK';
  raise notice '================================================';
end;
$$;

rollback;
