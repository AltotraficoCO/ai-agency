/**
 * Cómo le pregunta algo el Webmaster al cliente.
 *
 * Un Webmaster que termina su tarea con "¿te parece bien?" deja al cliente sin
 * forma de contestar: la tarea queda cerrada y lo único que ve son botones. Hay
 * dos formas de preguntar, y no son intercambiables:
 *
 *  · `pedir_aprobacion` es un SÍ o un NO sobre UNA propuesta concreta. Es
 *    sensible a propósito: el AI SDK la corta antes de ejecutarla, el cliente ve
 *    Aprobar y Rechazar, y la tarea se reanuda justo ahí con su decisión.
 *  · `preguntar_al_cliente` es para ELEGIR o PRECISAR: "¿cuál de estos tres
 *    plugins?". Con Aprobar y Rechazar eso no se puede contestar. La pregunta
 *    llega con sus opciones y un campo de texto; la respuesta se añade a la
 *    conversación guardada y la tarea se reanuda con ella.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { huellaAccion } from "../aprobacion.js";
import { entorno } from "./comun.js";

export const pedirAprobacion = defineTool({
  slug: "pedir_aprobacion",
  label: "Pedir aprobación al cliente",
  description:
    "Muestra al cliente UNA propuesta concreta con botones Aprobar y Rechazar y espera su decisión antes de seguir. Solo sirve para un sí o un no.",
  whenToUse:
    "cuando tengas una propuesta concreta y solo necesites un sí o un no: aceptar una alternativa porque lo pedido no se puede hacer tal cual, o confirmar un cambio que no pidió. Nunca para preguntar cuál entre varias opciones (usa preguntar_al_cliente) ni para pedir permiso de hacer lo que ya pidió",
  inputSchema: z.object({
    propuesta: z
      .string()
      .min(10)
      .max(600)
      .describe("Lo que harás si el cliente aprueba, en una o dos frases dirigidas a él."),
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
    "Le hace UNA pregunta al cliente con opciones para elegir con un clic y, si hace falta, un campo para escribir. La tarea se pausa hasta que responda y retomas con su respuesta.",
  whenToUse:
    "cuando el encargo es ambiguo y necesitas que el cliente elija o precise algo (qué plugin, qué página, qué texto exacto). Nunca para pedir permiso de hacer lo que ya pidió con claridad, y nunca preguntes en el texto de tu respuesta",
  inputSchema: z.object({
    pregunta: z.string().min(5).max(300).describe("La pregunta, dirigida al cliente."),
    opciones: z
      .array(z.string().min(1).max(80))
      .min(2)
      .max(6)
      .optional()
      .describe("Respuestas posibles para que elija con un clic."),
    permite_texto: z.boolean().default(true).describe("Si además puede escribir una respuesta libre."),
  }),
  sensitive: false,
  creditCost: 0,
  scopes: [],
  effect: "write_internal",
  kind: "system",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { sitio } = entorno(ctx, "preguntar_al_cliente");
    const huella = huellaAccion(sitio.taskId, "preguntar_al_cliente", input);

    // La misma pregunta ya contestada no se vuelve a hacer: la respuesta ya
    // está en la conversación con la que se reanudó la tarea.
    const previa = await sitio.approvals.check({ workspaceId: ctx.workspaceId, taskId: sitio.taskId, huella });
    if (previa) {
      return {
        ya_respondida: true,
        nota: "El cliente ya respondió a esta pregunta: su respuesta está en la conversación. Sigue con ella.",
      };
    }

    const solicitud = await sitio.approvals.request({
      workspaceId: ctx.workspaceId,
      taskId: sitio.taskId,
      siteId: sitio.siteId,
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
      mensaje:
        "Pregunta enviada al cliente. Detente aquí y no hagas nada más: cuando responda, retomarás con su respuesta en la conversación.",
    };
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      pregunta: input.pregunta,
      nota: "Simulación: la pregunta no se envió. Inclúyela en el plan.",
    };
  },
});

export const HERRAMIENTAS_CONFIRMACION: readonly ToolDef<never, unknown>[] = [
  pedirAprobacion,
  preguntarAlCliente,
] as unknown as readonly ToolDef<never, unknown>[];
