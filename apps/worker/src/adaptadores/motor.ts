/**
 * El modelo de cada tarea, según el plan del cliente.
 *
 * Ningún modelo está escrito en el código:
 *  · El modo sale del agente (`lite` o `max`) y se rebaja a `lite` si el plan
 *    del espacio no incluye Max. Max es de los planes grandes; ofrecerlo en el
 *    gratuito es regalar el modelo caro.
 *  · El modelo concreto sale de `model_tiers` para la tarea `business_agent`
 *    (fila `negocio`), la de los agentes del negocio, y se resuelve contra la
 *    cartera del worker (`MODEL_WALLET`, hoy OpenRouter). Su clave es distinta
 *    de la de la web y solo permite los modelos de esa fila.
 *  · Las tarifas salen de `credit_rates` y el cobro va al mismo libro que el
 *    resto de Strappy, así que una tarea del Webmaster se ve y se paga igual
 *    que una conversación.
 */
import { crearResolvedorDeModelo, resolveModel, type ModelMode } from "@strappy/core";
import type { TenantScope } from "@strappy/db";
import { cargarTablaDeModelos, cargarTarifas, crearCreditLedger } from "@strappy/db/adapters";
import type { MotorTarea, SqlPool, TareaReclamada } from "../ports.js";

/**
 * Planes que pueden usar el modo Max: TODOS los de pago. Quién lo enciende y
 * en qué agente lo decide el cliente (`agents.mode`), no el plan: Max gasta
 * más créditos de los suyos, así que negarlo a quien paga es decidir por él.
 * El gratuito no lo tiene: ahí los créditos los regalamos nosotros.
 *
 * Son las claves técnicas de `subscriptions.plan`; el nombre comercial de cada
 * una está en `apps/web/src/lib/negocio/planes.ts` (Pro es `starter`,
 * Scale-Up es `growth`, Prime es `business`).
 */
const PLANES_CON_MAX = new Set(["starter", "growth", "business", "enterprise"]);

export class MotorPorPlan {
  readonly #pool: SqlPool;
  /** Se construye una vez: crearlo por tarea abriría un cliente en cada una. */
  #resolvedor: ReturnType<typeof crearResolvedorDeModelo> | null = null;

  constructor(pool: SqlPool) {
    this.#pool = pool;
  }

  async para(tarea: TareaReclamada): Promise<MotorTarea> {
    const ambito = this.#ambito(tarea.workspaceId);
    const [modo, tabla, rates] = await Promise.all([
      this.#modo(tarea),
      cargarTablaDeModelos(ambito),
      cargarTarifas(ambito),
    ]);

    const eleccion = resolveModel(tabla, { mode: modo, task: "business_agent" });
    this.#resolvedor ??= crearResolvedorDeModelo();
    const libro = crearCreditLedger(ambito);

    return {
      model: this.#resolvedor.resolver(eleccion.primary),
      modelId: eleccion.primary,
      modo,
      rates,
      saldo: () => libro.balance(tarea.workspaceId),
      async cobrar({ creditos, clave, detalle }) {
        if (creditos <= 0) return;
        await libro.charge({
          workspaceId: tarea.workspaceId,
          kind: "model",
          credits: creditos,
          idempotencyKey: `agent_task:${clave}`,
          metadata: { ...detalle, model: eleccion.primary, modo, tarea: tarea.id },
        });
      },
    };
  }

  async #modo(tarea: TareaReclamada): Promise<ModelMode> {
    const { rows } = await this.#pool.query<{ modo: string | null; plan: string | null }>(
      `select (select mode from public.agents where workspace_id = $1 and id = $2) as modo,
              (select plan from public.subscriptions where workspace_id = $1 limit 1) as plan`,
      [tarea.workspaceId, tarea.agentId ?? null],
    );
    const fila = rows[0];
    // Sin fila de suscripción no hay plan de pago: lite. Con plan de pago, lo
    // que diga el agente.
    return fila?.modo === "max" && PLANES_CON_MAX.has(fila.plan ?? "") ? "max" : "lite";
  }

  /**
   * Los adaptadores de `@strappy/db` piden un ámbito de tenant. El worker se
   * conecta como el rol de servicio y cruza espacios al reclamar, así que el
   * ámbito aquí es solo la etiqueta del espacio con la que se cobra y se lee.
   */
  #ambito(workspaceId: string): TenantScope {
    const pool = this.#pool;
    return {
      workspaceId,
      query: <T>(text: string, values?: readonly unknown[]) =>
        pool.query<T & Record<string, unknown>>(text, values),
      assertSameWorkspace(otro: string) {
        if (otro !== workspaceId) {
          throw new Error(`Se intentó usar el espacio ${otro} desde una tarea del espacio ${workspaceId}.`);
        }
      },
    } as unknown as TenantScope;
  }
}
