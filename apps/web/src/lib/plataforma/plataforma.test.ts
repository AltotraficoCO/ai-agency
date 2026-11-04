import { describe, expect, it } from "vitest";
import { correoEsSuperAdmin } from "./acceso";
import { repartirDescuento } from "./ajustes";
import { patronDeBusqueda } from "./clientes";
import { completarMeses, variacion } from "./estadisticas";

describe("quién es super admin", () => {
  const lista = "victor@strappy.io, Otra@Strappy.io";

  it("compara el correo completo, sin importar mayúsculas", () => {
    expect(correoEsSuperAdmin("VICTOR@strappy.io", lista)).toBe(true);
    expect(correoEsSuperAdmin("otra@strappy.io", lista)).toBe(true);
    expect(correoEsSuperAdmin("victor@strappy.io.evil.com", lista)).toBe(false);
    expect(correoEsSuperAdmin("ictor@strappy.io", lista)).toBe(false);
  });

  it("sin lista no entra nadie, ni con correo vacío", () => {
    expect(correoEsSuperAdmin("victor@strappy.io", "")).toBe(false);
    expect(correoEsSuperAdmin("victor@strappy.io", undefined)).toBe(false);
    expect(correoEsSuperAdmin("", " , ")).toBe(false);
    expect(correoEsSuperAdmin(null, lista)).toBe(false);
  });
});

describe("quitar créditos a mano", () => {
  it("sale primero de lo incluido", () => {
    expect(repartirDescuento(300, 1000, 500)).toEqual({ incluido: 300, comprado: 200 });
  });

  it("no deja el saldo en negativo", () => {
    expect(repartirDescuento(100, 100, 201)).toBeNull();
    expect(repartirDescuento(-5, 100, 100)).toEqual({ incluido: 0, comprado: 100 });
  });
});

describe("buscar clientes", () => {
  it("los comodines se buscan como texto", () => {
    expect(patronDeBusqueda(" 100%_a\\ ")).toBe("%100\\%\\_a\\\\%");
  });
});

describe("ventas por mes", () => {
  it("rellena los meses sin ventas y termina en el mes en curso de Colombia", () => {
    const venta = { mes: "2026-10", usd: 50, pesos: 200_000, recargas: 1, clientes: 1 };
    // 1 de noviembre a las 02:00 UTC: en Bogotá todavía es octubre.
    const meses = completarMeses([venta], new Date("2026-11-01T02:00:00Z"), 3);
    expect(meses.map((m) => m.mes)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(meses[2]).toEqual(venta);
    expect(meses[0]?.usd).toBe(0);
  });

  it("cruza el cambio de año", () => {
    expect(completarMeses([], new Date("2027-01-15T12:00:00Z"), 2).map((m) => m.mes)).toEqual(["2026-12", "2027-01"]);
  });

  it("sin mes anterior no inventa una variación", () => {
    expect(variacion(100, 0)).toBeNull();
    expect(variacion(150, 100)).toBeCloseTo(0.5);
  });
});
