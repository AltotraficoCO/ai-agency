-- =============================================================================
-- 0004_conversations.sql · Contactos, conversaciones y mensajes
-- -----------------------------------------------------------------------------
-- El nucleo operativo. Las columnas de `conversations` no son adorno: el motor
-- decide con ellas si contesta, si calla, si escala o si reintenta.
-- Regla de diseno: el motor NO conoce conceptos de WhatsApp. La ventana de 24h
-- se guarda como send_restriction_until, generica para cualquier canal.
-- =============================================================================

-- En Supabase las extensiones viven en el esquema `extensions`. Los tipos y las
-- clases de operadores (vector, gin_trgm_ops...) se resuelven en el momento del
-- DDL, asi que `extensions` tiene que estar en el search_path AL APLICAR. En un
-- Postgres pelado el esquema no existe y la linea es inocua.
set search_path = public, extensions, pg_temp;

-- -----------------------------------------------------------------------------
create table if not exists public.contact_properties (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key          text not null,
  label        text not null,
  value_type   text not null default 'text'
                 check (value_type in ('text','number','boolean','date','select','multiselect','url','email','phone')),
  options      jsonb not null default '[]'::jsonb,
  is_system    boolean not null default false,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (workspace_id, key)
);

comment on table public.contact_properties is
  'Catalogo de propiedades personalizadas del contacto: solo describe la forma (etiqueta, tipo, opciones). Los VALORES viven en contacts.properties. No es EAV: no hay tabla de pares clave-valor por contacto.';

-- -----------------------------------------------------------------------------
create table if not exists public.contacts (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  external_id    text,
  phone          text,
  email          text,
  name           text,
  first_name     text,
  last_name      text,
  avatar_url     text,
  locale         text,
  timezone       text,
  properties     jsonb not null default '{}'::jsonb,
  is_blocked     boolean not null default false,
  opted_out_at   timestamptz,
  last_seen_at   timestamptz,
  source         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.contacts is
  'Persona con la que se conversa, unica por espacio. properties guarda los valores de las propiedades personalizadas en un solo jsonb con indice GIN: una lectura por contacto en lugar de N filas de EAV.';
comment on column public.contacts.properties is
  'Valores de las propiedades declaradas en contact_properties. Indexado con GIN jsonb_path_ops para filtrar la bandeja por atributo sin escanear la tabla.';

create unique index if not exists contacts_ws_phone_uniq
  on public.contacts (workspace_id, phone) where phone is not null;
create unique index if not exists contacts_ws_external_uniq
  on public.contacts (workspace_id, external_id) where external_id is not null;
create index if not exists contacts_ws_updated_idx
  on public.contacts (workspace_id, updated_at desc);
create index if not exists contacts_properties_gin
  on public.contacts using gin (properties jsonb_path_ops);
create index if not exists contacts_ws_name_trgm
  on public.contacts using gin (workspace_id, name gin_trgm_ops);

-- -----------------------------------------------------------------------------
create table if not exists public.conversations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  contact_id    uuid not null references public.contacts(id) on delete cascade,
  channel_id    uuid not null references public.channels(id) on delete cascade,
  agent_id      uuid references public.agents(id) on delete set null,
  external_key  text,

  status        text not null default 'open'
                  check (status in ('open','snoozed','closed')),

  -- Control de quien habla ------------------------------------------------
  handover_state text not null default 'bot'
                  check (handover_state in ('bot','human','pending_human')),
  bot_enabled    boolean not null default true,
  bot_paused_until timestamptz,

  -- Asignacion ------------------------------------------------------------
  assignee_user_id uuid references auth.users(id) on delete set null,
  assigned_team_id uuid references public.teams(id) on delete set null,

  -- Reloj de la conversacion ----------------------------------------------
  last_inbound_at  timestamptz,
  last_outbound_at timestamptz,
  last_message_at  timestamptz,
  send_restriction_until timestamptz,
  snoozed_until    timestamptz,

  -- Motor -----------------------------------------------------------------
  engine_lock_until timestamptz,
  pending_run_at    timestamptz,
  summary           text,
  variables         jsonb not null default '{}'::jsonb,

  unread_count   integer not null default 0 check (unread_count >= 0),
  priority       smallint not null default 0,
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.conversations is
  'Hilo con un contacto en un canal. Concentra todo el estado que el motor consulta para decidir si responde: control humano/bot, asignacion, relojes, cerrojo de ejecucion y variables acumuladas.';
comment on column public.conversations.handover_state is
  'Quien tiene la palabra: bot (automatico), human (una persona tomo el control) o pending_human (escalado pero aun sin agente asignado).';
comment on column public.conversations.bot_paused_until is
  'Silencio temporal del bot. Distinto de bot_enabled=false, que es una desactivacion permanente para este hilo.';
comment on column public.conversations.send_restriction_until is
  'Instante hasta el que se puede enviar libremente. Deliberadamente generica: es donde se proyecta la ventana de sesion de WhatsApp sin que el motor sepa que existe WhatsApp.';
comment on column public.conversations.engine_lock_until is
  'Cerrojo optimista del motor. Evita que dos trabajadores procesen el mismo hilo a la vez sin necesidad de una cola externa.';
comment on column public.conversations.pending_run_at is
  'Momento en que hay que ejecutar el agente (agrupacion de mensajes, seguimientos programados). Es la cola de trabajo del motor.';
comment on column public.conversations.variables is
  'Estado acumulado del hilo (datos recogidos, paso del guion). Lo lee y escribe el agente entre turnos.';

create unique index if not exists conversations_ws_external_uniq
  on public.conversations (workspace_id, channel_id, external_key)
  where external_key is not null;
create index if not exists conversations_ws_inbox_idx
  on public.conversations (workspace_id, status, last_message_at desc);
create index if not exists conversations_ws_assignee_idx
  on public.conversations (workspace_id, assignee_user_id, status, last_message_at desc);
create index if not exists conversations_ws_team_idx
  on public.conversations (workspace_id, assigned_team_id, status, last_message_at desc);
create index if not exists conversations_ws_contact_idx
  on public.conversations (workspace_id, contact_id, last_message_at desc);
-- Cola del motor: solo los hilos que esperan ejecucion.
create index if not exists conversations_pending_run_idx
  on public.conversations (workspace_id, pending_run_at)
  where pending_run_at is not null;
create index if not exists conversations_snoozed_idx
  on public.conversations (workspace_id, snoozed_until)
  where snoozed_until is not null;

-- -----------------------------------------------------------------------------
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id   uuid references public.contacts(id) on delete set null,
  channel_id   uuid references public.channels(id) on delete set null,

  external_id  text,
  direction    text not null check (direction in ('inbound','outbound')),
  author_type  text not null default 'contact'
                 check (author_type in ('contact','bot','human','system')),
  author_user_id uuid references auth.users(id) on delete set null,
  agent_id     uuid references public.agents(id) on delete set null,
  agent_version_id uuid references public.agent_versions(id) on delete set null,

  content_type text not null default 'text'
                 check (content_type in ('text','image','audio','video','document','sticker','location','contacts','template','interactive','system','unsupported')),
  content      jsonb not null default '{}'::jsonb,
  reply_to_id  uuid references public.messages(id) on delete set null,

  status       text not null default 'pending'
                 check (status in ('pending','sent','delivered','read','failed','deleted')),
  error_code   text,
  error_detail text,

  sent_at      timestamptz,
  delivered_at timestamptz,
  read_at      timestamptz,
  provider_timestamp timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.messages is
  'Mensaje individual del hilo. content es jsonb para no crear una tabla por tipo de adjunto. Es la tabla mas escrita del sistema y la de mayor sensibilidad a la idempotencia.';
comment on column public.messages.external_id is
  'Identificador del proveedor (wamid en WhatsApp). Junto a workspace_id forma la barrera de idempotencia REAL: Meta reenvia el mismo webhook varias veces y sin este unico se duplicarian mensajes en la bandeja.';
comment on column public.messages.provider_timestamp is
  'Marca de tiempo declarada por el proveedor. Puede diferir de created_at por reentregas: para ordenar el hilo manda esta, para auditar manda created_at.';

-- Barrera de idempotencia. Parcial porque un saliente aun sin acuse no tiene id externo.
create unique index if not exists messages_ws_external_uniq
  on public.messages (workspace_id, external_id) where external_id is not null;
create index if not exists messages_ws_conv_created_idx
  on public.messages (workspace_id, conversation_id, created_at desc);
create index if not exists messages_ws_status_idx
  on public.messages (workspace_id, status) where status in ('pending','failed');

-- -----------------------------------------------------------------------------
create table if not exists public.message_status_events (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  message_id   uuid not null references public.messages(id) on delete cascade,
  status       text not null
                 check (status in ('sent','delivered','read','failed','deleted')),
  error_code   text,
  detail       jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (message_id, status)
);

comment on table public.message_status_events is
  'Historial de acuses de un mensaje. El unico (message_id, status) absorbe las reentregas del proveedor: el mismo acuse puede llegar cinco veces y solo deja una fila.';

create index if not exists message_status_events_ws_idx
  on public.message_status_events (workspace_id, message_id);

-- -----------------------------------------------------------------------------
create table if not exists public.media (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  message_id   uuid references public.messages(id) on delete cascade,
  external_id  text,
  storage_path text,
  url          text,
  mime_type    text,
  file_name    text,
  size_bytes   bigint,
  width        integer,
  height       integer,
  duration_ms  integer,
  sha256       text,
  transcript   text,
  caption      text,
  status       text not null default 'pending'
                 check (status in ('pending','stored','failed','expired')),
  created_at   timestamptz not null default now()
);

comment on table public.media is
  'Adjuntos. Los proveedores sirven el binario con URL caducable, asi que se copia a almacenamiento propio; transcript guarda la transcripcion de audio para que el agente pueda razonar sobre notas de voz.';

create index if not exists media_ws_message_idx on public.media (workspace_id, message_id);
create unique index if not exists media_ws_external_uniq
  on public.media (workspace_id, external_id) where external_id is not null;

-- -----------------------------------------------------------------------------
create table if not exists public.conversation_events (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  type         text not null,
  actor_type   text not null default 'system'
                 check (actor_type in ('contact','bot','human','system','automation')),
  actor_user_id uuid references auth.users(id) on delete set null,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.conversation_events is
  'Linea de tiempo de lo que NO es un mensaje: toma de control, asignacion, etiquetado, cierre, pausa del bot. Alimenta la bandeja en vivo por Realtime.';

create index if not exists conversation_events_ws_conv_idx
  on public.conversation_events (workspace_id, conversation_id, created_at desc);

-- -----------------------------------------------------------------------------
create table if not exists public.notes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  contact_id   uuid references public.contacts(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  body         text not null,
  mentions     uuid[] not null default '{}'::uuid[],
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.notes is
  'Nota interna sobre un hilo o un contacto. Nunca se envia al contacto; mentions permite avisar a companeros.';

create index if not exists notes_ws_conv_idx on public.notes (workspace_id, conversation_id, created_at desc);
create index if not exists notes_ws_contact_idx on public.notes (workspace_id, contact_id, created_at desc);

-- -----------------------------------------------------------------------------
create table if not exists public.tags (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  color        text not null default '#64748b',
  description  text,
  created_at   timestamptz not null default now(),
  unique (workspace_id, name)
);

comment on table public.tags is 'Etiquetas del espacio, aplicables a conversaciones y contactos.';

create table if not exists public.taggings (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tag_id       uuid not null references public.tags(id) on delete cascade,
  entity_type  text not null check (entity_type in ('conversation','contact')),
  entity_id    uuid not null,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (tag_id, entity_type, entity_id)
);

comment on table public.taggings is
  'Aplicacion de una etiqueta a una entidad. Polimorfica a proposito: evita duplicar la tabla por cada tipo etiquetable.';

create index if not exists taggings_ws_entity_idx
  on public.taggings (workspace_id, entity_type, entity_id);

-- -----------------------------------------------------------------------------
create table if not exists public.quick_replies (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shortcut     text not null,
  title        text not null,
  body         text not null,
  category     text,
  is_shared    boolean not null default true,
  created_by   uuid references auth.users(id) on delete set null,
  usage_count  integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, shortcut)
);

comment on table public.quick_replies is
  'Respuestas guardadas que el agente humano inserta por atajo en la bandeja.';

-- =============================================================================
-- Mantenimiento automatico del reloj de la conversacion
-- =============================================================================
create or replace function public.bump_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.conversations c
  set last_message_at  = greatest(coalesce(c.last_message_at, 'epoch'::timestamptz),
                                  coalesce(new.provider_timestamp, new.created_at)),
      last_inbound_at  = case when new.direction = 'inbound'
                              then greatest(coalesce(c.last_inbound_at, 'epoch'::timestamptz),
                                            coalesce(new.provider_timestamp, new.created_at))
                              else c.last_inbound_at end,
      last_outbound_at = case when new.direction = 'outbound'
                              then greatest(coalesce(c.last_outbound_at, 'epoch'::timestamptz),
                                            coalesce(new.provider_timestamp, new.created_at))
                              else c.last_outbound_at end,
      unread_count     = case when new.direction = 'inbound' then c.unread_count + 1 else c.unread_count end,
      status           = case when c.status = 'closed' and new.direction = 'inbound' then 'open' else c.status end,
      updated_at       = now()
  where c.id = new.conversation_id
    and c.workspace_id = new.workspace_id;   -- barrera anti-cruce de tenant

  return new;
end;
$$;

comment on function public.bump_conversation_on_message() is
  'Actualiza relojes y no leidos de la conversacion al insertar un mensaje. El filtro por workspace_id es deliberado: si un bug enviara un mensaje con el hilo de otro tenant, no actualiza nada en lugar de corromperlo.';

drop trigger if exists messages_bump_conversation on public.messages;
create trigger messages_bump_conversation
  after insert on public.messages
  for each row execute function public.bump_conversation_on_message();

do $$
declare t text;
begin
  foreach t in array array['contacts','conversations','notes','quick_replies'] loop
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
select public.apply_tenant_rls('contact_properties',    'contacts.write');
select public.apply_tenant_rls('contacts',              'contacts.write');
select public.apply_tenant_rls('conversations',         'inbox.write');
select public.apply_tenant_rls('messages',              'inbox.write');
select public.apply_tenant_rls('message_status_events', null, true);
select public.apply_tenant_rls('media',                 'inbox.write');
select public.apply_tenant_rls('conversation_events',   null, true);
select public.apply_tenant_rls('notes',                 'inbox.write');
select public.apply_tenant_rls('tags',                  'inbox.write');
select public.apply_tenant_rls('taggings',              'inbox.write');
select public.apply_tenant_rls('quick_replies',         'inbox.write');

-- =============================================================================
-- Realtime: la bandeja se actualiza sola.
-- =============================================================================
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'sin publicacion supabase_realtime: se omite la publicacion de la bandeja';
    return;
  end if;
  foreach t in array array['messages','conversations','conversation_events'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when insufficient_privilege then
        -- La publicacion pertenece a supabase_admin en algunas instalaciones.
        raise warning 'sin permiso para publicar public.% en supabase_realtime; anadala manualmente', t;
      end;
    end if;
  end loop;
end
$$;

-- Realtime necesita la fila completa para poder filtrar por workspace_id.
alter table public.messages            replica identity full;
alter table public.conversations       replica identity full;
alter table public.conversation_events replica identity full;
