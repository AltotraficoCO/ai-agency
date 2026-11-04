import { describe, expect, it } from "vitest";
import { diasDeSaldo, estadoDelSaldo, fraseDeRitmo } from "./creditos";
import { longitudEnDias, periodoAnterior, rangoDeAtajo } from "./fechas";

describe("estado del saldo", () => {
  const base = { umbralAviso: 5_000, haRecargado: true };

  it("avisa por debajo del umbral y se agota en cero", () => {
    expect(estadoDelSaldo({ ...base, disponible: 5_000 })).toBe("sano");
    expect(estadoDelSaldo({ ...base, disponible: 4_999 })).toBe("aviso");
    expect(estadoDelSaldo({ ...base, disponible: 0 })).toBe("agotado");
  });

  it("a quien nunca recargó no se le dice que se quedó sin créditos", () => {
    expect(estadoDelSaldo({ ...base, disponible: 0, haRecargado: false })).toBe("sin_recargar");
  });

  it("el saldo comprado cuenta: recargar quita el aviso de agotado", () => {
    expect(estadoDelSaldo({ ...base, disponible: 25_000 })).toBe("sano");
  });
});

describe("para cuánto alcanza el saldo", () => {
  it("regla de tres sobre el gasto reciente", () => {
    // 30.000 en 30 días = 1.000 al día; con 12.500 alcanza para 12.
    expect(diasDeSaldo({ disponible: 12_500, gastados: 30_000, diasDeHistorial: 30 })).toBe(12);
  });

  it("con historial corto usa los días reales, no los 30", () => {
    expect(diasDeSaldo({ disponible: 10_000, gastados: 10_000, diasDeHistorial: 5 })).toBe(5);
  });

  it("no promete nada con una muestra demasiado corta o sin gasto", () => {
    expect(diasDeSaldo({ disponible: 10_000, gastados: 9_000, diasDeHistorial: 1 })).toBeNull();
    expect(diasDeSaldo({ disponible: 10_000, gastados: 0, diasDeHistorial: 30 })).toBeNull();
    expect(fraseDeRitmo(null)).toBeNull();
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
