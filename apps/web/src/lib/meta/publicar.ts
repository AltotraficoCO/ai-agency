/**
 * Publicar lo que Strap construyó.
 *
 * Tres escrituras que tienen que ocurrir juntas o no ocurrir: el agente, su
 * versión INMUTABLE y las variables que declara. Si la versión se creara sin
 * mover el puntero, el cliente vería «publicado» y el motor seguiría
 * ejecutando lo anterior; si el puntero se moviera sin versión, no habría
 * forma de auditar con qué prompt se respondió una conversación de hace un mes.
 *
 * `agent_versions` no se actualiza NUNCA —hay un trigger en el esquema que lo
 * impide—: publicar de nuevo es insertar la versión siguiente.
 *
 * La función recibe el ejecutor en vez de abrir la transacción ella misma para
 * poder probarse sin Postgres. `publicarAgenteDeStrap` es la que la monta.
 */
import { compilePrompt } from "@strappy/core";
import {
  aPromptSpec,
  leerEspecificacion,
  type DatosEmpresa,
  type EspecificacionAgente,
} from "@strappy/db/spec";
import { conEspacio } from "../db/pool";

export type EjecutorSql = {
  readonly workspaceId: string;
  query<T = Record<string, unknown>>(
    texto: string,
    valores?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
};

export type VariableDeclarada = {
  readonly clave: string;
  readonly etiqueta: string;
  readonly tipo: "text" | "number" | "boolean" | "date" | "json";
  readonly obligatoria: boolean;
  readonly descripcion?: string;
};

export type EntradaPublicacion = {
  readonly spec: EspecificacionAgente;
  readonly modo: "lite" | "max";
  readonly descripcion?: string;
  readonly variables?: readonly VariableDeclarada[];
  readonly cerebroId?: string;
  /** Si ya existe el agente, se publica una versión nueva sobre él. */
  readonly agenteId?: string;
  readonly usuarioId?: string;
  readonly empresa?: DatosEmpresa;
};

export type ResultadoPublicacion = {
  readonly agenteId: string;
  readonly versionId: string;
  readonly version: number;
  readonly huellaPrompt: string;
  readonly nombre: string;
};

export class PublicacionInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "PublicacionInvalidaError";
  }
}

export async function publicarDesdeBorrador(
  scope: EjecutorSql,
  entrada: EntradaPublicacion,
): Promise<ResultadoPublicacion> {
  const spec = leerEspecificacion(entrada.spec);
  const nombre = spec.identidad.nombre.trim();
  if (!nombre) {
    throw new PublicacionInvalidaError("El agente necesita un nombre antes de publicarse.");
  }
  if (spec.hace.length === 0) {
    throw new PublicacionInvalidaError("El agente necesita al menos una cosa que hacer.");
  }

  // El MISMO compilador que ejecuta el motor. Compilar aquí de otra forma haría
  // que la versión publicada no fuera la que responde.
  const compilado = compilePrompt(
    aPromptSpec(spec, entrada.empresa ? { empresa: entrada.empresa } : {}),
  );

  const agenteId = entrada.agenteId ?? (await crearAgente(scope, entrada, nombre));

  const { rows: filasVersion } = await scope.query<{ id: string; version: number }>(
    `insert into public.agent_versions
       (workspace_id, agent_id, version, spec, compiled_prompt, prompt_hash, model, changelog, published_by)
     select $1, $2,
            coalesce((select max(version) from public.agent_versions
                       where workspace_id = $1 and agent_id = $2), 0) + 1,
            $3::jsonb, $4, $5, $6, $7, $8
     returning id, version`,
    [
      scope.workspaceId,
      agenteId,
      JSON.stringify(spec),
      compilado.system,
      compilado.hash,
      entrada.modo,
      "Publicado por Strap",
      entrada.usuarioId ?? null,
    ],
  );
  const version = filasVersion[0];
  if (!version) throw new Error("No se pudo crear la versión del agente.");

  await scope.query(
    `update public.agents
        set active_version_id = $3, status = 'published', mode = $4,
            name = $5, description = coalesce($6, description), updated_at = now()
      where workspace_id = $1 and id = $2`,
    [
      scope.workspaceId,
      agenteId,
      version.id,
      entrada.modo,
      nombre,
      entrada.descripcion ?? null,
    ],
  );

  for (const variable of entrada.variables ?? []) {
    await scope.query(
      `insert into public.agent_variables
         (workspace_id, agent_id, key, label, value_type, is_required, scope, description)
       values ($1, $2, $3, $4, $5, $6, 'conversation', $7)
       on conflict (agent_id, key) do update
         set label = excluded.label, value_type = excluded.value_type,
             is_required = excluded.is_required, description = excluded.description`,
      [
        scope.workspaceId,
        agenteId,
        variable.clave,
        variable.etiqueta,
        variable.tipo,
        variable.obligatoria,
        variable.descripcion ?? null,
      ],
    );
  }

  if (entrada.cerebroId) {
    await scope.query(
      `insert into public.agent_brains (workspace_id, agent_id, brain_id)
       values ($1, $2, $3)
       on conflict do nothing`,
      [scope.workspaceId, agenteId, entrada.cerebroId],
    );
  }

  // El borrador del CONSTRUCTOR de formularios deja de tener sentido en cuanto
  // hay una versión publicada. El del hilo de Strap NO: es la conversación, y
  // borrarla dejaría a la persona mirando un chat que acaba de desaparecer
  // justo cuando su agente salía bien. Los distingue `thread_id`.
  await scope.query(
    `delete from public.agent_drafts
      where workspace_id = $1 and agent_id = $2 and thread_id is null`,
    [scope.workspaceId, agenteId],
  );

  return {
    agenteId,
    versionId: version.id,
    version: Number(version.version),
    huellaPrompt: compilado.hash,
    nombre,
  };
}

async function crearAgente(
  scope: EjecutorSql,
  entrada: EntradaPublicacion,
  nombre: string,
): Promise<string> {
  const { rows } = await scope.query<{ id: string }>(
    `insert into public.agents
       (workspace_id, kind, agent_type, name, description, status, mode, created_by)
     values ($1, 'own', 'conversational', $2, $3, 'draft', $4, $5)
     returning id`,
    [
      scope.workspaceId,
      nombre,
      entrada.descripcion ?? null,
      entrada.modo,
      entrada.usuarioId ?? null,
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("No se pudo crear el agente.");
  return id;
}

/** La versión que abre la transacción. Es la que usa la herramienta de Strap. */
export async function publicarAgenteDeStrap(
  workspaceId: string,
  entrada: EntradaPublicacion,
): Promise<ResultadoPublicacion> {
  return conEspacio(workspaceId, async (scope) =>
    publicarDesdeBorrador({ workspaceId: scope.workspaceId, query: scope.query.bind(scope) }, entrada),
  );
}
