/**
 * Registro de capacidades del meta-agente.
 *
 * Declara qué sabe construir Strap y cómo entrevista para ello. Enseñarle a
 * construir algo nuevo (un agente de voz, un widget web, conectar un canal)
 * es dar de alta una capacidad, no reescribir su prompt ni su lógica.
 */
import type { ZodType } from "zod";

/** Una pregunta de una fase. Las cerradas van siempre con opciones, nunca en texto libre. */
export type CapabilityQuestion = {
  readonly key: string;
  readonly prompt: string;
  readonly options?: readonly { value: string; label: string; hint?: string }[];
  readonly multiple?: boolean;
  readonly allowFreeText?: boolean;
  /** No se pregunta si esta función encuentra el dato ya resuelto en el borrador. */
  readonly skipIfPresent?: (draft: Record<string, unknown>) => boolean;
};

export type CapabilityPhase = {
  readonly slug: string;
  readonly goal: string;
  /** Máximo tres por ronda: más que eso se siente un formulario disfrazado de chat. */
  readonly questions: readonly CapabilityQuestion[];
};

export type CapabilityDef = {
  readonly slug: string;
  /** Etiqueta del chip de intención en la pantalla de inicio. */
  readonly label: string;
  readonly icon: string;
  readonly description: string;
  /** Qué tipo de agente produce, si produce uno. */
  readonly produces: { kind: "agent"; agentType: string } | { kind: "connection" } | { kind: "action" };
  readonly draftSchema: ZodType<unknown>;
  /**
   * Campos del borrador que el meta-agente escribe pero NUNCA pregunta: el id
   * del agente publicado, el del cerebro, las fuentes ya rastreadas. Sin esta
   * lista, derivar las rutas preguntables del esquema acaba enseñándole al
   * cliente un botón que dice «¿cuál es tu huellaPrompt?».
   */
  readonly internalFields?: readonly string[];
  readonly phases: readonly CapabilityPhase[];
  /** Herramientas del meta-agente habilitadas mientras esta capacidad está activa. */
  readonly tools: readonly string[];
  /** Cómo se prueba lo construido, antes de darlo por bueno. */
  readonly verify: { kind: "simulator"; scenarios: readonly string[] } | { kind: "healthcheck" } | { kind: "none" };
};

const capabilities = new Map<string, CapabilityDef>();

export function registerCapability(def: CapabilityDef): void {
  if (capabilities.has(def.slug)) {
    throw new Error(`La capacidad "${def.slug}" ya está registrada.`);
  }
  capabilities.set(def.slug, def);
}

export function getCapability(slug: string): CapabilityDef {
  const def = capabilities.get(slug);
  if (!def) {
    throw new Error(
      `Capacidad desconocida: "${slug}". Registradas: ${[...capabilities.keys()].join(", ") || "ninguna"}.`,
    );
  }
  return def;
}

export function listCapabilities(): readonly CapabilityDef[] {
  return [...capabilities.values()];
}
