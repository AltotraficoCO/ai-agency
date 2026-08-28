/**
 * El Cerebro del espacio, montado.
 *
 * `@strappy/rag` pone la recuperación (composición de dos turnos, presupuesto
 * de 800 ms con degradación, umbrales y cita de la fuente) y `@strappy/db` pone
 * las tablas. Aquí solo se enchufan.
 *
 * Sin `AI_GATEWAY_API_KEY` no hay embeddings, así que la búsqueda se degrada:
 * `Cerebro.search` devuelve vacío en lugar de lanzar y el turno sigue sin
 * conocimiento. Es lo correcto —un agente mudo es peor que uno sin catálogo—
 * pero conviene saberlo al leer una respuesta genérica en desarrollo.
 */
import { Cerebro, crearEmbeddings } from "@strappy/rag";
import type { PuertosDeBase, TenantScope } from "@strappy/db";

export function crearCerebro(scope: TenantScope, puertos: PuertosDeBase): Cerebro {
  return new Cerebro({
    db: puertos.conocimiento,
    embeddings: crearEmbeddings({ modelTiers: puertos.modelTiers }),
    turnos: {
      async ultimosTurnosUsuario({ workspaceId, conversationId, cuantos }) {
        scope.assertSameWorkspace(workspaceId);
        const { rows } = await scope.query<{ texto: string | null }>(
          `select content->>'text' as texto
             from public.messages
            where workspace_id = $1 and conversation_id = $2 and direction = 'inbound'
            order by created_at desc
            limit $3`,
          [scope.workspaceId, conversationId, cuantos],
        );
        return rows
          .map((r) => r.texto ?? "")
          .filter((t) => t.length > 0)
          .reverse();
      },
    },
    registro: {
      aviso(evento, datos) {
        console.warn(`[conocimiento] ${evento}`, datos ?? {});
      },
    },
  });
}
