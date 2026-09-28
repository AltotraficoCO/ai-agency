/**
 * El conocimiento del negocio, para TODOS los agentes.
 *
 * La base de conocimiento nació para los agentes de WhatsApp, pero lo que hay
 * dentro —qué vende el negocio, a qué precio, cómo habla, sus políticas— lo
 * necesita cualquiera que trabaje para él: el Webmaster que escribe una página
 * de servicios, el Diseñador que titula un banner, Marketing que redacta un
 * anuncio, el Administrativo que factura un servicio. Un agente que inventa lo
 * que el negocio ofrece, teniendo el catálogo al lado, es el peor de los
 * errores que se le pueden ver.
 *
 * Se añade en el montaje común (`oficioComun`) y no en cada paquete, por la
 * misma razón que los compañeros: olvidarlo en un oficio nuevo no daría ningún
 * error visible, solo un agente que sabe menos de lo que debería.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";

export type FragmentoDeConocimiento = {
  readonly texto: string;
  /** Título de la fuente: «Servicios | Altotrafico», «Lista de precios 2026». */
  readonly fuente: string;
  readonly uri?: string | null;
};

/** Lo que el worker sabe hacer y el paquete del oficio no: buscar en las bases del espacio. */
export interface ConocimientoPort {
  /** Cuántas bases tiene el espacio. Cero: no hay nada que consultar. */
  readonly bases: number;
  buscar(input: { pregunta: string; cuantos: number; signal?: AbortSignal }): Promise<readonly FragmentoDeConocimiento[]>;
}

export function crearHerramientaDeConocimiento(puerto: ConocimientoPort): ToolDef<never, unknown> {
  return defineTool({
    slug: "consultar_conocimiento",
    label: "Consultar el conocimiento del negocio",
    description:
      "Busca en la base de conocimiento del negocio (su web, sus documentos, sus datos): qué vende, precios, servicios, horarios, políticas, tono, datos de contacto. Devuelve los fragmentos más relevantes con su fuente.",
    whenToUse:
      "ANTES de escribir, diseñar, facturar o afirmar cualquier cosa sobre el negocio del cliente, y siempre que el encargo mencione un servicio, un producto, un precio o una política suya",
    inputSchema: z.object({
      pregunta: z.string().min(3).max(300).describe("Qué necesitas saber, en una frase: «qué servicios ofrece y a qué precio»."),
      cuantos: z.number().int().min(1).max(10).default(5),
    }),
    sensitive: false,
    creditCost: 1,
    scopes: [],
    effect: "read",
    kind: "system",
    async execute(ctx, input) {
      const fragmentos = await puerto.buscar({
        pregunta: input.pregunta,
        cuantos: input.cuantos,
        ...(ctx.abortSignal ? { signal: ctx.abortSignal } : {}),
      });
      if (fragmentos.length === 0) {
        return {
          encontrados: 0,
          nota: "La base de conocimiento no tiene nada sobre esto. No lo inventes: trabaja con lo que te dieron o pregúntalo.",
        };
      }
      return {
        encontrados: fragmentos.length,
        fragmentos: fragmentos.map((f) => ({
          fuente: f.fuente,
          ...(f.uri ? { uri: f.uri } : {}),
          texto: f.texto.length > 1600 ? `${f.texto.slice(0, 1600)}…` : f.texto,
        })),
      };
    },
  }) as unknown as ToolDef<never, unknown>;
}

/** Lo que el agente lee en su prompt cuando el negocio tiene conocimiento guardado. */
export function bloqueDeConocimiento(puerto: ConocimientoPort | undefined): string {
  if (!puerto || puerto.bases === 0) return "";
  return `

CONOCIMIENTO DEL NEGOCIO (obligatorio):
El cliente guardó lo que sabe de su negocio —su web, sus documentos, sus datos— en su base de conocimiento, y la puedes consultar con consultar_conocimiento.
- Antes de escribir textos, diseñar piezas, preparar documentos o afirmar algo sobre el negocio (qué vende, precios, servicios, horarios, políticas, cómo habla), consúltala.
- Lo que diga la base manda sobre lo que tú supongas. Si no encuentra algo, no lo inventes: dilo o pregúntalo.
- Una o dos consultas bien hechas bastan; no la recorras entera.`;
}
