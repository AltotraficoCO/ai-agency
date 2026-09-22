/**
 * De dónde salen las cuentas de publicidad de un espacio.
 *
 * Mismo sitio que el resto de credenciales de servicios externos,
 * `public.connections`, y mismo trato que los libros del financiero: el sobre
 * va cifrado con `APP_ENCRYPTION_KEY` y lo que no es secreto —el nombre, si la
 * conexión es de solo lectura— en `metadata`.
 *
 * Un espacio puede tener las tres plataformas conectadas, una o ninguna, y las
 * tres situaciones son normales. Por eso aquí NO se falla nunca por no
 * encontrar nada: se devuelve el espacio sin plataformas y el agente lo dice
 * con sus palabras («no hay ninguna plataforma de anuncios conectada»). Un
 * encargo que falla con un error deja al cliente sin saber qué hacer; uno que
 * termina explicando qué le falta, no.
 *
 * Lo mismo vale para una conexión rota: si el sobre no se puede descifrar con
 * la clave de hoy, esa plataforma se queda fuera y las demás siguen
 * funcionando. Tumbar el encargo entero porque una de tres está mal sería
 * castigar al cliente por un problema nuestro.
 */
import { crearAds, type CredencialesAds } from "@strappy/marketing/adaptadores";
import type { AdsPort, Plataforma } from "@strappy/marketing";
import { decryptJson } from "@strappy/webmaster";
import type { CuentasDeMarketing, CuentasPort, SqlExecutor } from "../ports.js";

/** Proveedores de `connections` que son plataformas de anuncios. */
export const PROVEEDORES_ADS = ["google_ads", "meta_ads", "tiktok_ads"] as const;

type ProveedorAds = (typeof PROVEEDORES_ADS)[number];

function esProveedorAds(valor: string): valor is ProveedorAds {
  return (PROVEEDORES_ADS as readonly string[]).includes(valor);
}

type MetadatosAds = {
  nombre?: string;
  /** El cliente no quiere que nadie le mueva el dinero, o el permiso no llegó. */
  solo_lectura?: boolean;
  /** Mira y propone sin tocar nada. Por defecto NO: todo cambio pasa por aprobación. */
  primer_contacto?: boolean;
  agent_name?: string;
};

type FilaConexion = {
  id: string;
  provider: string;
  credentials_encrypted: string | null;
  metadata: MetadatosAds | null;
  status: string;
};

export class CuentasPostgres implements CuentasPort {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly claveMaestra: Buffer,
    private readonly fetchPlataformas?: typeof globalThis.fetch,
  ) {}

  async cargar(input: {
    workspaceId: string;
    conexionId: string | null;
  }): Promise<CuentasDeMarketing> {
    const { rows } = await this.sql.query<{ nombre: string | null }>(
      `select name as nombre from public.workspaces where id = $1`,
      [input.workspaceId],
    );
    const negocio = rows[0]?.nombre?.trim() || "tu negocio";

    // TODAS las plataformas activas del espacio, no solo la del encargo: el
    // cliente pregunta «cómo van mis campañas» y espera que se miren las suyas,
    // estén en Google, en Meta o en TikTok. `conexionId` solo decide sobre cuál
    // cuelgan las aprobaciones y los backups.
    const conexiones = await this.sql.query<FilaConexion>(
      `select id, provider, credentials_encrypted, metadata, status
         from public.connections
        where workspace_id = $1 and provider = any($2::text[]) and status = 'active'
        order by updated_at desc`,
      [input.workspaceId, [...PROVEEDORES_ADS]],
    );

    const ads: AdsPort[] = [];
    const secretos: string[] = [];
    let agentName: string | undefined;
    let primerContacto = false;
    const yaConectadas = new Set<Plataforma>();
    const ilegibles: Plataforma[] = [];

    for (const fila of conexiones.rows) {
      if (!esProveedorAds(fila.provider) || !fila.credentials_encrypted) continue;
      // Si el cliente reconectó la misma plataforma, la fila más reciente gana:
      // la consulta viene ordenada por `updated_at`.
      if (yaConectadas.has(fila.provider)) continue;

      let creds: Record<string, unknown>;
      try {
        creds = decryptJson<Record<string, unknown>>(fila.credentials_encrypted, this.claveMaestra);
      } catch {
        // Indescifrable con la clave de hoy: la web la guardó con otra
        // APP_ENCRYPTION_KEY. El agente trabaja con el resto y lo dice con la
        // causa; tumbar el encargo aquí no le daría al cliente ninguna pista.
        console.error(`[cuentas] no se pudo descifrar la conexión ${fila.id} (${fila.provider}): APP_ENCRYPTION_KEY distinta de la de la web`);
        if (!ilegibles.includes(fila.provider)) ilegibles.push(fila.provider);
        continue;
      }

      ads.push(
        crearAds({ plataforma: fila.provider, creds } as CredencialesAds, {
          soloLectura: fila.metadata?.solo_lectura === true,
          ...(this.fetchPlataformas ? { fetch: this.fetchPlataformas } : {}),
        }),
      );
      yaConectadas.add(fila.provider);

      // Ni el token ni el refresco pueden salir en un paso ni en un error.
      for (const clave of ["accessToken", "refreshToken", "clientSecret", "secret"]) {
        const valor = creds[clave];
        if (typeof valor === "string" && valor.length > 0) secretos.push(valor);
      }
      if (fila.metadata?.primer_contacto === true) primerContacto = true;
      agentName ??= fila.metadata?.agent_name?.trim() || undefined;
    }

    return {
      conexionId: input.conexionId ?? conexiones.rows[0]?.id ?? null,
      ads,
      negocio,
      agentName: agentName ?? "Tu agente de marketing",
      ...(primerContacto ? { primerContacto: true } : {}),
      ...(ilegibles.length > 0 ? { ilegibles } : {}),
      ...(secretos.length > 0 ? { secretos } : {}),
    };
  }
}
