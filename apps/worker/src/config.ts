/**
 * Configuración del worker: todo por entorno, nada en el código.
 *
 * Se valida al arrancar y con mensajes que dicen qué falta. Un worker que
 * arranca a medias y falla en la primera tarea de un cliente es peor que uno
 * que se niega a arrancar.
 */
import { z } from "zod";
import { masterKeyFromEnv } from "@strappy/webmaster";
import type { RateTable } from "@strappy/core";

const esquema = z.object({
  DATABASE_URL: z.string().min(1, "Sin DATABASE_URL el worker no tiene cola que atender."),
  APP_ENCRYPTION_KEY: z.string().min(16),
  WORKER_ID: z.string().min(1).optional(),
  WORKER_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(3000),
  WORKER_MODEL: z.string().min(1).default("anthropic/claude-sonnet-4-5"),
  /** Ruta a un Chrome. Sin navegador la verificación es más pobre y se avisa. */
  WORKER_CHROME_PATH: z.string().min(1).optional(),
  /** Host del almacén de referencias del cliente. Vacío = no se admiten. */
  WORKER_REFERENCIAS_HOST: z.string().min(1).optional(),
  WORKER_TABLA_TAREAS: z.string().min(1).default("public.agent_tasks"),
});

export type ConfigWorker = {
  readonly databaseUrl: string;
  readonly claveMaestra: Buffer;
  readonly workerId: string;
  readonly pollMs: number;
  readonly modelId: string;
  readonly chromePath?: string;
  readonly referenciasHost?: string;
  readonly tablaTareas: string;
};

export function leerConfig(env: NodeJS.ProcessEnv = process.env): ConfigWorker {
  const parsed = esquema.safeParse(env);
  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Configuración del worker incompleta:\n  ${detalle}`);
  }
  const c = parsed.data;
  return {
    databaseUrl: c.DATABASE_URL,
    claveMaestra: masterKeyFromEnv(env),
    workerId: c.WORKER_ID ?? `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
    pollMs: c.WORKER_POLL_MS,
    modelId: c.WORKER_MODEL,
    ...(c.WORKER_CHROME_PATH ? { chromePath: c.WORKER_CHROME_PATH } : {}),
    ...(c.WORKER_REFERENCIAS_HOST ? { referenciasHost: c.WORKER_REFERENCIAS_HOST } : {}),
    tablaTareas: c.WORKER_TABLA_TAREAS,
  };
}

/**
 * Tarifas de venta por defecto, en dólares por millón de tokens. Es un
 * arranque razonable, no la fuente de verdad: en producción la tabla vive en
 * `credit_rates` y la mantiene la corriente de facturación.
 */
export const TARIFAS_POR_DEFECTO: RateTable = {
  models: {
    "anthropic/claude-sonnet-4-5": { input: 9, output: 45, cacheRead: 0.9, cacheWrite: 11.25 },
    "anthropic/claude-haiku-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  fallback: { input: 12, output: 60 },
};
