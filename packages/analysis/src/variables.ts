/**
 * El esquema de extracción se construye desde las variables declaradas del
 * agente, no se escribe a mano.
 *
 * El compilador de prompt (capa 6) le PROHÍBE al agente escribir JSON mientras
 * conversa: pedir estructura en vivo arruina el tono y añade latencia. La
 * estructura sale de aquí, después, en una sola pasada con un modelo barato.
 */
import { z } from "zod";
import type { Sentimiento } from "./tipos.js";

export type TipoDeVariable = "texto" | "numero" | "booleano" | "fecha" | "seleccion" | "json";

export type VariableDeAgente = {
  readonly clave: string;
  readonly etiqueta?: string;
  readonly tipo: TipoDeVariable;
  /** Valores admitidos cuando el tipo es `seleccion`. */
  readonly opciones?: readonly string[];
  readonly obligatoria?: boolean;
  /** Si al extraerla hay que avisar a alguien. Lo consume `automatizaciones`. */
  readonly notificar?: boolean;
  readonly descripcion?: string;
};

/** Campos que el análisis siempre produce. Ninguna variable puede pisarlos. */
export const CLAVES_RESERVADAS = [
  "resumen",
  "objetivo_logrado",
  "objetivo_score",
  "objetivo_razon",
  "sentimiento",
  "objeciones",
] as const;

export const SENTIMIENTOS = ["positivo", "neutro", "negativo"] as const satisfies readonly Sentimiento[];

export const ESQUEMA_BASE = z.object({
  resumen: z.string(),
  objetivo_logrado: z.boolean(),
  objetivo_score: z.number().min(0).max(100),
  objetivo_razon: z.string(),
  sentimiento: z.enum(SENTIMIENTOS),
  // No está en el enunciado original del esquema, pero sin objeciones no hay
  // ciclo de mejora: es la materia prima de la sugerencia mensual.
  objeciones: z.array(z.string()),
});

export type AnalisisBase = z.infer<typeof ESQUEMA_BASE>;

/**
 * Traduce el `value_type` de `agent_variables` al tipo del dominio.
 * `secret` devuelve `null` a propósito: un secreto NUNCA se extrae de una
 * conversación; que aparezca en el hilo es un incidente, no un dato.
 */
export function tipoDesdeColumna(valueType: string): TipoDeVariable | null {
  switch (valueType) {
    case "text":
      return "texto";
    case "number":
      return "numero";
    case "boolean":
      return "booleano";
    case "date":
      return "fecha";
    case "json":
      return "json";
    case "select":
    case "seleccion":
      return "seleccion";
    case "secret":
      return null;
    default:
      return null;
  }
}

/** Fila cruda de `agent_variables`, con las columnas que hoy existen. */
export type FilaDeVariable = {
  readonly key: string;
  readonly label?: string | null;
  readonly value_type: string;
  readonly is_required?: boolean | null;
  readonly description?: string | null;
  /** Opciones y aviso viven en el spec del agente; se aceptan si el puerto las trae. */
  readonly options?: readonly string[] | null;
  readonly notify?: boolean | null;
};

export function variableDesdeFila(fila: FilaDeVariable): VariableDeAgente | null {
  const tipo = tipoDesdeColumna(fila.value_type);
  if (!tipo) return null;
  const opciones = fila.options?.filter((o) => typeof o === "string" && o.length > 0) ?? [];
  return {
    clave: fila.key,
    ...(fila.label ? { etiqueta: fila.label } : {}),
    // Con opciones declaradas manda la selección aunque la columna diga `text`.
    tipo: opciones.length > 0 ? "seleccion" : tipo,
    ...(opciones.length > 0 ? { opciones } : {}),
    obligatoria: Boolean(fila.is_required),
    notificar: Boolean(fila.notify),
    ...(fila.description ? { descripcion: fila.description } : {}),
  };
}

/** Clave de variable que puede vivir como propiedad de un objeto JSON. */
export function claveValida(clave: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(clave);
}

/**
 * Variables que de verdad entran al esquema: sin duplicados, sin claves
 * inválidas y sin pisar los campos base. Descartar en silencio sería peor que
 * fallar, así que se devuelve también el motivo del descarte.
 */
export function filtrarVariables(
  vars: readonly VariableDeAgente[],
): { readonly usadas: readonly VariableDeAgente[]; readonly descartadas: readonly { clave: string; motivo: string }[] } {
  const usadas: VariableDeAgente[] = [];
  const descartadas: { clave: string; motivo: string }[] = [];
  const vistas = new Set<string>(CLAVES_RESERVADAS);

  for (const v of vars) {
    if (!claveValida(v.clave)) {
      descartadas.push({ clave: v.clave, motivo: "clave no usable como propiedad JSON" });
      continue;
    }
    if (vistas.has(v.clave)) {
      descartadas.push({ clave: v.clave, motivo: "clave reservada o repetida" });
      continue;
    }
    if (v.tipo === "seleccion" && (v.opciones ?? []).length === 0) {
      descartadas.push({ clave: v.clave, motivo: "selector sin opciones" });
      continue;
    }
    vistas.add(v.clave);
    usadas.push(v);
  }
  return { usadas, descartadas };
}

/**
 * Todo campo de variable es `nullable`: una conversación normal no contiene
 * todos los datos, y forzar al modelo a rellenar es forzarlo a inventar.
 */
export function campoDeVariable(v: VariableDeAgente): z.ZodType<unknown> {
  switch (v.tipo) {
    case "numero":
      return z.number().nullable();
    case "booleano":
      return z.boolean().nullable();
    case "seleccion": {
      const opciones = v.opciones ?? [];
      const [primera, ...resto] = opciones;
      if (!primera) return z.string().nullable();
      return z.enum([primera, ...resto] as [string, ...string[]]).nullable();
    }
    case "fecha":
      // Fecha como texto ISO: el resultado viaja en `jsonb` y una `Date` no
      // sobrevive el viaje de ida y vuelta sin convenio.
      return z.string().nullable();
    case "json":
      return z.string().nullable();
    case "texto":
    default:
      return z.string().nullable();
  }
}

export type EsquemaDeAnalisis = {
  readonly esquema: z.ZodType<Record<string, unknown>>;
  readonly usadas: readonly VariableDeAgente[];
  readonly descartadas: readonly { clave: string; motivo: string }[];
};

/** Base + un campo por variable declarada. Una sola pasada, un solo objeto. */
export function construirEsquemaDeAnalisis(vars: readonly VariableDeAgente[]): EsquemaDeAnalisis {
  const { usadas, descartadas } = filtrarVariables(vars);
  const campos: Record<string, z.ZodType<unknown>> = {};
  for (const v of usadas) campos[v.clave] = campoDeVariable(v);
  const esquema = ESQUEMA_BASE.extend(campos) as unknown as z.ZodType<Record<string, unknown>>;
  return { esquema, usadas, descartadas };
}
