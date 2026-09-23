/**
 * El Diseñador, montado sobre el bucle común de `@strappy/agentes`.
 *
 * Lo propio de aquí son tres cosas:
 *
 *  · **El colector de imágenes.** Lo que dibuja se acumula como evidencia del
 *    encargo, igual que las capturas del navegador del Webmaster, para que el
 *    cliente VEA la imagen en su pantalla y no tenga que creerse que existe.
 *
 *  · **El almacén de borradores.** Dibujar y publicar son dos pasos, y entre
 *    medias hay una aprobación. Los bytes viven aquí, en memoria de esta
 *    ejecución, y no en la conversación: una imagen en base64 dentro del
 *    contexto del modelo son cientos de miles de tokens que paga el cliente.
 *
 *  · **El contador.** El tope de imágenes por encargo es lo único que impide
 *    que un encargo mal entendido se coma el saldo dibujando variaciones.
 */
import {
  contextoComun,
  filtrarHerramientas,
  lanzarOficio,
  oficioComun,
  type EntradaComunDeAgente,
  type OficioDelAgente,
  type ResultadoTarea,
} from "@strappy/agentes";
import type { ToolDef } from "@strappy/tools";
import type { DisenadorAgentDef } from "./agent.js";
import { huellaAccion } from "./aprobacion.js";
import type { DisenadorContext } from "./context.js";
import {
  MAX_IMAGENES_POR_ENCARGO,
  type CapturaEvidencia,
  type DisenoContext,
  type ImagenGenerada,
} from "./ports.js";
import { detalleDePaso, etiquetaDePaso } from "./pasos.js";
import { HERRAMIENTAS_DISENADOR } from "./tools/index.js";

export type { PasoTrabajo } from "./pasos.js";

/**
 * Lo que cuesta una imagen cuando nadie dice otra cosa.
 *
 * Es un RESPALDO, no el precio. El precio real viaja en el contexto
 * (`diseno.creditosPorImagen`) y sale de `credit_rates` según el generador que
 * vaya a dibujar: en Lite es Gemini y en Max GPT Image 1, que cuesta cinco
 * veces más. Este número solo se usa si la tarifa no se pudo leer, y está
 * puesto en lo que cuesta la barata para no cobrar de más por un fallo nuestro.
 */
export const CREDITOS_POR_IMAGEN = 100;

export function herramientasDe(agent: DisenadorAgentDef): readonly ToolDef<never, unknown>[] {
  return filtrarHerramientas(HERRAMIENTAS_DISENADOR, agent.allowedToolPatterns);
}

/** Lo común a todos los agentes por encargo, más lo que solo tiene este. */
export type EjecucionDisenador = EntradaComunDeAgente & {
  readonly agent: DisenadorAgentDef;
  /** Cómo se llama el negocio: el agente habla de él por su nombre. */
  readonly negocio: string;
  readonly diseno: DisenoContext;
};

export async function ejecutarTareaDisenador(
  input: EjecucionDisenador,
): Promise<ResultadoTarea> {
  const { agent, tarea } = input;
  const simulacion = Boolean(input.diseno.primerContacto);

  // Lo que se dibuja en ESTA ejecución. Va en el contexto y no en un módulo
  // compartido: dos encargos a la vez en el mismo worker no pueden verse las
  // imágenes el uno al otro.
  const capturas: CapturaEvidencia[] = [];
  const borradores = new Map<string, ImagenGenerada>();
  const contador = { generadas: 0 };

  const creditosPorImagen = input.diseno.creditosPorImagen ?? CREDITOS_POR_IMAGEN;

  // El precio que el agente le anuncia al cliente y el que el bucle le cobra
  // son el MISMO número, y por eso se escribe una sola vez: anunciar 100 y
  // cobrar 250 es la clase de diferencia que se descubre en la factura.
  const comun: EjecucionDisenador = {
    ...input,
    rates: {
      ...input.rates,
      tools: { ...input.rates.tools, img_generar: creditosPorImagen },
    },
  };

  const diseno: DisenoContext = {
    ...input.diseno,
    capturas: { push: (c) => capturas.push(c) },
    borradores,
    contador,
    maxImagenes: input.diseno.maxImagenes ?? MAX_IMAGENES_POR_ENCARGO,
    creditosPorImagen,
  };

  const contexto: DisenadorContext = {
    ...contextoComun(comun, agent, simulacion),
    diseno,
  };

  const oficio: OficioDelAgente = {
    ...oficioComun({
      agent,
      herramientas: herramientasDe(agent),
      sistema: agent.prompt({
        agentName: input.agentName,
        negocio: input.negocio,
        maxImagenes: diseno.maxImagenes ?? MAX_IMAGENES_POR_ENCARGO,
        creditosPorImagen,
        estiloMedido: diseno.estilo?.origen === "sitio",
        modoSimulacion: simulacion,
      }),
      contexto,
      etiquetaDePaso,
      detalleDePaso,
      comun,
    }),
    // Las credenciales del sitio viven dentro del adaptador de medios y la
    // clave de la cartera dentro del de imágenes: no hay nada que tapar aquí.
    limpiarSecretos: (texto) => texto,
    describirSolicitud,
    // La misma que usan las herramientas de este paquete al pasar por la puerta
    // de aprobación: una decisión guardada tiene que poder encontrarse.
    huella: (toolSlug, entrada) => huellaAccion(diseno.taskId, toolSlug, entrada),
    aprobaciones: diseno.approvals,
    conexionId: diseno.conexionId || null,
    motivoAprobacion: "deja una imagen en el sitio del cliente",
    capturas: () => capturas,
  };

  return lanzarOficio(comun, oficio, simulacion);
}

/**
 * Lo que lee la persona antes de pulsar Aprobar.
 *
 * La herramienta de publicar ya escribe su propio resumen diciendo qué imagen
 * es y dónde va; esto es la red por si el AI SDK corta la llamada antes de que
 * llegue a escribirlo.
 */
export function describirSolicitud(toolName: string, entrada: unknown): string {
  const e = (entrada ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case "img_publicar": {
      const alt = typeof e.alt === "string" ? e.alt : "una imagen que preparé";
      return e.reemplaza_id
        ? `Reemplazar la imagen ${String(e.reemplaza_id)} de tu sitio por otra: ${alt}. La anterior deja de verse donde estuviera puesta.`
        : `Subir a la biblioteca de tu sitio una imagen nueva: ${alt}.`;
    }
    default:
      return `${toolName}: ${JSON.stringify(entrada).slice(0, 160)}`;
  }
}
