import { describe, expect, it } from "vitest";
import { agruparObjeciones, generarSugerenciaMensual } from "../src/mejora.js";
import type { ObjecionRegistrada, SugerenciasPort } from "../src/ports.js";
import type { SugerenciaDeMejora } from "../src/mejora.js";

const DESDE = new Date("2026-07-01T00:00:00Z");
const HASTA = new Date("2026-08-01T00:00:00Z");

function objeciones(n: number, texto: string, prefijo: string): ObjecionRegistrada[] {
  return Array.from({ length: n }, (_, i) => ({
    texto,
    conversationId: `${prefijo}${i}`,
    detectadaEl: DESDE,
  }));
}

function puerto(datos: ObjecionRegistrada[], total: number) {
  const guardadas: SugerenciaDeMejora[] = [];
  const port: SugerenciasPort = {
    async objeciones() {
      return datos;
    },
    async conversacionesAnalizadas() {
      return total;
    },
    async guardar(s) {
      guardadas.push(s);
    },
  };
  return { port, guardadas };
}

describe("ciclo de mejora", () => {
  it("agrupa objeciones equivalentes y cuenta conversaciones, no menciones", () => {
    const grupos = agruparObjeciones(
      [
        ...objeciones(2, "El precio le parece alto", "a"),
        { texto: "el PRECIO le parece alto", conversationId: "a0", detectadaEl: DESDE },
        ...objeciones(1, "El plazo de entrega le preocupa", "b"),
      ],
      10,
    );
    expect(grupos[0]?.veces).toBe(2);
    expect(grupos[0]?.proporcion).toBeCloseTo(0.2);
  });

  it("sugiere cuando el patrón supera el umbral", async () => {
    const { port, guardadas } = puerto(objeciones(4, "El precio le parece alto", "c"), 10);
    const s = await generarSugerenciaMensual({ port: undefined } as never, {
      workspaceId: "ws",
      agentId: "ag",
      desde: DESDE,
      hasta: HASTA,
    }).catch(() => null);
    expect(s).toBeNull(); // deps mal formadas: no se inventa nada

    const real = await generarSugerenciaMensual(
      { sugerencias: port, now: () => HASTA },
      { workspaceId: "ws", agentId: "ag", desde: DESDE, hasta: HASTA },
    );
    expect(real?.texto).toContain("40%");
    expect(real?.texto).toContain("precio");
    expect(real?.parcheSugerido.length).toBeGreaterThan(20);
    expect(guardadas).toHaveLength(1);
  });

  it("calla cuando no hay patrón o no hay muestra", async () => {
    const pocas = puerto(objeciones(4, "El precio le parece alto", "d"), 5);
    expect(
      await generarSugerenciaMensual({ sugerencias: pocas.port }, { workspaceId: "ws", agentId: "ag", desde: DESDE, hasta: HASTA }),
    ).toBeNull();

    const dispersas = puerto(objeciones(1, "El precio le parece alto", "e"), 40);
    expect(
      await generarSugerenciaMensual({ sugerencias: dispersas.port }, { workspaceId: "ws", agentId: "ag", desde: DESDE, hasta: HASTA }),
    ).toBeNull();
  });
});
