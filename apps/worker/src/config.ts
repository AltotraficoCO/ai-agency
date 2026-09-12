/**
 * Configuración del worker: todo por entorno, nada en el código.
 *
 * Se valida al arrancar y con mensajes que dicen qué falta. Un worker que
 * arranca a medias y falla en la primera tarea de un cliente es peor que uno
 * que se niega a arrancar.
 *
 * El modelo NO se configura aquí: sale del plan de cada espacio y de
 * `model_tiers` (ver adaptadores/motor.ts). La clave de la cartera
 * (`OPENROUTER_API_KEY`, o `AI_GATEWAY_API_KEY` con `MODEL_WALLET=vercel-gateway`)
 * la lee directamente `@strappy/core`.
 */
import { z } from "zod";
import { masterKeyFromEnv } from "@strappy/webmaster";
import type { RateTable } from "@strappy/core";

const esquema = z.object({
  DATABASE_URL: z.string().min(1, "Sin DATABASE_URL el worker no tiene cola que atender."),
  APP_ENCRYPTION_KEY: z.string().min(16),
  WORKER_ID: z.string().min(1).optional(),
  WORKER_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(3000),
  /** Ruta a un Chrome. Sin navegador la verificación es más pobre y se avisa. */
  WORKER_CHROME_PATH: z.string().min(1).optional(),
  /** Host del almacén de referencias del cliente. Vacío = no se admiten. */
  WORKER_REFERENCIAS_HOST: z.string().min(1).optional(),
  /**
   * Clave de PageSpeed Insights, con la que mide el Velocista. Es NUESTRA y es
   * gratuita (25.000 consultas al día, sin trámite de aprobación). Sin ella el
   * agente dice que no pudo medir, que es preferible a inventarse un tiempo.
   */
  PAGESPEED_API_KEY: z.string().min(1).optional(),
  WORKER_TABLA_TAREAS: z.string().min(1).default("public.agent_tasks"),
});

export type ConfigWorker = {
  readonly databaseUrl: string;
  readonly claveMaestra: Buffer;
  readonly workerId: string;
  readonly pollMs: number;
  readonly chromePath?: string;
  readonly referenciasHost?: string;
  readonly pagespeedApiKey?: string;
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
    ...(c.WORKER_CHROME_PATH ? { chromePath: c.WORKER_CHROME_PATH } : {}),
    ...(c.WORKER_REFERENCIAS_HOST ? { referenciasHost: c.WORKER_REFERENCIAS_HOST } : {}),
    ...(c.PAGESPEED_API_KEY ? { pagespeedApiKey: c.PAGESPEED_API_KEY } : {}),
    tablaTareas: c.WORKER_TABLA_TAREAS,
  };
}

/**
 * Tarifas de ejemplo para la prueba local (`scripts/probar-sitio.ts`), que corre
 * sin base de datos. En producción las tarifas se leen de `credit_rates`.
 */
export const TARIFAS_POR_DEFECTO: RateTable = {
  models: {
    "anthropic/claude-sonnet-5": { input: 6, output: 30, cacheRead: 0.6, cacheWrite: 7.5 },
    "zai/glm-4.7-flash": { input: 0.21, output: 1.2, cacheRead: 0.021 },
  },
  fallback: { input: 6, output: 30, cacheRead: 0.6 },
};
