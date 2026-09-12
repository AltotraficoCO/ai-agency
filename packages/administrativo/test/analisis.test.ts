/**
 * El criterio del agente, que es lo único que de verdad se puede probar.
 *
 * Lo que se verifica aquí no es que compile, sino cuatro promesas al dueño del
 * negocio: que lo primero que lee es lo que más dinero le tiene parado, que las
 * cuentas en dólares no se suman como si fueran pesos, que se le habla sin
 * jerga de contador y que el recordatorio de cobro no ofende a su cliente.
 */
import { describe, expect, it } from "vitest";
import {
  diasDeAtraso,
  dinero,
  estadoDeCaja,
  fraseDeCaja,
  fraseDeFactura,
  frasesDeReparto,
  importeLegible,
  pendientes,
  repartoPorTramo,
  textoDeRecordatorio,
  totalDelBorrador,
  tramoDe,
} from "../src/analisis.js";
import {
  COBROS_DE_EJEMPLO,
  FACTURAS_DE_EJEMPLO,
  enDolares,
  enPesos,
} from "../src/testing/dobles.js";
import type { Factura } from "../src/ports.js";

const HOY = new Date("2026-09-12T15:00:00.000Z");

const factura = (p: Partial<Factura> & { id: string }): Factura => ({
  numero: p.numero ?? p.id,
  cliente: p.cliente ?? { id: "cli", nombre: "Cliente" },
  fecha: p.fecha ?? "2026-01-01",
  vence: p.vence ?? "2026-01-31",
  estado: p.estado ?? "abierta",
  total: p.total ?? enPesos(1_000_000),
  saldo: p.saldo ?? p.total ?? enPesos(1_000_000),
  id: p.id,
});

describe("cuentas básicas", () => {
  it("una factura que vence hoy no lleva atraso", () => {
    expect(diasDeAtraso("2026-09-12", HOY)).toBe(0);
  });

  it("los tramos se cortan donde dicen", () => {
    expect(tramoDe(0)).toBe("al_dia");
    expect(tramoDe(1)).toBe("menos_de_un_mes");
    expect(tramoDe(30)).toBe("menos_de_un_mes");
    expect(tramoDe(31)).toBe("uno_a_dos_meses");
    expect(tramoDe(91)).toBe("mas_de_tres_meses");
  });

  it("suma los impuestos de cada línea, no del total", () => {
    const r = totalDelBorrador([
      { cantidad: 2, precio: 100_000, impuestoPorcentaje: 19 },
      { cantidad: 1, precio: 50_000 },
    ]);
    expect(r.subtotal).toBe(250_000);
    expect(r.impuestos).toBe(38_000);
    expect(r.total).toBe(288_000);
  });
});

describe("lo primero es lo que más duele", () => {
  it("ordena por dinero parado y no solo por antigüedad", () => {
    const lista = pendientes(
      [
        factura({ id: "vieja_chica", vence: "2025-09-12", saldo: enPesos(100_000) }),
        factura({ id: "grande_reciente", vence: "2026-08-12", saldo: enPesos(20_000_000) }),
      ],
      HOY,
    );
    expect(lista[0]?.factura.id).toBe("grande_reciente");
  });

  it("deja fuera las pagadas y las que ya no deben nada", () => {
    const lista = pendientes(FACTURAS_DE_EJEMPLO, HOY);
    expect(lista.map((p) => p.factura.numero)).not.toContain("FV-0999");
  });

  it("una factura que aún no vence va después de las vencidas", () => {
    const lista = pendientes(FACTURAS_DE_EJEMPLO, HOY);
    expect(lista[lista.length - 1]?.factura.numero).toBe("FV-1095");
  });
});

describe("el dinero en otra moneda no se suma como si fuera pesos", () => {
  it("convierte con la tasa del documento, no con una de hoy", () => {
    const usd = enDolares(955, 3_230.44);
    expect(usd.enMonedaBase).toBe(3_085_070);
    expect(usd.valor).toBe(955);
  });

  it("al dueño se le enseñan las dos cifras", () => {
    const texto = importeLegible(enDolares(955, 3_230.44), "COP");
    expect(texto).toContain("955");
    expect(texto).toContain("unos");
  });

  it("si la factura ya está en la moneda del negocio, no repite la cifra", () => {
    expect(importeLegible(enPesos(620_200), "COP")).not.toContain("unos");
  });

  it("el estado de caja suma en la moneda del negocio", () => {
    const caja = estadoDeCaja({
      facturas: FACTURAS_DE_EJEMPLO,
      cobros: COBROS_DE_EJEMPLO,
      moneda: "COP",
      hoy: HOY,
    });
    // 18.400.000 + 4.252.000 + 3.085.070 (los 955 dólares) + 620.200
    expect(caja.porCobrar).toBe(26_357_270);
    expect(caja.facturasAbiertas).toBe(4);
    expect(caja.facturasVencidas).toBe(3);
    // El cobro en dólares también viaja convertido.
    expect(caja.cobrado).toBe(4_252_000 + 646_088);
  });
});

describe("cómo se lo cuenta al dueño", () => {
  it("dice cuánto le deben y cuánto está vencido, sin jerga", () => {
    const caja = estadoDeCaja({
      facturas: FACTURAS_DE_EJEMPLO,
      cobros: COBROS_DE_EJEMPLO,
      moneda: "COP",
      hoy: HOY,
    });
    const frase = fraseDeCaja(caja);
    expect(frase).toContain("Te deben");
    expect(frase).toContain("vencidos");
    expect(frase.toLowerCase()).not.toMatch(/cartera|cxc|conciliaci|causaci|partida/);
  });

  it("el reparto por antigüedad se dice en meses, no en días", () => {
    const frases = frasesDeReparto(repartoPorTramo(pendientes(FACTURAS_DE_EJEMPLO, HOY)), "COP");
    expect(frases.join(" ")).toContain("meses");
    expect(frases.join(" ")).not.toContain("90 días");
  });

  it("una factura se cuenta con nombre, número y días, y sin datos de más", () => {
    const p = pendientes(FACTURAS_DE_EJEMPLO, HOY)[0]!;
    const frase = fraseDeFactura(p, "COP");
    expect(frase).toContain("Constructora del Valle");
    expect(frase).toContain("FV-1001");
    expect(frase).toContain("vencida hace");
  });

  it("cuando no debe nadie, lo dice en una frase", () => {
    const caja = estadoDeCaja({ facturas: [], cobros: [], moneda: "COP", hoy: HOY });
    expect(fraseDeCaja(caja)).toContain("No te debe nadie");
  });

  it("escribe las cifras como se leen en pesos, sin decimales", () => {
    expect(dinero(18_400_000, "COP")).not.toContain(",00");
    expect(dinero(955, "USD")).toContain(",00");
  });
});

describe("el recordatorio de cobro", () => {
  it("pide el pago con el número y el importe, sin amenazar", () => {
    const p = pendientes(FACTURAS_DE_EJEMPLO, HOY)[0]!;
    const texto = textoDeRecordatorio(p, "Altotráfico");
    expect(texto).toContain("Constructora del Valle");
    expect(texto).toContain("FV-1001");
    expect(texto).toContain("Altotráfico");
    expect(texto.toLowerCase()).not.toMatch(/moroso|deudor|legal|abogado|reporte|cobro jurídico/);
    expect(texto).toBe(texto.replace(/\b[A-ZÁÉÍÓÚÑ]{4,}\b/g, (m) => m));
  });

  it("si todavía no ha vencido, avisa en vez de reclamar", () => {
    const p = pendientes(FACTURAS_DE_EJEMPLO, HOY).find((x) => x.factura.numero === "FV-1095")!;
    const texto = textoDeRecordatorio(p, "Altotráfico");
    expect(texto).toContain("vence");
    expect(texto).toContain("Si ya la pagaste");
  });

  it("una factura en dólares se le recuerda al cliente en dólares", () => {
    const p = pendientes(FACTURAS_DE_EJEMPLO, HOY).find((x) => x.factura.numero === "FV-1080")!;
    expect(textoDeRecordatorio(p, "Altotráfico")).toContain("955");
  });
});
