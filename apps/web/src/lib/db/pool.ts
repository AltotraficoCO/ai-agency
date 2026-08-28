/**
 * Conexión a Postgres del lado servidor.
 *
 * Dos formas de hablar con la base, y la diferencia importa:
 *
 *  · `conEspacio()` abre una transacción, BAJA al rol `strappy_worker` y declara
 *    `app.workspace_id`. A partir de ahí la RLS del rol solo deja ver ese
 *    espacio: un join mal escrito devuelve cero filas en vez de datos de otro
 *    cliente. Es por donde pasa el motor y todo lo que escribe.
 *
 *  · `consultar()` va sin rol acotado y solo debe usarse para lo que es
 *    legítimamente transversal: resolver a qué espacio pertenece un usuario
 *    antes de saber cuál es el espacio.
 */
import { Pool } from "pg";
import { createWorkerClient, type TenantScope } from "@strappy/db";

declare global {
  // Next recarga los módulos en desarrollo; sin esto cada recarga abriría otro
  // pool y Postgres se quedaría sin conexiones en veinte minutos.
  // eslint-disable-next-line no-var
  var __strappyPool: Pool | undefined;
}

export function obtenerPool(): Pool {
  if (!globalThis.__strappyPool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "Falta DATABASE_URL. Apunta a la base de Strappy, p. ej. postgresql://postgres:postgres@localhost:54322/postgres",
      );
    }
    globalThis.__strappyPool = new Pool({ connectionString: url, max: 10 });
  }
  return globalThis.__strappyPool;
}

const ROL_WORKER = process.env.STRAPPY_DB_ROLE ?? "strappy_worker";

/**
 * Ejecuta el trabajo dentro de un ámbito de tenant.
 *
 * Todo lo que el motor hace en un turno —incluido el lock por conversación—
 * ocurre en ESTA transacción: `pg_try_advisory_xact_lock` se libera al cerrarla,
 * así que si el turno corriera fuera, el lock no protegería nada.
 */
export async function conEspacio<T>(
  workspaceId: string,
  fn: (scope: TenantScope) => Promise<T>,
): Promise<T> {
  const cliente = createWorkerClient(obtenerPool(), {
    assumeRole: ROL_WORKER,
    // Un turno llama al modelo dentro de la transacción; el límite protege cada
    // sentencia, no la espera de red.
    statementTimeoutMs: 20_000,
  });
  return cliente.withWorkspace(workspaceId, fn);
}

/** Consulta transversal, sin espacio declarado. Úsala solo para resolver tenencia. */
export async function consultar<T = Record<string, unknown>>(
  texto: string,
  valores: readonly unknown[] = [],
): Promise<T[]> {
  const { rows } = await obtenerPool().query(texto, valores as unknown[]);
  return rows as T[];
}
