/**
 * Lock por conversación con doble barrera.
 *
 * Barrera 1: `pg_try_advisory_xact_lock`. Es instantáneo y lo libera Postgres
 * al cerrar la transacción, incluso si el proceso muere. Barrera 2: un lease
 * persistente (`engine_lock_until`) por si el trabajo se hace fuera de esa
 * transacción o sobrevive a ella; sin él, un proceso que muere con el trabajo
 * a medias deja la conversación abierta a una segunda ejecución simultánea.
 *
 * Ninguna de las dos basta sola: la advisory no sobrevive al commit, y el
 * lease sin advisory tiene una carrera entre leer y escribir.
 */

export interface ConversationLockPort {
  /**
   * `pg_try_advisory_xact_lock` sobre un hash de la conversación.
   * No bloquea: devuelve false si otro proceso lo tiene.
   */
  tryAdvisoryLock(conversationId: string): Promise<boolean>;
  /** Libera la advisory si la implementación no depende del fin de transacción. */
  releaseAdvisoryLock?(conversationId: string): Promise<void>;
  /**
   * Escribe el lease solo si el actual venció o es nuestro.
   * Debe ser una sola sentencia condicional, no un leer-y-escribir.
   */
  acquireLease(input: { conversationId: string; owner: string; until: Date }): Promise<boolean>;
  renewLease?(input: { conversationId: string; owner: string; until: Date }): Promise<boolean>;
  releaseLease(input: { conversationId: string; owner: string }): Promise<void>;
}

export type LockResult<T> =
  | { readonly acquired: true; readonly value: T }
  | { readonly acquired: false; readonly reason: "advisory_busy" | "lease_held" };

export const DEFAULT_LEASE_MS = 120_000;

export async function withConversationLock<T>(
  lock: ConversationLockPort,
  conversationId: string,
  options: { owner: string; leaseMs?: number; now?: () => number },
  work: () => Promise<T>,
): Promise<LockResult<T>> {
  const now = options.now ?? (() => Date.now());
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;

  if (!(await lock.tryAdvisoryLock(conversationId))) {
    return { acquired: false, reason: "advisory_busy" };
  }

  let leaseTaken = false;
  try {
    leaseTaken = await lock.acquireLease({
      conversationId,
      owner: options.owner,
      until: new Date(now() + leaseMs),
    });
    if (!leaseTaken) {
      return { acquired: false, reason: "lease_held" };
    }
    return { acquired: true, value: await work() };
  } finally {
    if (leaseTaken) {
      await lock.releaseLease({ conversationId, owner: options.owner });
    }
    await lock.releaseAdvisoryLock?.(conversationId);
  }
}
