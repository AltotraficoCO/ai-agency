/**
 * Un agente pidiéndole ayuda a otro.
 *
 * Lo que se prueba aquí no es que la herramienta «funcione»: es que NO haga las
 * tres cosas que arruinarían a un cliente —encadenar encargos sin fin, llamarse
 * en círculo y delegar en alguien que no está contratado— y que cuando sí
 * delega, el gasto del compañero vuelva para poder cobrarlo una sola vez.
 */
import { describe, expect, it } from "vitest";
import type { ToolContext } from "@strappy/tools";
import {
  crearHerramientaDeColaboracion,
  PROFUNDIDAD_MAXIMA,
  type ColaboracionPort,
  type Companero,
  type EncargoDelegado,
} from "../src/colaboracion.js";
import type { Evidencia, ResultadoTarea } from "../src/tipos.js";

const CONTEXTO: ToolContext = {
  workspaceId: "w1",
  dryRun: false,
  scopes: [],
  ports: {},
  now: () => new Date("2026-09-12T00:00:00Z"),
};

const EVIDENCIA: Evidencia = {
  acciones: [{ herramienta: "wp_leer_contenido", entrada: {}, simulada: false, duracionMs: 10 }],
  capturas: [],
  backups: [],
  aprobacionesPendientes: [],
  pasos: 1,
  uso: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  creditos: 42,
  modelo: "x",
  simulacion: false,
};

function puertoDoble(
  companeros: readonly Companero[],
  resultado?: ResultadoTarea,
): ColaboracionPort & { encargos: EncargoDelegado[] } {
  const encargos: EncargoDelegado[] = [];
  return {
    encargos,
    companeros: async () => companeros,
    encargar: async (input) => {
      encargos.push(input);
      return (
        resultado ?? { estado: "completada", resumen: "Listo, revisé las campañas.", evidencia: EVIDENCIA }
      );
    },
  };
}

const MARKETING: Companero = {
  slug: "marketing",
  nombre: "Lucía",
  paraQue: "campañas de publicidad",
};

async function pedir(
  herramienta: ReturnType<typeof crearHerramientaDeColaboracion>,
  companero: string,
): Promise<Record<string, unknown>> {
  return (await herramienta.execute(CONTEXTO, {
    companero,
    encargo: "Revisa cómo van las campañas de esta semana",
  })) as Record<string, unknown>;
}

describe("pedir ayuda a un compañero", () => {
  it("delega y devuelve lo que gastó el compañero, para cobrarlo una sola vez", async () => {
    const puerto = puertoDoble([MARKETING]);
    const salida = await pedir(
      crearHerramientaDeColaboracion({ puerto, slugPropio: "webmaster", cadena: [] }),
      "marketing",
    );

    expect(salida.ok).toBe(true);
    expect(salida.companero).toBe("Lucía");
    expect(salida.creditos).toBe(42);
    expect(puerto.encargos).toHaveLength(1);
    expect(puerto.encargos[0]?.profundidad).toBe(1);
  });

  it("no encadena sin fin: quien ya está ayudando no puede pedir más ayuda", async () => {
    const puerto = puertoDoble([MARKETING]);
    const salida = await pedir(
      crearHerramientaDeColaboracion({
        puerto,
        slugPropio: "administrativo",
        // Ya hay tantos eslabones como el máximo: este no puede añadir otro.
        cadena: Array.from({ length: PROFUNDIDAD_MAXIMA }, (_, i) => `agente${i}`),
      }),
      "marketing",
    );

    expect(salida.ok).toBe(false);
    expect(puerto.encargos).toHaveLength(0);
  });

  it("no se llama a sí mismo", async () => {
    const puerto = puertoDoble([MARKETING]);
    const salida = await pedir(
      crearHerramientaDeColaboracion({ puerto, slugPropio: "marketing", cadena: [] }),
      "marketing",
    );

    expect(salida.ok).toBe(false);
    expect(String(salida.motivo)).toContain("Ese eres tú");
    expect(puerto.encargos).toHaveLength(0);
  });

  it("no llama a quien ya está en la cadena: sería el mismo círculo por otra vía", async () => {
    const puerto = puertoDoble([MARKETING]);
    const salida = await pedir(
      crearHerramientaDeColaboracion({ puerto, slugPropio: "webmaster", cadena: ["marketing"] }),
      "marketing",
    );

    expect(salida.ok).toBe(false);
    expect(puerto.encargos).toHaveLength(0);
  });

  it("si no está contratado lo dice y ofrece a los que sí, sin fallar", async () => {
    const puerto = puertoDoble([MARKETING]);
    const salida = await pedir(
      crearHerramientaDeColaboracion({ puerto, slugPropio: "webmaster", cadena: [] }),
      "disenador",
    );

    expect(salida.ok).toBe(false);
    expect(String(salida.motivo)).toContain("marketing");
    expect(puerto.encargos).toHaveLength(0);
  });

  it("sin nadie contratado invita a terminar solo, no a contratar a mitad del encargo", async () => {
    const puerto = puertoDoble([]);
    const salida = await pedir(
      crearHerramientaDeColaboracion({ puerto, slugPropio: "webmaster", cadena: [] }),
      "marketing",
    );

    expect(salida.ok).toBe(false);
    // Le dice al agente que termine lo que pueda, no que le pida al cliente
    // contratar a alguien en mitad de un encargo que ya aprobó.
    expect(String(salida.motivo)).toContain("RESUMEN");
    expect(String(salida.motivo)).not.toMatch(/contrata a|contrátalo|que contrate/i);
  });

  it("un compañero que se queda esperando aprobación no bloquea a quien pidió ayuda", async () => {
    const puerto = puertoDoble([MARKETING], {
      estado: "esperando_aprobacion",
      resumen: "Necesito tu aprobación para subir el presupuesto.",
      evidencia: EVIDENCIA,
      mensajes: [],
    });
    const salida = await pedir(
      crearHerramientaDeColaboracion({ puerto, slugPropio: "webmaster", cadena: [] }),
      "marketing",
    );

    expect(salida.ok).toBe(true);
    expect(String(salida.nota)).toContain("aprobación");
  });

  it("si el compañero falla, lo cuenta en vez de romper el encargo", async () => {
    const puerto = puertoDoble([MARKETING], {
      estado: "fallida",
      error: "Google Ads no está conectado.",
      motivo: "error",
      evidencia: EVIDENCIA,
    });
    const salida = await pedir(
      crearHerramientaDeColaboracion({ puerto, slugPropio: "webmaster", cadena: [] }),
      "marketing",
    );

    expect(salida.ok).toBe(false);
    expect(String(salida.resumen)).toContain("Google Ads");
  });
});
