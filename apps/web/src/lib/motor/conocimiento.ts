/**
 * El Cerebro del espacio, montado.
 *
 * `@strappy/rag` pone la recuperación (composición de dos turnos, presupuesto
 * de 800 ms con degradación, umbrales y cita de la fuente) y `@strappy/db` pone
 * las tablas. Aquí solo se enchufan.
 *
 * Los embeddings salen de la cartera de modelos: con `OPENROUTER_API_KEY` (la
 * misma del chat) la búsqueda es por significado y por palabras. Sin ningún
 * proveedor se degrada a solo palabras en lugar de fallar.
 */
import { Cerebro, crearEmbeddingsSiHayProveedor } from "@strappy/rag";
import type { PuertosDeBase, TenantScope } from "@strappy/db";

export function crearCerebro(scope: TenantScope, puertos: PuertosDeBase): Cerebro {
  const embeddings = crearEmbeddingsSiHayProveedor({ modelTiers: puertos.modelTiers });

  return new Cerebro({
    db: puertos.conocimiento,
    // Sin proveedor de embeddings el cerebro entra en modo "solo texto" en vez
    // de fallar: encuentra por coincidencia de palabras, que es gratis y sirve
    // para nombres de producto, precios y referencias exactas. Con la clave de
    // OpenRouter (nuestra cartera) el modo completo se activa solo.
    ...(embeddings ? { embeddings } : {}),
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
