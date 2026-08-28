import { describe, expect, it } from "vitest";
import {
  ejecutarAutomatizaciones,
  evaluarDisparo,
  normalizarDisparo,
  type Accion,
  type Automatizacion,
  type ContextoDeDisparo,
  type EjecucionDeAutomatizacion,
} from "../src/automatizaciones.js";
import type { AutomatizacionesPort, ContextoDeAccion, EjecutorDeAccionesPort } from "../src/ports.js";
import type { ResultadoAnalisis } from "../src/tipos.js";

const CTX: ContextoDeDisparo = {
  variables: {
    presupuesto_confirmado: true,
    estado_del_lead: "Caliente",
    fecha_de_seguimiento: "2026-09-10",
    presupuesto: 350,
    ciudad: null,
  },
  objetivoLogrado: true,
  objetivoScore: 82,
  sentimiento: "positivo",
};

describe("disparos", () => {
  it("los tres ejemplos del enunciado disparan", () => {
    expect(evaluarDisparo({ variable: "presupuesto_confirmado", operador: "igual", valor: true }, CTX)).toBe(true);
    expect(evaluarDisparo({ variable: "estado_del_lead", operador: "igual", valor: "caliente" }, CTX)).toBe(true);
    expect(evaluarDisparo({ variable: "fecha_de_seguimiento", operador: "existe" }, CTX)).toBe(true);
    expect(evaluarDisparo({ objetivoLogrado: true }, CTX)).toBe(true);
  });

  it("no dispara cuando la condición no se cumple", () => {
    const frio: ContextoDeDisparo = {
      ...CTX,
      variables: { ...CTX.variables, estado_del_lead: "frio", presupuesto_confirmado: false, fecha_de_seguimiento: null },
      objetivoLogrado: false,
    };
    expect(evaluarDisparo({ variable: "presupuesto_confirmado", operador: "igual", valor: true }, frio)).toBe(false);
    expect(evaluarDisparo({ variable: "estado_del_lead", operador: "igual", valor: "caliente" }, frio)).toBe(false);
    expect(evaluarDisparo({ variable: "fecha_de_seguimiento", operador: "existe" }, frio)).toBe(false);
    expect(evaluarDisparo({ objetivoLogrado: true }, frio)).toBe(false);
  });

  it("una variable ausente no dispara nunca por igualdad", () => {
    expect(evaluarDisparo({ variable: "ciudad", operador: "igual", valor: "Bogotá" }, CTX)).toBe(false);
    expect(evaluarDisparo({ variable: "ciudad", operador: "no_existe" }, CTX)).toBe(true);
    expect(evaluarDisparo({ variable: "inexistente", operador: "distinto", valor: "x" }, CTX)).toBe(false);
  });

  it("compara números y listas", () => {
    expect(evaluarDisparo({ variable: "presupuesto", operador: "mayor", valor: 300 }, CTX)).toBe(true);
    expect(evaluarDisparo({ variable: "presupuesto", operador: "menor", valor: 300 }, CTX)).toBe(false);
    expect(evaluarDisparo({ variable: "estado_del_lead", operador: "en", valor: ["tibio", "caliente"] }, CTX)).toBe(true);
  });

  it("lee un trigger de jsonb y rechaza el ilegible", () => {
    expect(normalizarDisparo({ variable: "x", operador: "igual", valor: 1 })).toEqual({
      variable: "x",
      operador: "igual",
      valor: 1,
    });
    expect(normalizarDisparo({ objetivo_logrado: true })).toEqual({ objetivoLogrado: true });
    expect(normalizarDisparo({ operador: "igual" })).toBeNull();
    expect(normalizarDisparo({ variable: "x", operador: "aproximadamente" })).toBeNull();
    expect(normalizarDisparo("nada")).toBeNull();
  });
});

function resultado(): ResultadoAnalisis {
  return {
    resumen: "r",
    objetivoLogrado: true,
    objetivoScore: 82,
    objetivoRazon: "-",
    sentimiento: "positivo",
    objeciones: [],
    variables: CTX.variables,
    modelo: "ensayo",
    mensajesAlAnalizar: 4,
    analizadoEl: new Date("2026-08-27T12:00:00Z"),
  };
}

function regla(id: string, disparo: Automatizacion["disparo"], accion: Accion): Automatizacion {
  return { id, workspaceId: "ws", nombre: id, activa: true, disparo, acciones: [accion] };
}

describe("ejecución", () => {
  it("solo ejecuta las reglas cuya condición se cumple", async () => {
    const reglas: Automatizacion[] = [
      regla("aviso-dueno", { variable: "presupuesto_confirmado", operador: "igual", valor: true }, { tipo: "email", config: { a: "dueno@x.co" } }),
      regla("crm", { variable: "estado_del_lead", operador: "igual", valor: "caliente" }, { tipo: "webhook", config: { url: "https://crm" } }),
      regla("recordatorio", { variable: "fecha_de_seguimiento", operador: "existe" }, { tipo: "tarea", config: {} }),
      regla("nunca", { variable: "estado_del_lead", operador: "igual", valor: "frio" }, { tipo: "whatsapp", config: {} }),
      { ...regla("apagada", { objetivoLogrado: true }, { tipo: "crm", config: {} }), activa: false },
    ];
    const ejecutadas: string[] = [];
    const registradas: EjecucionDeAutomatizacion[] = [];
    const automatizaciones: AutomatizacionesPort = {
      async listarActivas() {
        return reglas;
      },
      async registrarEjecucion(r) {
        registradas.push(r);
      },
    };
    const acciones: EjecutorDeAccionesPort = {
      async ejecutar(a: Accion, _c: ContextoDeAccion) {
        ejecutadas.push(a.tipo);
        return { ok: true };
      },
    };

    const out = await ejecutarAutomatizaciones(
      { automatizaciones, acciones },
      {
        agentId: "ag",
        contexto: {
          workspaceId: "ws",
          conversationId: "conv",
          agentId: "ag",
          analisisId: "an1",
          resultado: resultado(),
          motivoCierre: "inactividad",
        },
      },
    );

    expect(ejecutadas).toEqual(["email", "webhook", "tarea"]);
    expect(out.map((e) => e.automationId)).toEqual(["aviso-dueno", "crm", "recordatorio"]);
    expect(out.every((e) => e.estado === "succeeded")).toBe(true);
    expect(registradas).toHaveLength(3);
    expect(new Set(out.map((e) => e.claveIdempotencia)).size).toBe(3);
  });

  it("una acción rota no tumba el análisis y queda como fallida", async () => {
    const automatizaciones: AutomatizacionesPort = {
      async listarActivas() {
        return [regla("crm", { objetivoLogrado: true }, { tipo: "webhook", config: {} })];
      },
      async registrarEjecucion() {},
    };
    const acciones: EjecutorDeAccionesPort = {
      async ejecutar() {
        throw new Error("el CRM devolvió 500");
      },
    };
    const out = await ejecutarAutomatizaciones(
      { automatizaciones, acciones },
      {
        agentId: "ag",
        contexto: {
          workspaceId: "ws",
          conversationId: "conv",
          agentId: "ag",
          resultado: resultado(),
          motivoCierre: "explicito",
        },
      },
    );
    expect(out[0]?.estado).toBe("failed");
    expect(out[0]?.error).toContain("500");
  });
});
