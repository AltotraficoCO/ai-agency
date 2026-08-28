/**
 * `ConversationLockPort` con la doble barrera que el motor espera.
 *
 * Barrera 1 · `pg_try_advisory_xact_lock`: instantáneo, y Postgres lo suelta al
 * cerrar la transacción aunque el proceso muera a mitad. Exige que el ámbito
 * (`withWorkspace`) sea la MISMA transacción en la que corre el turno; si no,
 * el lock se libera en el commit del ámbito y no protege nada.
 *
 * Barrera 2 · el lease en `conversations.engine_lock_until`, escrito con UNA
 * sentencia condicional. Un `select` seguido de un `update` tendría una carrera
 * entre las dos, que es justo lo que este lock existe para evitar.
 *
 * El dueño del lease se guarda en `variables._lock_owner`: sin él, un proceso
 * podría liberar el lease de otro.
 */
import type { ConversationLockPort } from '@strappy/core';
import type { TenantScope } from '../client.js';
import { CLAVE_DUENO_LOCK } from './util.js';

export function crearConversationLock(scope: TenantScope): ConversationLockPort {
  const ws = scope.workspaceId;

  return {
    async tryAdvisoryLock(conversationId) {
      const { rows } = await scope.query<{ tomado: boolean }>(
        // El espacio entra en el hash: dos conversaciones de tenants distintos
        // no deben competir nunca por el mismo lock.
        `select pg_try_advisory_xact_lock(
                  hashtextextended($1 || ':' || $2, 0)) as tomado`,
        [ws, conversationId],
      );
      return rows[0]?.tomado ?? false;
    },

    // No se libera a mano: es un lock de transacción y lo suelta el commit.
    // Liberarlo antes dejaría el resto del turno sin barrera.

    async acquireLease({ conversationId, owner, until }) {
      const { rows } = await scope.query<{ id: string }>(
        `update public.conversations
            set engine_lock_until = $3,
                variables = coalesce(variables, '{}'::jsonb)
                            || jsonb_build_object($5::text, $4::text)
          where workspace_id = $1
            and id = $2
            and (engine_lock_until is null
                 or engine_lock_until <= now()
                 or variables->>$5 = $4)
          returning id`,
        [ws, conversationId, until.toISOString(), owner, CLAVE_DUENO_LOCK],
      );
      return rows.length > 0;
    },

    async renewLease({ conversationId, owner, until }) {
      const { rows } = await scope.query<{ id: string }>(
        `update public.conversations
            set engine_lock_until = $3
          where workspace_id = $1 and id = $2 and variables->>$4 = $5
          returning id`,
        [ws, conversationId, until.toISOString(), CLAVE_DUENO_LOCK, owner],
      );
      return rows.length > 0;
    },

    async releaseLease({ conversationId, owner }) {
      await scope.query(
        `update public.conversations
            set engine_lock_until = null,
                variables = coalesce(variables, '{}'::jsonb) - $4
          where workspace_id = $1 and id = $2 and variables->>$4 = $3`,
        [ws, conversationId, owner, CLAVE_DUENO_LOCK],
      );
    },
  };
}
