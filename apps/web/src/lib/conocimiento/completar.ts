import "server-only";

/**
 * Completar la búsqueda por significado de lo que ya se aprendió.
 *
 * Todo lo indexado mientras la instalación no tenía proveedor de embeddings
 * quedó buscable solo por palabras (`embedding IS NULL`). En cuanto hay
 * proveedor, esto le pone el vector que le falta, sin volver a descargar ni
 * trocear nada (`revectorizarPendientes` de `@strappy/rag`).
 *
 * Se llama en segundo plano —al abrir una base y al terminar de aprender— y
 * está acotado por tres lados, porque la pantalla de una base se refresca cada
 * pocos segundos mientras aprende:
 *  · sin proveedor no hace nada;
 *  · como mucho una pasada por base cada minuto en este proceso;
 *  · lotes cortos, cada uno en su propia transacción, con tope por llamada.
 * Es idempotente: el adaptador solo escribe donde el vector sigue vacío.
 */
import { crearEmbeddingsSiHayProveedor, hayProveedorDeEmbeddings, revectorizarPendientes } from "@strappy/rag";
import { crearModelTiersPort, crearRevectorizadoDb } from "@strappy/db/adapters";
import { conEspacio } from "../db/pool";

const TROZOS_POR_LOTE = 48;
const LOTES_POR_LLAMADA = 8;
const PAUSA_POR_BASE_MS = 60_000;

declare global {
  // Sobrevive a las recargas de módulos en desarrollo, igual que el pool.
  var __strappyUltimoCompletado: Map<string, number> | undefined;
}

function ultimoCompletado(): Map<string, number> {
  globalThis.__strappyUltimoCompletado ??= new Map();
  return globalThis.__strappyUltimoCompletado;
}

/** Devuelve cuántos fragmentos recibieron vector en esta llamada. Nunca lanza. */
export async function completarVectores(input: {
  workspaceId: string;
  cerebroId?: string;
}): Promise<number> {
  if (!hayProveedorDeEmbeddings()) return 0;

  const clave = `${input.workspaceId}:${input.cerebroId ?? "*"}`;
  const ahora = Date.now();
  const antes = ultimoCompletado().get(clave);
  if (antes !== undefined && ahora - antes < PAUSA_POR_BASE_MS) return 0;
  ultimoCompletado().set(clave, ahora);

  let total = 0;
  try {
    for (let lote = 0; lote < LOTES_POR_LLAMADA; lote++) {
      const resultado = await conEspacio(input.workspaceId, async (scope) => {
        const embeddings = crearEmbeddingsSiHayProveedor({ modelTiers: crearModelTiersPort(scope) });
        if (!embeddings) return null;
        return revectorizarPendientes(
          { db: crearRevectorizadoDb(scope), embeddings },
          {
            workspaceId: scope.workspaceId,
            ...(input.cerebroId ? { cerebroId: input.cerebroId } : {}),
            maximo: TROZOS_POR_LOTE,
            loteEmbeddings: TROZOS_POR_LOTE,
          },
        );
      });
      if (!resultado) break;
      total += resultado.trozosVectorizados;
      if (!resultado.quedanPendientes) break;
    }
  } catch (error) {
    // No es grave: lo pendiente sigue buscable por palabras y la próxima pasada
    // lo reintenta. El mensaje ya viene sin la clave del proveedor.
    console.warn("[conocimiento] no se pudo completar la búsqueda por significado", {
      workspaceId: input.workspaceId,
      cerebroId: input.cerebroId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return total;
}
