import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL_TABLE,
  resolveModel,
  withModelFallback,
  type ModelTable,
} from "../src/engine/model-tier.js";

describe("selección de modelo por modo", () => {
  it("resuelve (modo, tarea) desde la tabla", () => {
    expect(resolveModel(DEFAULT_MODEL_TABLE, { mode: "lite", task: "conversation" }).primary).toBe(
      "zai/glm-4.7-flash",
    );
    expect(resolveModel(DEFAULT_MODEL_TABLE, { mode: "max", task: "conversation" }).primary).toBe(
      "anthropic/claude-sonnet-5",
    );
  });

  it("cae al valor por defecto del modo cuando la tarea no tiene entrada propia", () => {
    const tabla: ModelTable = {
      chains: { lite: {}, max: {} },
      defaults: { lite: ["a/1"], max: ["b/1", "b/2"] },
    };
    expect(resolveModel(tabla, { mode: "max", task: "extraction" }).chain).toEqual(["b/1", "b/2"]);
  });

  it("los identificadores son datos: cambiar la tabla cambia el modelo sin tocar lógica", () => {
    const tabla: ModelTable = {
      chains: { lite: { conversation: ["nuevo/proveedor-1"] }, max: {} },
      defaults: { lite: ["x/1"], max: ["y/1"] },
    };
    expect(resolveModel(tabla, { mode: "lite", task: "conversation" }).primary).toBe("nuevo/proveedor-1");
  });

  it("recorre la cadena de respaldo hasta que una llamada funciona", async () => {
    const choice = resolveModel(DEFAULT_MODEL_TABLE, { mode: "max", task: "conversation" });
    const intentos: string[] = [];
    const onFallback = vi.fn();
    const r = await withModelFallback(
      choice,
      async (id) => {
        intentos.push(id);
        if (id === choice.primary) throw new Error("proveedor caído");
        return id;
      },
      onFallback,
    );
    expect(r).toBe("anthropic/claude-opus-5");
    expect(intentos).toEqual(["anthropic/claude-sonnet-5", "anthropic/claude-opus-5"]);
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it("si toda la cadena falla, el error dice qué se intentó", async () => {
    const choice = resolveModel(DEFAULT_MODEL_TABLE, { mode: "lite", task: "conversation" });
    await expect(
      withModelFallback(choice, async () => {
        throw new Error("504");
      }),
    ).rejects.toThrow(/zai\/glm-4\.7-flash → deepseek\/deepseek-v4-flash/);
  });
});
