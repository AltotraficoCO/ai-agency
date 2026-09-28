/**
 * La base de conocimiento del negocio, para los agentes por encargo.
 *
 * Es la misma búsqueda que usan los agentes de WhatsApp (`@strappy/rag`,
 * `search_knowledge`): por significado si hay proveedor de embeddings, por
 * palabras si no. Se buscan TODAS las bases del espacio: un agente por encargo
 * trabaja para el negocio entero, no para un canal.
 *
 * El worker se conecta con el rol de servicio y cruza espacios, así que el
 * ámbito aquí es la etiqueta del espacio del encargo, igual que en el motor.
 * Las bases se leen filtradas por ese espacio: nunca se busca en otras.
 */
import type { TenantScope } from "@strappy/db";
import { crearConocimientoDb, crearModelTiersPort } from "@strappy/db/adapters";
import { crearEmbeddingsSiHayProveedor, recuperar } from "@strappy/rag";
import type { ConocimientoPort } from "@strappy/agentes";
import type { SqlExecutor } from "../ports.js";

export class ConocimientoPostgres {
  constructor(private readonly sql: SqlExecutor) {}

  /** El conocimiento del espacio, o `undefined` si no tiene ninguna base con contenido. */
  async para(workspaceId: string): Promise<ConocimientoPort | undefined> {
    const { rows } = await this.sql.query<{ id: string }>(
      `select b.id from public.brains b
        where b.workspace_id = $1
          and exists (select 1 from public.brain_chunks c where c.workspace_id = b.workspace_id and c.brain_id = b.id)`,
      [workspaceId],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return undefined;

    const sql = this.sql;
    const ambito = {
      workspaceId,
      query: <T>(text: string, values?: readonly unknown[]) => sql.query<T & Record<string, unknown>>(text, values),
      assertSameWorkspace(otro: string) {
        if (otro !== workspaceId) throw new Error(`Se intentó usar el espacio ${otro} desde una tarea del espacio ${workspaceId}.`);
      },
    } as unknown as TenantScope;
    const embeddings = crearEmbeddingsSiHayProveedor({ modelTiers: crearModelTiersPort(ambito) });

    return {
      bases: ids.length,
      async buscar({ pregunta, cuantos }) {
        const r = await recuperar(
          { db: crearConocimientoDb(ambito), ...(embeddings ? { embeddings } : { forzarSoloTexto: true }) },
          { workspaceId, cerebroIds: ids, turnosUsuario: [pregunta], limite: cuantos },
        );
        return r.fragmentos.map((f) => ({ texto: f.text, fuente: f.title, ...(f.source ? { uri: f.source } : {}) }));
      },
    };
  }
}
