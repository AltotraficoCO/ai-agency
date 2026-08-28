import "server-only";

/**
 * Lectura de agentes del espacio activo.
 *
 * Toda consulta filtra por `workspace_id` y se apoya en `agents_ws_status_idx`.
 */
import { conEspacio } from "./db/pool";
import {
  ESPECIFICACION_VACIA,
  componerInstrucciones,
  instruccionesEfectivas,
  leerEspecificacion,
  type EspecificacionAgente,
} from "@strappy/db/spec";

export type ResumenAgente = {
  id: string;
  nombre: string;
  descripcion: string | null;
  estado: "draft" | "published" | "paused" | "archived";
  tipo: string;
  modo: "lite" | "max";
  publicado: boolean;
  conversaciones: number;
  actualizado: string;
};

export async function listarAgentes(workspaceId: string): Promise<ResumenAgente[]> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      id: string;
      name: string;
      description: string | null;
      status: ResumenAgente["estado"];
      agent_type: string;
      mode: "lite" | "max";
      active_version_id: string | null;
      updated_at: string;
      conversaciones: string;
    }>(
      `select a.id, a.name, a.description, a.status, a.agent_type, a.mode,
              a.active_version_id, a.updated_at,
              (select count(*) from public.conversations c
                where c.workspace_id = a.workspace_id and c.agent_id = a.id) as conversaciones
         from public.agents a
        where a.workspace_id = $1 and a.status <> 'archived'
        order by a.updated_at desc`,
      [scope.workspaceId],
    );
    return rows.map((r) => ({
      id: r.id,
      nombre: r.name,
      descripcion: r.description,
      estado: r.status,
      tipo: r.agent_type,
      modo: r.mode,
      publicado: Boolean(r.active_version_id) && r.status === "published",
      conversaciones: Number(r.conversaciones),
      actualizado: new Date(r.updated_at).toISOString(),
    }));
  });
}

export type FichaAgente = {
  id: string;
  nombre: string;
  descripcion: string | null;
  estado: ResumenAgente["estado"];
  modo: "lite" | "max";
  publicado: boolean;
  spec: EspecificacionAgente;
  prompt: string;
  promptCompuesto: string;
  /** true si alguien editó el prompt a mano y ya no lo escriben los formularios. */
  editadoAMano: boolean;
  /** true si hay cambios sin publicar. El motor sigue ejecutando la versión activa. */
  hayCambiosSinPublicar: boolean;
};

export async function leerAgente(
  workspaceId: string,
  agentId: string,
): Promise<FichaAgente | null> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      id: string;
      name: string;
      description: string | null;
      status: FichaAgente["estado"];
      mode: "lite" | "max";
      active_version_id: string | null;
      spec: unknown;
      hay_borrador: boolean;
    }>(
      // El borrador gana sobre la version publicada: es lo que la persona
      // estaba escribiendo la ultima vez, y perderlo al recargar seria
      // imperdonable. La version publicada es lo que ejecuta el motor.
      `select a.id, a.name, a.description, a.status, a.mode, a.active_version_id,
              coalesce(b.spec, v.spec, ultima.spec, '{}'::jsonb) as spec,
              (b.spec is not null) as hay_borrador
         from public.agents a
         left join public.agent_drafts b
           on b.workspace_id = a.workspace_id and b.agent_id = a.id
         left join public.agent_versions v
           on v.workspace_id = a.workspace_id and v.id = a.active_version_id
         left join lateral (
           select spec from public.agent_versions
            where workspace_id = a.workspace_id and agent_id = a.id
            order by version desc limit 1
         ) ultima on true
        where a.workspace_id = $1 and a.id = $2`,
      [scope.workspaceId, agentId],
    );
    const fila = rows[0];
    if (!fila) return null;

    const spec = fila.spec ? leerEspecificacion(fila.spec) : ESPECIFICACION_VACIA;
    return {
      id: fila.id,
      nombre: fila.name,
      descripcion: fila.description,
      estado: fila.status,
      modo: fila.mode,
      publicado: Boolean(fila.active_version_id) && fila.status === "published",
      spec,
      prompt: instruccionesEfectivas(spec),
      promptCompuesto: componerInstrucciones(spec),
      editadoAMano: Boolean(spec.instruccionesManuales?.trim()),
      hayCambiosSinPublicar: fila.hay_borrador,
    };
  });
}
