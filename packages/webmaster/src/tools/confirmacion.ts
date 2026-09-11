/**
 * `pedir_aprobacion`: la forma de preguntarle algo al cliente.
 *
 * Un Webmaster que termina su tarea con "¿te parece bien?" deja al cliente sin
 * forma de contestar: la tarea queda cerrada y lo único que ve son botones.
 * Esta herramienta es sensible a propósito, así que el AI SDK la corta antes
 * de ejecutarla. La propuesta llega al cliente con Aprobar y Rechazar, la
 * tarea queda suspendida con su conversación guardada y, cuando decide, se
 * reanuda justo aquí: si aprobó, la herramienta se ejecuta y el agente sigue;
 * si rechazó, el agente recibe la negativa y no lo hace.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";

export const pedirAprobacion = defineTool({
  slug: "pedir_aprobacion",
  label: "Pedir aprobación al cliente",
  description:
    "Muestra al cliente tu propuesta con botones Aprobar y Rechazar y espera su decisión antes de seguir.",
  whenToUse:
    "cuando necesites que el cliente decida algo antes de continuar: elegir entre caminos, aceptar una alternativa porque lo pedido no se puede hacer tal cual, o confirmar un cambio que no pidió. Nunca para pedir permiso de hacer exactamente lo que ya pidió, y nunca preguntes en el texto",
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

export const HERRAMIENTAS_CONFIRMACION: readonly ToolDef<never, unknown>[] = [
  pedirAprobacion as unknown as ToolDef<never, unknown>,
];
