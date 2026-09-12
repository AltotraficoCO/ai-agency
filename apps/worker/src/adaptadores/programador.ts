/**
 * El trabajo programado en Postgres.
 *
 * Mismo patrón que la vigilancia y por la misma razón: `FOR UPDATE SKIP LOCKED`
 * para que dos workers no disparen el mismo programado, y arrendamiento para que
 * la muerte de un proceso no deje la fila bloqueada.
 *
 * Lo que hace distinto a este adaptador: **no ejecuta nada**. Cuando llega la
 * hora inserta un encargo en `agent_tasks` —el mismo insert que hace la web
 * cuando el cliente escribe— y lo ejecuta el consumidor de tareas de siempre.
 * Crear el encargo y programar la siguiente van en UNA transacción: si se
 * cayera entre las dos, el cliente tendría dos informes o ninguno.
 *
 * La tabla está en `packages/db/migrations/0034_trabajo_programado.sql`.
 */
import type { Cadencia } from "@strappy/core";
import type { ProgramadoReclamado, ProgramadorPort, SqlPool } from "../ports.js";

type FilaProgramado = {
  id: string;
  workspace_id: string;
  agent_id: string;
  agente: string;
  titulo: string;
  detalle: string;
  frecuencia: "diaria" | "semanal" | "mensual";
  hora: number;
  minuto: number;
  dia_semana: number | null;
  dia_mes: number | null;
  zona_horaria: string;
  proxima_en: Date;
};

function cadenciaDe(f: FilaProgramado): Cadencia {
  return {
    frecuencia: f.frecuencia,
    hora: f.hora,
    minuto: f.minuto,
    ...(f.dia_semana !== null ? { diaSemana: f.dia_semana } : {}),
    ...(f.dia_mes !== null ? { diaMes: f.dia_mes } : {}),
    zona: f.zona_horaria,
  };
}

export class ProgramadorPostgres implements ProgramadorPort {
  constructor(private readonly pool: SqlPool) {}

  async reclamar(input: {
    workerId: string;
    arrendamientoMs: number;
  }): Promise<ProgramadoReclamado | null> {
    const conn = await this.pool.connect();
    try {
      await conn.query("begin");
      const { rows } = await conn.query<FilaProgramado>(
        `update public.agent_schedules s
            set lease_until = now() + ($2::bigint * interval '1 millisecond'),
                worker_id   = $1,
                updated_at  = now()
          where s.id = (
            select c.id from public.agent_schedules c
             where c.activa
               and c.proxima_en <= now()
               and (c.lease_until is null or c.lease_until < now())
             order by c.proxima_en
             limit 1
             for update skip locked
          )
        returning s.id, s.workspace_id, s.agent_id, s.agente, s.titulo, s.detalle,
                  s.frecuencia, s.hora, s.minuto, s.dia_semana, s.dia_mes,
                  s.zona_horaria, s.proxima_en`,
        [input.workerId, input.arrendamientoMs],
      );
      await conn.query("commit");
      const f = rows[0];
      if (!f) return null;
      return {
        id: f.id,
        workspaceId: f.workspace_id,
        agentId: f.agent_id,
        agente: f.agente,
        titulo: f.titulo,
        detalle: f.detalle,
        cadencia: cadenciaDe(f),
        previstaEn: new Date(f.proxima_en),
      };
    } catch (e) {
      await conn.query("rollback").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }

  /**
   * El encargo y la reprogramación, en una transacción.
   *
   * La conexión sobre la que trabaja el agente se busca igual que en la web: la
   * activa del proveedor que le corresponde. Si no hay ninguna, el encargo se
   * crea igual sin sitio y el agente explica qué le falta conectar, que es más
   * útil que no aparecer.
   */
  async lanzar(input: {
    id: string;
    workerId: string;
    programado: ProgramadoReclamado;
    proxima: Date;
  }): Promise<string | null> {
    const { programado: p } = input;
    const conn = await this.pool.connect();
    try {
      await conn.query("begin");
      const creado = await conn.query<{ id: string }>(
        `insert into public.agent_tasks
           (workspace_id, agent_id, site_id, titulo, detalle, agente)
         select $1, $2,
                (select c.id from public.connections c
                  where c.workspace_id = $1
                    and c.provider = any($6::text[])
                    and c.status = 'active'
                  order by c.updated_at desc
                  limit 1),
                $3, $4, $5
         returning id`,
        [p.workspaceId, p.agentId, p.titulo, p.detalle, p.agente, proveedoresDe(p.agente)],
      );
      const taskId = creado.rows[0]?.id ?? null;

      await conn.query(
        `update public.agent_schedules
            set proxima_en     = $3,
                ultima_en      = now(),
                ultimo_task_id = coalesce($4::uuid, ultimo_task_id),
                lease_until    = null,
                updated_at     = now()
          where id = $1 and worker_id = $2`,
        [input.id, input.workerId, input.proxima.toISOString(), taskId],
      );
      await conn.query("commit");
      return taskId;
    } catch (e) {
      await conn.query("rollback").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }

  async reprogramar(input: { id: string; workerId: string; proxima: Date }): Promise<void> {
    await this.pool.query(
      `update public.agent_schedules
          set proxima_en = $3, lease_until = null, updated_at = now()
        where id = $1 and worker_id = $2`,
      [input.id, input.workerId, input.proxima.toISOString()],
    );
  }

  async pausar(input: { id: string; workerId: string; motivo: string }): Promise<void> {
    await this.pool.query(
      `update public.agent_schedules
          set activa = false, motivo_pausa = $3, lease_until = null, updated_at = now()
        where id = $1 and worker_id = $2`,
      [input.id, input.workerId, input.motivo],
    );
  }

  /**
   * Lo que le queda al espacio, medido igual que en el resto de Strappy
   * (`packages/db/src/adapters/credits.ts`): lo incluido del plan más lo
   * comprado, menos lo que ya está comprometido por ejecuciones en vuelo.
   *
   * Un espacio sin cartera todavía no ha gastado nada: se trata como sin saldo
   * solo si la fila existe y está a cero, no por no existir.
   */
  async saldo(workspaceId: string): Promise<number> {
    const { rows } = await this.pool.query<{ disponible: string | null }>(
      `select (included_balance + purchased_balance - reserved_balance)::text as disponible
         from public.credit_wallets
        where workspace_id = $1`,
      [workspaceId],
    );
    const fila = rows[0];
    if (!fila) return 0;
    return Number(fila.disponible ?? 0);
  }

  /**
   * Red de seguridad: dar de baja a un agente ya apaga sus programados en el
   * mismo clic, pero un contrato puede caerse por otras vías —un impago, una
   * fila tocada a mano—. Seguir encargando trabajo en nombre de un agente que
   * el cliente despidió es gasto que nadie pidió.
   *
   * Apaga, no borra: recontratar devuelve el trabajo programado tal y como
   * estaba, que es lo que el cliente espera.
   */
  async sincronizar(): Promise<number> {
    const { rows } = await this.pool.query<{ id: string }>(
      `update public.agent_schedules s
          set activa = false, motivo_pausa = 'agente_de_baja', updated_at = now()
        where s.activa
          and not exists (
            select 1 from public.agent_subscriptions a
             where a.workspace_id = s.workspace_id
               and a.catalog_slug = s.agente
               and a.status = 'active'
          )
      returning s.id`,
      [],
    );
    return rows.length;
  }
}

/** Sobre qué conexión trabaja cada oficio. Igual que en la web. */
function proveedoresDe(agente: string): string[] {
  if (agente === "marketing") return ["google_ads", "meta_ads"];
  if (agente === "administrativo") return ["alegra"];
  return ["wordpress"];
}
