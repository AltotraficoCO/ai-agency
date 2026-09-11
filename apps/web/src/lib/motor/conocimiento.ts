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
    db: conPuntoDeGuardado(scope, puertos.conocimiento),
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

/**
 * Cada consulta al conocimiento, dentro de su propio punto de guardado.
 *
 * El turno entero vive en una transacción. Si una búsqueda falla en SQL, el
 * Cerebro la captura y sigue degradado —como debe—, pero Postgres ya ha
 * abortado la transacción y todo lo que viene después (la respuesta, el cobro)
 * falla con «current transaction is aborted». Volver al punto de guardado deja
 * el fallo en la búsqueda, que es donde tiene que quedarse.
 *
 * Van en fila: con dos puntos de guardado abiertos a la vez, liberar el primero
 * se llevaría también el segundo.
 */
function conPuntoDeGuardado<T extends object>(scope: TenantScope, puerto: T): T {
  let cola: Promise<unknown> = Promise.resolve();
  let cuenta = 0;
  return new Proxy(puerto, {
    get(objetivo, clave, receptor) {
      const valor: unknown = Reflect.get(objetivo, clave, receptor);
      if (typeof valor !== "function") return valor;
      return (...argumentos: unknown[]) => {
        const turno = cola.then(async () => {
          const nombre = `conocimiento_${++cuenta}`;
          await scope.query(`savepoint ${nombre}`);
          try {
            const resultado: unknown = await valor.apply(objetivo, argumentos);
            await scope.query(`release savepoint ${nombre}`);
            return resultado;
          } catch (error) {
            await scope.query(`rollback to savepoint ${nombre}`);
            throw error;
          }
        });
        cola = turno.catch(() => undefined);
        return turno;
      };
    },
  });
}
