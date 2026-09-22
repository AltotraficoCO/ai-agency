/**
 * La cola en Postgres, con `FOR UPDATE SKIP LOCKED`.
 *
 * Es el patrón que permite tener varios workers tirando de la misma tabla:
 * cada uno bloquea la fila que se lleva y los demás la SALTAN en vez de
 * quedarse esperando. Sin `SKIP LOCKED`, dos workers se serializan en la
 * primera fila de la cola y el segundo no sirve para nada.
 *
 * El arrendamiento (`lease_until`) es la otra mitad: si un worker muere a
 * mitad de una tarea de nueve minutos, la fila se queda en `running` para
 * siempre. Con arrendamiento, otro worker la recoge cuando expira, y
 * `intentos` impide que un fallo determinista se reintente sin fin.
 *
 * La tabla está en `packages/db/migrations/0015_tareas_webmaster.sql`.
 */
import type {
  CierreTarea,
  SqlPool,
  TareaReclamada,
  TaskQueuePort,
} from "../ports.js";

const MAX_INTENTOS = 3;

type FilaTarea = {
  id: string;
  workspace_id: string;
  site_id: string | null;
  agente: string | null;
  agent_id: string | null;
  titulo: string;
  detalle: string | null;
  intentos: number;
  mensajes: unknown;
  aprobaciones: unknown;
  pasos: unknown;
};

export type OpcionesColaPostgres = {
  readonly tabla?: string;
  readonly maxIntentos?: number;
};

export class ColaPostgres implements TaskQueuePort {
  readonly #pool: SqlPool;
  readonly #tabla: string;
  readonly #maxIntentos: number;

  constructor(pool: SqlPool, o: OpcionesColaPostgres = {}) {
    this.#pool = pool;
    // Nombre de tabla fijo y validado: nunca se interpola nada del exterior.
    const tabla = o.tabla ?? "public.agent_tasks";
    if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(tabla)) {
      throw new Error(`Nombre de tabla inválido para la cola: "${tabla}".`);
    }
    this.#tabla = tabla;
    this.#maxIntentos = o.maxIntentos ?? MAX_INTENTOS;
  }

  async reclamar(input: { workerId: string; arrendamientoMs: number }): Promise<TareaReclamada | null> {
    const conn = await this.#pool.connect();
    try {
      await conn.query("begin");
      // La subconsulta elige UNA fila elegible y la bloquea; SKIP LOCKED hace
      // que otro worker que llegue a la vez se lleve la siguiente, no un error.
      const { rows } = await conn.query<FilaTarea>(
        `update ${this.#tabla} t
            set estado      = 'running',
                worker_id   = $1,
                lease_until = now() + ($2::bigint * interval '1 millisecond'),
                intentos    = t.intentos + 1,
                started_at  = coalesce(t.started_at, now()),
                updated_at  = now()
          where t.id = (
            select c.id from ${this.#tabla} c
             where (c.estado = 'queued'
                    or (c.estado = 'running' and c.lease_until < now())
                    or (c.estado = 'aprobada' ))
               and c.intentos < $3
               and (c.programada_para is null or c.programada_para <= now())
             order by c.prioridad desc, c.created_at
             for update skip locked
             limit 1
          )
        returning t.id, t.workspace_id, t.site_id, t.agent_id, t.titulo,
                  t.detalle, t.intentos, t.mensajes, t.aprobaciones,
                  -- Por fila entera: si la migración 0018 aún no está aplicada, sale null en vez de romper.
                  to_jsonb(t)->'pasos' as pasos,
                  -- Igual con 0029: sin la columna agente sale null, y el
                  -- consumidor lo trata como Webmaster, que es lo que era.
                  to_jsonb(t)->>'agente' as agente`,
        [input.workerId, input.arrendamientoMs, this.#maxIntentos],
      );
      await conn.query("commit");
      const fila = rows[0];
      if (!fila) return null;
      return {
        id: fila.id,
        workspaceId: fila.workspace_id,
        siteId: fila.site_id ?? null,
        ...(fila.agente ? { agente: fila.agente } : {}),
        ...(fila.agent_id ? { agentId: fila.agent_id } : {}),
        titulo: fila.titulo,
        detalle: fila.detalle,
        intentos: fila.intentos,
        ...(Array.isArray(fila.mensajes) ? { mensajes: fila.mensajes } : {}),
        ...(Array.isArray(fila.aprobaciones)
          ? { aprobaciones: fila.aprobaciones as TareaReclamada["aprobaciones"] }
          : {}),
        ...(Array.isArray(fila.pasos) ? { pasos: fila.pasos } : {}),
      };
    } catch (e) {
      await conn.query("rollback").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }

  async latido(input: {
    taskId: string;
    workerId: string;
    arrendamientoMs: number;
  }): Promise<void> {
    await this.#pool.query(
      `update ${this.#tabla}
          set lease_until = now() + ($3::bigint * interval '1 millisecond'), updated_at = now()
        where id = $1 and worker_id = $2 and estado = 'running'`,
      [input.taskId, input.workerId, input.arrendamientoMs],
    );
  }

  async completar(input: { taskId: string; workerId: string } & CierreTarea): Promise<void> {
    await this.#pool.query(
      `update ${this.#tabla}
          set estado = 'done', resumen = $3, evidencia = $4::jsonb, creditos = $5,
              mensajes = null, aprobaciones = null,
              finished_at = now(), updated_at = now(), lease_until = null
        where id = $1 and worker_id = $2`,
      [input.taskId, input.workerId, input.resumen, JSON.stringify(input.evidencia), input.creditos],
    );
  }

  async traspasarEspera(input: {
    workspaceId: string;
    agente: string;
    titulo: string;
    detalle: string;
    resumen: string;
    evidencia: unknown;
    creditos: number;
    mensajes: readonly unknown[];
    pasos: readonly unknown[];
    aprobacionIds: readonly string[];
  }): Promise<string | null> {
    const conn = await this.#pool.connect();
    try {
      await conn.query("begin");
      const creado = await conn.query<{ id: string }>(
        `insert into ${this.#tabla}
           (workspace_id, agent_id, site_id, titulo, detalle, agente, estado,
            resumen, evidencia, creditos, mensajes, pasos)
         select $1,
                (select s.agent_id from public.agent_subscriptions s
                  where s.workspace_id = $1 and s.catalog_slug = $2 and s.status = 'active'
                  order by s.started_at desc limit 1),
                (select c.id from public.connections c
                  where c.workspace_id = $1 and c.provider = any($3::text[]) and c.status = 'active'
                  order by c.updated_at desc limit 1),
                $4, $5, $2, 'esperando_aprobacion', $6, $7::jsonb, $8, $9::jsonb, $10::jsonb
          where exists (select 1 from public.connections c
                         where c.workspace_id = $1 and c.provider = any($3::text[]) and c.status = 'active')
         returning id`,
        [
          input.workspaceId,
          input.agente,
          proveedoresDe(input.agente),
          input.titulo,
          input.detalle,
          input.resumen,
          JSON.stringify(input.evidencia),
          input.creditos,
          JSON.stringify(input.mensajes),
          JSON.stringify(input.pasos),
        ],
      );
      const id = creado.rows[0]?.id ?? null;
      if (id && input.aprobacionIds.length > 0) {
        await conn.query(
          `update public.task_approvals set task_id = $2, updated_at = now()
            where workspace_id = $1 and id = any($3::uuid[])`,
          [input.workspaceId, id, [...input.aprobacionIds]],
        );
      }
      await conn.query("commit");
      return id;
    } catch (error) {
      await conn.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      conn.release();
    }
  }

  async suspender(input: {
    taskId: string;
    workerId: string;
    resumen: string;
    evidencia: unknown;
    creditos: number;
    mensajes: readonly unknown[];
  }): Promise<void> {
    // `esperando_aprobacion` no consume intentos: no falló nada, falta un clic.
    await this.#pool.query(
      `update ${this.#tabla}
          set estado = 'esperando_aprobacion', resumen = $3, evidencia = $4::jsonb,
              creditos = coalesce(creditos, 0) + $5, mensajes = $6::jsonb,
              intentos = greatest(intentos - 1, 0),
              updated_at = now(), lease_until = null
        where id = $1 and worker_id = $2`,
      [
        input.taskId,
        input.workerId,
        input.resumen,
        JSON.stringify(input.evidencia),
        input.creditos,
        JSON.stringify(input.mensajes),
      ],
    );
  }

  async fallar(input: {
    taskId: string;
    workerId: string;
    error: string;
    motivo: string;
    evidencia: unknown;
    reintentable: boolean;
  }): Promise<void> {
    await this.#pool.query(
      `update ${this.#tabla}
          set estado = case when $5 and intentos < $6 then 'queued' else 'failed' end,
              error = $3, error_motivo = $7, evidencia = $4::jsonb,
              finished_at = case when $5 and intentos < $6 then null else now() end,
              updated_at = now(), lease_until = null
        where id = $1 and worker_id = $2`,
      [
        input.taskId,
        input.workerId,
        input.error,
        JSON.stringify(input.evidencia),
        input.reintentable,
        this.#maxIntentos,
        input.motivo,
      ],
    );
  }

  async registrarPasos(input: { taskId: string; workerId: string; pasos: readonly unknown[] }): Promise<void> {
    // Solo quien tiene la tarea escribe su registro: un worker que perdió el
    // arrendamiento no pisa lo que ya está contando el que la recogió.
    await this.#pool.query(
      `update ${this.#tabla}
          set pasos = $3::jsonb, updated_at = now()
        where id = $1 and worker_id = $2`,
      [input.taskId, input.workerId, JSON.stringify(input.pasos)],
    );
  }
}

/** Sobre qué conexión trabaja cada oficio; la misma tabla que usa el programador. */
function proveedoresDe(agente: string): string[] {
  if (agente === "marketing") return ["google_ads", "meta_ads", "tiktok_ads"];
  if (agente === "administrativo" || agente === "reportes") return ["alegra"];
  return ["wordpress"];
}
