/**
 * Tipos del esquema de Strappy, escritos a mano.
 *
 * Se mantienen a mano y no se generan porque el generador produce un tipo por
 * columna sin uniones literales ni relacion con los CHECK del SQL: aqui cada
 * enumeracion refleja exactamente el `check (... in (...))` de la migracion.
 * Al tocar una migracion hay que tocar este fichero.
 *
 * Convenios:
 *  - `timestamptz` y `date` viajan como `string` ISO 8601.
 *  - `numeric` viaja como `string` en la mayoria de drivers de Postgres para no
 *    perder precision; se declara `Numeric = string` y se convierte en el borde.
 *  - `jsonb` sin forma fija se declara `Json`.
 */

export type Uuid = string;
export type Timestamptz = string;
export type DateOnly = string;
/** numeric de Postgres. Cadena a proposito: `number` pierde centavos y creditos. */
export type Numeric = string;

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

// ============================================================================
// 0001 · Identidad y permisos
// ============================================================================

export const ROLES = ['owner', 'admin', 'builder', 'agent', 'analyst'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'workspace.read', 'workspace.manage', 'workspace.delete',
  'members.read', 'members.manage',
  'billing.read', 'billing.manage',
  'agents.read', 'agents.write', 'agents.publish',
  'knowledge.read', 'knowledge.write',
  'tools.read', 'tools.write',
  'channels.read', 'channels.write',
  'inbox.read', 'inbox.write', 'inbox.assign', 'inbox.takeover',
  'contacts.read', 'contacts.write',
  'automations.read', 'automations.write',
  'analytics.read', 'catalog.subscribe', 'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Override de permisos: concesion (`"agents.write"`) o revocacion (`"!agents.write"`). */
export type PermissionOverride = Permission | `!${Permission}`;

export interface Organization {
  id: Uuid;
  name: string;
  slug: string;
  billing_email: string | null;
  country: string;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Workspace {
  id: Uuid;
  organization_id: Uuid;
  name: string;
  slug: string;
  settings: JsonObject;
  timezone: string;
  locale: string;
  status: 'active' | 'suspended' | 'deleted';
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Profile {
  user_id: Uuid;
  full_name: string | null;
  avatar_url: string | null;
  locale: string;
  timezone: string;
  default_workspace_id: Uuid | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Membership {
  id: Uuid;
  workspace_id: Uuid;
  user_id: Uuid;
  role: Role;
  permissions: PermissionOverride[];
  status: 'active' | 'suspended';
  invited_by: Uuid | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Invitation {
  id: Uuid;
  workspace_id: Uuid;
  email: string;
  role: Role;
  permissions: PermissionOverride[];
  token_hash: string;
  invited_by: Uuid | null;
  expires_at: Timestamptz;
  accepted_at: Timestamptz | null;
  revoked_at: Timestamptz | null;
  created_at: Timestamptz;
}

export type RoutingStrategy = 'manual' | 'round_robin' | 'least_busy';

export interface Team {
  id: Uuid;
  workspace_id: Uuid;
  name: string;
  description: string | null;
  routing_strategy: RoutingStrategy;
  is_default: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface TeamMember {
  workspace_id: Uuid;
  team_id: Uuid;
  user_id: Uuid;
  is_lead: boolean;
  max_open_conversations: number | null;
  created_at: Timestamptz;
}

export interface AuditLogEntry {
  id: string;
  workspace_id: Uuid;
  actor_user_id: Uuid | null;
  actor_type: 'user' | 'system' | 'worker' | 'agent';
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before: Json | null;
  after: Json | null;
  ip: string | null;
  user_agent: string | null;
  created_at: Timestamptz;
}

// ============================================================================
// 0002 · Canales
// ============================================================================

/** Texto libre a proposito: el registro de canales es extensible. */
export type ChannelKind = 'whatsapp' | 'webchat' | 'instagram' | 'telegram' | (string & {});

export interface ChannelKindRow {
  kind: string;
  label: string;
  is_enabled: boolean;
  capabilities: JsonObject;
  created_at: Timestamptz;
}

export interface Channel {
  id: Uuid;
  workspace_id: Uuid;
  kind: ChannelKind;
  name: string;
  status: 'pending' | 'connected' | 'degraded' | 'disconnected' | 'error';
  settings: JsonObject;
  status_detail: string | null;
  connected_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface WhatsappAccount {
  id: Uuid;
  workspace_id: Uuid;
  channel_id: Uuid;
  waba_id: string;
  business_id: string | null;
  name: string | null;
  access_token_encrypted: string | null;
  key_version: number;
  token_expires_at: Timestamptz | null;
  payment_status: 'unknown' | 'active' | 'past_due' | 'suspended' | 'no_payment_method';
  account_review_status: 'pending' | 'approved' | 'rejected';
  business_verification_status: 'not_verified' | 'pending' | 'verified' | 'failed';
  messaging_limit_tier: string | null;
  signup_version: string | null;
  webhook_subscribed: boolean;
  last_sync_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface WhatsappNumber {
  id: Uuid;
  workspace_id: Uuid;
  account_id: Uuid;
  channel_id: Uuid;
  phone_number_id: string;
  display_phone_number: string;
  verified_name: string | null;
  quality_rating: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
  messaging_tier: string;
  code_verification_status: string | null;
  is_default: boolean;
  agent_id: Uuid | null;
  status: 'active' | 'paused' | 'disconnected';
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

/** Fila plana de resolucion de tenant. La mantiene un trigger; nunca se escribe a mano. */
export interface ChannelRoute {
  external_key: string;
  kind: ChannelKind;
  workspace_id: Uuid;
  channel_id: Uuid;
  agent_id: Uuid | null;
  account_id: Uuid | null;
  is_active: boolean;
  updated_at: Timestamptz;
}

// ============================================================================
// 0003 · Agentes
// ============================================================================

export type AgentTypeName = 'conversational' | 'task' | 'classifier' | 'meta' | (string & {});
export type AgentMode = 'lite' | 'max';

export interface AgentTypeRow {
  agent_type: string;
  label: string;
  description: string | null;
  default_spec: JsonObject;
  is_enabled: boolean;
  created_at: Timestamptz;
}

export interface CompanyProfile {
  id: Uuid;
  workspace_id: Uuid;
  legal_name: string | null;
  brand_name: string | null;
  description: string | null;
  industry: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  country: string;
  timezone: string | null;
  currency: string;
  business_hours: JsonObject;
  contact_email: string | null;
  contact_phone: string | null;
  policies: JsonObject;
  extra: JsonObject;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Agent {
  id: Uuid;
  workspace_id: Uuid;
  kind: 'own' | 'catalog' | 'system';
  agent_type: AgentTypeName;
  catalog_slug: string | null;
  name: string;
  avatar_url: string | null;
  description: string | null;
  active_version_id: Uuid | null;
  status: 'draft' | 'published' | 'paused' | 'archived';
  mode: AgentMode;
  created_by: Uuid | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

/** Inmutable una vez publicada: solo `status` admite cambio (a `rolled_back`). */
export interface AgentVersion {
  id: Uuid;
  workspace_id: Uuid;
  agent_id: Uuid;
  version: number;
  spec: JsonObject;
  compiled_prompt: string;
  prompt_hash: string;
  model: string | null;
  changelog: string | null;
  status: 'published' | 'rolled_back';
  published_by: Uuid | null;
  published_at: Timestamptz;
}

export type DraftPhase =
  | 'discovery' | 'company' | 'persona' | 'knowledge'
  | 'tools' | 'channels' | 'review' | 'published';

export interface AgentDraft {
  id: Uuid;
  workspace_id: Uuid;
  agent_id: Uuid | null;
  spec: JsonObject;
  phase: DraftPhase;
  progress: JsonObject;
  thread_id: Uuid | null;
  created_by: Uuid | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface AgentVariable {
  id: Uuid;
  workspace_id: Uuid;
  agent_id: Uuid;
  key: string;
  label: string | null;
  value_type: 'text' | 'number' | 'boolean' | 'date' | 'json' | 'secret';
  default_value: Json | null;
  is_required: boolean;
  scope: 'agent' | 'conversation' | 'contact';
  description: string | null;
  created_at: Timestamptz;
}

export interface AgentTool {
  id: Uuid;
  workspace_id: Uuid;
  agent_id: Uuid;
  tool_id: Uuid;
  is_enabled: boolean;
  config: JsonObject;
  auto_approve: boolean;
  position: number;
  created_at: Timestamptz;
}

export interface AgentBrain {
  id: Uuid;
  workspace_id: Uuid;
  agent_id: Uuid;
  brain_id: Uuid;
  top_k: number;
  threshold: Numeric;
  is_enabled: boolean;
  created_at: Timestamptz;
}

/** Global: no lleva workspace_id porque es catalogo de producto. */
export interface CatalogAgent {
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  agent_type: AgentTypeName;
  category: string;
  avatar_url: string | null;
  spec_template: JsonObject;
  required_tools: string[];
  monthly_credits: number;
  setup_credits: number;
  is_published: boolean;
  position: number;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface AgentSubscription {
  id: Uuid;
  workspace_id: Uuid;
  catalog_slug: string;
  agent_id: Uuid | null;
  status: 'active' | 'paused' | 'cancelled';
  started_at: Timestamptz;
  cancelled_at: Timestamptz | null;
  settings: JsonObject;
  created_by: Uuid | null;
  created_at: Timestamptz;
}

// ============================================================================
// 0004 · Conversaciones
// ============================================================================

export interface ContactProperty {
  id: Uuid;
  workspace_id: Uuid;
  key: string;
  label: string;
  value_type:
    | 'text' | 'number' | 'boolean' | 'date'
    | 'select' | 'multiselect' | 'url' | 'email' | 'phone';
  options: Json[];
  is_system: boolean;
  position: number;
  created_at: Timestamptz;
}

export interface Contact {
  id: Uuid;
  workspace_id: Uuid;
  external_id: string | null;
  phone: string | null;
  email: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  locale: string | null;
  timezone: string | null;
  properties: JsonObject;
  is_blocked: boolean;
  opted_out_at: Timestamptz | null;
  last_seen_at: Timestamptz | null;
  source: string | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export type HandoverState = 'bot' | 'human' | 'pending_human';
export type ConversationStatus = 'open' | 'snoozed' | 'closed';

export interface Conversation {
  id: Uuid;
  workspace_id: Uuid;
  contact_id: Uuid;
  channel_id: Uuid;
  agent_id: Uuid | null;
  external_key: string | null;
  status: ConversationStatus;
  handover_state: HandoverState;
  bot_enabled: boolean;
  bot_paused_until: Timestamptz | null;
  assignee_user_id: Uuid | null;
  assigned_team_id: Uuid | null;
  last_inbound_at: Timestamptz | null;
  last_outbound_at: Timestamptz | null;
  last_message_at: Timestamptz | null;
  /** Generica a proposito: aqui se proyecta la ventana de sesion de WhatsApp. */
  send_restriction_until: Timestamptz | null;
  snoozed_until: Timestamptz | null;
  engine_lock_until: Timestamptz | null;
  pending_run_at: Timestamptz | null;
  summary: string | null;
  variables: JsonObject;
  unread_count: number;
  priority: number;
  closed_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export type MessageDirection = 'inbound' | 'outbound';
export type MessageAuthorType = 'contact' | 'bot' | 'human' | 'system';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'deleted';
export type MessageContentType =
  | 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker'
  | 'location' | 'contacts' | 'template' | 'interactive' | 'system' | 'unsupported';

export interface Message {
  id: Uuid;
  workspace_id: Uuid;
  conversation_id: Uuid;
  contact_id: Uuid | null;
  channel_id: Uuid | null;
  /** Barrera de idempotencia junto a workspace_id. */
  external_id: string | null;
  direction: MessageDirection;
  author_type: MessageAuthorType;
  author_user_id: Uuid | null;
  agent_id: Uuid | null;
  agent_version_id: Uuid | null;
  content_type: MessageContentType;
  content: JsonObject;
  reply_to_id: Uuid | null;
  status: MessageStatus;
  error_code: string | null;
  error_detail: string | null;
  sent_at: Timestamptz | null;
  delivered_at: Timestamptz | null;
  read_at: Timestamptz | null;
  provider_timestamp: Timestamptz | null;
  created_at: Timestamptz;
}

export interface MessageStatusEvent {
  id: string;
  workspace_id: Uuid;
  message_id: Uuid;
  status: Exclude<MessageStatus, 'pending'>;
  error_code: string | null;
  detail: JsonObject;
  occurred_at: Timestamptz;
  created_at: Timestamptz;
}

export interface MediaAsset {
  id: Uuid;
  workspace_id: Uuid;
  message_id: Uuid | null;
  external_id: string | null;
  storage_path: string | null;
  url: string | null;
  mime_type: string | null;
  file_name: string | null;
  size_bytes: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  sha256: string | null;
  transcript: string | null;
  caption: string | null;
  status: 'pending' | 'stored' | 'failed' | 'expired';
  created_at: Timestamptz;
}

export interface ConversationEvent {
  id: string;
  workspace_id: Uuid;
  conversation_id: Uuid;
  type: string;
  actor_type: 'contact' | 'bot' | 'human' | 'system' | 'automation';
  actor_user_id: Uuid | null;
  payload: JsonObject;
  created_at: Timestamptz;
}

export interface Note {
  id: Uuid;
  workspace_id: Uuid;
  conversation_id: Uuid | null;
  contact_id: Uuid | null;
  author_user_id: Uuid | null;
  body: string;
  mentions: Uuid[];
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Tag {
  id: Uuid;
  workspace_id: Uuid;
  name: string;
  color: string;
  description: string | null;
  created_at: Timestamptz;
}

export interface Tagging {
  id: Uuid;
  workspace_id: Uuid;
  tag_id: Uuid;
  entity_type: 'conversation' | 'contact';
  entity_id: Uuid;
  created_by: Uuid | null;
  created_at: Timestamptz;
}

export interface QuickReply {
  id: Uuid;
  workspace_id: Uuid;
  shortcut: string;
  title: string;
  body: string;
  category: string | null;
  is_shared: boolean;
  created_by: Uuid | null;
  usage_count: number;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

// ============================================================================
// 0005 · Ingesta
// ============================================================================

export interface WebhookEvent {
  id: Uuid;
  received_at: Timestamptz;
  provider: string;
  external_key: string | null;
  workspace_id: Uuid | null;
  channel_id: Uuid | null;
  event_type: string | null;
  event_hash: string;
  signature_ok: boolean;
  payload: Json;
  headers: JsonObject;
  status: 'pending' | 'processing' | 'processed' | 'skipped' | 'failed';
  attempts: number;
  process_error: string | null;
  processed_at: Timestamptz | null;
}

/** Devuelto por `ingest_webhook_event`. `is_new=false` significa evento repetido. */
export interface IngestResult {
  event_id: Uuid | null;
  is_new: boolean;
  workspace_id: Uuid | null;
  channel_id: Uuid | null;
  agent_id: Uuid | null;
}

// ============================================================================
// 0006 · Conocimiento
// ============================================================================

export interface Brain {
  id: Uuid;
  workspace_id: Uuid;
  name: string;
  description: string | null;
  language: string;
  embedding_model: string;
  chunk_size: number;
  chunk_overlap: number;
  status: 'ready' | 'indexing' | 'error';
  chunk_count: number;
  created_by: Uuid | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface BrainSource {
  id: Uuid;
  workspace_id: Uuid;
  brain_id: Uuid;
  kind: 'text' | 'file' | 'url' | 'sitemap' | 'faq' | 'table' | 'notion' | 'gdrive';
  title: string;
  uri: string | null;
  storage_path: string | null;
  mime_type: string | null;
  raw_content: string | null;
  /** Si no cambia, no se reindexa. */
  content_hash: string | null;
  metadata: JsonObject;
  status: 'pending' | 'indexing' | 'indexed' | 'error' | 'stale';
  error_detail: string | null;
  chunk_count: number;
  indexed_at: Timestamptz | null;
  created_by: Uuid | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface BrainChunk {
  id: Uuid;
  workspace_id: Uuid;
  brain_id: Uuid;
  source_id: Uuid;
  position: number;
  content: string;
  token_count: number | null;
  /** vector(1536); se envia como array de numeros o como literal `[..]`. */
  embedding: number[] | null;
  metadata: JsonObject;
  created_at: Timestamptz;
}

/** Fila de `search_knowledge`: fusion RRF de la lista vectorial y la lexica. */
export interface KnowledgeHit {
  chunk_id: Uuid;
  source_id: Uuid;
  brain_id: Uuid;
  content: string;
  score: number;
  vec_rank: number | null;
  lex_rank: number | null;
  distance: number | null;
  metadata: JsonObject;
}

// ============================================================================
// 0007 · Herramientas y trazas
// ============================================================================

export interface Tool {
  id: Uuid;
  /** Nulo = herramienta de sistema, global y de solo lectura para el cliente. */
  workspace_id: Uuid | null;
  slug: string;
  name: string;
  description: string | null;
  kind: 'http' | 'builtin' | 'mcp' | 'sql' | 'webhook' | 'handover' | 'schedule';
  input_schema: JsonObject;
  output_schema: JsonObject;
  config: JsonObject;
  connection_id: Uuid | null;
  requires_connection: boolean;
  is_enabled: boolean;
  timeout_ms: number;
  created_by: Uuid | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Connection {
  id: Uuid;
  workspace_id: Uuid;
  provider: string;
  name: string;
  auth_type: 'api_key' | 'oauth2' | 'basic' | 'bearer' | 'none';
  credentials_encrypted: string | null;
  key_version: number;
  metadata: JsonObject;
  scopes: string[];
  expires_at: Timestamptz | null;
  last_verified_at: Timestamptz | null;
  status: 'active' | 'expired' | 'revoked' | 'error';
  created_by: Uuid | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export const SKIP_REASONS = [
  'no_credits', 'taken_over', 'bot_paused', 'bot_disabled',
  'outside_hours', 'duplicate', 'contact_blocked', 'send_restricted',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export interface AgentRun {
  id: Uuid;
  workspace_id: Uuid;
  agent_id: Uuid | null;
  agent_version_id: Uuid | null;
  conversation_id: Uuid | null;
  message_id: Uuid | null;
  trigger: 'inbound' | 'schedule' | 'automation' | 'manual' | 'retry' | 'catalog_task';
  status: 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
  skip_reason: SkipReason | null;
  mode: AgentMode | null;
  model: string | null;
  fallback_used: boolean;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  latency_ms: number | null;
  ttft_ms: number | null;
  credits: Numeric;
  steps: number;
  error_code: string | null;
  error_detail: string | null;
  metadata: JsonObject;
  started_at: Timestamptz;
  finished_at: Timestamptz | null;
}

export interface ToolRun {
  id: Uuid;
  workspace_id: Uuid;
  agent_run_id: Uuid | null;
  conversation_id: Uuid | null;
  tool_id: Uuid | null;
  connection_id: Uuid | null;
  tool_slug: string;
  call_id: string | null;
  input: JsonObject;
  output: Json | null;
  status: 'running' | 'succeeded' | 'failed' | 'timeout' | 'rejected' | 'awaiting_approval';
  http_status: number | null;
  error_code: string | null;
  error_detail: string | null;
  latency_ms: number | null;
  credits: Numeric;
  started_at: Timestamptz;
  finished_at: Timestamptz | null;
}

// ============================================================================
// 0008 · Facturacion y creditos
// ============================================================================

export interface Subscription {
  id: Uuid;
  workspace_id: Uuid;
  organization_id: Uuid | null;
  plan: 'trial' | 'starter' | 'growth' | 'business' | 'enterprise';
  status: 'trialing' | 'active' | 'past_due' | 'paused' | 'cancelled';
  provider: string;
  external_id: string | null;
  seats: number;
  included_credits_monthly: Numeric;
  currency: string;
  price_amount: Numeric;
  current_period_start: Timestamptz;
  current_period_end: Timestamptz;
  trial_ends_at: Timestamptz | null;
  cancel_at: Timestamptz | null;
  cancelled_at: Timestamptz | null;
  metadata: JsonObject;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface CreditWallet {
  workspace_id: Uuid;
  included_balance: Numeric;
  purchased_balance: Numeric;
  reserved_balance: Numeric;
  included_granted: Numeric;
  low_balance_threshold: Numeric;
  period_start: Timestamptz;
  period_end: Timestamptz;
  updated_at: Timestamptz;
}

export type RateKind =
  | 'model_input' | 'model_output' | 'model_cache_read'
  | 'embedding' | 'tool_call' | 'message_out' | (string & {});

export interface CreditRate {
  id: Uuid;
  kind: RateKind;
  ref_key: string;
  unit: 'unit' | 'ktoken' | 'message' | 'minute' | 'run' | 'mb';
  credits_per_unit: Numeric;
  description: string | null;
  effective_from: Timestamptz;
  effective_to: Timestamptz | null;
  created_at: Timestamptz;
}

export interface ModelTier {
  mode: AgentMode;
  task: string;
  provider: string;
  primary_model: string;
  fallback_models: string[];
  params: JsonObject;
  max_tokens: number | null;
  notes: string | null;
  updated_at: Timestamptz;
}

export interface CreditLedgerEntry {
  id: Uuid;
  created_at: Timestamptz;
  workspace_id: Uuid;
  direction: 'debit' | 'credit';
  source: string;
  amount: Numeric;
  from_included: Numeric;
  from_purchased: Numeric;
  balance_after: Numeric;
  idempotency_key: string;
  rate_snapshot: Json;
  ref_type: string | null;
  ref_id: Uuid | null;
  agent_run_id: Uuid | null;
  description: string | null;
  metadata: JsonObject;
}

/** Una linea a valorar en `charge_credits`. */
export interface ChargeItem {
  kind: RateKind;
  ref_key?: string;
  quantity: number;
}

export interface ChargeResult {
  applied: boolean;
  /** `no_credits` cuando falta saldo, `duplicate` cuando el reintento ya se cobro. */
  reason: 'no_credits' | 'duplicate' | null;
  credits: Numeric;
  from_included: Numeric;
  from_purchased: Numeric;
  balance_after: Numeric;
  ledger_id: Uuid | null;
}

export interface UsageDaily {
  workspace_id: Uuid;
  day: DateOnly;
  agent_id: Uuid | null;
  conversations_started: number;
  conversations_active: number;
  messages_in: number;
  messages_out: number;
  agent_runs: number;
  agent_runs_skipped: number;
  tool_runs: number;
  input_tokens: string;
  output_tokens: string;
  cache_tokens: string;
  credits_spent: Numeric;
  handovers: number;
  avg_latency_ms: number | null;
  updated_at: Timestamptz;
}

export interface WabaAnalyticsDaily {
  workspace_id: Uuid;
  day: DateOnly;
  waba_id: string;
  phone_number_id: string;
  country: string;
  conversation_category: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  conversations: number;
  cost_usd: Numeric;
  raw: JsonObject;
  updated_at: Timestamptz;
}

// ============================================================================
// 0009 · Analisis, automatizacion, evaluacion y extraccion
// ============================================================================

export interface ConversationAnalysis {
  id: Uuid;
  workspace_id: Uuid;
  conversation_id: Uuid;
  agent_run_id: Uuid | null;
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed' | null;
  sentiment_score: Numeric | null;
  intent: string | null;
  topics: string[];
  language: string | null;
  resolution: 'resolved' | 'unresolved' | 'escalated' | 'abandoned' | null;
  csat_estimate: number | null;
  lead_score: number | null;
  summary: string | null;
  highlights: Json[];
  model: string | null;
  analyzed_at: Timestamptz;
  message_count_at_analysis: number | null;
}

export interface Automation {
  id: Uuid;
  workspace_id: Uuid;
  name: string;
  description: string | null;
  is_enabled: boolean;
  trigger: JsonObject;
  conditions: Json[];
  actions: Json[];
  run_count: number;
  last_run_at: Timestamptz | null;
  created_by: Uuid | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface AutomationRun {
  id: Uuid;
  workspace_id: Uuid;
  automation_id: Uuid;
  conversation_id: Uuid | null;
  contact_id: Uuid | null;
  trigger_payload: JsonObject;
  status: 'running' | 'succeeded' | 'failed' | 'skipped';
  skip_reason: string | null;
  actions_result: Json[];
  error_detail: string | null;
  latency_ms: number | null;
  idempotency_key: string | null;
  started_at: Timestamptz;
  finished_at: Timestamptz | null;
}

export interface EvalCase {
  id: Uuid;
  workspace_id: Uuid;
  agent_id: Uuid | null;
  name: string;
  input: JsonObject;
  expected: JsonObject;
  assertions: Json[];
  tags: string[];
  source_conversation_id: Uuid | null;
  is_enabled: boolean;
  last_status: 'passed' | 'failed' | 'error' | 'skipped' | null;
  last_run_at: Timestamptz | null;
  last_version_id: Uuid | null;
  created_by: Uuid | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface ExtractionSchema {
  id: Uuid;
  workspace_id: Uuid;
  agent_id: Uuid | null;
  name: string;
  description: string | null;
  json_schema: JsonObject;
  target: 'conversation' | 'contact' | 'message';
  write_to_contact: boolean;
  is_enabled: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Extraction {
  id: Uuid;
  workspace_id: Uuid;
  schema_id: Uuid;
  conversation_id: Uuid | null;
  contact_id: Uuid | null;
  message_id: Uuid | null;
  agent_run_id: Uuid | null;
  data: JsonObject;
  confidence: Numeric | null;
  status: 'extracted' | 'partial' | 'failed' | 'confirmed';
  model: string | null;
  created_at: Timestamptz;
}

// ============================================================================
// Mapa nombre de tabla -> fila
// ============================================================================

export interface Tables {
  organizations: Organization;
  workspaces: Workspace;
  profiles: Profile;
  memberships: Membership;
  invitations: Invitation;
  teams: Team;
  team_members: TeamMember;
  audit_log: AuditLogEntry;
  channel_kinds: ChannelKindRow;
  channels: Channel;
  whatsapp_accounts: WhatsappAccount;
  whatsapp_numbers: WhatsappNumber;
  channel_routing: ChannelRoute;
  agent_types: AgentTypeRow;
  company_profiles: CompanyProfile;
  agents: Agent;
  agent_versions: AgentVersion;
  agent_drafts: AgentDraft;
  agent_variables: AgentVariable;
  agent_tools: AgentTool;
  agent_brains: AgentBrain;
  catalog_agents: CatalogAgent;
  agent_subscriptions: AgentSubscription;
  contact_properties: ContactProperty;
  contacts: Contact;
  conversations: Conversation;
  messages: Message;
  message_status_events: MessageStatusEvent;
  media: MediaAsset;
  conversation_events: ConversationEvent;
  notes: Note;
  tags: Tag;
  taggings: Tagging;
  quick_replies: QuickReply;
  webhook_events: WebhookEvent;
  brains: Brain;
  brain_sources: BrainSource;
  brain_chunks: BrainChunk;
  tools: Tool;
  connections: Connection;
  agent_runs: AgentRun;
  tool_runs: ToolRun;
  subscriptions: Subscription;
  credit_wallets: CreditWallet;
  credit_rates: CreditRate;
  model_tiers: ModelTier;
  credit_ledger: CreditLedgerEntry;
  usage_daily: UsageDaily;
  waba_analytics_daily: WabaAnalyticsDaily;
  conversation_analysis: ConversationAnalysis;
  automations: Automation;
  automation_runs: AutomationRun;
  eval_cases: EvalCase;
  extraction_schemas: ExtractionSchema;
  extractions: Extraction;
}

export type TableName = keyof Tables;
export type Row<T extends TableName> = Tables[T];

/** Tablas cuyo `workspace_id` puede ser nulo (fila global compartida). */
export type GlobalRowTable = 'tools' | 'webhook_events';

/** Tablas sin `workspace_id`: catalogo de producto, no dato de cliente. */
export type GlobalTable =
  | 'channel_kinds' | 'agent_types' | 'catalog_agents'
  | 'credit_rates' | 'model_tiers';

/** Tablas que un usuario solo puede LEER: las escribe el rol de servicio. */
export type ReadOnlyTable =
  | 'audit_log' | 'channel_routing' | 'webhook_events'
  | 'message_status_events' | 'conversation_events'
  | 'agent_runs' | 'tool_runs'
  | 'subscriptions' | 'credit_wallets' | 'credit_ledger'
  | 'usage_daily' | 'waba_analytics_daily'
  | 'conversation_analysis' | 'automation_runs' | 'extractions';

/** Tablas publicadas en Realtime. */
export const REALTIME_TABLES = ['messages', 'conversations', 'conversation_events'] as const;
export type RealtimeTable = (typeof REALTIME_TABLES)[number];
