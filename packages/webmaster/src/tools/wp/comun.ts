/**
 * Piezas que comparten varias herramientas de WordPress: los campos de
 * entrada repetidos y cómo saber qué página es la portada.
 */
import { z } from "zod";
import * as wp from "../../wordpress/client.js";
import { EXTRACTO_MAXIMO } from "../../wordpress/articulo.js";

/**
 * Extracto e imagen destacada: sin ellos una entrada se publica bien pero su
 * tarjeta sale VACÍA en el listado del blog, que es de lo único que vive ese
 * listado (imagen destacada + título + extracto).
 */
export const extractoInput = z
  .string()
  .max(EXTRACTO_MAXIMO)
  .optional()
  .describe(
    "1-2 frases que resumen la entrada para la tarjeta del blog. Si no lo pasas, se genera del propio artículo.",
  );

export const imagenDestacadaInput = z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    "Id de la imagen destacada en la biblioteca de medios (wp_listar_medios, o el id que devuelve wp_subir_media). Sin ella la entrada sale sin foto en el listado del blog.",
  );

export const cantidadPedida = z
  .number()
  .int()
  .min(1)
  .max(10)
  .optional()
  .describe(
    "Cuántos contenidos NUEVOS pidió el cliente en esta tarea, SOLO si dio un número o dijo «varias». «Un blog», «un post» o «un artículo» es 1: no lo pases.",
  );

export const tipoContenido = z.enum(["page", "post"]);
export const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Usa un color hexadecimal, p.ej. #17150F.");

/** `page_on_front` del sitio. Sin esto no se sabe qué página es la portada. */
export async function portadaDe(
  creds: wp.WpCreds,
  opciones: Parameters<typeof wp.leerAjustes>[1],
): Promise<number | undefined> {
  try {
    const ajustes = await wp.leerAjustes(creds, opciones);
    const id = ajustes.page_on_front;
    return typeof id === "number" && id > 0 ? id : undefined;
  } catch {
    // Que no se puedan leer los ajustes no debe impedir la tarea; solo hace
    // que no podamos reconocer la portada, y ahí se prefiere seguir.
    return undefined;
  }
}
