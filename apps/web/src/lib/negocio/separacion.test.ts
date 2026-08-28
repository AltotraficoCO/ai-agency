import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { combinarFactura } from "./factura";
import { planPorClave } from "./planes";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LAS DOS ANALÍTICAS NO SE SUMAN. NUNCA.
 * ════════════════════════════════════════════════════════════════════════════
 * Operamos como Tech Provider: el WhatsApp es del cliente y Meta le cobra a él
 * directamente. Si un total mezclara su gasto en Meta con nuestros créditos, el
 * cliente creería que se lo cobramos nosotros —o que se lo cobramos dos veces—.
 *
 * Esta prueba defiende esa frontera de dos maneras: comprobando la aritmética
 * del total, y vigilando que nadie escriba una suma nueva que la cruce.
 */
describe("la factura solo suma lo que facturamos nosotros", () => {
  const plan = planPorClave("starter");

  it("suma plan, agentes y recargas, y nada más", () => {
    const factura = combinarFactura(plan, { planUsd: 99, agentesUsd: 20, recargasUsd: 25 });
    expect(factura.totalUsd).toBe(144);
  });

  it("un gasto en Meta del mismo periodo no cambia el total", () => {
    // Este objeto es lo que devolvería `gastoEnMeta`. Aquí no hay forma de
    // colarlo: la firma de `combinarFactura` no tiene dónde ponerlo.
    const gastoEnMeta = { origen: "meta" as const, costeUsd: 380.5 };

    const sinMeta = combinarFactura(plan, { planUsd: 99, agentesUsd: 0, recargasUsd: 0 });
    expect(sinMeta.totalUsd).toBe(99);
    expect(sinMeta.totalUsd).not.toBe(99 + gastoEnMeta.costeUsd);
    expect(Object.values(sinMeta)).not.toContain(gastoEnMeta.costeUsd);
  });

  it("los sumandos siguen visibles por separado para poder auditar el total", () => {
    const factura = combinarFactura(plan, { planUsd: 99, agentesUsd: 12.5, recargasUsd: 0 });
    expect(factura.planUsd + factura.agentesUsd + factura.recargasUsd).toBeCloseTo(factura.totalUsd, 6);
  });
});

describe("ninguna fuente mezcla las dos analíticas", () => {
  /**
   * Guardia de regresión sobre el código, no sobre los datos.
   *
   * Es deliberadamente tosca: busca aritmética entre un coste de Meta y
   * cualquier otra cosa. Si algún día alguien escribe `meta.costeUsd +` para
   * componer un «total general», esta prueba se pone roja y le manda a leer el
   * comentario de `factura.ts` antes de que llegue a producción.
   */
  const RAICES = ["src/lib/negocio", "src/components/negocio", "src/app/(aplicacion)/analitica"];
  const PROHIBIDO = [
    /meta\.costeUsd\s*[+\-]/,
    /[+\-]\s*meta\.costeUsd/,
    /costeUsd\s*\+\s*(creditos|creditosDelRango)/i,
    /(creditos|creditosDelRango)\s*\+\s*.*costeUsd/i,
  ];

  function archivos(directorio: string): string[] {
    const encontrados: string[] = [];
    for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
      const ruta = join(directorio, entrada.name);
      if (entrada.isDirectory()) encontrados.push(...archivos(ruta));
      else if (/\.tsx?$/.test(entrada.name) && !entrada.name.endsWith(".test.ts")) {
        encontrados.push(ruta);
      }
    }
    return encontrados;
  }

  it("no hay ninguna suma que cruce créditos con el gasto de Meta", () => {
    const infractores: string[] = [];
    for (const raiz of RAICES) {
      for (const ruta of archivos(raiz)) {
        const fuente = readFileSync(ruta, "utf8");
        for (const patron of PROHIBIDO) {
          if (patron.test(fuente)) infractores.push(`${ruta} → ${patron}`);
        }
      }
    }
    expect(infractores).toEqual([]);
  });

  it("el módulo de Meta declara su origen y no exporta créditos", () => {
    const fuente = readFileSync("src/lib/negocio/meta.ts", "utf8");
    expect(fuente).toContain('ORIGEN_META = "meta"');
    // El tipo habla de dólares (`costeUsd`), no de créditos: si alguien
    // introdujera un campo `creditos` aquí, la frontera se habría roto.
    expect(fuente).not.toMatch(/readonly creditos\b/);
  });
});
