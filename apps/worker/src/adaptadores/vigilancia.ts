/**
 * La vigilancia en Postgres.
 *
 * Mismo patrón que la cola de tareas y por la misma razón: `FOR UPDATE SKIP
 * LOCKED` para que dos workers no comprueben el mismo sitio a la vez, y
 * arrendamiento para que la muerte de un proceso no deje una fila bloqueada
 * para siempre.
 *
 * Las tablas están en `packages/db/migrations/0026_vigilancia_del_sitio.sql`.
 */
import type { Aviso, EstadoVigilancia } from "@strappy/webmaster";
import type { SitioVigilado, SqlPool, VigilanciaPort } from "../ports.js";

export class VigilanciaPostgres implements VigilanciaPort {
  constructor(private readonly pool: SqlPool) {}

  async reclamar(input: { workerId: string; arrendamientoMs: number }): Promise<SitioVigilado | null> {
    const conn = await this.pool.connect();
    try {
      await conn.query("begin");
      const { rows } = await conn.query<{
        site_id: string;
        workspace_id: string;
        estado: EstadoVigilancia | null;
        cada_minutos: number;
      }>(
        `update public.site_monitor m
            set lease_until = now() + ($2::bigint * interval '1 millisecond'),
                worker_id   = $1,
                updated_at  = now()
          where m.site_id = (
            select c.site_id from public.site_monitor c
             where c.activa
               and c.proxima_en <= now()
               and (c.lease_until is null or c.lease_until < now())
             order by c.proxima_en
             limit 1
             for update skip locked
          )
        returning m.site_id, m.workspace_id, m.estado, m.cada_minutos`,
        [input.workerId, input.arrendamientoMs],
      );
      await conn.query("commit");
      const f = rows[0];
      if (!f) return null;
      return {
        siteId: f.site_id,
        workspaceId: f.workspace_id,
        estado: f.estado ?? {},
        cadaMinutos: f.cada_minutos,
      };
    } catch (e) {
      await conn.query("rollback").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }

  async guardar(input: {
    siteId: string;
    workerId: string;
    estado: EstadoVigilancia;
    chequeo: unknown;
    proximaEnMs: number;
  }): Promise<void> {
    await this.pool.query(
      `update public.site_monitor
          set estado         = $3::jsonb,
              ultimo_chequeo = $4::jsonb,
              proxima_en     = now() + ($5::bigint * interval '1 millisecond'),
              lease_until    = null,
              updated_at     = now()
        where site_id = $1 and worker_id = $2`,
      [
        input.siteId,
        input.workerId,
        JSON.stringify(input.estado),
        JSON.stringify(input.chequeo ?? null),
        input.proximaEnMs,
      ],
    );
  }

  async registrarAvisos(input: {
    workspaceId: string;
    siteId: string;
    avisos: readonly Aviso[];
  }): Promise<number> {
    let nuevos = 0;
    for (const aviso of input.avisos) {
      const { rows } = await this.pool.query<{ id: string }>(
        `insert into public.site_alerts
           (workspace_id, site_id, clave, severidad, titulo, cuerpo, propuesta)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (site_id, clave) do nothing
         returning id`,
        [
          input.workspaceId,
          input.siteId,
          aviso.clave,
          aviso.severidad,
          aviso.titulo,
          aviso.cuerpo,
          aviso.propuesta,
        ],
      );
      if (rows.length > 0) nuevos += 1;
    }
    return nuevos;
  }

  /**
   * Alta automática: se vigila el sitio WordPress activo de cada espacio que
   * tenga contratado el Webmaster. Sin esto, conectar un sitio no serviría de
   * nada hasta que alguien tocara una fila a mano.
   *
   * `on conflict do nothing` la hace idempotente, y como no toca las filas que
   * ya existen, no reinicia el estado ni adelanta la próxima ronda de nadie.
   */
  async sincronizar(): Promise<number> {
    const { rows } = await this.pool.query<{ site_id: string }>(
      `insert into public.site_monitor (site_id, workspace_id)
       select c.id, c.workspace_id
         from public.connections c
         join public.agent_subscriptions s
           on s.workspace_id = c.workspace_id
          and s.catalog_slug = 'webmaster'
          and s.status = 'active'
        where c.provider = 'wordpress'
          and c.status = 'active'
       on conflict (site_id) do nothing
       returning site_id`,
      [],
    );

    // Red de seguridad: dar de baja al Webmaster ya apaga la vigilancia en el
    // mismo clic, pero un contrato puede caerse por otras vías —una baja por
    // impago, una fila tocada a mano, un sitio desconectado— y seguir
    // comprobando la web de quien ya no lo tiene contratado es trabajo que
    // nadie pidió y gasto que nadie paga. Esto lo corrige en la ronda
    // siguiente. No borra la fila: conserva lo que la vigilancia recuerda del
    // sitio, así que recontratar no empieza de cero ni dispara avisos viejos.
    await this.pool.query(
      `update public.site_monitor m
          set activa = false, updated_at = now()
        where m.activa
          and not exists (
            select 1
              from public.connections c
              join public.agent_subscriptions s
                on s.workspace_id = c.workspace_id
               and s.catalog_slug = 'webmaster'
               and s.status = 'active'
             where c.id = m.site_id
               and c.provider = 'wordpress'
               and c.status = 'active'
          )`,
      [],
    );

    return rows.length;
  }
}
