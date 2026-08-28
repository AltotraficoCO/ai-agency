/**
 * El ciclo de mejora.
 *
 * Acumula las objeciones que el análisis fue detectando y, una vez al mes,
 * propone en lenguaje llano lo que el prompt debería aprender: «el 40% de tus
 * leads objeta el precio; ¿quieres que añada el manejo de esa objeción?».
 * Aquí solo se genera y se guarda; mostrarla es de otra corriente.
 */
import type { ObjecionRegistrada, SugerenciasPort } from "./ports.js";

export type GrupoDeObjecion = {
  readonly texto: string;
  readonly veces: number;
  /** Sobre el total de conversaciones analizadas en la ventana, 0–1. */
  readonly proporcion: number;
  readonly ejemplos: readonly string[];
};

export type SugerenciaDeMejora = {
  readonly workspaceId: string;
  readonly agentId: string;
  readonly desde: Date;
  readonly hasta: Date;
  readonly tipo: "objecion_frecuente";
  readonly texto: string;
  /** Texto listo para añadir a las instrucciones si el cliente acepta. */
  readonly parcheSugerido: string;
  readonly grupos: readonly GrupoDeObjecion[];
  readonly generadaEl: Date;
};

/** Por debajo de este porcentaje la objeción es ruido, no un patrón. */
export const UMBRAL_PROPORCION = 0.25;
/** Con menos conversaciones no hay muestra: cualquier porcentaje engaña. */
export const MINIMO_CONVERSACIONES = 10;

function clave(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 3)
    .sort()
    .join(" ");
}

export function agruparObjeciones(
  objeciones: readonly ObjecionRegistrada[],
  totalConversaciones: number,
): readonly GrupoDeObjecion[] {
  const grupos = new Map<string, { texto: string; convs: Set<string>; ejemplos: string[] }>();
  for (const o of objeciones) {
    const k = clave(o.texto);
    if (!k) continue;
    const g = grupos.get(k) ?? { texto: o.texto, convs: new Set<string>(), ejemplos: [] };
    g.convs.add(o.conversationId);
    if (g.ejemplos.length < 3) g.ejemplos.push(o.texto);
    grupos.set(k, g);
  }
  const total = Math.max(1, totalConversaciones);
  return [...grupos.values()]
    .map((g) => ({
      texto: g.texto,
      veces: g.convs.size,
      proporcion: g.convs.size / total,
      ejemplos: g.ejemplos,
    }))
    .sort((a, b) => b.veces - a.veces || a.texto.localeCompare(b.texto, "es"));
}

export function redactarSugerencia(grupo: GrupoDeObjecion): string {
  const pct = Math.round(grupo.proporcion * 100);
  return `El ${pct}% de tus conversaciones tropieza con lo mismo: ${grupo.texto.toLowerCase()}. ¿Quieres que añada el manejo de esa objeción al prompt?`;
}

function redactarParche(grupo: GrupoDeObjecion): string {
  return [
    `Cuando la persona plantee esta objeción — ${grupo.texto.toLowerCase()} —`,
    `reconócela antes de responder, explica el valor con un dato concreto y`,
    `ofrece la alternativa que corresponda. No la ignores ni cambies de tema.`,
  ].join(" ");
}

export type DepsMejora = {
  readonly sugerencias: SugerenciasPort;
  readonly now?: () => Date;
};

/**
 * Genera la sugerencia del periodo. Devuelve `null` cuando no hay patrón: una
 * sugerencia inventada por cortesía enseña al cliente a ignorarlas todas.
 */
export async function generarSugerenciaMensual(
  deps: DepsMejora,
  input: {
    readonly workspaceId: string;
    readonly agentId: string;
    readonly desde: Date;
    readonly hasta: Date;
    readonly umbral?: number;
    readonly minimoConversaciones?: number;
  },
): Promise<SugerenciaDeMejora | null> {
  const now = deps.now ?? (() => new Date());
  const ventana = { workspaceId: input.workspaceId, agentId: input.agentId, desde: input.desde, hasta: input.hasta };
  const total = await deps.sugerencias.conversacionesAnalizadas(ventana);
  if (total < (input.minimoConversaciones ?? MINIMO_CONVERSACIONES)) return null;

  const objeciones = await deps.sugerencias.objeciones(ventana);
  const grupos = agruparObjeciones(objeciones, total);
  const principal = grupos[0];
  if (!principal || principal.proporcion < (input.umbral ?? UMBRAL_PROPORCION)) return null;

  const sugerencia: SugerenciaDeMejora = {
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    desde: input.desde,
    hasta: input.hasta,
    tipo: "objecion_frecuente",
    texto: redactarSugerencia(principal),
    parcheSugerido: redactarParche(principal),
    grupos,
    generadaEl: now(),
  };
  await deps.sugerencias.guardar(sugerencia);
  return sugerencia;
}
