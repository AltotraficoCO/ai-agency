import { describe, expect, it } from "vitest";
import { ModeloEstructuradoDeEnsayo } from "@strappy/analysis";
import { crearJuezConModelo, crearJuezDeEnsayo } from "../src/juez.js";
import type { CasoDeEvaluacion } from "../src/casos.js";

const CASO: CasoDeEvaluacion = {
  id: "c1",
  nombre: "Pide horario",
  turnos: ["¿A qué hora abren?"],
  esperado: { debeContener: ["lunes a viernes"], noDebeContener: ["no lo sé"], nota: "Debe dar el horario." },
};

const TRANSCRIPTO = ["Cliente: ¿A qué hora abren?", "Agente: Atendemos de lunes a viernes de 8 a 6."].join("\n");

describe("juez", () => {
  it("el de ensayo es estable ante el mismo transcript", async () => {
    const juez = crearJuezDeEnsayo();
    const a = await juez.juzgar({ caso: CASO, transcripto: TRANSCRIPTO });
    const b = await juez.juzgar({ caso: CASO, transcripto: TRANSCRIPTO });
    expect(a).toEqual(b);
    expect(a.aprobado).toBe(true);
    expect(a.puntuacion).toBe(100);
  });

  it("el juez con modelo es estable ante el mismo transcript", async () => {
    const juez = crearJuezConModelo(new ModeloEstructuradoDeEnsayo(), { modo: "max" });
    const a = await juez.juzgar({ caso: CASO, transcripto: TRANSCRIPTO, objetivo: "Informar bien" });
    const b = await juez.juzgar({ caso: CASO, transcripto: TRANSCRIPTO, objetivo: "Informar bien" });
    expect(a).toEqual(b);
    expect(a.puntuacion).toBeGreaterThanOrEqual(0);
    expect(a.puntuacion).toBeLessThanOrEqual(100);
  });

  it("baja la nota cuando falta lo esperado o aparece lo prohibido", async () => {
    const juez = crearJuezDeEnsayo();
    const flojo = await juez.juzgar({ caso: CASO, transcripto: "Cliente: ¿A qué hora abren?\nAgente: no lo sé" });
    expect(flojo.aprobado).toBe(false);
    expect(flojo.puntuacion).toBe(0);
    expect(flojo.razon).toContain("no debía");
  });
});
