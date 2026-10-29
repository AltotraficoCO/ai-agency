/**
 * El pool acotado al espacio de la tarea en curso.
 *
 * REGLA DE ORO DEL WORKER (packages/db/src/client.ts): ninguna consulta sobre
 * datos de un cliente corre como `postgres`. Aquí es donde se cumple. Cada
 * `query` toma una conexión, baja al rol `strappy_worker`, declara
 * `app.workspace_id` y ejecuta dentro de esa transacción. A partir de ahí la
 * RLS solo deja ver ese espacio: un `where id = $1` sin `workspace_id` o un
 * join mal escrito devuelve cero filas en vez de datos de otro cliente, y
 * `charge_credits` revalida con `assert_workspace()`.
 *
 * Por qué una transacción POR CONSULTA y no una por tarea: el bucle de un
 * agente dura minutos. Una transacción abierta todo ese tiempo retiene la
 * conexión, bloquea el autovacuum y convierte un `statement_timeout` en un
 * problema de diseño. Así cada consulta es corta y el pool se comparte.
 *
 * El espacio activo viaja por `AsyncLocalStorage`: el consumidor envuelve la
 * tarea con `enEspacio(workspaceId, …)` y todos los adaptadores que reciben
 * este pool lo heredan sin pasarlo a mano. Fuera de un espacio, el pool se
 * niega: es preferible un error claro a una consulta sin RLS.
 *
 * Lo que es legítimamente de todos los espacios (reclamar de la cola, listar
 * sitios vigilados, latidos por id de tarea) sigue usando el pool crudo, y lo
 * recibe explícitamente en `index.ts`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { SqlConnection, SqlExecutor, SqlPool } from "../ports.js";

const ROL_WORKER = "strappy_worker";
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const almacen = new AsyncLocalStorage<string>();

/** Ejecuta `fn` con ese espacio como ámbito de todas las consultas acotadas. */
export function enEspacio<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  // No se valida aquí: los puertos en memoria de los tests usan ids como
  // «ws_1». Lo valida el pool justo antes de interpolarlo en SET LOCAL.
  return almacen.run(workspaceId, fn);
}

/** El espacio activo, o `undefined` fuera de una tarea. */
export function espacioActual(): string | undefined {
  return almacen.getStore();
}

function validarUuid(valor: string): string {
  if (!RE_UUID.test(valor)) throw new Error(`workspaceId inválido: ${valor}`);
  return valor.toLowerCase();
}

export type OpcionesAmbito = {
  /** Tope por consulta. Las del worker son cortas; una larga es un bug. */
  readonly statementTimeoutMs?: number;
  readonly rol?: string;
};

/**
 * Un `SqlPool` que solo sabe consultar dentro de un espacio.
 *
 * `connect()` devuelve una conexión ya dentro de la transacción acotada; al
 * soltarla se confirma. Hoy ningún adaptador acotado la usa (los que abren
 * conexión a mano son los multi-espacio y llevan el pool crudo), pero la
 * interfaz la exige y así no sorprende a nadie mañana.
 */
export class PoolConAmbito implements SqlPool {
  readonly #pool: SqlPool;
  readonly #timeout: number;
  readonly #rol: string;

  constructor(pool: SqlPool, opciones: OpcionesAmbito = {}) {
    this.#pool = pool;
    this.#timeout = Math.max(1000, Number(opciones.statementTimeoutMs ?? 15_000) | 0);
    const rol = opciones.rol ?? ROL_WORKER;
    if (!/^[a-z_][a-z0-9_]*$/.test(rol)) throw new Error(`Nombre de rol inválido: ${rol}`);
    this.#rol = rol;
  }

  #espacio(): string {
    const espacio = espacioActual();
    if (!espacio) {
      throw new Error(
        "Consulta acotada fuera de una tarea: no hay espacio declarado. Envuélvela con enEspacio(workspaceId, …) o usa el pool crudo si de verdad es de todos los espacios.",
      );
    }
    return espacio;
  }

  async #preparar(conn: SqlConnection, espacio: string): Promise<void> {
    await conn.query("begin");
    await conn.query(`set local role ${this.#rol}`);
    // SET LOCAL no admite parámetros: por eso se valida el UUID antes.
    await conn.query(`set local app.workspace_id = '${validarUuid(espacio)}'`);
    await conn.query(`set local statement_timeout = ${this.#timeout}`);
  }

  async query<T = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }> {
    const espacio = this.#espacio();
    const conn = await this.#pool.connect();
    try {
      await this.#preparar(conn, espacio);
      const resultado = await conn.query<T>(text, values);
      await conn.query("commit");
      return resultado;
    } catch (error) {
      await conn.query("rollback").catch(() => {});
      throw error;
    } finally {
      conn.release();
    }
  }

  async connect(): Promise<SqlConnection> {
    const espacio = this.#espacio();
    const conn = await this.#pool.connect();
    try {
      await this.#preparar(conn, espacio);
    } catch (error) {
      await conn.query("rollback").catch(() => {});
      conn.release();
      throw error;
    }
    let suelta = false;
    return {
      query: (text, values) => conn.query(text, values),
      release: () => {
        if (suelta) return;
        suelta = true;
        void conn
          .query("commit")
          .catch(() => conn.query("rollback").catch(() => {}))
          .finally(() => conn.release());
      },
    };
  }
}

/** Un ejecutor acotado a un espacio fijo, para quien no pueda heredar el ámbito. */
export function ejecutorDelEspacio(pool: PoolConAmbito, workspaceId: string): SqlExecutor {
  return {
    query: (text, values) => enEspacio(workspaceId, () => pool.query(text, values)),
  };
}
