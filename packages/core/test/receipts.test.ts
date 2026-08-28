import { describe, expect, it } from "vitest";
import { isProgress, type DeliveryStatus } from "../src/types/message.js";

const ORDEN: DeliveryStatus[] = ["sent", "delivered", "read"];

describe("monotonía de los recibos de entrega", () => {
  it("solo avanza, nunca retrocede", () => {
    expect(isProgress(null, "sent")).toBe(true);
    expect(isProgress("sent", "delivered")).toBe(true);
    expect(isProgress("delivered", "read")).toBe(true);
    expect(isProgress("read", "delivered")).toBe(false);
    expect(isProgress("delivered", "sent")).toBe(false);
    expect(isProgress("read", "sent")).toBe(false);
  });

  it("un mismo estado repetido no es progreso (los proveedores reenvían recibos)", () => {
    for (const s of ORDEN) expect(isProgress(s, s)).toBe(false);
  });

  it("un fallo se registra en cualquier momento, pero nada lo revierte", () => {
    for (const s of ORDEN) expect(isProgress(s, "failed")).toBe(true);
    for (const s of ORDEN) expect(isProgress("failed", s)).toBe(false);
    expect(isProgress("failed", "failed")).toBe(false);
  });

  it("aplicar recibos desordenados converge al estado más avanzado", () => {
    const desordenados: DeliveryStatus[] = ["read", "sent", "delivered", "sent"];
    let estado: DeliveryStatus | null = null;
    for (const r of desordenados) if (isProgress(estado, r)) estado = r;
    expect(estado).toBe("read");
  });
});
