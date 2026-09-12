/**
 * De dónde salen los libros de un negocio: su sistema de facturación conectado.
 *
 * Mismo sitio que el resto de credenciales de servicios externos,
 * `public.connections`, y mismo trato que el sitio del Webmaster: el sobre va
 * cifrado con `APP_ENCRYPTION_KEY` y lo que no es secreto —el nombre, el
 * usuario, si la conexión es de solo lectura— en `metadata`.
 *
 * Sin conexión NO se falla: se devuelve el espacio sin contabilidad y el agente
 * lo dice con sus palabras («no tienes tu sistema de facturación conectado») en
 * vez de reventar con un error técnico. Un encargo que falla deja al cliente sin
 * saber qué hacer; uno que termina explicando qué le falta, no.
 */
import { crearContabilidadAlegra, type CredencialesAlegra } from "@strappy/administrativo/alegra";
import { decryptJson } from "@strappy/webmaster";
import type { LibrosDelNegocio, LibrosPort, SqlExecutor } from "../ports.js";

/** Proveedores de `connections` que son sistemas de facturación. */
export const PROVEEDORES_CONTABILIDAD = ["alegra"] as const;

type MetadatosContabilidad = {
  nombre?: string;
  usuario?: string;
  /** El cliente no quiere que se emita nada en su nombre, o su usuario no puede. */
  solo_lectura?: boolean;
  agent_name?: string;
};

type FilaConexion = {
  id: string;
  provider: string;
  credentials_encrypted: string | null;
  metadata: MetadatosContabilidad | null;
  status: string;
};

export class LibrosPostgres implements LibrosPort {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly claveMaestra: Buffer,
    private readonly fetchContable?: typeof globalThis.fetch,
  ) {}

  async cargar(input: {
    workspaceId: string;
    conexionId: string | null;
  }): Promise<LibrosDelNegocio> {
    const espacio = await this.sql.query<{ nombre: string | null }>(
      `select name as nombre from public.workspaces where id = $1`,
      [input.workspaceId],
    );
    const negocio = espacio.rows[0]?.nombre?.trim() || "tu negocio";

    // Si el encargo trae conexión, esa; si no, la última activa del espacio.
    const { rows } = input.conexionId
      ? await this.sql.query<FilaConexion>(
          `select id, provider, credentials_encrypted, metadata, status
             from public.connections
            where id = $1 and workspace_id = $2 and provider = any($3::text[])`,
          [input.conexionId, input.workspaceId, [...PROVEEDORES_CONTABILIDAD]],
        )
      : await this.sql.query<FilaConexion>(
          `select id, provider, credentials_encrypted, metadata, status
             from public.connections
            where workspace_id = $1 and provider = any($2::text[]) and status = 'active'
            order by updated_at desc
            limit 1`,
          [input.workspaceId, [...PROVEEDORES_CONTABILIDAD]],
        );

    const fila = rows[0];
    const sinContabilidad: LibrosDelNegocio = {
      conexionId: null,
      negocio,
      agentName: "Tu agente financiero",
    };
    if (!fila || fila.status !== "active" || !fila.credentials_encrypted) return sinContabilidad;

    let credenciales: CredencialesAlegra;
    try {
      credenciales = decryptJson<CredencialesAlegra>(fila.credentials_encrypted, this.claveMaestra);
    } catch {
      // Indescifrable con la clave actual: el agente trabaja sin libros y lo
      // dice. Tumbar el encargo aquí no le daría al cliente ninguna pista.
      return { ...sinContabilidad, conexionId: fila.id };
    }

    const soloLectura = fila.metadata?.solo_lectura === true;
    const contabilidad = crearContabilidadAlegra(credenciales, {
      soloLectura,
      ...(this.fetchContable ? { fetch: this.fetchContable } : {}),
    });

    return {
      conexionId: fila.id,
      contabilidad,
      negocio,
      agentName: fila.metadata?.agent_name?.trim() || "Tu agente financiero",
      // El token y el usuario nunca pueden salir en un paso ni en un error.
      secretos: [credenciales.secreto, credenciales.usuario].filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      ),
    };
  }
}
