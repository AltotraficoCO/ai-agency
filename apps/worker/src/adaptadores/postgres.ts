/**
 * Adaptadores a Postgres de los puertos del Webmaster.
 *
 * El sitio se lee de `public.connections`, que ya existe: es exactamente la
 * tabla de credenciales de un servicio externo, con el sobre cifrado en
 * `credentials_encrypted` y el resto en `metadata`. No hacía falta una tabla
 * nueva para eso, y una tabla menos es una migración menos que coordinar.
 *
 * Backups y aprobaciones sí son tablas nuevas: `packages/db/migrations/0015_tareas_webmaster.sql`.
 */
import { decryptJson, githubApp } from "@strappy/webmaster";
import type {
  ApprovalDecision,
  ApprovalPort,
  ApprovalRequest,
  BackupPort,
  BackupRecord,
  ConectorCreds,
  EstadoRepo,
  RepoCreds,
  RepoEstadoPort,
  WpCreds,
} from "@strappy/webmaster";
import type { SitePort, SitioConectado, SqlExecutor } from "../ports.js";

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

export class BackupsPostgres implements BackupPort {
  constructor(private readonly sql: SqlExecutor) {}

  async create(input: {
    workspaceId: string;
    siteId: string;
    taskId: string;
    alcance: string;
    snapshot: unknown;
  }): Promise<string> {
    const { rows } = await this.sql.query<{ id: string }>(
      `insert into public.site_backups (workspace_id, site_id, task_id, alcance, snapshot)
       values ($1, $2, $3, $4, $5::jsonb)
       returning id`,
      [input.workspaceId, input.siteId, input.taskId, input.alcance, JSON.stringify(input.snapshot)],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("No se pudo guardar el backup; se aborta antes de mutar el sitio.");
    return id;
  }

  async read(input: { workspaceId: string; backupId: string }): Promise<BackupRecord | null> {
    const { rows } = await this.sql.query<{
      id: string;
      alcance: string;
      snapshot: unknown;
      created_at: string;
    }>(
      `select id, alcance, snapshot, created_at
         from public.site_backups
        where id = $1 and workspace_id = $2`,
      [input.backupId, input.workspaceId],
    );
    const f = rows[0];
    return f ? { id: f.id, alcance: f.alcance, snapshot: f.snapshot, creadoEn: f.created_at } : null;
  }

  async listar(input: { workspaceId: string; siteId: string; limite?: number }): Promise<readonly BackupRecord[]> {
    const { rows } = await this.sql.query<{
      id: string;
      alcance: string;
      snapshot: unknown;
      created_at: string;
    }>(
      `select id, alcance, snapshot, created_at
         from public.site_backups
        where workspace_id = $1 and site_id = $2
        order by created_at desc
        limit $3`,
      [input.workspaceId, input.siteId, Math.min(input.limite ?? 20, 50)],
    );
    return rows.map((f) => ({ id: f.id, alcance: f.alcance, snapshot: f.snapshot, creadoEn: f.created_at }));
  }
}

// ---------------------------------------------------------------------------
// Aprobaciones
// ---------------------------------------------------------------------------

export class AprobacionesPostgres implements ApprovalPort {
  constructor(private readonly sql: SqlExecutor) {}

  async check(input: {
    workspaceId: string;
    taskId: string;
    huella: string;
  }): Promise<ApprovalDecision | null> {
    const { rows } = await this.sql.query<{ decision: string | null }>(
      `select decision from public.task_approvals
        where workspace_id = $1 and task_id = $2 and huella = $3`,
      [input.workspaceId, input.taskId, input.huella],
    );
    const d = rows[0]?.decision;
    return d === "aprobada" || d === "rechazada" ? d : null;
  }

  async request(input: {
    workspaceId: string;
    taskId: string;
    /** Null desde 0029: un encargo puede no colgar de ninguna conexión. */
    siteId: string | null;
    huella: string;
    toolSlug: string;
    motivo: string;
    resumen: string;
    entrada: unknown;
  }): Promise<ApprovalRequest> {
    // Idempotente por huella: si el modelo vuelve a proponer exactamente la
    // misma acción, no se le pintan dos botones al cliente.
    const { rows } = await this.sql.query<{ id: string; decision: string | null }>(
      `insert into public.task_approvals
         (workspace_id, task_id, site_id, huella, tool_slug, motivo, resumen, entrada)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       on conflict (workspace_id, task_id, huella) do update set updated_at = now()
       returning id, decision`,
      [
        input.workspaceId,
        input.taskId,
        input.siteId,
        input.huella,
        input.toolSlug,
        input.motivo,
        input.resumen,
        JSON.stringify(input.entrada),
      ],
    );
    const f = rows[0];
    if (!f) throw new Error("No se pudo registrar la solicitud de aprobación.");
    return {
      id: f.id,
      decision: f.decision === "aprobada" || f.decision === "rechazada" ? f.decision : null,
    };
  }

  /** Lo que contestó el cliente: la web lo guarda en `entrada.respuesta` al responder. */
  async respuesta(input: { workspaceId: string; taskId: string; huella: string }): Promise<string | null> {
    const { rows } = await this.sql.query<{ respuesta: string | null }>(
      `select entrada->>'respuesta' as respuesta from public.task_approvals
        where workspace_id = $1 and task_id = $2 and huella = $3 and decision is not null`,
      [input.workspaceId, input.taskId, input.huella],
    );
    return rows[0]?.respuesta ?? null;
  }
}

// ---------------------------------------------------------------------------
// Sesiones de trabajo sobre un repositorio
// ---------------------------------------------------------------------------

export class RepoEstadoPostgres implements RepoEstadoPort {
  constructor(private readonly sql: SqlExecutor) {}

  async cargar(input: { workspaceId: string; taskId: string }): Promise<EstadoRepo | null> {
    const { rows } = await this.sql.query<{ estado: EstadoRepo }>(
      `select estado from public.repo_sesiones where workspace_id = $1 and task_id = $2`,
      [input.workspaceId, input.taskId],
    );
    return rows[0]?.estado ?? null;
  }

  async guardar(input: { workspaceId: string; taskId: string; siteId: string; estado: EstadoRepo }): Promise<void> {
    await this.sql.query(
      `insert into public.repo_sesiones (task_id, workspace_id, site_id, estado)
       values ($1, $2, $3, $4::jsonb)
       on conflict (task_id) do update set estado = excluded.estado
        where public.repo_sesiones.workspace_id = excluded.workspace_id`,
      [input.taskId, input.workspaceId, input.siteId, JSON.stringify(input.estado)],
    );
  }
}

// ---------------------------------------------------------------------------
// Sitios
// ---------------------------------------------------------------------------

type MetadatosSitio = {
  url?: string;
  tipo?: string;
  agent_name?: string;
  primer_contacto?: boolean;
  owner?: string;
  repo?: string;
  rama_principal?: string;
};

/** Lo que se guarda cifrado de un repositorio: un token propio o la instalación de la App. */
type CredencialesRepo = {
  token?: string;
  installationId?: number;
  bypassVistaPrevia?: string;
};

export class SitiosPostgres implements SitePort {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly claveMaestra: Buffer,
    /** La GitHub App de Strappy. Sin ella, solo sirven los repos conectados con token. */
    private readonly app?: githubApp.ConfigApp,
  ) {}

  /** Las credenciales con las que el agente habla con GitHub durante este encargo. */
  async #credencialesRepo(meta: MetadatosSitio, guardadas: CredencialesRepo): Promise<RepoCreds> {
    if (!meta.owner || !meta.repo) throw new Error("El repositorio conectado no dice cuál es: hay que reconectarlo.");
    let token = guardadas.token;
    if (!token && guardadas.installationId) {
      if (!this.app) {
        throw new Error("El repositorio se conectó con la GitHub App y este worker no tiene su configuración (GITHUB_APP_ID y GITHUB_APP_PRIVATE_KEY).");
      }
      // Dura una hora: de sobra para un encargo, que no pasa de diez minutos.
      ({ token } = await githubApp.tokenDeInstalacion(this.app, guardadas.installationId));
    }
    if (!token) throw new Error("El repositorio no tiene acceso guardado: hay que reconectarlo.");
    return {
      proveedor: "github",
      owner: meta.owner,
      repo: meta.repo,
      ramaPrincipal: meta.rama_principal ?? "main",
      token,
      urlProduccion: meta.url ?? `https://github.com/${meta.owner}/${meta.repo}`,
      ...(guardadas.bypassVistaPrevia ? { bypassVistaPrevia: guardadas.bypassVistaPrevia } : {}),
    };
  }

  async cargar(input: { workspaceId: string; siteId: string }): Promise<SitioConectado | null> {
    const { rows } = await this.sql.query<{
      id: string;
      workspace_id: string;
      credentials_encrypted: string | null;
      metadata: MetadatosSitio;
      status: string;
    }>(
      `select id, workspace_id, credentials_encrypted, metadata, status
         from public.connections
        where id = $1 and workspace_id = $2`,
      [input.siteId, input.workspaceId],
    );
    const f = rows[0];
    if (!f) return null;
    if (f.status !== "active") {
      throw new Error(`La conexión con el sitio está en estado "${f.status}".`);
    }
    if (!f.credentials_encrypted) {
      throw new Error("El sitio no tiene credenciales guardadas: hay que reconectarlo.");
    }

    let guardadas: WpCreds | ConectorCreds | CredencialesRepo;
    try {
      guardadas = decryptJson<WpCreds | ConectorCreds | CredencialesRepo>(
        f.credentials_encrypted,
        this.claveMaestra,
      );
    } catch {
      throw new Error(
        "Las credenciales guardadas son indescifrables con la clave actual. Hay que reconectar el sitio.",
      );
    }

    const meta = f.metadata ?? {};
    const tipo = meta.tipo === "repo" ? "repo" : meta.tipo === "custom" ? "custom" : "wp";
    const credenciales =
      tipo === "repo"
        ? await this.#credencialesRepo(meta, guardadas as CredencialesRepo)
        : (guardadas as WpCreds | ConectorCreds);
    return {
      id: f.id,
      workspaceId: f.workspace_id,
      tipo,
      url:
        meta.url ??
        ("url" in credenciales ? credenciales.url : "baseUrl" in credenciales ? credenciales.baseUrl : credenciales.urlProduccion),
      credenciales,
      agentName: f.metadata?.agent_name ?? "Webmaster",
      // Solo simula si se pide expresamente: el Webmaster ejecuta desde el
      // primer encargo, con backup antes de cada cambio y aprobación en lo delicado.
      primerContacto: f.metadata?.primer_contacto === true,
    };
  }

  async marcarTocado(input: { workspaceId: string; siteId: string }): Promise<void> {
    await this.sql.query(
      `update public.connections
          set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{primer_contacto}', 'false'::jsonb),
              updated_at = now()
        where id = $1 and workspace_id = $2`,
      [input.siteId, input.workspaceId],
    );
  }
}
