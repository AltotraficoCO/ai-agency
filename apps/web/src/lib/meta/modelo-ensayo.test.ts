/**
 * Strap sin clave de modelo.
 *
 * La promesa es que una instalación recién clonada, sin cuenta en ningún
 * proveedor, recorre el guion entero y publica un agente de verdad. Estas
 * pruebas la sostienen: se le da al constructor de ensayo el MISMO prompt que
 * recibiría el modelo real y se comprueba qué herramienta llama.
 *
 * Se prueba a través de `streamText` a propósito, no llamando a `doStream` a
 * pelo: lo que puede romperse aquí no es la lógica del guion, es que el flujo
 * de partes que emite deje de encajar con lo que el AI SDK espera.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { streamText, stepCountIs, type ToolSet } from "ai";
import { BORRADOR_AGENTE_VACIO, capacidadAgenteMensajeria, preguntasPendientes } from "@strappy/core";
import { ModeloConstructorDeEnsayo } from "./modelo-ensayo";
import { construirPromptDeStrap } from "./prompt";
import type { FaseMeta } from "@strappy/core";

function promptDe(fase: FaseMeta, borrador: Record<string, unknown>): string {
  return construirPromptDeStrap({
    nombreUsuario: "Ana",
    nombreEspacio: "Panadería",
    fase,
    objetivoFase: capacidadAgenteMensajeria.phases.find((f) => f.slug === fase)?.goal ?? "",
    borrador,
    empresa: {},
    pendientes: preguntasPendientes({ capacidad: capacidadAgenteMensajeria, fase, borrador }),
    hayAgentePublicado: false,
    escenarios: ["cliente interesado con presupuesto bajo"],
    modeloDeEnsayo: true,
  });
}

/** Herramientas que solo registran la llamada: aquí se prueba QUÉ llama, no qué hace. */
function herramientasEspia(): { tools: ToolSet; llamadas: { nombre: string; entrada: unknown }[] } {
  const llamadas: { nombre: string; entrada: unknown }[] = [];
  const nombres = capacidadAgenteMensajeria.tools;
  const tools: ToolSet = {};
  for (const nombre of nombres) {
    tools[nombre] = {
      description: nombre,
      inputSchema: z.looseObject({}),
      execute: async (entrada: unknown) => {
        llamadas.push({ nombre, entrada });
        return { tipo: "borrador", ok: true };
      },
    };
  }
  return { tools, llamadas };
}

async function unTurno(sistema: string): Promise<{ nombre: string; entrada: unknown }[]> {
  const { tools, llamadas } = herramientasEspia();
  const resultado = streamText({
    model: new ModeloConstructorDeEnsayo("ensayo"),
    system: sistema,
    messages: [{ role: "user", content: "Hola" }],
    tools,
    stopWhen: [stepCountIs(1)],
  });
  await resultado.consumeStream();
  return llamadas;
}

describe("el constructor de ensayo", () => {
  it("pregunta lo que falta, con sus opciones y sin inventarse claves", async () => {
    const llamadas = await unTurno(promptDe("intencion", BORRADOR_AGENTE_VACIO));

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.nombre).toBe("preguntar");

    const entrada = llamadas[0]?.entrada as {
      preguntas: { clave: string; opciones: { valor: string }[] }[];
    };
    expect(entrada.preguntas.length).toBeLessThanOrEqual(3);
    expect(entrada.preguntas.map((p) => p.clave)).toContain("agente.proposito");
    expect(entrada.preguntas[0]?.opciones.map((o) => o.valor)).toContain("vender");
  });

  it("cuando no queda nada que preguntar, mueve el guion", async () => {
    const llamadas = await unTurno(
      promptDe("intencion", {
        ...BORRADOR_AGENTE_VACIO,
        agente: { proposito: "vender" },
        canal: "whatsapp",
        empresa: { sitioWeb: "https://espiga.example" },
      }),
    );
    expect(llamadas[0]?.nombre).toBe("draft_actualizar");
    expect(llamadas[0]?.entrada).toMatchObject({ fase: "recoleccion_1" });
  });

  it("en construcción publica, y en reporte prueba el agente solo", async () => {
    const listo = {
      ...BORRADOR_AGENTE_VACIO,
      agente: { nombre: "Espiga", proposito: "vender", tono: "cercano" },
      empresa: { nombre: "La Espiga" },
      canal: "whatsapp",
      hace: ["Responde precios"],
      recoger: [{ clave: "nombre", etiqueta: "nombre" }],
    };

    expect((await unTurno(promptDe("construccion", listo)))[0]?.nombre).toBe("publicar_agente");

    const prueba = await unTurno(promptDe("reporte", listo));
    expect(prueba[0]?.nombre).toBe("probar_agente");
    expect(prueba[0]?.entrada).toMatchObject({ guion: "cliente interesado con presupuesto bajo" });

    expect((await unTurno(promptDe("prueba", listo)))[0]?.nombre).toBe("mostrar_tarjeta_agente");
  });

  it("con sitio web sin indexar, primero da de comer el Cerebro", async () => {
    const llamadas = await unTurno(
      promptDe("construccion", {
        ...BORRADOR_AGENTE_VACIO,
        agente: { nombre: "Espiga", proposito: "vender", tono: "cercano" },
        empresa: { nombre: "La Espiga", sitioWeb: "https://espiga.example" },
        hace: ["Responde precios"],
      }),
    );
    expect(llamadas[0]?.nombre).toBe("crear_brain_desde_fuentes");
    expect(llamadas[0]?.entrada).toMatchObject({ urls: ["https://espiga.example"] });
  });
});
