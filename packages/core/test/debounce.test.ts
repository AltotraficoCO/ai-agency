import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncer, InMemoryDebounceStore, wake } from "../src/engine/debounce.js";

describe("debounce con cancelación", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tres mensajes en tres segundos producen una sola ejecución", async () => {
    const ejecuciones: string[] = [];
    const debouncer = createDebouncer({
      defaultDelayMs: 6000,
      run: async ({ token }) => {
        ejecuciones.push(token);
      },
    });

    const a = debouncer.push("conv-1");
    await vi.advanceTimersByTimeAsync(1000);
    const b = debouncer.push("conv-1");
    await vi.advanceTimersByTimeAsync(1000);
    const c = debouncer.push("conv-1");

    await vi.advanceTimersByTimeAsync(6000);

    expect(await a.done).toMatchObject({ ran: false, reason: "superseded" });
    expect(await b.done).toMatchObject({ ran: false, reason: "superseded" });
    expect(await c.done).toMatchObject({ ran: true });
    expect(ejecuciones).toEqual([c.token]);
  });

  it("un mensaje aislado sí ejecuta, y solo después de la espera", async () => {
    const run = vi.fn();
    const debouncer = createDebouncer({ defaultDelayMs: 6000, run });

    const p = debouncer.push("conv-2");
    await vi.advanceTimersByTimeAsync(5999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await p.done;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("cada conversación tiene su propio hilo", async () => {
    const vistos: string[] = [];
    const debouncer = createDebouncer({ defaultDelayMs: 100, run: ({ key }) => void vistos.push(key) });
    const a = debouncer.push("conv-a");
    const b = debouncer.push("conv-b");
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([a.done, b.done]);
    expect(vistos.sort()).toEqual(["conv-a", "conv-b"]);
  });

  it("cancelar descarta el trabajo pendiente", async () => {
    const run = vi.fn();
    const debouncer = createDebouncer({ defaultDelayMs: 100, run });
    const p = debouncer.push("conv-3");
    await debouncer.cancel("conv-3");
    await vi.advanceTimersByTimeAsync(200);
    expect(run).not.toHaveBeenCalled();
    expect(await p.done).toMatchObject({ ran: false, reason: "cancelled" });
  });

  it("la espera es configurable por agente", async () => {
    const run = vi.fn();
    const debouncer = createDebouncer({ defaultDelayMs: 6000, run });
    const p = debouncer.push("conv-4", { delayMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    await p.done;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("wake() aplica la misma regla para un worker distribuido", async () => {
    const store = new InMemoryDebounceStore();
    await store.schedule("conv-5", { token: "nuevo", runAt: 0 });
    const run = vi.fn();

    // Un job viejo despierta con un token que ya no es el vigente.
    expect(await wake(store, "conv-5", "viejo", run)).toMatchObject({ ran: false, reason: "superseded" });
    expect(run).not.toHaveBeenCalled();

    expect(await wake(store, "conv-5", "nuevo", run)).toMatchObject({ ran: true });
    expect(run).toHaveBeenCalledTimes(1);

    // Y no se puede ejecutar dos veces el mismo token.
    expect(await wake(store, "conv-5", "nuevo", run)).toMatchObject({ ran: false, reason: "cancelled" });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
