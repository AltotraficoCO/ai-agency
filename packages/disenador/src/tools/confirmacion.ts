/**
 * Cómo le pregunta algo el Diseñador al cliente.
 *
 * Mismas dos formas que en el resto de agentes y por la misma razón: uno que
 * cierra su tarea con «¿te gusta?» deja al cliente sin forma de contestar.
 * `pedir_aprobacion` es un sí o un no sobre una propuesta; `preguntar_al_cliente`
 * es para elegir entre opciones, que aquí pasa a menudo: qué formato, qué debe
 * salir en la imagen, para qué artículo es.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { huellaAccion } from "../aprobacion.js";
import { entorno } from "./comun.js";

export const pedirAprobacion = defineTool({
  slug: "pedir_aprobacion",
  label: "Pedir aprobación al cliente",
  description:
    "Muestra al cliente UNA propuesta concreta con botones Aprobar y Rechazar y espera su decisión. Solo sirve para un sí o un no.",
  whenToUse:
    "cuando tengas una propuesta concreta y solo necesites un sí o un no. Nunca para preguntar cuál entre varias opciones",
  inputSchema: z.object({
    propuesta: z
      .string()
      .min(10)
      .max(600)
      .describe("Lo que harás si aprueba, en una o dos frases."),
  }),
  sensitive: true,
  creditCost: 0,
  scopes: [],
  effect: "read",
  kind: "system",
  async execute(_ctx, input) {
    return {
      aprobada: true,
      propuesta: input.propuesta,
      indicacion: "El cliente aprobó la propuesta. Ejecútala tal cual y cierra con RESUMEN.",
    };
  },
});

export const preguntarAlCliente = defineTool({
  slug: "preguntar_al_cliente",
  label: "Preguntar al cliente",
  description:
    "Le hace UNA pregunta al cliente con opciones para elegir con un clic. La tarea se pausa hasta que responda.",
  whenToUse:
    "cuando el encargo sea ambiguo y necesites que elija o precise algo: qué formato, qué debe salir en la imagen, para qué es",
  inputSchema: z.object({
    pregunta: z.string().min(5).max(300),
    opciones: z.array(z.string().min(1).max(80)).min(2).max(6).optional(),
    permite_texto: z.boolean().default(true),
  }),
  sensitive: false,
  creditCost: 0,
  scopes: [],
  effect: "write_internal",
  kind: "system",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { diseno, workspaceId } = entorno(ctx, "preguntar_al_cliente");
    const huella = huellaAccion(diseno.taskId, "preguntar_al_cliente", input);
    const previa = await diseno.approvals.check({
      workspaceId,
      taskId: diseno.taskId,
      huella,
    });
    if (previa) {
      return {
        ya_respondida: true,
        nota: "El cliente ya respondió: su respuesta está en la conversación. Sigue con ella.",
      };
    }
    const solicitud = await diseno.approvals.request({
      workspaceId,
      taskId: diseno.taskId,
      siteId: diseno.conexionId || null,
      huella,
      toolSlug: "preguntar_al_cliente",
      motivo: "necesito que me digas cómo seguir",
      resumen: input.pregunta,
      entrada: input,
    });
    return {
      requiere_aprobacion: true,
      solicitud_id: solicitud.id,
      motivo: "pregunta al cliente",
      mensaje: "Pregunta enviada. Detente aquí: retomarás con su respuesta.",
    };
  },
  simulate(_ctx, input) {
    return { simulado: true, pregunta: input.pregunta, nota: "Simulación: la pregunta no se envió." };
  },
});

export const HERRAMIENTAS_CONFIRMACION: readonly ToolDef<never, unknown>[] = [
  pedirAprobacion,
  preguntarAlCliente,
] as unknown as readonly ToolDef<never, unknown>[];
