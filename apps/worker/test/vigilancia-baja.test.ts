/**
 * Dar de baja al Webmaster tiene que apagar la vigilancia de su sitio.
 *
 * El caso real: un cliente cancela, su fila de `site_monitor` sigue activa y el
 * worker le sigue comprobando la web cada quince minutos. Es trabajo que nadie
 * pidió y gasto que nadie paga, y encima el cliente podría recibir avisos de un
 * agente que ya no tiene.
 *
 * Cancelar desde la web ya lo apaga en el mismo clic. Esto prueba la red de
 * seguridad del worker, que es la que cubre las bajas que no pasan por ahí: un
 * impago, una fila tocada a mano, un sitio desconectado.
 *
 * Se comprueba contra el SQL porque es donde vive la decisión. Sin Postgres
 * delante no se puede ejecutar, así que lo que se fija aquí es el contrato: que
 * la consulta existe, que apaga en vez de borrar y que se apoya en el contrato
 * activo.
 */
import { describe, expect, it } from "vitest";
import { VigilanciaPostgres } from "../src/adaptadores/vigilancia.js";
import type { SqlPool } from "../src/ports.js";

type Consulta = { texto: string; valores: readonly unknown[] };

/**
 * Un pool que solo anota lo que se le pide. `connect` no se implementa a
 * propósito: `sincronizar` no abre transacción, y si algún día la abriera,
 * este test fallaría en vez de pasar por casualidad.
 */
function poolFalso(): { pool: SqlPool; consultas: Consulta[] } {
  const consultas: Consulta[] = [];
  const pool = {
    async query(texto: string, valores: readonly unknown[] = []) {
      consultas.push({ texto, valores });
      return { rows: [] };
    },
  };
  return { pool: pool as unknown as SqlPool, consultas };
}

const sinEspacios = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

describe("sincronización de la vigilancia", () => {
  it("da de alta los sitios de quien tiene el Webmaster contratado", async () => {
    const { pool, consultas } = poolFalso();
    await new VigilanciaPostgres(pool).sincronizar();

    const alta = sinEspacios(consultas[0]?.texto ?? "");
    expect(alta).toContain("insert into public.site_monitor");
    expect(alta).toContain("s.catalog_slug = 'webmaster'");
    expect(alta).toContain("s.status = 'active'");
  });

  it("apaga la vigilancia del que ya no lo tiene contratado, sin borrar lo que recuerda", async () => {
    const { pool, consultas } = poolFalso();
    await new VigilanciaPostgres(pool).sincronizar();

    const apagado = sinEspacios(consultas[1]?.texto ?? "");
    expect(apagado).toContain("update public.site_monitor");
    expect(apagado).toContain("activa = false");
    expect(apagado).toContain("not exists");
    expect(apagado).toContain("s.status = 'active'");

    // Borrar la fila perdería lo que la vigilancia sabe del sitio, y recontratar
    // empezaría de cero: avisaría otra vez de cosas que el cliente ya sabía.
    for (const c of consultas) expect(sinEspacios(c.texto)).not.toContain("delete from");
  });
});
