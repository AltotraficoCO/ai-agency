import { describe, expect, it } from "vitest";
import {
  estadoDelSaldo,
  fraseDeProyeccion,
  proyectarConsumo,
  UMBRAL_AVISO,
} from "./creditos";
import { longitudEnDias, periodoAnterior, rangoDeAtajo } from "./fechas";

/**
 * La proyección es la promesa del producto: «no vas a tener una factura
 * sorpresa». Si el número está mal, la promesa está rota, así que se prueba
 * contra casos con la cuenta hecha a mano.
 */
describe("proyección de consumo", () => {
  const inicio = new Date("2026-08-01T00:00:00Z");
  const fin = new Date("2026-08-31T00:00:00Z"); // 30 días exactos

  it("proyecta por regla de tres sobre el tiempo transcurrido", () => {
    // A los 15 días (la mitad) con 20.000 gastados → 40.000 al cierre.
    const p = proyectarConsumo({
      consumidos: 20_000,
      asignados: 50_000,
      inicioPeriodo: inicio,
      finPeriodo: fin,
      ahora: new Date("2026-08-16T00:00:00Z"),
    });
    expect(p.avancePeriodo).toBeCloseTo(0.5, 6);
    expect(p.proyectado).toBe(40_000);
    expect(p.porcentajeProyectado).toBeCloseTo(0.8, 6);
    expect(p.excede).toBe(false);
  });

  it("usa el tiempo real y no los días redondeados", () => {
    // Día 3 a mediodía: 2,5 días de 30 = 8,33%, no 10%.
    const p = proyectarConsumo({
      consumidos: 1_000,
      asignados: 50_000,
      inicioPeriodo: inicio,
      finPeriodo: fin,
      ahora: new Date("2026-08-03T12:00:00Z"),
    });
    expect(p.avancePeriodo).toBeCloseTo(2.5 / 30, 6);
    expect(p.proyectado).toBe(12_000);
  });

  it("marca el exceso y cuánto faltaría", () => {
    const p = proyectarConsumo({
      consumidos: 41_000,
      asignados: 50_000,
      inicioPeriodo: inicio,
      finPeriodo: fin,
      ahora: new Date("2026-08-16T00:00:00Z"),
    });
    expect(p.proyectado).toBe(82_000);
    expect(p.excede).toBe(true);
    expect(p.excedente).toBe(32_000);
    expect(fraseDeProyeccion(p)).toContain("164%");
  });

  it("no proyecta con una muestra demasiado corta", () => {
    // 300 créditos en las primeras horas del día 1 proyectarían un disparate.
    const p = proyectarConsumo({
      consumidos: 300,
      asignados: 50_000,
      inicioPeriodo: inicio,
      finPeriodo: fin,
      ahora: new Date("2026-08-01T06:00:00Z"),
    });
    expect(p.fiable).toBe(false);
    expect(fraseDeProyeccion(p)).toContain("pronto");
  });

  it("no divide por cero con un periodo degenerado", () => {
    const p = proyectarConsumo({
      consumidos: 500,
      asignados: 1_000,
      inicioPeriodo: inicio,
      finPeriodo: inicio,
      ahora: inicio,
    });
    expect(Number.isFinite(p.proyectado)).toBe(true);
    expect(p.proyectado).toBe(500);
  });

  it("la frase del enunciado del producto sale exacta", () => {
    // «Al ritmo actual terminarás el mes en 41 K (82%)».
    const p = proyectarConsumo({
      consumidos: 20_500,
      asignados: 50_000,
      inicioPeriodo: inicio,
      finPeriodo: fin,
      ahora: new Date("2026-08-16T00:00:00Z"),
    });
    expect(p.proyectado).toBe(41_000);
    expect(fraseDeProyeccion(p)).toBe("Al ritmo actual terminarás el mes en 41 K (82%).");
  });
});

describe("umbrales de saldo", () => {
  it("avisa a partir del 80% y agota en el 100%", () => {
    expect(estadoDelSaldo(0, 1000)).toBe("sano");
    expect(estadoDelSaldo(799, 1000)).toBe("sano");
    expect(estadoDelSaldo(UMBRAL_AVISO * 1000, 1000)).toBe("aviso");
    expect(estadoDelSaldo(1000, 1000)).toBe("agotado");
    expect(estadoDelSaldo(1200, 1000)).toBe("agotado");
  });

  it("sin asignación no hay saldo que gastar", () => {
    expect(estadoDelSaldo(0, 0)).toBe("agotado");
  });
});

describe("rangos de fecha", () => {
  const ahora = new Date("2026-08-16T15:00:00Z");

  it("los atajos cubren los días que dicen cubrir", () => {
    expect(longitudEnDias(rangoDeAtajo("hoy", ahora, "UTC"))).toBe(1);
    expect(longitudEnDias(rangoDeAtajo("7d", ahora, "UTC"))).toBe(7);
    expect(longitudEnDias(rangoDeAtajo("30d", ahora, "UTC"))).toBe(30);
    expect(rangoDeAtajo("mes", ahora, "UTC")).toEqual({ desde: "2026-08-01", hasta: "2026-08-16" });
  });

  it("el periodo anterior tiene la misma longitud y termina justo antes", () => {
    const rango = rangoDeAtajo("7d", ahora, "UTC");
    const previo = periodoAnterior(rango);
    expect(longitudEnDias(previo)).toBe(longitudEnDias(rango));
    expect(previo.hasta).toBe("2026-08-09");
    expect(previo.desde).toBe("2026-08-03");
  });

  it("respeta la zona horaria del espacio", () => {
    // Las 15:00 UTC son las 10:00 en Bogotá: mismo día. Las 02:00 UTC del 17
    // son todavía el 16 en Bogotá, y ahí es donde una analítica ingenua falla.
    const madrugada = new Date("2026-08-17T02:00:00Z");
    expect(rangoDeAtajo("hoy", madrugada, "America/Bogota").hasta).toBe("2026-08-16");
    expect(rangoDeAtajo("hoy", madrugada, "UTC").hasta).toBe("2026-08-17");
  });
});
