-- =============================================================================
-- 0009_analysis.sql · Analisis, automatizaciones, evaluacion y extraccion
-- =============================================================================

-- En Supabase las extensiones viven en el esquema `extensions`. Los tipos y las
-- clases de operadores (vector, gin_trgm_ops...) se resuelven en el momento del
-- DDL, asi que `extensions` tiene que estar en el search_path AL APLICAR. En un
-- Postgres pelado el esquema no existe y la linea es inocua.
set search_path = public, extensions, pg_temp;

create table if not exists public.conversation_analysis (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  agent_run_id    uuid references public.agent_runs(id) on delete set null,
  sentiment       text check (sentiment is null or sentiment in ('positive','neutral','negative','mixed')),
  sentiment_score numeric(4,3),
  intent          text,
  topics          text[] not null default '{}'::text[],
  language        text,
  resolution      text check (resolution is null or resolution in ('resolved','unresolved','escalated','abandoned')),
  csat_estimate   smallint check (csat_estimate is null or csat_estimate between 1 and 5),
  lead_score      smallint check (lead_score is null or lead_score between 0 and 100),
  summary         text,
  highlights      jsonb not null default '[]'::jsonb,
  model           text,
  analyzed_at     timestamptz not null default now(),
  message_count_at_analysis integer,
  unique (conversation_id, analyzed_at)
);

comment on table public.conversation_analysis is
  'Lectura del hilo hecha por un modelo: sentimiento, intencion, resolucion y resumen. Historica y no destructiva (una fila por analisis) para poder comparar como evoluciono una conversacion larga.';

create index if not exists conversation_analysis_ws_idx
  on public.conversation_analysis (workspace_id, analyzed_at desc);
create index if not exists conversation_analysis_ws_conv_idx
  on public.conversation_analysis (workspace_id, conversation_id, analyzed_at desc);
create index if not exists conversation_analysis_topics_gin
  on public.conversation_analysis using gin (topics);

-- -----------------------------------------------------------------------------
create table if not exists public.automations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  description  text,
  is_enabled   boolean not null default true,
  trigger      jsonb not null,
  conditions   jsonb not null default '[]'::jsonb,
  actions      jsonb not null,
  run_count    integer not null default 0,
  last_run_at  timestamptz,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, name)
);

comment on table public.automations is
  'Regla del espacio: disparo + condiciones + acciones, todo en jsonb. Se guarda como datos y no como codigo para que el cliente pueda crear reglas sin desplegar nada.';
comment on column public.automations.trigger is
  'Disparo declarativo, p.ej. {"event":"conversation.tagged","tag":"reclamo"} o {"event":"schedule","cron":"0 9 * * 1"}.';
comment on column public.automations.actions is
  'Lista ordenada de acciones, p.ej. [{"type":"assign_team","team_id":"..."},{"type":"send_template","name":"..."}].';

create index if not exists automations_ws_enabled_idx
  on public.automations (workspace_id, is_enabled);

create table if not exists public.automation_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  contact_id    uuid references public.contacts(id) on delete set null,
  trigger_payload jsonb not null default '{}'::jsonb,
  status        text not null default 'running'
                  check (status in ('running','succeeded','failed','skipped')),
  skip_reason   text,
  actions_result jsonb not null default '[]'::jsonb,
  error_detail  text,
  latency_ms    integer,
  idempotency_key text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

comment on table public.automation_runs is
  'Traza de cada disparo de una automatizacion. Solo lectura para usuarios.';

create index if not exists automation_runs_ws_idx
  on public.automation_runs (workspace_id, automation_id, started_at desc);
create unique index if not exists automation_runs_idem_uniq
  on public.automation_runs (workspace_id, idempotency_key)
  where idempotency_key is not null;

-- -----------------------------------------------------------------------------
create table if not exists public.eval_cases (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  agent_id      uuid references public.agents(id) on delete cascade,
  name          text not null,
  input         jsonb not null,
  expected      jsonb not null default '{}'::jsonb,
  assertions    jsonb not null default '[]'::jsonb,
  tags          text[] not null default '{}'::text[],
  source_conversation_id uuid references public.conversations(id) on delete set null,
  is_enabled    boolean not null default true,
  last_status   text check (last_status is null or last_status in ('passed','failed','error','skipped')),
  last_run_at   timestamptz,
  last_version_id uuid references public.agent_versions(id) on delete set null,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.eval_cases is
  'Caso de prueba de un agente. source_conversation_id permite convertir una conversacion real que salio mal en un caso de regresion con un clic, que es de donde salen los mejores tests.';

create index if not exists eval_cases_ws_agent_idx
  on public.eval_cases (workspace_id, agent_id, is_enabled);

-- -----------------------------------------------------------------------------
create table if not exists public.extraction_schemas (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id     uuid references public.agents(id) on delete cascade,
  name         text not null,
  description  text,
  json_schema  jsonb not null,
  target       text not null default 'conversation'
                 check (target in ('conversation','contact','message')),
  write_to_contact boolean not null default false,
  is_enabled   boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, name)
);

comment on table public.extraction_schemas is
  'Definicion de los datos estructurados que se extraen de una conversacion (JSON Schema). write_to_contact vuelca el resultado en contacts.properties.';

create table if not exists public.extractions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  schema_id       uuid not null references public.extraction_schemas(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  contact_id      uuid references public.contacts(id) on delete set null,
  message_id      uuid references public.messages(id) on delete set null,
  agent_run_id    uuid references public.agent_runs(id) on delete set null,
  data            jsonb not null default '{}'::jsonb,
  confidence      numeric(4,3),
  status          text not null default 'extracted'
                    check (status in ('extracted','partial','failed','confirmed')),
  model           text,
  created_at      timestamptz not null default now()
);

comment on table public.extractions is
  'Resultado de aplicar un esquema de extraccion. data se indexa con GIN para poder segmentar contactos por lo extraido sin recorrer las conversaciones.';

create index if not exists extractions_ws_schema_idx
  on public.extractions (workspace_id, schema_id, created_at desc);
create index if not exists extractions_ws_conv_idx
  on public.extractions (workspace_id, conversation_id);
create index if not exists extractions_data_gin
  on public.extractions using gin (data jsonb_path_ops);

do $$
declare t text;
begin
  foreach t in array array['automations','eval_cases','extraction_schemas'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch', t);
  end loop;
end
$$;

-- =============================================================================
-- RLS
-- =============================================================================
select public.apply_tenant_rls('conversation_analysis', null, true);
select public.apply_tenant_rls('automations',           'automations.write');
select public.apply_tenant_rls('automation_runs',       null, true);
select public.apply_tenant_rls('eval_cases',            'agents.write');
select public.apply_tenant_rls('extraction_schemas',    'agents.write');
select public.apply_tenant_rls('extractions',           null, true);
