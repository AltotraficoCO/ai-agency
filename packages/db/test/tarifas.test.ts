/**
 * El margen vive en el tarifario, y el tarifario es un archivo SQL.
 *
 * Los socios fijaron el margen en el 20% sobre el coste del proveedor
 * (11-sep-2026). Antes era 3,0x, y la unica forma de saber cual esta aplicado
 * es multiplicar a mano: nada en el codigo lo declara, porque los precios NO se
 * escriben en TypeScript. Esta prueba pone la cuenta por escrito: si alguien
 * cambia una tarifa de 0025 sin querer, o anade un modelo con otro margen, aqui
 * salta.
 *
 * No necesita base de datos: lee el SQL de la migracion.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 1 credito = 0,001 USD de precio de venta. */
const USD_POR_CREDITO = 0.001;

/** Lo acordado: coste del proveedor por 1,2. */
const MARGEN = 1.2;

/**
 * Coste del proveedor en USD por millon de tokens, entrada y salida.
 * Verificado contra OpenRouter el 11-sep-2026.
 */
const COSTE_POR_MTOK: Record<string, { entrada: number; salida: number }> = {
  'zai/glm-4.7-flash': { entrada: 0.07, salida: 0.4 },
  'deepseek/deepseek-v4-flash': { entrada: 0.13, salida: 0.26 },
  'anthropic/claude-sonnet-5': { entrada: 2, salida: 10 },
  'anthropic/claude-opus-5': { entrada: 5, salida: 25 },
  'openai/gpt-5.6-luna': { entrada: 0.2, salida: 1.2 },
  'openai/gpt-5.6-luna-pro': { entrada: 0.2, salida: 1.2 },
  'openai/text-embedding-3-small': { entrada: 0.02, salida: 0.02 },
};

/** creditos_por_ktoken = usd_por_Mtok / 1.000 * margen / usd_por_credito. */
function creditosEsperados(usdPorMtok: number): number {
  return (usdPorMtok / 1000) * MARGEN / USD_POR_CREDITO;
}

const SQL = readFileSync(new URL('../migrations/0025_margen_del_20_por_ciento.sql', import.meta.url), 'utf8');

/** Filas `('model_input', 'zai/glm-4.7-flash', 0.084000, '...')`. */
function tarifasDelSql(): { kind: string; ref: string; creditos: number }[] {
  const filas = [...SQL.matchAll(/\(\s*'(model_input|model_output|model_cache_read|embedding)'\s*,\s*'([^']+)'\s*,\s*([\d.]+)\s*,/g)];
  return filas.map((m) => ({ kind: m[1]!, ref: m[2]!, creditos: Number(m[3]) }));
}

describe('margen del tarifario', () => {
  const tarifas = tarifasDelSql();

  it('la migración declara los siete modelos', () => {
    const refs = new Set(tarifas.map((t) => t.ref));
    expect([...refs].sort()).toEqual(Object.keys(COSTE_POR_MTOK).sort());
  });

  it('cada tarifa es el coste del proveedor por 1,2', () => {
    expect(tarifas.length).toBeGreaterThan(0);
    for (const { kind, ref, creditos } of tarifas) {
      const coste = COSTE_POR_MTOK[ref];
      expect(coste, `falta el coste de ${ref}`).toBeDefined();
      // La lectura de caché se factura al 10% de la entrada.
      const base =
        kind === 'model_output'
          ? coste!.salida
          : kind === 'model_cache_read'
            ? coste!.entrada * 0.1
            : coste!.entrada;
      expect(creditos, `${kind} de ${ref}`).toBeCloseTo(creditosEsperados(base), 6);
    }
  });

  it('un margen del 20% deja al proveedor cinco sextos de lo facturado', () => {
    // 1,2x significa que de cada dólar facturado, 0,833 son coste. Si alguien
    // sube MARGEN sin hablarlo, este número lo delata.
    expect(1 / MARGEN).toBeCloseTo(0.8333, 4);
    expect(creditosEsperados(0.07)).toBeCloseTo(0.084, 6);
  });

  it('la migración no toca tool_call ni message_out', () => {
    expect(SQL).not.toMatch(/'tool_call'\s*,/);
    expect(SQL).not.toMatch(/'message_out'\s*,/);
  });

  it('cierra la tarifa vigente antes de insertar la nueva', () => {
    expect(SQL).toMatch(/set effective_to = ahora/);
    expect(SQL).toMatch(/effective_to is null/);
  });
});
