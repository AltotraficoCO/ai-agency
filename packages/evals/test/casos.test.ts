import { describe, expect, it } from "vitest";
import {
  casoDesdeConversacion,
  compararCorridas,
  correrCasos,
  type CasoDeEvaluacion,
  type CorridaDeCasos,
} from "../src/casos.js";
import { crearAgenteDeEnsayo } from "../src/agente-ensayo.js";
import { crearJuezDeEnsayo } from "../src/juez.js";

describe("casos guardados", () => {
  it("una conversación real se convierte en caso con un clic", () => {
    const caso = casoDesdeConversacion({
      conversationId: "conv-99",
      nombre: "Lead que se fue por precio",
      mensajes: [
        { rol: "contacto", texto: "Hola", enviadoEl: new Date(0) },
        { rol: "agente", texto: "¡Hola!", enviadoEl: new Date(1) },
        { rol: "contacto", texto: "¿Cuánto vale?", enviadoEl: new Date(2) },
        { rol: "sistema", texto: "traspaso", enviadoEl: new Date(3) },
      ],
      esperado: { debeContener: ["precio"] },
    });
    expect(caso.turnos).toEqual(["Hola", "¿Cuánto vale?"]);
    expect(caso.sourceConversationId).toBe("conv-99");
    expect(caso.activo).toBe(true);
  });

  it("corre los casos activos y promedia", async () => {
    const casos: CasoDeEvaluacion[] = [
      { id: "a", nombre: "Saluda", turnos: ["Hola"], esperado: { debeContener: ["Sofía"] } },
      { id: "b", nombre: "Apagado", turnos: ["Hola"], activo: false },
    ];
    const corrida = await correrCasos(
      { agente: crearAgenteDeEnsayo(), juez: crearJuezDeEnsayo(), now: () => new Date("2026-08-27T00:00:00Z") },
      { casos, versionId: "v2" },
    );
    expect(corrida.total).toBe(1);
    expect(corrida.aprobados).toBe(1);
    expect(corrida.puntuacionMedia).toBe(100);
  });
});

function corrida(versionId: string, notas: Readonly<Record<string, number>>): CorridaDeCasos {
  const resultados = Object.entries(notas).map(([casoId, puntuacion]) => ({
    casoId,
    nombre: casoId,
    veredicto: { puntuacion, aprobado: puntuacion >= 70, razon: "" },
    transcripto: "",
    latenciaMaxMs: 10,
  }));
  return {
    versionId,
    resultados,
    total: resultados.length,
    aprobados: resultados.filter((r) => r.veredicto.aprobado).length,
    puntuacionMedia: Math.round(resultados.reduce((s, r) => s + r.veredicto.puntuacion, 0) / resultados.length),
    corridaEl: new Date(0),
  };
}

describe("diff entre versiones", () => {
  it("dice «4 mejoran, 1 empeora»", () => {
    const antes = corrida("v1", { a: 50, b: 50, c: 50, d: 50, e: 90 });
    const ahora = corrida("v2", { a: 80, b: 70, c: 60, d: 90, e: 60 });
    const diff = compararCorridas(antes, ahora);
    expect(diff.mejoran).toBe(4);
    expect(diff.empeoran).toBe(1);
    expect(diff.resumen).toBe("4 mejoran, 1 empeora");
    expect(diff.hayRegresion).toBe(true);
  });

  it("una diferencia menor que el umbral no es un cambio", () => {
    const diff = compararCorridas(corrida("v1", { a: 70 }), corrida("v2", { a: 73 }));
    expect(diff.iguales).toBe(1);
    expect(diff.hayRegresion).toBe(false);
    expect(diff.resumen).toBe("1 sin cambio");
  });

  it("sin corrida anterior todos los casos son nuevos", () => {
    const diff = compararCorridas(null, corrida("v1", { a: 70, b: 80 }));
    expect(diff.nuevos).toBe(2);
    expect(diff.resumen).toBe("2 casos nuevos");
  });
});
