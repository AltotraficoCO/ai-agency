/**
 * `ContactPort` de `@strappy/tools`.
 *
 * Un dato que el agente averigua se guarda en DOS sitios: en la conversación
 * (`conversations.variables`), que es lo que el prompt del siguiente turno lee,
 * y en la ficha del contacto (`contacts.properties`), que es lo que la empresa
 * consulta seis meses después. Escribir solo en uno de los dos es el error que
 * hace que el agente vuelva a preguntar lo que ya sabía.
 */
import type { ContactPort } from '@strappy/tools';
import type { TenantScope } from '../client.js';
import { esClaveInterna } from './util.js';

export function crearContactPort(scope: TenantScope): ContactPort {
  const ws = scope.workspaceId;

  return {
    async saveField({ workspaceId, conversationId, contactId, key, value }) {
      scope.assertSameWorkspace(workspaceId);
      if (esClaveInterna(key)) {
        throw new Error(
          `"${key}" empieza por guion bajo y esas claves están reservadas para el motor.`,
        );
      }

      await scope.query(
        `update public.conversations
            set variables = coalesce(variables, '{}'::jsonb)
                            || jsonb_build_object($3::text, $4::text),
                updated_at = now()
          where workspace_id = $1 and id = $2`,
        [ws, conversationId, key, value],
      );

      await scope.query(
        `update public.contacts
            set properties = coalesce(properties, '{}'::jsonb)
                             || jsonb_build_object($3::text, $4::text),
                updated_at = now()
          where workspace_id = $1
            and id = coalesce($2::uuid,
                              (select contact_id from public.conversations
                                where workspace_id = $1 and id = $5))`,
        [ws, contactId ?? null, key, value, conversationId],
      );

      await scope.query(
        `insert into public.conversation_events
           (workspace_id, conversation_id, type, actor_type, payload)
         values ($1, $2, 'dato_guardado', 'bot', jsonb_build_object('clave', $3::text))`,
        [ws, conversationId, key],
      );
    },

    async addTags({ workspaceId, conversationId, tags }) {
      scope.assertSameWorkspace(workspaceId);
      for (const nombre of tags) {
        const limpio = nombre.trim();
        if (!limpio) continue;
        // Las etiquetas se crean solas: obligar a definirlas antes convertiría
        // una herramienta útil en un error que el agente no puede resolver.
        const { rows } = await scope.query<{ id: string }>(
          `with existente as (
             select id from public.tags where workspace_id = $1 and lower(name) = lower($2)
           ), creada as (
             insert into public.tags (workspace_id, name)
             select $1, $2 where not exists (select 1 from existente)
             returning id
           )
           select id from existente union all select id from creada`,
          [ws, limpio],
        );
        const tagId = rows[0]?.id;
        if (!tagId) continue;

        await scope.query(
          `insert into public.taggings (workspace_id, tag_id, entity_type, entity_id)
           values ($1, $2, 'conversation', $3)
           on conflict do nothing`,
          [ws, tagId, conversationId],
        );
      }
    },
  };
}
