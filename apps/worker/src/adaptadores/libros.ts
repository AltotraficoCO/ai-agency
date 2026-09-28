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
import {
  crearAlegraMcp,
  necesitaRenovar,
  renovarTokens,
  type CredencialesMcpAlegra,
} from "@strappy/administrativo/alegra-mcp";
import { decryptJson, encryptJson } from "@strappy/webmaster";
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

/**
 * Lo que se guarda cifrado de una conexión con Alegra. El usuario y el token
 * dan la API contable; `mcp`, la cuenta entera (nómina incluida) por OAuth. Una
 * conexión puede tener cualquiera de las dos, o las dos.
 */
type CredencialesGuardadas = Partial<CredencialesAlegra> & { mcp?: CredencialesMcpAlegra };

export class LibrosPostgres implements LibrosPort {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly claveMaestra: Buffer,
    private readonly fetchContable?: typeof globalThis.fetch,
  ) {}

  /**
   * Un token de acceso a Alegra vigente, renovándolo si caduca pronto.
   *
   * La renovación se guarda con una comparación sobre el sobre anterior: si
   * otro encargo renovó a la vez, su escritura gana y aquí se relee la suya en
   * vez de pisarla. Alegra puede rotar el token de renovación, y guardar uno ya
   * gastado dejaría la conexión muerta hasta que el cliente la rehiciera.
   */
  async #accesoMcp(conexionId: string, sobre: string, cred: CredencialesGuardadas): Promise<CredencialesMcpAlegra | null> {
    const mcp = cred.mcp;
    if (!mcp) return null;
    if (!necesitaRenovar(mcp)) return mcp;
    if (!mcp.refreshToken) return null;
    try {
      const nuevos = await renovarTokens({ clientId: mcp.clientId, refreshToken: mcp.refreshToken }, this.fetchContable);
      const actualizado: CredencialesMcpAlegra = { clientId: mcp.clientId, ...nuevos };
      const { rows } = await this.sql.query<{ id: string }>(
        `update public.connections
            set credentials_encrypted = $3, updated_at = updated_at
          where id = $1 and credentials_encrypted = $2
          returning id`,
        [conexionId, sobre, encryptJson({ ...cred, mcp: actualizado }, this.claveMaestra)],
      );
      if (rows.length > 0) return actualizado;
    } catch {
      /* puede que otro encargo ya la renovara y gastara el token: se relee */
    }
    const { rows } = await this.sql.query<{ credentials_encrypted: string | null }>(
      `select credentials_encrypted from public.connections where id = $1`,
      [conexionId],
    );
    const otro = rows[0]?.credentials_encrypted;
    if (!otro || otro === sobre) return null;
    try {
      const releido = decryptJson<CredencialesGuardadas>(otro, this.claveMaestra).mcp;
      return releido && !necesitaRenovar(releido) ? releido : null;
    } catch {
      return null;
    }
  }

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

    let credenciales: CredencialesGuardadas;
    try {
      credenciales = decryptJson<CredencialesGuardadas>(fila.credentials_encrypted, this.claveMaestra);
    } catch {
      // Indescifrable con la clave actual: el agente trabaja sin libros y lo
      // dice. Tumbar el encargo aquí no le daría al cliente ninguna pista.
      return { ...sinContabilidad, conexionId: fila.id };
    }

    const soloLectura = fila.metadata?.solo_lectura === true;
    const contabilidad =
      credenciales.usuario && credenciales.secreto
        ? crearContabilidadAlegra(credenciales as CredencialesAlegra, {
            soloLectura,
            ...(this.fetchContable ? { fetch: this.fetchContable } : {}),
          })
        : undefined;

    // El resto de Alegra (nómina, gastos, reportes), si el cliente conectó su
    // cuenta. Si la autorización ya no sirve, el agente trabaja sin ella y lo dice.
    const mcp = await this.#accesoMcp(fila.id, fila.credentials_encrypted, credenciales).catch(() => null);
    const alegra = mcp
      ? crearAlegraMcp({ token: mcp.accessToken, ...(this.fetchContable ? { fetch: this.fetchContable } : {}) })
      : undefined;

    return {
      conexionId: fila.id,
      ...(contabilidad ? { contabilidad } : {}),
      ...(alegra ? { alegra } : {}),
      negocio,
      agentName: fila.metadata?.agent_name?.trim() || "Tu agente financiero",
      // Los tokens y el usuario nunca pueden salir en un paso ni en un error.
      secretos: [credenciales.secreto, credenciales.usuario, mcp?.accessToken, mcp?.refreshToken].filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      ),
    };
  }
}
