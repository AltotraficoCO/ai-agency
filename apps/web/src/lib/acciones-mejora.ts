"use server";

/**
 * La acción de «Mejorar con IA».
 *
 * Una llamada al modelo, cobrada como cualquier otra del producto: se cotiza el
 * consumo con la tarifa vigente del espacio y se carga en el mismo libro donde
 * caen las conversaciones. Sin esto, mejorar instrucciones sería la única cosa
 * gratis de Strappy y el margen se iría por ahí sin que nadie lo viera.
 *
 * Aquí NO se escribe nada del agente: se devuelve una propuesta. Quien la
 * aplica es la persona, desde la pantalla, y quien la guarda es «Guardar
 * borrador», que ya existía. Un botón que escribe en la base sin pasar por el
 * ojo de alguien es justo lo que este producto promete no hacer.
 */
import { generateObject } from "ai";
import {
  creditsForUsage,
  normalizeUsage,
  resolveModel,
  withModelFallback,
} from "@strappy/core";
import { cargarTablaDeModelos, cargarTarifas, crearCreditLedger } from "@strappy/db/adapters";
import { leerEspecificacion, type EspecificacionAgente } from "@strappy/db/spec";
import { exigirUsuarioActual } from "./identidad";
import { conEspacio } from "./db/pool";
import { hayModeloReal, resolveLanguageModel } from "./motor/modelo";
import {
  SISTEMA_MEJORA,
  entradaDeMejora,
  esquemaMejora,
  cambiosDeLaMejora,
  type CambioPropuesto,
  type Mejora,
} from "./agentes/mejora";

export type ResultadoMejora =
  | {
      readonly ok: true;
      readonly mejora: Mejora;
      readonly cambios: readonly CambioPropuesto[];
      readonly creditos: number;
      readonly saldo: number;
    }
  | { readonly ok: false; readonly error: string };

/** Lo que se reserva antes de llamar: una mejora cuesta uno o dos créditos. */
const CREDITOS_ESTIMADOS = 2;

export async function mejorarInstrucciones(
  agentId: string,
  spec: EspecificacionAgente,
): Promise<ResultadoMejora> {
  try {
    const usuario = await exigirUsuarioActual();
    const actual = leerEspecificacion(spec);

    if (!hayModeloReal()) {
      return {
        ok: false,
        error: "Ahora mismo no hay un modelo conectado, así que no puedo mejorar las instrucciones.",
      };
    }

    return await conEspacio(usuario.workspaceId, async (scope) => {
      const { rows } = await scope.query<{ mode: "lite" | "max" }>(
        `select mode from public.agents where workspace_id = $1 and id = $2`,
        [scope.workspaceId, agentId],
      );
      const modo = rows[0]?.mode;
      if (!modo) return { ok: false as const, error: "Ese agente no existe en tu espacio." };

      const libro = crearCreditLedger(scope);
      const saldoPrevio = await libro.balance(scope.workspaceId);
      if (saldoPrevio < CREDITOS_ESTIMADOS) {
        return {
          ok: false as const,
          error: "No te quedan créditos suficientes. Recarga y vuelve a intentarlo.",
        };
      }

      const [tabla, tarifas] = await Promise.all([
        cargarTablaDeModelos(scope),
        cargarTarifas(scope),
      ]);
      // `builder` es la tarea de escribir agentes: la misma que usa Strap. Qué
      // modelo concreto responde vive en `model_tiers`, nunca aquí.
      const eleccion = resolveModel(tabla, { mode: modo, task: "builder" });

      let usado = eleccion.primary;
      const respuesta = await withModelFallback(eleccion, async (modelId) => {
        usado = modelId;
        return generateObject({
          model: resolveLanguageModel(modelId),
          output: "object" as const,
          schema: esquemaMejora,
          system: SISTEMA_MEJORA,
          prompt: entradaDeMejora(actual),
          temperature: 0.3,
        });
      });

      const cotizacion = creditsForUsage(tarifas, usado, normalizeUsage(respuesta.usage));
      if (cotizacion.credits > 0) {
        await libro.charge({
          workspaceId: scope.workspaceId,
          kind: "model",
          credits: cotizacion.credits,
          // Por agente y minuto: dos clics seguidos sobre el mismo texto no
          // cobran dos veces, y una mejora de verdad más tarde sí.
          idempotencyKey: `mejora:${agentId}:${Math.floor(Date.now() / 60_000)}`,
          metadata: { model: usado, usd: cotizacion.usd, origen: "mejorar_instrucciones" },
        });
      }

      const mejora = respuesta.object;
      return {
        ok: true as const,
        mejora,
        cambios: cambiosDeLaMejora(actual, mejora),
        creditos: cotizacion.credits,
        saldo: await libro.balance(scope.workspaceId),
      };
    });
  } catch (error) {
    console.error("[mejora] no se pudo mejorar la ficha", error);
    return {
      ok: false,
      error: "No pude mejorar las instrucciones. Tu texto sigue como estaba; vuelve a intentarlo.",
    };
  }
}
