/**
 * `AgentStore` contra el esquema real.
 *
 * `agents` es un puntero mutable y `agent_versions` la cadena inmutable que
 * ejecuta el motor. Se lee SIEMPRE la versión activa: un agente sin
 * `active_version_id` no está publicado y el motor no debe correrlo.
 */
import type { AgentConfig, AgentStore, ConversationSnapshot, PromptSpec } from '@strappy/core';
import type { TenantScope } from '../client.js';
import { aPromptSpec, leerEspecificacion, type DatosEmpresa } from './spec.js';

type FilaAgente = {
  id: string;
  workspace_id: string;
  agent_type: string;
  status: string;
  mode: string;
  spec: unknown;
  settings: Record<string, unknown> | null;
};

export function crearAgentStore(scope: TenantScope): AgentStore {
  const ws = scope.workspaceId;
  return {
    async load(agentId): Promise<AgentConfig | null> {
      const { rows } = await scope.query<FilaAgente>(
        `select a.id, a.workspace_id, a.agent_type, a.status, a.mode,
                v.spec, w.settings
           from public.agents a
           join public.agent_versions v
             on v.workspace_id = a.workspace_id and v.id = a.active_version_id
           join public.workspaces w on w.id = a.workspace_id
          where a.workspace_id = $1 and a.id = $2`,
        [ws, agentId],
      );
      const fila = rows[0];
      if (!fila) return null;

      const ajustes = (fila.settings ?? {}) as Record<string, unknown>;
      const debounce = ajustes['debounce_ms'];
      const temperatura = ajustes['temperature'];

      return {
        id: fila.id,
        workspaceId: fila.workspace_id,
        agentTypeSlug: fila.agent_type,
        enabled: fila.status === 'published',
        mode: fila.mode === 'max' ? 'max' : 'lite',
        ...(typeof debounce === 'number' ? { debounceMs: debounce } : {}),
        ...(typeof temperatura === 'number' ? { temperature: temperatura } : {}),
        promptSpecRaw: fila.spec ?? {},
      };
    },
  };
}

/**
 * `promptSpecFor` del motor. Lee la ficha de empresa una vez por turno: es una
 * fila por espacio y sin ella el agente responde como si no supiera dónde trabaja.
 */
export function crearPromptSpecFor(
  scope: TenantScope,
): (
  agent: { promptSpecRaw: unknown; id: string },
  conversation: ConversationSnapshot,
) => Promise<PromptSpec> {
  const ws = scope.workspaceId;

  return async (agent, conversation) => {
    const [empresa, canal] = await Promise.all([
      leerEmpresa(scope, ws),
      leerEtiquetaCanal(scope, ws, conversation.channelId),
    ]);
    return aPromptSpec(leerEspecificacion(agent.promptSpecRaw), {
      ...(empresa ? { empresa } : {}),
      ...(canal ? { etiquetaCanal: canal } : {}),
    });
  };
}

async function leerEmpresa(scope: TenantScope, ws: string): Promise<DatosEmpresa | undefined> {
  const { rows } = await scope.query<{
    brand_name: string | null;
    legal_name: string | null;
    description: string | null;
    industry: string | null;
    website: string | null;
    business_hours: Record<string, unknown> | null;
    policies: unknown;
  }>(
    `select brand_name, legal_name, description, industry, website, business_hours, policies
       from public.company_profiles
      where workspace_id = $1`,
    [ws],
  );
  const fila = rows[0];
  if (!fila) return undefined;
  const nombre = fila.brand_name ?? fila.legal_name;
  if (!nombre) return undefined;

  const horario = fila.business_hours?.['texto'];
  const politicas = Array.isArray(fila.policies)
    ? (fila.policies as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];

  return {
    name: nombre,
    ...(fila.description ? { description: fila.description } : {}),
    ...(fila.industry ? { industry: fila.industry } : {}),
    ...(fila.website ? { website: fila.website } : {}),
    ...(typeof horario === 'string' ? { hours: horario } : {}),
    ...(politicas.length > 0 ? { policies: politicas } : {}),
  };
}

async function leerEtiquetaCanal(
  scope: TenantScope,
  ws: string,
  channelId: string,
): Promise<string | undefined> {
  const { rows } = await scope.query<{ label: string | null; name: string }>(
    `select k.label, c.name
       from public.channels c
       left join public.channel_kinds k on k.kind = c.kind
      where c.workspace_id = $1 and c.id = $2`,
    [ws, channelId],
  );
  return rows[0]?.label ?? rows[0]?.name ?? undefined;
}
