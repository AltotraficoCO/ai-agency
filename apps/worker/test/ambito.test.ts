/**
 * El pool acotado: cada consulta baja a `strappy_worker` con el espacio de la
 * tarea declarado, y fuera de una tarea se niega. Es la pieza que hace
 * verdad la regla de oro del worker (packages/db/src/client.ts).
 */
import { describe, expect, it } from "vitest";
import { PoolConAmbito, ejecutorDelEspacio, enEspacio, espacioActual } from "../src/db/ambito.js";
import type { SqlConnection, SqlPool } from "../src/ports.js";

const ESPACIO = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";

function poolFalso(filas: Record<string, unknown>[] = []) {
  const consultas: string[] = [];
  let abiertas = 0;
  const pool: SqlPool = {
    async query(text) {
      consultas.push(`[crudo] ${text}`);
      return { rows: filas as never[] };
    },
    async connect(): Promise<SqlConnection> {
      abiertas++;
      return {
        async query(text) {
          consultas.push(text);
          if (/^falla/.test(text)) throw new Error("boom");
          return { rows: filas as never[] };
        },
        release() {
          abiertas--;
        },
      };
    },
  };
  return { pool, consultas, abiertas: () => abiertas };
}

describe("PoolConAmbito", () => {
  it("envuelve cada consulta en begin / rol / espacio / commit y suelta la conexión", async () => {
    const { pool, consultas, abiertas } = poolFalso([{ id: 1 }]);
    const acotado = new PoolConAmbito(pool, { statementTimeoutMs: 5000 });

    const r = await enEspacio(ESPACIO, () => acotado.query("select 1"));

    expect(r.rows).toEqual([{ id: 1 }]);
    expect(consultas).toEqual([
      "begin",
      "set local role strappy_worker",
      `set local app.workspace_id = '${ESPACIO}'`,
      "set local statement_timeout = 5000",
      "select 1",
      "commit",
    ]);
    expect(abiertas()).toBe(0);
  });

  it("se niega fuera de un espacio: nunca una consulta sin RLS", async () => {
    const { pool, consultas } = poolFalso();
    const acotado = new PoolConAmbito(pool);
    await expect(acotado.query("select 1")).rejects.toThrow(/fuera de una tarea/);
    expect(consultas).toEqual([]);
    expect(espacioActual()).toBeUndefined();
  });

  it("deshace y suelta si la consulta falla", async () => {
    const { pool, consultas, abiertas } = poolFalso();
    const acotado = new PoolConAmbito(pool);
    await expect(enEspacio(ESPACIO, () => acotado.query("falla ahora"))).rejects.toThrow("boom");
    expect(consultas.at(-1)).toBe("rollback");
    expect(abiertas()).toBe(0);
  });

  it("un id que no es UUID se rechaza antes de tocar la base: nunca llega al SET LOCAL", async () => {
    const { pool, consultas, abiertas } = poolFalso();
    const acotado = new PoolConAmbito(pool);
    await expect(enEspacio("x'; drop table users; --", () => acotado.query("select 1"))).rejects.toThrow(
      /workspaceId inválido/,
    );
    expect(consultas.filter((c) => c.startsWith("set local app"))).toEqual([]);
    expect(abiertas()).toBe(0);
  });

  it("cada tarea ve solo su espacio aunque corran a la vez", async () => {
    const { pool, consultas } = poolFalso();
    const acotado = new PoolConAmbito(pool);
    await Promise.all([
      enEspacio(ESPACIO, async () => {
        await new Promise((r) => setTimeout(r, 5));
        await acotado.query("select 'a'");
      }),
      enEspacio(OTRO, () => acotado.query("select 'b'")),
    ]);
    const declarados = consultas.filter((c) => c.startsWith("set local app.workspace_id"));
    expect(declarados).toContain(`set local app.workspace_id = '${OTRO}'`);
    expect(declarados).toContain(`set local app.workspace_id = '${ESPACIO}'`);
    const indiceB = consultas.indexOf("select 'b'");
    const indiceA = consultas.indexOf("select 'a'");
    expect(consultas.slice(0, indiceB).at(-1)).toBe("set local statement_timeout = 15000");
    expect(consultas.slice(0, indiceB)).toContain(`set local app.workspace_id = '${OTRO}'`);
    expect(consultas.slice(indiceB, indiceA)).toContain(`set local app.workspace_id = '${ESPACIO}'`);
  });

  it("ejecutorDelEspacio fija el espacio para quien no pueda heredarlo", async () => {
    const { pool, consultas } = poolFalso();
    const acotado = new PoolConAmbito(pool);
    await ejecutorDelEspacio(acotado, ESPACIO).query("select 2");
    expect(consultas).toContain(`set local app.workspace_id = '${ESPACIO}'`);
  });
});
