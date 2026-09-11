/**
 * Cliente de base de datos con helpers de tenencia.
 *
 * No depende de ningun driver concreto: se define la interfaz minima que debe
 * cumplir (`SqlExecutor`) y encajan `pg`, `postgres.js` o el pool de Supabase.
 * La razon es que el paquete no debe imponer el driver a la web ni al worker.
 *
 * REGLA DE ORO DEL WORKER
 * -----------------------
 * El worker NO usa el rol de servicio. Se conecta como `strappy_worker` y toda
 * consulta ocurre dentro de `withWorkspace()`, que abre transaccion y ejecuta
 * `SET LOCAL app.workspace_id`. A partir de ahi la RLS del rol solo deja ver ese
 * espacio, de modo que un join mal escrito devuelve cero filas en lugar de datos
 * de otro cliente. Las funciones criticas (`charge_credits`, `grant_credits`)
 * ademas revalidan con `assert_workspace()`.
 */

import type {
  ChannelRoute,
  ChargeItem,
  ChargeResult,
  IngestResult,
  Json,
  KnowledgeHit,
  Numeric,
  Uuid,
} from './types.js';

// ---------------------------------------------------------------------------
// Interfaz minima del driver
// ---------------------------------------------------------------------------

export interface QueryResult<T> {
  rows: T[];
}

export interface SqlExecutor {
  query<T = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

/** Un pool capaz de reservar una conexion exclusiva (necesario para transacciones). */
export interface SqlPool extends SqlExecutor {
  connect(): Promise<PooledConnection>;
}

export interface PooledConnection extends SqlExecutor {
  release(): void;
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export class TenantMismatchError extends Error {
  constructor(
    readonly declared: Uuid,
    readonly attempted: Uuid,
  ) {
    super(
      `Cruce de tenant bloqueado: la transaccion declaro ${declared} pero la operacion apunta a ${attempted}`,
    );
    this.name = 'TenantMismatchError';
  }
}

export class InsufficientCreditsError extends Error {
  constructor(readonly workspaceId: Uuid, readonly required: Numeric) {
    super(`Sin creditos suficientes en el espacio ${workspaceId} (requeridos ${required})`);
    this.name = 'InsufficientCreditsError';
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Valida que un identificador es un UUID antes de interpolarlo.
 * `SET LOCAL` no admite parametros vinculados, asi que el valor se interpola en
 * el texto: sin esta comprobacion seria una via de inyeccion.
 */
export function assertUuid(value: string, label = 'uuid'): Uuid {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label} invalido: se esperaba un UUID`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Contexto de tenant
// ---------------------------------------------------------------------------

/** Conexion ya acotada a un espacio de trabajo. */
export interface TenantScope extends SqlExecutor {
  readonly workspaceId: Uuid;
  /** Lanza `TenantMismatchError` si el id no es el del ambito abierto. */
  assertSameWorkspace(workspaceId: Uuid): void;
}

function makeScope(conn: SqlExecutor, workspaceId: Uuid): TenantScope {
  // Un scope es UNA conexion dentro de una transaccion: lo que se le lance con
  // `Promise.all` no va en paralelo, pg lo encola solo... y hacerlo esta
  // deprecado (desaparece en pg@9). Se encola aqui, en el unico sitio por el
  // que pasa toda consulta con tenant, en vez de perseguir cada `Promise.all`.
  // Un fallo no rompe la cola: cada consulta sigue devolviendo su propio error.
  let cola: Promise<unknown> = Promise.resolve();
  return {
    workspaceId,
    query: <T = Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
      const turno = cola.then(() => conn.query<T>(text, values));
      cola = turno.catch(() => undefined);
      return turno;
    },
    assertSameWorkspace(other: Uuid) {
      if (other !== workspaceId) throw new TenantMismatchError(workspaceId, other);
    },
  };
}

// ---------------------------------------------------------------------------
// Cliente del worker
// ---------------------------------------------------------------------------

export interface WorkerClientOptions {
  /** Statement timeout por transaccion, en milisegundos. */
  statementTimeoutMs?: number;
  /**
   * Rol que se asume dentro de la transaccion, p.ej. `strappy_worker`.
   *
   * `strappy_worker` se crea NOLOGIN a proposito: no es un rol al que uno se
   * conecte, es un rol al que uno BAJA. Quien se conecta lo hace con una
   * cuenta con permiso de conexion y aqui renuncia a sus privilegios para lo
   * que queda de transaccion. Asi el codigo de aplicacion nunca corre con
   * BYPASSRLS, que es justo lo que convierte un join mal escrito en una fuga
   * entre clientes.
   */
  assumeRole?: string;
}

export interface WorkerClient {
  /**
   * Abre una transaccion, declara `app.workspace_id` y ejecuta el trabajo.
   * Confirma al terminar y revierte ante cualquier error.
   */
  withWorkspace<T>(workspaceId: Uuid, fn: (scope: TenantScope) => Promise<T>): Promise<T>;

  /** Resuelve el tenant de un webhook con UNA lectura por clave primaria. */
  resolveRoute(externalKey: string): Promise<ChannelRoute | null>;

  /** Guarda el webhook crudo de forma idempotente y devuelve el tenant resuelto. */
  ingestWebhookEvent(input: IngestWebhookInput): Promise<IngestResult>;
}

export interface IngestWebhookInput {
  provider: string;
  eventHash: string;
  payload: Json;
  signatureOk: boolean;
  externalKey?: string | null;
  eventType?: string | null;
  headers?: Json;
}

export function createWorkerClient(pool: SqlPool, options: WorkerClientOptions = {}): WorkerClient {
  const timeout = options.statementTimeoutMs ?? 15_000;

  return {
    async withWorkspace(workspaceId, fn) {
      const id = assertUuid(workspaceId, 'workspaceId');
      const conn = await pool.connect();
      try {
        await conn.query('begin');
        if (options.assumeRole) {
          if (!/^[a-z_][a-z0-9_]*$/.test(options.assumeRole)) {
            throw new Error(`Nombre de rol invalido: ${options.assumeRole}`);
          }
          await conn.query(`set local role ${options.assumeRole}`);
        }
        // SET LOCAL no acepta parametros vinculados: por eso se valida el UUID.
        await conn.query(`set local app.workspace_id = '${id}'`);
        await conn.query(`set local statement_timeout = ${Number(timeout) | 0}`);
        const result = await fn(makeScope(conn, id));
        await conn.query('commit');
        return result;
      } catch (error) {
        try {
          await conn.query('rollback');
        } catch {
          /* la conexion ya estaba rota */
        }
        throw error;
      } finally {
        conn.release();
      }
    },

    async resolveRoute(externalKey) {
      const { rows } = await pool.query<ChannelRoute>(
        `select external_key, kind, workspace_id, channel_id, agent_id, account_id,
                is_active, updated_at
           from public.channel_routing
          where external_key = $1`,
        [externalKey],
      );
      return rows[0] ?? null;
    },

    async ingestWebhookEvent(input) {
      const { rows } = await pool.query<IngestResult>(
        `select * from public.ingest_webhook_event($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb)`,
        [
          input.provider,
          input.eventHash,
          JSON.stringify(input.payload),
          input.signatureOk,
          input.externalKey ?? null,
          input.eventType ?? null,
          JSON.stringify(input.headers ?? {}),
        ],
      );
      const row = rows[0];
      if (!row) {
        throw new Error('ingest_webhook_event no devolvio ninguna fila');
      }
      return row;
    },
  };
}

// ---------------------------------------------------------------------------
// Creditos
// ---------------------------------------------------------------------------

export interface ChargeCreditsInput {
  /** Clave estable de la operacion, p.ej. `agent_run:<uuid>`. Un reintento reusa la misma. */
  idempotencyKey: string;
  items: ChargeItem[];
  source?: string;
  refType?: string | null;
  refId?: Uuid | null;
  agentRunId?: Uuid | null;
  description?: string | null;
  metadata?: Json;
  occurredAt?: Date | string;
  /** Permite dejar el saldo en negativo. Solo para conciliaciones. */
  allowNegative?: boolean;
}

/**
 * Cobra creditos dentro del ambito abierto.
 *
 * No lanza excepcion cuando falta saldo: devuelve `applied: false` con
 * `reason: 'no_credits'` para que el motor registre `agent_runs.skip_reason` y
 * siga su curso. Un reintento con la misma clave devuelve `reason: 'duplicate'`
 * sin volver a cobrar.
 */
export async function chargeCredits(
  scope: TenantScope,
  input: ChargeCreditsInput,
): Promise<ChargeResult> {
  const { rows } = await scope.query<ChargeResult>(
    `select * from public.charge_credits(
       $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9::jsonb, coalesce($10::timestamptz, now()), $11)`,
    [
      scope.workspaceId,
      input.idempotencyKey,
      JSON.stringify(input.items),
      input.source ?? 'agent_run',
      input.refType ?? null,
      input.refId ?? null,
      input.agentRunId ?? null,
      input.description ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.occurredAt instanceof Date ? input.occurredAt.toISOString() : (input.occurredAt ?? null),
      input.allowNegative ?? false,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('charge_credits no devolvio ninguna fila');
  return row;
}

/** Igual que `chargeCredits` pero lanza `InsufficientCreditsError` si falta saldo. */
export async function chargeCreditsOrThrow(
  scope: TenantScope,
  input: ChargeCreditsInput,
): Promise<ChargeResult> {
  const result = await chargeCredits(scope, input);
  if (!result.applied && result.reason === 'no_credits') {
    throw new InsufficientCreditsError(scope.workspaceId, result.credits);
  }
  return result;
}

export async function grantCredits(
  scope: TenantScope,
  input: { idempotencyKey: string; amount: number; bucket?: 'included' | 'purchased'; source?: string; description?: string },
): Promise<{ applied: boolean; balance_after: Numeric; ledger_id: Uuid | null }> {
  const { rows } = await scope.query<{ applied: boolean; balance_after: Numeric; ledger_id: Uuid | null }>(
    `select * from public.grant_credits($1, $2, $3::numeric, $4, $5, $6)`,
    [
      scope.workspaceId,
      input.idempotencyKey,
      input.amount,
      input.bucket ?? 'purchased',
      input.source ?? 'topup',
      input.description ?? null,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('grant_credits no devolvio ninguna fila');
  return row;
}

/** Comprobacion barata previa a ejecutar un agente. */
export async function hasCredits(scope: TenantScope, min = 1): Promise<boolean> {
  const { rows } = await scope.query<{ has_credits: boolean }>(
    `select public.has_credits($1, $2::numeric) as has_credits`,
    [scope.workspaceId, min],
  );
  return rows[0]?.has_credits ?? false;
}

// ---------------------------------------------------------------------------
// Conocimiento
// ---------------------------------------------------------------------------

/** Serializa un embedding al literal que espera pgvector: `[0.1,0.2,...]`. */
export function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Recuperacion hibrida (vectorial + lexica, fusionadas con RRF).
 * Los `brainIds` deben pertenecer al espacio del ambito: la RLS lo garantiza,
 * pero la comprobacion previa evita una consulta inutil.
 */
export async function searchKnowledge(
  scope: TenantScope,
  input: { brainIds: Uuid[]; query: string; embedding: readonly number[]; k?: number },
): Promise<KnowledgeHit[]> {
  if (input.brainIds.length === 0) return [];
  const { rows } = await scope.query<KnowledgeHit>(
    `select * from public.search_knowledge($1::uuid[], $2, $3::vector, $4)`,
    [input.brainIds, input.query, toVectorLiteral(input.embedding), input.k ?? 8],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Mantenimiento
// ---------------------------------------------------------------------------

/** Crea las particiones mensuales pendientes. Idempotente; llamar a diario. */
export async function ensureMonthPartitions(db: SqlExecutor, monthsAhead = 2): Promise<void> {
  await db.query(`select public.ensure_month_partitions($1)`, [monthsAhead]);
}

/** Aplica la retencion de 30 dias de `webhook_events` soltando particiones enteras. */
export async function dropExpiredWebhookPartitions(
  db: SqlExecutor,
  keepDays = 30,
): Promise<number> {
  const { rows } = await db.query<{ drop_expired_webhook_partitions: number }>(
    `select public.drop_expired_webhook_partitions($1)`,
    [keepDays],
  );
  return rows[0]?.drop_expired_webhook_partitions ?? 0;
}

// ---------------------------------------------------------------------------
// Lado usuario (PostgREST / supabase-js)
// ---------------------------------------------------------------------------

/**
 * Forma estructural minima de un cliente PostgREST. Se declara aqui en lugar de
 * depender de `@supabase/supabase-js` para que este paquete no arrastre esa
 * dependencia a quien solo necesita los tipos.
 */
export interface PostgrestLike {
  from(table: string): {
    select(columns?: string): unknown;
  };
  rpc(fn: string, args?: Record<string, unknown>): unknown;
}

/**
 * Filtro de tenant para el cliente del navegador.
 *
 * La RLS ya impide leer otro espacio; esto es una defensa en profundidad y, sobre
 * todo, evita traerse datos de TODOS los espacios del usuario cuando pertenece a
 * varios, que es el error mas comun en la interfaz.
 */
export function tenantFilter(workspaceId: Uuid): { workspace_id: Uuid } {
  return { workspace_id: assertUuid(workspaceId, 'workspaceId') };
}

/** Filtro de Realtime para suscribirse solo a los cambios del espacio activo. */
export function realtimeFilter(workspaceId: Uuid): string {
  return `workspace_id=eq.${assertUuid(workspaceId, 'workspaceId')}`;
}
