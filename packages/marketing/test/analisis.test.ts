/**
 * El criterio del agente, que es lo único que de verdad se puede probar.
 *
 * Lo que se verifica aquí no es que compile, sino tres promesas al cliente: que
 * no se le llama mala a una campaña con cuatro clics, que se le avisa cuando
 * está tirando el dinero, y que se le habla en pesos y no en siglas.
 */
import { describe, expect, it } from "vitest";
import {
  analizar,
  costePorResultado,
  costeTipico,
  dinero,
  frasePeriodo,
  impactoMensual,
  resumir,
} from "../src/analisis.js";
import { CAMPANAS_DE_EJEMPLO } from "../src/testing/dobles.js";
import type { Campana } from "../src/ports.js";

const campana = (p: Partial<Campana> & { id: string }): Campana => ({
  nombre: p.nombre ?? p.id,
  estado: p.estado ?? "activa",
  ...(p.presupuestoDiario !== undefined ? { presupuestoDiario: p.presupuestoDiario } : {}),
  metricas: p.metricas ?? { gasto: 0, impresiones: 0, clics: 0, conversiones: 0 },
  id: p.id,
});

describe("cuentas básicas", () => {
  it("el coste por resultado es null cuando todavía no hay resultados", () => {
    expect(costePorResultado({ gasto: 100, impresiones: 10, clics: 5, conversiones: 0 })).toBeNull();
  });

  it("la mediana ignora las campañas sin resultados", () => {
    const campanas = [
      campana({ id: "a", metricas: { gasto: 100_000, impresiones: 0, clics: 50, conversiones: 10 } }),
      campana({ id: "b", metricas: { gasto: 300_000, impresiones: 0, clics: 50, conversiones: 10 } }),
      campana({ id: "sin", metricas: { gasto: 900_000, impresiones: 0, clics: 50, conversiones: 0 } }),
    ];
    // 10.000 y 30.000 → mediana 20.000. Si contara la que no convierte, saldría otra cosa.
    expect(costeTipico(campanas)).toBe(20_000);
  });
});

describe("no se juzga sin datos", () => {
  it("una campaña con pocos clics y poco gasto solo merece un aviso", () => {
    const campanas = [
      campana({ id: "referencia", metricas: { gasto: 200_000, impresiones: 0, clics: 100, conversiones: 10 } }),
      campana({ id: "nueva", metricas: { gasto: 8_000, impresiones: 300, clics: 4, conversiones: 0 } }),
    ];
    const hallazgo = analizar(campanas, "COP").find((h) => h.campanaId === "nueva");
    expect(hallazgo?.severidad).toBe("aviso");
    expect(hallazgo?.detalle).toContain("aún son pocos datos");
  });

  it("con tráfico suficiente y cero resultados, sí es grave", () => {
    const campanas = [
      campana({ id: "referencia", metricas: { gasto: 200_000, impresiones: 0, clics: 100, conversiones: 10 } }),
      campana({ id: "seca", metricas: { gasto: 140_000, impresiones: 30_000, clics: 95, conversiones: 0 } }),
    ];
    const hallazgo = analizar(campanas, "COP").find((h) => h.campanaId === "seca");
    expect(hallazgo?.severidad).toBe("grave");
    expect(hallazgo?.titulo).toContain("sin traer clientes");
    expect(hallazgo?.propuesta).toContain("apruebas");
  });
});

describe("comparación entre campañas del mismo negocio", () => {
  it("señala la que cuesta mucho más que la mediana", () => {
    const campanas = [
      campana({ id: "a", metricas: { gasto: 100_000, impresiones: 0, clics: 80, conversiones: 10 } }),
      campana({ id: "b", metricas: { gasto: 120_000, impresiones: 0, clics: 80, conversiones: 10 } }),
      campana({ id: "cara", metricas: { gasto: 600_000, impresiones: 0, clics: 80, conversiones: 2 } }),
    ];
    const hallazgo = analizar(campanas, "COP").find((h) => h.campanaId === "cara");
    expect(hallazgo?.severidad).toBe("grave");
    expect(hallazgo?.titulo).toContain("veces más");
  });

  it("también dice cuál es la que mejor funciona", () => {
    const hallazgos = analizar(CAMPANAS_DE_EJEMPLO, "COP");
    const bueno = hallazgos.find((h) => h.severidad === "bueno");
    expect(bueno?.campanaId).toBe("c_buena");
    expect(bueno?.propuesta).toContain("presupuesto");
  });

  it("las campañas pausadas no se juzgan", () => {
    expect(analizar(CAMPANAS_DE_EJEMPLO, "COP").some((h) => h.campanaId === "c_dormida")).toBe(false);
  });

  it("lo más grave y lo que más cuesta va primero", () => {
    const hallazgos = analizar(CAMPANAS_DE_EJEMPLO, "COP");
    expect(hallazgos[0]?.severidad).toBe("grave");
    expect(hallazgos[hallazgos.length - 1]?.severidad).toBe("bueno");
  });
});

describe("cómo se le habla al cliente", () => {
  it("los pesos se escriben sin decimales y los dólares con ellos", () => {
    expect(dinero(120_000, "COP")).toContain("120.000");
    expect(dinero(120_000, "COP")).not.toContain(",00");
    expect(dinero(12.5, "USD")).toContain("12,50");
  });

  it("el resumen del periodo se lee como una frase, no como un panel", () => {
    const periodo = { desde: "2026-09-01", hasta: "2026-09-07" };
    const frase = frasePeriodo(resumir(CAMPANAS_DE_EJEMPLO, periodo, "COP"));
    expect(frase).toContain("invertiste");
    expect(frase).toContain("por cada uno");
  });

  it("sin resultados lo dice, en vez de inventarse un coste", () => {
    const periodo = { desde: "2026-09-01", hasta: "2026-09-07" };
    const secas = [campana({ id: "x", metricas: { gasto: 50_000, impresiones: 0, clics: 10, conversiones: 0 } })];
    expect(frasePeriodo(resumir(secas, periodo, "COP"))).toContain("todavía no hay resultados");
  });

  it("una propuesta de presupuesto dice cuánto es al mes", () => {
    const texto = impactoMensual(30_000, 50_000, "COP");
    expect(texto).toContain("600.000");
    expect(texto).toContain("más al mes");
  });

  it("ningún texto del análisis usa jerga de plataforma publicitaria", () => {
    const todo = analizar(CAMPANAS_DE_EJEMPLO, "COP")
      .flatMap((h) => [h.titulo, h.detalle, h.propuesta ?? ""])
      .join(" ");
    for (const jerga of ["CPA", "CPC", "CTR", "ROAS", "impresiones", "conversion rate"]) {
      expect(todo).not.toContain(jerga);
    }
  });
});
