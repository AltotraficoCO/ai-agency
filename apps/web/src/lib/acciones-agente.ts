"use server";

/**
 * Acciones del constructor de agentes.
 *
 * Guardar y publicar son cosas DISTINTAS y el esquema lo impone: guardar
 * escribe un borrador (`agent_drafts`), publicar crea una versión inmutable
 * (`agent_versions`) y mueve el puntero. Así el agente que está atendiendo
 * clientes no cambia porque alguien tocó un campo del formulario.
 */
import { revalidatePath } from "next/cache";
import { compilePrompt } from "@strappy/core";
import {
  aPromptSpec,
  instruccionesEfectivas,
  leerEspecificacion,
  type EspecificacionAgente,
} from "@strappy/db/spec";
import { exigirUsuarioActual } from "./identidad";
import { conEspacio } from "./db/pool";

export type ResultadoAccion = { ok: true } | { ok: false; error: string };

export async function guardarBorrador(
  agentId: string,
  spec: EspecificacionAgente,
): Promise<ResultadoAccion> {
  try {
    const usuario = await exigirUsuarioActual();
    const limpia = leerEspecificacion(spec);

    await conEspacio(usuario.workspaceId, async (scope) => {
      await scope.query(
        `insert into public.agent_drafts (workspace_id, agent_id, spec, phase, created_by)
         values ($1, $2, $3::jsonb, 'persona', $4)
         on conflict (workspace_id, agent_id) where agent_id is not null
           do update set spec = excluded.spec, updated_at = now()`,
        [scope.workspaceId, agentId, JSON.stringify(limpia), usuario.id],
      );
      await scope.query(
        `update public.agents set name = coalesce(nullif($3, ''), name), updated_at = now()
          where workspace_id = $1 and id = $2`,
        [scope.workspaceId, agentId, limpia.identidad.nombre],
      );
    });

    revalidatePath(`/agentes/${agentId}/instrucciones`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: mensaje(error) };
  }
}

export async function publicarAgente(
  agentId: string,
  spec: EspecificacionAgente,
): Promise<ResultadoAccion> {
  try {
    const usuario = await exigirUsuarioActual();
    const limpia = leerEspecificacion(spec);

    if (!limpia.identidad.nombre.trim()) {
      return { ok: false, error: "Ponle un nombre al agente antes de publicarlo." };
    }
    if (limpia.hace.length === 0) {
      return { ok: false, error: "Dinos al menos una cosa que el agente deba hacer." };
    }

    // El hash se calcula con el MISMO compilador que usa el motor: si aquí se
    // compilara distinto, la versión publicada no sería la que se ejecuta.
    const compilado = compilePrompt(aPromptSpec(limpia));

    await conEspacio(usuario.workspaceId, async (scope) => {
      const { rows } = await scope.query<{ id: string }>(
        `insert into public.agent_versions
           (workspace_id, agent_id, spec, compiled_prompt, prompt_hash, changelog, published_by)
         values ($1, $2, $3::jsonb, $4, $5, $6, $7)
         returning id`,
        [
          scope.workspaceId,
          agentId,
          JSON.stringify(limpia),
          compilado.system,
          compilado.hash,
          "Publicado desde el constructor",
          usuario.id,
        ],
      );
      const versionId = rows[0]?.id;
      if (!versionId) throw new Error("No se pudo crear la versión.");

      await scope.query(
        `update public.agents
            set active_version_id = $3, status = 'published', updated_at = now()
          where workspace_id = $1 and id = $2`,
        [scope.workspaceId, agentId, versionId],
      );
      await scope.query(
        `delete from public.agent_drafts where workspace_id = $1 and agent_id = $2`,
        [scope.workspaceId, agentId],
      );
    });

    revalidatePath(`/agentes/${agentId}/instrucciones`);
    revalidatePath("/agentes");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: mensaje(error) };
  }
}

/** Cuenta de tokens del prompt, para que nadie publique un prompt de 8.000 tokens sin verlo. */
export async function contarTokens(spec: EspecificacionAgente): Promise<number> {
  return Math.ceil(instruccionesEfectivas(leerEspecificacion(spec)).length / 4);
}

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : "Algo salió mal al guardar.";
}
