import { describe, expect, it } from "vitest";
import {
  CREDIT_USD,
  creditsForUsage,
  normalizeUsage,
  precheckCredits,
  stepIdempotencyKey,
  toolIdempotencyKey,
  usdToCredits,
  type CreditEntry,
  type CreditLedgerPort,
  type RateTable,
} from "../src/credits/index.js";

const tarifas: RateTable = {
  models: {
    "anthropic/claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    "zai/glm-4.7-flash": { input: 0.1, output: 0.4 },
  },
  fallback: { input: 5, output: 20 },
};

/** Libro en memoria que se comporta como la función SQL: descarta duplicados. */
function libroFalso(saldoInicial = 1000) {
  const vistas = new Map<string, number>();
  let saldo = saldoInicial;
  const ledger: CreditLedgerPort = {
    async charge(entry: CreditEntry) {
      if (vistas.has(entry.idempotencyKey)) return { applied: false, balance: saldo };
      vistas.set(entry.idempotencyKey, entry.credits);
      saldo -= entry.credits;
      return { applied: true, balance: saldo };
    },
    async balance() {
      return saldo;
    },
  };
  return { ledger, asientos: vistas, saldo: () => saldo };
}

describe("cálculo de créditos", () => {
  it("1 crédito = 0,001 USD de precio de venta", () => {
    expect(CREDIT_USD).toBe(0.001);
    expect(usdToCredits(0.05)).toBe(50);
    expect(usdToCredits(0)).toBe(0);
    // Cualquier consumo real cuesta al menos un crédito.
    expect(usdToCredits(0.0000001)).toBe(1);
  });

  it("tarifica entrada, salida y caché por separado", () => {
    const quote = creditsForUsage(tarifas, "anthropic/claude-sonnet-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    expect(quote.usd).toBeCloseTo(3 + 15 + 0.3 + 3.75, 6);
    expect(quote.credits).toBe(22_050);
    expect(quote.usedFallback).toBe(false);
  });

  it("un modelo desconocido usa la tarifa por defecto y lo marca", () => {
    const quote = creditsForUsage(tarifas, "proveedor/modelo-nuevo", {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(quote.usedFallback).toBe(true);
    expect(quote.credits).toBe(5000);
  });

  it("normaliza el usage del AI SDK sin cobrar dos veces los tokens cacheados", () => {
    const usage = normalizeUsage({
      inputTokens: 1000,
      outputTokens: 200,
      inputTokenDetails: { cacheReadTokens: 600, cacheWriteTokens: 100, noCacheTokens: 300 },
    });
    expect(usage).toEqual({
      inputTokens: 300,
      outputTokens: 200,
      cacheReadTokens: 600,
      cacheWriteTokens: 100,
    });
  });

  it("deduce los tokens sin caché cuando el proveedor no los desglosa", () => {
    const usage = normalizeUsage({
      inputTokens: 1000,
      outputTokens: 50,
      inputTokenDetails: { cacheReadTokens: 400 },
    });
    expect(usage.inputTokens).toBe(600);
  });
});

describe("idempotencia del cobro", () => {
  it("la clave de un paso es agentRunId:step", () => {
    expect(stepIdempotencyKey("run_1", 0)).toBe("run_1:0");
    expect(stepIdempotencyKey("run_1", 3)).toBe("run_1:3");
    expect(toolIdempotencyKey("toolrun_9")).toBe("toolrun_9");
    expect(() => stepIdempotencyKey("", 0)).toThrow();
    expect(() => stepIdempotencyKey("run_1", -1)).toThrow();
  });

  it("reintentar la misma ejecución no vuelve a cobrar", async () => {
    const { ledger, saldo } = libroFalso(1000);
    const cobrar = () =>
      ledger.charge({
        workspaceId: "ws_1",
        kind: "model",
        credits: 30,
        idempotencyKey: stepIdempotencyKey("run_7", 0),
      });

    expect(await cobrar()).toEqual({ applied: true, balance: 970 });
    expect(await cobrar()).toEqual({ applied: false, balance: 970 });
    expect(await cobrar()).toEqual({ applied: false, balance: 970 });
    expect(saldo()).toBe(970);
  });

  it("pasos distintos de la misma ejecución sí cobran cada uno", async () => {
    const { ledger, saldo } = libroFalso(1000);
    for (const step of [0, 1, 2]) {
      await ledger.charge({
        workspaceId: "ws_1",
        kind: "model",
        credits: 10,
        idempotencyKey: stepIdempotencyKey("run_8", step),
      });
    }
    expect(saldo()).toBe(970);
  });
});

describe("pre-chequeo de créditos", () => {
  it("deja pasar si alcanza el saldo", async () => {
    const { ledger } = libroFalso(100);
    const r = await precheckCredits(ledger, {
      workspaceId: "ws_1",
      estimatedCredits: 50,
      idempotencyKey: "pre_1",
    });
    expect(r.ok).toBe(true);
  });

  it("corta antes de gastar si no alcanza", async () => {
    const { ledger } = libroFalso(10);
    const r = await precheckCredits(ledger, {
      workspaceId: "ws_1",
      estimatedCredits: 50,
      idempotencyKey: "pre_2",
    });
    expect(r).toMatchObject({ ok: false, reason: "sin_creditos", required: 50, balance: 10 });
  });

  it("usa la reserva del puerto cuando existe", async () => {
    const base = libroFalso(100);
    let reservado = 0;
    const conReserva: CreditLedgerPort = {
      ...base.ledger,
      async reserve({ credits }) {
        reservado = credits;
        return { id: "res_1", credits };
      },
    };
    const r = await precheckCredits(conReserva, {
      workspaceId: "ws_1",
      estimatedCredits: 40,
      idempotencyKey: "pre_3",
    });
    expect(r.ok && r.reservation?.id).toBe("res_1");
    expect(reservado).toBe(40);
  });
});
