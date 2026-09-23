/**
 * Dibujar y publicar. Las dos únicas herramientas que cuestan algo.
 *
 * El reparto de responsabilidad es deliberado:
 *
 *  · **Dibujar gasta créditos pero no toca nada del cliente**, así que no pide
 *    botón: lo acotan un tope por encargo y el coste dicho en voz alta. Si cada
 *    dibujo pidiera aprobación, el Webmaster que encarga la portada de un
 *    artículo se quedaría a medias esperando un clic que el cliente no sabe que
 *    tiene que dar, y la colaboración entre agentes dejaría de servir.
 *
 *  · **Publicar sí pide botón**, porque a partir de ahí la imagen vive en el
 *    sitio del cliente. Y reemplazar una existente, con más razón todavía:
 *    crear es reversible, pisar la portada de alguien no.
 *
 * Los bytes de la imagen NUNCA salen en el resultado que ve el modelo. Van al
 * colector de evidencia —donde el cliente las ve dentro del encargo— y a un
 * almacén de borradores del que solo sale un identificador corto. Una imagen en
 * base64 dentro de la conversación son cientos de miles de tokens que paga el
 * cliente por nada.
 */
import { z } from "zod";
import { defineTool, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import { puertaDeAprobacion, type Bloqueo } from "../aprobacion.js";
import { armarPrompt, medidaDe, nombreDeArchivo, PARA_QUE, type FormatoImagen } from "../formatos.js";
import { requireImagenes, requireMedios, type ImagenGenerada } from "../ports.js";
import { entorno, generadas, topeDeImagenes } from "./comun.js";

const formato = z
  .enum(["portada", "cuadrada", "historia", "banner"])
  .describe(
    "portada: la foto de un artículo. cuadrada: publicación de Instagram o Facebook. historia: vertical. banner: cabecera ancha.",
  );

export const imgGenerar = defineTool({
  slug: "img_generar",
  label: "Dibujar una imagen",
  description:
    "Dibuja una imagen nueva con los colores de la marca del cliente. Cuesta créditos y hay un tope por encargo: piensa bien la descripción antes de llamarla. Devuelve un identificador de borrador para publicarla después.",
  whenToUse:
    "cuando el cliente necesita una imagen que no tiene, y ya miraste su biblioteca y su estilo",
  inputSchema: z.object({
    idea: z
      .string()
      .min(15)
      .max(600)
      .describe(
        "Qué se ve, desde qué ángulo, con qué luz y qué ambiente. Concreto: «un escritorio de abogado con documentos y una lámpara cálida, vista cenital, tonos sobrios» y no «algo sobre derecho».",
      ),
    formato,
  }),
  sensitive: false,
  // Respaldo, no precio. El de verdad lo pone el bucle en `rates.tools` a
  // partir de la tarifa del generador que vaya a dibujar (Gemini en Lite,
  // GPT Image 1 en Max, cinco veces más caro); ver la migración 0046. Este
  // número solo se aplica si esa tarifa no se pudo leer.
  creditCost: 100,
  scopes: [SCOPES.imagenCrear],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { diseno } = entorno(ctx, "img_generar");
    const imagenes = requireImagenes(diseno, "img_generar");

    const tope = topeDeImagenes(diseno);
    const hechas = generadas(diseno);
    if (hechas >= tope) {
      throw new Error(
        `Ya dibujaste ${hechas} ${hechas === 1 ? "imagen" : "imágenes"} en este encargo y ese es el tope. ` +
          `Publica la que mejor esté y cierra con RESUMEN; si hicieran falta más, dilo ahí.`,
      );
    }

    const medida = medidaDe(input.formato as FormatoImagen);
    const prompt = armarPrompt({
      idea: input.idea,
      formato: input.formato as FormatoImagen,
      ...(diseno.estilo ? { estilo: diseno.estilo } : {}),
    });

    const imagen: ImagenGenerada = await imagenes.generar({ prompt, medida });

    if (diseno.contador) diseno.contador.generadas = hechas + 1;
    const borradorId = `img_${hechas + 1}`;
    diseno.borradores?.set(borradorId, imagen);

    // Que el cliente la VEA dentro del encargo es la mitad del producto: sin
    // esto tendría que creerse que la imagen existe.
    diseno.capturas?.push({
      herramienta: "img_generar",
      mimeType: imagen.mimeType,
      url: `borrador:${borradorId}`,
      titulo: input.idea.slice(0, 80),
      base64: imagen.base64,
    });

    const restantes = tope - (hechas + 1);
    return {
      borrador_id: borradorId,
      formato: input.formato,
      para_que: PARA_QUE[input.formato as FormatoImagen],
      medida: `${medida.ancho}x${medida.alto}`,
      estilo_de_la_marca: diseno.estilo?.origen === "sitio",
      // Lo que se le cobrará de verdad: el mismo número que usa el bucle.
      creditos: diseno.creditosPorImagen ?? 100,
      te_quedan: restantes,
      nota:
        restantes === 0
          ? "Era la última que podías dibujar en este encargo. Publícala si sirve y cierra."
          : "El cliente ya puede verla en el encargo. Publícala con img_publicar si es la buena.",
    };
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      idea: input.idea,
      nota: "Simulación: no se dibujó nada. Descríbela en el plan.",
    };
  },
});

export const imgPublicar = defineTool({
  slug: "img_publicar",
  label: "Subir la imagen al sitio",
  description:
    "Sube al sitio del cliente una imagen que dibujaste y devuelve su id, que es lo que hace falta para ponerla como imagen destacada de una entrada. Deja algo en su sitio: SIEMPRE requiere que una persona lo apruebe.",
  whenToUse: "cuando la imagen ya es la buena y el cliente la va a usar en su web",
  inputSchema: z.object({
    borrador_id: z
      .string()
      .min(1)
      .max(40)
      .describe("El identificador que devolvió img_generar."),
    alt: z
      .string()
      .min(10)
      .max(160)
      .describe(
        "Texto alternativo: qué se ve en la imagen, en una frase. Lo leen las personas ciegas y Google.",
      ),
    reemplaza_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "SOLO si el cliente pidió expresamente cambiar una imagen que ya existe. Sin esto se añade una nueva, que es lo normal.",
      ),
  }),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.mediosWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { diseno, workspaceId } = entorno(ctx, "img_publicar");
    const medios = requireMedios(diseno, "img_publicar");

    const imagen = diseno.borradores?.get(input.borrador_id);
    if (!imagen) {
      throw new Error(
        `No tengo ninguna imagen con el identificador "${input.borrador_id}". ` +
          `Solo puedes publicar lo que dibujaste en este encargo con img_generar.`,
      );
    }

    const bloqueo = await puertaDeAprobacion({
      approvals: diseno.approvals,
      workspaceId,
      taskId: diseno.taskId,
      conexionId: diseno.conexionId || null,
      toolSlug: "img_publicar",
      motivo: input.reemplaza_id
        ? "reemplaza una imagen que ya está en tu sitio"
        : "sube una imagen nueva a tu sitio",
      resumen: input.reemplaza_id
        ? `Reemplazar la imagen ${input.reemplaza_id} de ${medios.sitio} por la que acabo de preparar: ${input.alt}. La anterior deja de verse donde estuviera puesta.`
        : `Subir a la biblioteca de ${medios.sitio} la imagen que preparé: ${input.alt}.`,
      entrada: input,
    });
    if (bloqueo) return bloqueo;

    const subida = await medios.subir({
      base64: imagen.base64,
      mimeType: imagen.mimeType,
      nombre: nombreDeArchivo(input.alt, imagen.mimeType),
      alt: input.alt,
    });

    return {
      publicada: true,
      imagen_id: subida.id,
      url: subida.url,
      sitio: medios.sitio,
      nota: `Ya está en la biblioteca del cliente. El id ${subida.id} es el que sirve como imagen destacada de una entrada: dilo en el RESUMEN.`,
    };
  },
  simulate(_ctx, input) {
    return {
      simulado: true,
      borrador_id: input.borrador_id,
      nota: "Simulación: la imagen no se subió al sitio. Descríbelo en el plan.",
    };
  },
});

export const HERRAMIENTAS_CREACION: readonly ToolDef<never, unknown>[] = [
  imgGenerar,
  imgPublicar,
] as unknown as readonly ToolDef<never, unknown>[];
