import { describe, expect, it } from "vitest";
import { compararCanario, enCanario, revertir, versionParaConversacion, type VersionesPort } from "../src/canario.js";

describe("canario", () => {
  it("reparte de forma determinista y cercana al porcentaje pedido", () => {
    const ids = Array.from({ length: 5000 }, (_, i) => `conv-${i}`);
    const dentro = ids.filter((id) => enCanario(id, 10));
    expect(dentro.length / ids.length).toBeGreaterThan(0.07);
    expect(dentro.length / ids.length).toBeLessThan(0.13);
    // La misma conversación cae siempre del mismo lado.
    expect(ids.every((id) => enCanario(id, 10) === enCanario(id, 10))).toBe(true);
  });

  it("sin versión canaria todo va a la estable", () => {
    expect(versionParaConversacion({ conversationId: "x", versionEstableId: "v1" })).toBe("v1");
    expect(versionParaConversacion({ conversationId: "x", versionEstableId: "v1", versionCanariaId: "v2", porcentaje: 100 })).toBe("v2");
    expect(versionParaConversacion({ conversationId: "x", versionEstableId: "v1", versionCanariaId: "v2", porcentaje: 0 })).toBe("v1");
  });

  it("revierte ante caída de puntuación, aunque falten horas", () => {
    const d = compararCanario({
      estable: { versionId: "v1", muestras: 500, puntuacionMedia: 72, tasaTraspaso: 0.1 },
      canario: { versionId: "v2", muestras: 50, puntuacionMedia: 60, tasaTraspaso: 0.1 },
      horasTranscurridas: 3,
    });
    expect(d.recomendacion).toBe("revertir");
    expect(d.deltaPuntuacion).toBe(-12);
  });

  it("revierte si sube el traspaso a humano", () => {
    const d = compararCanario({
      estable: { versionId: "v1", muestras: 500, puntuacionMedia: 72, tasaTraspaso: 0.10 },
      canario: { versionId: "v2", muestras: 200, puntuacionMedia: 73, tasaTraspaso: 0.18 },
      horasTranscurridas: 24,
    });
    expect(d.recomendacion).toBe("revertir");
  });

  it("espera sin muestra y promueve con la ventana cumplida", () => {
    const pocos = compararCanario({
      estable: { versionId: "v1", muestras: 500, puntuacionMedia: 72, tasaTraspaso: 0.1 },
      canario: { versionId: "v2", muestras: 5, puntuacionMedia: 74, tasaTraspaso: 0.09 },
      horasTranscurridas: 24,
    });
    expect(pocos.recomendacion).toBe("esperar");

    const listo = compararCanario({
      estable: { versionId: "v1", muestras: 500, puntuacionMedia: 72, tasaTraspaso: 0.1 },
      canario: { versionId: "v2", muestras: 120, puntuacionMedia: 76, tasaTraspaso: 0.08 },
      horasTranscurridas: 25,
    });
    expect(listo.recomendacion).toBe("promover");
  });

  it("revertir es un solo movimiento del puntero", async () => {
    const llamadas: unknown[] = [];
    const versiones: VersionesPort = {
      async activar(i) {
        llamadas.push(i);
      },
    };
    await revertir(versiones, { workspaceId: "ws", agentId: "ag", versionEstableId: "v1" });
    expect(llamadas).toEqual([{ workspaceId: "ws", agentId: "ag", versionId: "v1" }]);
  });
});
