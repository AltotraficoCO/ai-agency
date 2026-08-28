/**
 * Claves de idempotencia del consumo de créditos.
 *
 * Todo cobro se identifica por su origen, no por el momento en que se
 * intentó escribir. Un reintento del worker vuelve a producir exactamente la
 * misma clave, y la escritura en base de datos la descarta.
 */

/** Un paso del modelo dentro de una ejecución de agente. */
export function stepIdempotencyKey(agentRunId: string, step: number): string {
  if (!agentRunId) throw new Error("agentRunId es obligatorio para la clave de idempotencia.");
  if (!Number.isInteger(step) || step < 0) {
    throw new Error(`step debe ser un entero >= 0, llegó ${String(step)}.`);
  }
  return `${agentRunId}:${step}`;
}

/** Una ejecución de herramienta. Su id ya es único, así que es la clave entera. */
export function toolIdempotencyKey(toolRunId: string): string {
  if (!toolRunId) throw new Error("toolRunId es obligatorio para la clave de idempotencia.");
  return toolRunId;
}
