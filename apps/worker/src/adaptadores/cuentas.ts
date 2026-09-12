/**
 * De dónde salen las cuentas de publicidad de un espacio.
 *
 * Mismo sitio que el resto de credenciales de servicios externos:
 * `public.connections`. Cuando los accesos de Google Ads y de Meta estén
 * aprobados, aquí se descifran y se construyen los adaptadores reales; hasta
 * entonces esto devuelve el espacio SIN plataformas, y el agente lo dice con
 * sus palabras («no hay ninguna plataforma de anuncios conectada») en vez de
 * reventar con un error técnico.
 *
 * Esa diferencia importa: un encargo que falla con un error deja al cliente sin
 * saber qué hacer; uno que termina explicando qué le falta, no.
 */
import type { CuentasDeMarketing, CuentasPort, SqlExecutor } from "../ports.js";

/** Proveedores de `connections` que son plataformas de anuncios. */
export const PROVEEDORES_ADS = ["google_ads", "meta_ads"] as const;

type FilaEspacio = { nombre: string | null };

export class CuentasPostgres implements CuentasPort {
  constructor(private readonly sql: SqlExecutor) {}

  async cargar(input: {
    workspaceId: string;
    conexionId: string | null;
  }): Promise<CuentasDeMarketing> {
    const { rows } = await this.sql.query<FilaEspacio>(
      `select name as nombre from public.workspaces where id = $1`,
      [input.workspaceId],
    );
    const negocio = rows[0]?.nombre?.trim() || "tu negocio";

    // Las conexiones de anuncios todavía no existen: ningún proveedor está
    // aprobado. Se consulta igualmente para que el día que existan no haya que
    // tocar el worker, solo añadir el adaptador de cada plataforma.
    const conexiones = await this.sql.query<{ id: string; provider: string }>(
      `select id, provider from public.connections
        where workspace_id = $1 and provider = any($2::text[]) and status = 'active'
        order by updated_at desc`,
      [input.workspaceId, [...PROVEEDORES_ADS]],
    );

    return {
      conexionId: input.conexionId ?? conexiones.rows[0]?.id ?? null,
      // Vacío a propósito mientras no haya adaptador real de cada plataforma.
      ads: [],
      negocio,
      agentName: "Tu agente de marketing",
      // Sin plataformas no hay nada que tocar, así que tampoco hay primer
      // contacto que proteger: el modo simulación llegará con el adaptador real.
      primerContacto: false,
    };
  }
}
