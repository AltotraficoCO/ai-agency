/**
 * Cuándo le toca trabajar a un agente.
 *
 * Lo que se prueba aquí no es aritmética: es que «cada mañana a las 8» sea a
 * las 8 del reloj del cliente el día del cambio de horario, que un worker
 * apagado el fin de semana no dispare tres informes al volver, y que lo que
 * llega demasiado tarde se salte en vez de entregarse fuera de tiempo.
 */
import { describe, expect, it } from "vitest";
import {
  decidirEjecucion,
  describirCadencia,
  esZonaValida,
  proximaEjecucion,
  toleranciaMs,
  vecesAlMes,
  type Cadencia,
} from "../src/schedule/cadencia.js";

const BOGOTA = "America/Bogota";

const diaria = (hora = 8, zona = BOGOTA): Cadencia => ({
  frecuencia: "diaria",
  hora,
  minuto: 0,
  zona,
});

describe("la hora es la del cliente, no la del servidor", () => {
  it("«cada mañana a las 8» en Bogotá son las 13:00 UTC", () => {
    // 12-sep-2026, 01:00 en Bogotá (06:00 UTC): la de hoy todavía no ha pasado.
    const proxima = proximaEjecucion(new Date("2026-09-12T06:00:00Z"), diaria());
    expect(proxima.toISOString()).toBe("2026-09-12T13:00:00.000Z");
  });

  it("si la hora de hoy ya pasó, toca mañana", () => {
    // 12-sep-2026, 09:00 en Bogotá: las 8 quedaron atrás.
    const proxima = proximaEjecucion(new Date("2026-09-12T14:00:00Z"), diaria());
    expect(proxima.toISOString()).toBe("2026-09-13T13:00:00.000Z");
  });

  it("respeta el cambio de horario: las 8 siguen siendo las 8", () => {
    // Madrid adelanta el reloj la madrugada del 29 de marzo de 2026.
    const madrid = diaria(8, "Europe/Madrid");
    const antes = proximaEjecucion(new Date("2026-03-28T00:00:00Z"), madrid);
    const despues = proximaEjecucion(new Date("2026-03-29T00:00:00Z"), madrid);
    expect(antes.toISOString()).toBe("2026-03-28T07:00:00.000Z"); // 08:00 CET
    expect(despues.toISOString()).toBe("2026-03-29T06:00:00.000Z"); // 08:00 CEST
  });

  it("una zona inventada se detecta antes de guardarla", () => {
    expect(esZonaValida(BOGOTA)).toBe(true);
    expect(esZonaValida("Marte/Olympus")).toBe(false);
  });
});

describe("semanal y mensual", () => {
  const lunes: Cadencia = { frecuencia: "semanal", hora: 8, minuto: 0, diaSemana: 1, zona: BOGOTA };

  it("el lunes siguiente, aunque hoy sea miércoles", () => {
    // 16-sep-2026 es miércoles.
    const proxima = proximaEjecucion(new Date("2026-09-16T15:00:00Z"), lunes);
    expect(proxima.toISOString()).toBe("2026-09-21T13:00:00.000Z");
    expect(new Date(proxima).getUTCDay()).toBe(1);
  });

  it("el día del mes, sin saltarse febrero", () => {
    const dia28: Cadencia = { frecuencia: "mensual", hora: 9, minuto: 30, diaMes: 28, zona: BOGOTA };
    const proxima = proximaEjecucion(new Date("2026-02-01T12:00:00Z"), dia28);
    expect(proxima.toISOString()).toBe("2026-02-28T14:30:00.000Z");
  });

  it("el día 1 del mes que viene cuando el de este ya pasó", () => {
    const dia1: Cadencia = { frecuencia: "mensual", hora: 8, minuto: 0, diaMes: 1, zona: BOGOTA };
    const proxima = proximaEjecucion(new Date("2026-09-12T14:00:00Z"), dia1);
    expect(proxima.toISOString()).toBe("2026-10-01T13:00:00.000Z");
  });
});

describe("un worker que estuvo caído", () => {
  it("ejecuta tarde si llega dentro de la tolerancia", () => {
    const prevista = new Date("2026-09-12T13:00:00Z");
    const ahora = new Date("2026-09-12T15:00:00Z"); // dos horas tarde
    const decision = decidirEjecucion(prevista, ahora, diaria());
    expect(decision.ejecutar).toBe(true);
  });

  it("se salta lo que llega demasiado tarde", () => {
    const prevista = new Date("2026-09-12T13:00:00Z");
    const ahora = new Date("2026-09-13T02:00:00Z"); // trece horas tarde
    const decision = decidirEjecucion(prevista, ahora, diaria());
    expect(decision.ejecutar).toBe(false);
    expect(decision.ejecutar === false && decision.motivo).toBe("tarde");
  });

  it("no acumula: tres días apagado son UNA ejecución, no tres", () => {
    const prevista = new Date("2026-09-10T13:00:00Z");
    const ahora = new Date("2026-09-13T12:00:00Z");
    const decision = decidirEjecucion(prevista, ahora, diaria());
    // La próxima se calcula desde ahora, así que es la de hoy, no la del día 11.
    expect(decision.proxima.toISOString()).toBe("2026-09-13T13:00:00.000Z");
    expect(decision.proxima.getTime()).toBeGreaterThan(ahora.getTime());
  });

  it("un informe semanal aguanta más retraso que el repaso de la mañana", () => {
    expect(toleranciaMs("semanal")).toBeGreaterThan(toleranciaMs("diaria"));
  });
});

describe("lo que lee el cliente", () => {
  it("se describe en su idioma, sin asteriscos ni cron", () => {
    expect(describirCadencia(diaria())).toBe("todos los días a las 08:00");
    expect(
      describirCadencia({ frecuencia: "semanal", hora: 8, minuto: 0, diaSemana: 1, zona: BOGOTA }),
    ).toBe("los lunes a las 08:00");
    expect(
      describirCadencia({ frecuencia: "mensual", hora: 9, minuto: 30, diaMes: 1, zona: BOGOTA }),
    ).toBe("el día 1 de cada mes a las 09:30");
  });

  it("dice cuántas veces al mes va a gastar", () => {
    expect(vecesAlMes("diaria")).toBe(30);
    expect(vecesAlMes("semanal")).toBe(4);
    expect(vecesAlMes("mensual")).toBe(1);
  });
});
