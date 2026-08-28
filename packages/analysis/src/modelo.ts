/**
 * Puerto de generación estructurada.
 *
 * El análisis y el juez piden lo mismo: «dame UN objeto que cumpla este
 * esquema». Se declara como puerto para que ninguno de los dos dependa del AI
 * SDK, y para que todo el paquete se pueda probar sin clave de modelo con
 * `ModeloEstructuradoDeEnsayo`, el equivalente al `ModeloDeEnsayo` de la web.
 */
import { z } from "zod";
import { generateObject, type LanguageModel } from "ai";
import {
  resolveModel,
  withModelFallback,
  DEFAULT_MODEL_TABLE,
  type ModelMode,
  type ModelTable,
  type ModelTask,
} from "@strappy/core";
import { extraerTranscripto } from "./transcripto.js";

export type PeticionEstructurada<T> = {
  readonly esquema: z.ZodType<T>;
  readonly sistema: string;
  readonly entrada: string;
  readonly tarea: ModelTask;
  readonly modo: ModelMode;
  readonly abortSignal?: AbortSignal;
};

export type RespuestaEstructurada<T> = {
  readonly valor: T;
  /** Identificador canónico del modelo que respondió. Se guarda con el análisis. */
  readonly modelo: string;
};

export interface ModeloEstructuradoPort {
  generar<T>(peticion: PeticionEstructurada<T>): Promise<RespuestaEstructurada<T>>;
}

export type OpcionesModeloEstructurado = {
  readonly modelTable?: ModelTable;
  readonly resolveLanguageModel: (modelId: string) => LanguageModel;
  readonly temperature?: number;
};

/** Implementación real: tabla de modelos + cadena de respaldo + `generateObject`. */
export function crearModeloEstructurado(o: OpcionesModeloEstructurado): ModeloEstructuradoPort {
  const tabla = o.modelTable ?? DEFAULT_MODEL_TABLE;
  return {
    async generar<T>(p: PeticionEstructurada<T>): Promise<RespuestaEstructurada<T>> {
      const eleccion = resolveModel(tabla, { mode: p.modo, task: p.tarea });
      let usado = eleccion.primary;
      const valor = await withModelFallback(eleccion, async (modelId) => {
        usado = modelId;
        const r = await generateObject({
          model: o.resolveLanguageModel(modelId),
          output: "object" as const,
          schema: p.esquema as unknown as z.ZodType<Record<string, unknown>>,
          system: p.sistema,
          prompt: p.entrada,
          temperature: o.temperature ?? 0,
          ...(p.abortSignal ? { abortSignal: p.abortSignal } : {}),
        });
        return r.object as T;
      });
      return { valor, modelo: usado };
    },
  };
}

// ---------------------------------------------------------------------------
// Modelo de ensayo
// ---------------------------------------------------------------------------

/**
 * Genera un objeto válido para cualquier esquema, sin red y sin clave.
 *
 * No pretende ser listo: pretende ser DETERMINISTA. La misma entrada produce
 * exactamente la misma salida, que es justo lo que hace falta para probar el
 * análisis, el juez y el humo sin gastar un céntimo.
 */
export class ModeloEstructuradoDeEnsayo implements ModeloEstructuradoPort {
  readonly modelo = "strappy-ensayo/estructurado";

  async generar<T>(p: PeticionEstructurada<T>): Promise<RespuestaEstructurada<T>> {
    const js = z.toJSONSchema(p.esquema as z.ZodType, { io: "output" }) as EsquemaJson;
    // Solo el transcript alimenta las heurísticas: las instrucciones no son
    // hechos de la conversación.
    const foco = extraerTranscripto(p.entrada);
    const bruto = sintetizar(js, foco, "raiz");
    // Se valida contra el propio esquema: si la síntesis se desviara, el
    // ensayo tiene que romper aquí y no más abajo, con un dato imposible.
    const valor = (p.esquema as z.ZodType).parse(bruto) as T;
    return { valor, modelo: this.modelo };
  }
}

type EsquemaJson = {
  type?: string | string[];
  properties?: Record<string, EsquemaJson>;
  required?: string[];
  items?: EsquemaJson;
  enum?: unknown[];
  const?: unknown;
  anyOf?: EsquemaJson[];
  oneOf?: EsquemaJson[];
  minimum?: number;
  maximum?: number;
};

/** Hash estable de 32 bits (FNV-1a). No es criptografía, es reproducibilidad. */
export function huella(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const NEGATIVO = /(caro|carísimo|muy alto|no me interesa|molest|pésim|fatal|queja|reclamo|estafa|decepcion)/i;
const POSITIVO = /(gracias|perfecto|genial|excelente|me interesa|listo|de una|dale|encantad)/i;
const LOGRADO = /(agend|confirm|reserv|te espero|cita|nos vemos|quedamos)/i;

const OBJECIONES: readonly (readonly [RegExp, string])[] = [
  [/(precio|caro|carísimo|presupuesto|cuesta|vale mucho)/i, "El precio le parece alto"],
  [/(tiempo|demora|tarda|plazo|cuándo llega)/i, "El plazo de entrega le preocupa"],
  [/(confianza|garantía|seguro|estafa|reseñas)/i, "Duda de la garantía o de la confianza"],
  [/(compet|otra empresa|otro proveedor|cotiz)/i, "Está comparando con la competencia"],
];

function sintetizar(js: EsquemaJson, entrada: string, ruta: string): unknown {
  const variantes = js.anyOf ?? js.oneOf;
  if (variantes && variantes.length > 0) {
    // Con `null` entre las opciones se elige siempre la otra: devolver null
    // por defecto haría que el ensayo pareciese que no extrajo nada.
    const util = variantes.find((v) => v.type !== "null") ?? variantes[0]!;
    return sintetizar(util, entrada, ruta);
  }
  if (js.const !== undefined) return js.const;
  if (js.enum && js.enum.length > 0) {
    return elegirEnum(js.enum, entrada, ruta);
  }

  const tipo = Array.isArray(js.type) ? js.type.find((t) => t !== "null") ?? js.type[0] : js.type;
  switch (tipo) {
    case "object": {
      const salida: Record<string, unknown> = {};
      for (const [clave, sub] of Object.entries(js.properties ?? {})) {
        salida[clave] = valorDeCampo(clave, sub, entrada);
      }
      return salida;
    }
    case "array":
      return js.items ? [sintetizar(js.items, entrada, `${ruta}[]`)] : [];
    case "number":
    case "integer": {
      const min = js.minimum ?? 0;
      const max = js.maximum ?? min + 100;
      return min + (huella(ruta + entrada) % Math.max(1, Math.floor(max - min) + 1));
    }
    case "boolean":
      return huella(ruta + entrada) % 2 === 0;
    case "null":
      return null;
    case "string":
    default:
      return textoPlausible(ruta, entrada);
  }
}

function elegirEnum(opciones: readonly unknown[], entrada: string, ruta: string): unknown {
  const textos = opciones.filter((o): o is string => typeof o === "string");
  if (ruta === "sentimiento" && textos.length > 0) {
    const s = NEGATIVO.test(entrada) ? "negativo" : POSITIVO.test(entrada) ? "positivo" : "neutro";
    if (textos.includes(s)) return s;
  }
  const i = huella(ruta + entrada) % opciones.length;
  return opciones[i];
}

function valorDeCampo(clave: string, js: EsquemaJson, entrada: string): unknown {
  switch (clave) {
    case "resumen":
      return resumenPlausible(entrada);
    case "objetivo_logrado":
      return LOGRADO.test(entrada);
    case "objetivo_score": {
      const base = LOGRADO.test(entrada) ? 70 : 10;
      return base + (huella(`score:${entrada}`) % 30);
    }
    case "objetivo_razon":
      return LOGRADO.test(entrada)
        ? "La conversación llega al compromiso que define el objetivo."
        : "La conversación termina sin llegar al compromiso que define el objetivo.";
    case "objeciones":
      return OBJECIONES.filter(([re]) => re.test(entrada)).map(([, texto]) => texto);
    default:
      return sintetizar(js, entrada, clave);
  }
}

function resumenPlausible(entrada: string): string {
  const primera = entrada
    .split("\n")
    .map((l) => l.replace(/^\s*\w+:\s*/, "").trim())
    .find((l) => l.length > 0);
  return primera
    ? `Conversación de ensayo sobre «${recortar(primera, 90)}».`
    : "Conversación sin contenido analizable.";
}

/**
 * Texto derivado del nombre del campo: legible, distinto por campo y estable.
 * Un valor no nulo por defecto es deliberado: el ensayo simula la extracción
 * completa para que el circuito de cobertura se pueda probar de verdad.
 */
function textoPlausible(ruta: string, entrada: string): string {
  const nombre = ruta.replace(/_/g, " ");
  return `${nombre} (ensayo ${huella(ruta + entrada) % 1000})`;
}

function recortar(t: string, max: number): string {
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
