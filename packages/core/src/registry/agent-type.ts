/**
 * Registro de tipos de agente.
 *
 * Un tipo de agente declara qué es capaz de ser un agente: qué forma tiene su
 * configuración, qué herramientas admite y qué runtime lo ejecuta.
 *
 * En la v1 hay dos: `conversacional` (atiende a un cliente final, latencia de
 * segundos) y `tarea_por_encargo` (trabaja para la empresa durante minutos, con
 * evidencia y aprobación humana). Añadir "voz" o "programado" es registrar una
 * entrada más, no tocar el motor.
 */
import type { ZodType } from "zod";

export type AgentRuntimeKind = "conversational" | "task";

export type AgentTypeDef<TSpec = unknown> = {
  readonly slug: string;
  readonly label: string;
  readonly description: string;
  /** Qué runtime lo ejecuta. Define límites, latencia y si admite aprobación humana. */
  readonly runtime: AgentRuntimeKind;
  /** Esquema de su configuración. Es la validación real, tanto en la API como en el builder. */
  readonly specSchema: ZodType<TSpec>;
  /** Patrones de slug de herramientas permitidas, p.ej. ["wp_*", "navegador_*"]. */
  readonly allowedToolPatterns: readonly string[];
  /** Canales en los que puede operar. Vacío = ninguno (agentes que no atienden a nadie). */
  readonly channels: readonly string[];
  /** Tope de pasos de herramienta por turno. Protege coste y latencia. */
  readonly maxToolSteps: number;
  /** Tiempo máximo de una ejecución. */
  readonly timeoutMs: number;
  /** Si sus acciones sensibles requieren un clic humano antes de ejecutarse. */
  readonly requiresApprovalForSensitive: boolean;
};

const types = new Map<string, AgentTypeDef<never>>();

export function registerAgentType<TSpec>(def: AgentTypeDef<TSpec>): void {
  if (types.has(def.slug)) {
    throw new Error(`El tipo de agente "${def.slug}" ya está registrado.`);
  }
  types.set(def.slug, def as unknown as AgentTypeDef<never>);
}

export function getAgentType(slug: string): AgentTypeDef<never> {
  const def = types.get(slug);
  if (!def) {
    throw new Error(
      `Tipo de agente desconocido: "${slug}". Registrados: ${[...types.keys()].join(", ") || "ninguno"}.`,
    );
  }
  return def;
}

export function listAgentTypes(): readonly AgentTypeDef<never>[] {
  return [...types.values()];
}

/** ¿Puede este tipo de agente usar esta herramienta? Se evalúa antes de exponerla al modelo. */
export function allowsTool(agentTypeSlug: string, toolSlug: string): boolean {
  return getAgentType(agentTypeSlug).allowedToolPatterns.some((pattern) => {
    if (!pattern.includes("*")) return pattern === toolSlug;
    const rx = new RegExp(`^${pattern.split("*").map(escapeRe).join(".*")}$`);
    return rx.test(toolSlug);
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
