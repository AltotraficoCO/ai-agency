import { describe, expect, it } from "vitest";
import { analizarConversacion, type DepsAnalisis } from "../src/analizar.js";
import { ModeloEstructuradoDeEnsayo } from "../src/modelo.js";
import { motivoDeCierre } from "../src/cierre.js";
import type { AgenteAnalizadoPort, AnalisisStorePort } from "../src/ports.js";
import type { AnalisisGuardable, Transcripto } from "../src/tipos.js";

const AGENTE: AgenteAnalizadoPort = {
  async cargar() {
    return {
      agentId: "ag",
      workspaceId: "ws",
      nombre: "Sofía",
      modo: "lite",
      objetivo: "Agendar una visita con un lead con presupuesto sobre 300M",
      variables: [
        { clave: "nombre_del_lead", tipo: "texto", obligatoria: true },
        { clave: "presupuesto", tipo: "numero", obligatoria: true },
        { clave: "estado_del_lead", tipo: "seleccion", opciones: ["frio", "tibio", "caliente"] },
      ],
    };
  },
};

function almacen(): { store: AnalisisStorePort; guardados: AnalisisGuardable[] } {
  const guardados: AnalisisGuardable[] = [];
  return {
    guardados,
    store: {
      async guardar(a) {
        guardados.push(a);
        return { id: `an${guardados.length}` };
      },
    },
  };
}

function transcripto(mensajes: readonly [string, string][]): Transcripto {
  return {
    conversationId: "conv",
    workspaceId: "ws",
    agentId: "ag",
    motivoCierre: "inactividad",
    mensajes: mensajes.map(([rol, texto], i) => ({
      rol: rol === "c" ? "contacto" : "agente",
      texto,
      enviadoEl: new Date(Date.UTC(2026, 7, 27, 12, i)),
    })),
  };
}

const CHARLA = transcripto([
  ["c", "Hola, vi el apartamento del norte"],
  ["a", "¡Hola! Claro, ¿cómo te llamas?"],
  ["c", "Ana. Tengo unos 350 millones de presupuesto"],
  ["a", "Perfecto Ana, ¿te agendo una visita el sábado?"],
  ["c", "Dale, listo, nos vemos el sábado"],
]);

describe("análisis post-conversación", () => {
  it("una sola pasada devuelve base + variables y lo guarda", async () => {
    const { store, guardados } = almacen();
    const deps: DepsAnalisis = { modelo: new ModeloEstructuradoDeEnsayo(), agentes: AGENTE, analisis: store };
    const salida = await analizarConversacion(deps, CHARLA);

    expect(salida).not.toBeNull();
    const r = salida!.resultado;
    expect(r.objetivoLogrado).toBe(true);
    expect(r.objetivoScore).toBeGreaterThanOrEqual(70);
    expect(r.sentimiento).toBe("positivo");
    expect(Object.keys(r.variables).sort()).toEqual(["estado_del_lead", "nombre_del_lead", "presupuesto"]);
    expect(["frio", "tibio", "caliente"]).toContain(r.variables["estado_del_lead"]);
    expect(guardados[0]?.conversationId).toBe("conv");
    expect(guardados[0]?.motivoCierre).toBe("inactividad");
  });

  it("es estable: el mismo transcript da el mismo análisis", async () => {
    const deps = (): DepsAnalisis => ({
      modelo: new ModeloEstructuradoDeEnsayo(),
      agentes: AGENTE,
      analisis: almacen().store,
      now: () => new Date("2026-08-27T00:00:00Z"),
    });
    const a = await analizarConversacion(deps(), CHARLA);
    const b = await analizarConversacion(deps(), CHARLA);
    expect(a?.resultado).toEqual(b?.resultado);
  });

  it("detecta objeción de precio y sentimiento negativo", async () => {
    const deps: DepsAnalisis = {
      modelo: new ModeloEstructuradoDeEnsayo(),
      agentes: AGENTE,
      analisis: almacen().store,
    };
    const salida = await analizarConversacion(
      deps,
      transcripto([
        ["c", "¿Cuánto cuesta?"],
        ["a", "Desde 500 millones"],
        ["c", "Uf, muy caro, no me interesa"],
      ]),
    );
    expect(salida?.resultado.sentimiento).toBe("negativo");
    expect(salida?.resultado.objeciones.join(" ")).toContain("precio");
    expect(salida?.resultado.objetivoLogrado).toBe(false);
  });
});

describe("cierre", () => {
  const base = new Date("2026-08-27T12:00:00Z");
  it("cierra a los 30 minutos de silencio", () => {
    expect(motivoDeCierre({ ultimoMensajeEl: base, ahora: new Date(base.getTime() + 29 * 60_000), turnos: 3 })).toBeNull();
    expect(motivoDeCierre({ ultimoMensajeEl: base, ahora: new Date(base.getTime() + 30 * 60_000), turnos: 3 })).toBe("inactividad");
  });
  it("el traspaso y el cierre explícito ganan a la inactividad", () => {
    expect(motivoDeCierre({ ultimoMensajeEl: base, ahora: base, turnos: 1, handover: "human" })).toBe("traspaso");
    expect(motivoDeCierre({ ultimoMensajeEl: base, ahora: base, turnos: 1, cerradaExplicitamente: true })).toBe("explicito");
  });
  it("el límite de turnos cierra", () => {
    expect(motivoDeCierre({ ultimoMensajeEl: base, ahora: base, turnos: 60 })).toBe("limite_turnos");
  });
});
