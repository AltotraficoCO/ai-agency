/**
 * Puertos de las herramientas de sistema.
 *
 * Ninguna herramienta habla con la base de datos ni con un proveedor
 * directamente: pide a un puerto. Otra corriente escribe el esquema, así que
 * aquí no aparece ni un nombre de tabla.
 */

export type KnowledgeHit = {
  readonly title: string;
  readonly text: string;
  readonly source?: string;
  readonly score?: number;
};

export interface KnowledgePort {
  search(input: {
    workspaceId: string;
    agentId?: string;
    query: string;
    limit: number;
  }): Promise<readonly KnowledgeHit[]>;
}

export interface ContactPort {
  saveField(input: {
    workspaceId: string;
    conversationId: string;
    contactId?: string;
    key: string;
    value: string;
  }): Promise<void>;
  addTags(input: {
    workspaceId: string;
    conversationId: string;
    contactId?: string;
    tags: readonly string[];
  }): Promise<void>;
}

export interface HandoverPort {
  escalate(input: {
    workspaceId: string;
    conversationId: string;
    reason: string;
    urgency: "normal" | "alta";
    summary?: string;
  }): Promise<{ notified: boolean; queue?: string }>;
  close(input: {
    workspaceId: string;
    conversationId: string;
    outcome: string;
    note?: string;
  }): Promise<void>;
}

export type SchedulingSlot = {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly label?: string;
};

export interface SchedulingPort {
  availability(input: {
    workspaceId: string;
    calendarId?: string;
    fromISO: string;
    toISO: string;
    durationMinutes: number;
  }): Promise<readonly SchedulingSlot[]>;
  book(input: {
    workspaceId: string;
    conversationId: string;
    calendarId?: string;
    startsAtISO: string;
    durationMinutes: number;
    title: string;
    attendeeName?: string;
    attendeeEmail?: string;
    notes?: string;
  }): Promise<{ eventId: string; startsAtISO: string; joinUrl?: string }>;
}

/** Resuelve una credencial por referencia. El valor jamás llega al modelo. */
export interface SecretResolver {
  resolve(input: { workspaceId: string; ref: string }): Promise<string>;
}

/** Salida HTTP para herramientas definidas por el cliente. Deny by default. */
export interface HttpPort {
  /** Hosts permitidos. Vacío = ninguno: se prohíbe todo lo no declarado. */
  readonly allowedHosts: readonly string[];
  fetch(request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs: number;
    abortSignal?: AbortSignal;
  }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

/**
 * Todo lo que una herramienta puede necesitar. Es opcional a propósito: un
 * agente que no agenda no tiene por qué tener un puerto de agenda montado, y
 * la herramienta falla con un mensaje claro en vez de con un `undefined`.
 */
export type ToolPorts = {
  readonly knowledge?: KnowledgePort;
  readonly contacts?: ContactPort;
  readonly handover?: HandoverPort;
  readonly scheduling?: SchedulingPort;
  readonly secrets?: SecretResolver;
  readonly http?: HttpPort;
};

export function requirePort<K extends keyof ToolPorts>(
  ports: ToolPorts,
  key: K,
  toolSlug: string,
): NonNullable<ToolPorts[K]> {
  const port = ports[key];
  if (!port) {
    throw new Error(
      `La herramienta "${toolSlug}" necesita el puerto "${String(key)}" y este workspace no lo tiene configurado.`,
    );
  }
  return port as NonNullable<ToolPorts[K]>;
}
