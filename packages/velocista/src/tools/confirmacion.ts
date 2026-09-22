/**
 * Cómo le pregunta algo el Velocista al cliente.
 *
 * Mismas dos formas que en el Webmaster y en Marketing, y por la misma razón:
 * un agente que cierra su tarea con «¿te parece bien?» deja al cliente sin
 * forma de contestar. `pedir_aprobacion` es un sí o un no sobre una propuesta;
 * `preguntar_al_cliente` es para elegir entre opciones.
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
      .describe("Lo que harás si aprueba y qué gana con ello, en una o dos frases."),
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
    "cuando el encargo sea ambiguo y necesites que el cliente elija o precise algo: qué página le preocupa, o si prefiere que toques algo o solo que le expliques",
  inputSchema: z.object({
    // Cabe una frase con lo medido delante de la pregunta: el cliente nunca
    // debe decidir sin saber cuánto tarda su página.
    pregunta: z.string().min(5).max(500),
    opciones: z.array(z.string().min(1).max(80)).min(2).max(6).optional(),
    permite_texto: z.boolean().default(true),
  }),
  sensitive: false,
  creditCost: 0,
  scopes: [],
  effect: "write_internal",
  kind: "system",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { velocidad, workspaceId } = entorno(ctx, "preguntar_al_cliente");
    const huella = huellaAccion(velocidad.taskId, "preguntar_al_cliente", input);
    const previa = await velocidad.approvals.check({
      workspaceId,
      taskId: velocidad.taskId,
      huella,
    });
    if (previa) {
      return {
        ya_respondida: true,
        nota: "El cliente ya respondió: su respuesta está en la conversación. Sigue con ella.",
      };
    }
    const solicitud = await velocidad.approvals.request({
      workspaceId,
      taskId: velocidad.taskId,
      siteId: velocidad.conexionId,
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
