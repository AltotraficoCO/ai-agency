import { describe, expect, it } from "vitest";
import { decidirEjecucion, limitesAAjustes, limitesDesdeAjustes, LIMITES_POR_DEFECTO } from "./limites";

/**
 * La regla de negocio más importante de esta corriente, y la que más caro
 * cuesta si alguien la rompe sin darse cuenta: quedarse sin saldo detiene al
 * BOT, nunca a la bandeja.
 */
describe("agotamiento de saldo", () => {
  it("sin saldo, el bot para", () => {
    const decision = decidirEjecucion({
      saldoDisponible: 0,
      costeEstimado: 5,
      gastadoHoy: 0,
      gastadoEnConversacion: 0,
    });
    expect(decision.permitido).toBe(false);
    expect(decision.motivo).toBe("no_credits");
  });

  it("sin saldo, la bandeja sigue viva", () => {
    const decision = decidirEjecucion({
      saldoDisponible: 0,
      costeEstimado: 5,
      gastadoHoy: 0,
      gastadoEnConversacion: 0,
    });
    expect(decision.bandejaOperativa).toBe(true);
    expect(decision.explicacion).toContain("bandeja");
  });

  it("NINGUNA parada cierra la bandeja, sea cual sea el motivo", () => {
    const casos = [
      { saldoDisponible: 0, costeEstimado: 10, gastadoHoy: 0, gastadoEnConversacion: 0 },
      {
        saldoDisponible: 10_000,
        costeEstimado: 10,
        gastadoHoy: 999,
        gastadoEnConversacion: 0,
        limites: { diario: 1_000, porConversacion: null, parada: "dura" as const },
      },
      {
        saldoDisponible: 10_000,
        costeEstimado: 10,
        gastadoHoy: 0,
        gastadoEnConversacion: 1_995,
        limites: { diario: null, porConversacion: 2_000, parada: "dura" as const },
      },
    ];
    for (const caso of casos) {
      const decision = decidirEjecucion(caso);
      expect(decision.permitido).toBe(false);
      expect(decision.bandejaOperativa).toBe(true);
    }
  });

  it("con saldo suficiente, el bot responde", () => {
    const decision = decidirEjecucion({
      saldoDisponible: 100,
      costeEstimado: 5,
      gastadoHoy: 0,
      gastadoEnConversacion: 0,
    });
    expect(decision.permitido).toBe(true);
    expect(decision.motivo).toBeNull();
  });

  it("la parada blanda deja seguir en negativo", () => {
    const decision = decidirEjecucion({
      saldoDisponible: 0,
      costeEstimado: 5,
      gastadoHoy: 0,
      gastadoEnConversacion: 0,
      limites: { diario: null, porConversacion: null, parada: "blanda" },
    });
    expect(decision.permitido).toBe(true);
  });
});

describe("topes de gasto", () => {
  it("el tope por conversación corta el bucle antes que el saldo", () => {
    // Saldo de sobra, pero la conversación ya se comió su cupo.
    const decision = decidirEjecucion({
      saldoDisponible: 1_000_000,
      costeEstimado: 50,
      gastadoHoy: 0,
      gastadoEnConversacion: 1_990,
      limites: { diario: null, porConversacion: 2_000, parada: "dura" },
    });
    expect(decision.motivo).toBe("tope_conversacion");
  });

  it("el tope diario corta aunque la conversación esté dentro del suyo", () => {
    const decision = decidirEjecucion({
      saldoDisponible: 1_000_000,
      costeEstimado: 50,
      gastadoHoy: 4_990,
      gastadoEnConversacion: 0,
      limites: { diario: 5_000, porConversacion: null, parada: "dura" },
    });
    expect(decision.motivo).toBe("tope_diario");
  });

  it("por defecto hay tope por conversación pero no diario", () => {
    expect(LIMITES_POR_DEFECTO.porConversacion).toBe(2_000);
    expect(LIMITES_POR_DEFECTO.diario).toBeNull();
    expect(LIMITES_POR_DEFECTO.parada).toBe("dura");
  });
});

describe("lectura y escritura de los topes en los ajustes", () => {
  it("ida y vuelta sin perder nada", () => {
    const limites = { diario: 500, porConversacion: 100, parada: "blanda" as const };
    expect(limitesDesdeAjustes(limitesAAjustes(limites))).toEqual(limites);
  });

  it("tolera ajustes vacíos o corruptos", () => {
    expect(limitesDesdeAjustes(null)).toEqual(LIMITES_POR_DEFECTO);
    expect(limitesDesdeAjustes("no soy un objeto")).toEqual(LIMITES_POR_DEFECTO);
    expect(limitesDesdeAjustes({ limites_credito: { diario: "-5" } }).diario).toBeNull();
  });
});
