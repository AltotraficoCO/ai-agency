/**
 * Las medidas y cómo se convierte el estilo de la marca en instrucciones.
 *
 * Dos cosas que el modelo NO debe decidir por su cuenta:
 *
 *  · **Las medidas.** Una portada de blog que sale cuadrada se recorta sola en
 *    cada listado y queda con la cara del señor cortada. Los formatos son
 *    nombres que el cliente entiende («portada», «historia») y detrás llevan
 *    los píxeles correctos.
 *
 *  · **Los colores.** Si el modelo elige la paleta, cada imagen sale de un
 *    negocio distinto. Se le pasan los del sitio, medidos, dentro del prompt.
 */
import type { EstiloDeMarca, Medida } from "./ports.js";

export type FormatoImagen = "portada" | "cuadrada" | "historia" | "banner";

/** Medidas reales de cada formato. Lo que pide cada sitio donde se publica. */
export const MEDIDAS: Readonly<Record<FormatoImagen, Medida>> = {
  /** Portada de artículo: lo que usan los listados de blog y al compartir. */
  portada: { ancho: 1200, alto: 630 },
  /** Publicación de Instagram o Facebook. */
  cuadrada: { ancho: 1080, alto: 1080 },
  /** Historia o reel. */
  historia: { ancho: 1080, alto: 1920 },
  /** Cabecera ancha de una página. */
  banner: { ancho: 1600, alto: 500 },
};

/** Cómo se le explica cada formato al cliente, sin hablar de píxeles. */
export const PARA_QUE: Readonly<Record<FormatoImagen, string>> = {
  portada: "la foto de portada de un artículo, la que sale en el listado del blog y al compartirlo",
  cuadrada: "una publicación para Instagram o Facebook",
  historia: "una historia o un reel, en vertical",
  banner: "una cabecera ancha para una página",
};

export function medidaDe(formato: FormatoImagen): Medida {
  return MEDIDAS[formato];
}

/**
 * El estilo de la marca, escrito para que un modelo de imagen lo obedezca.
 *
 * Se le dan los colores en hexadecimal y se le prohíbe explícitamente lo que
 * más estropea una imagen de empresa: texto mal escrito, logos inventados y
 * caras de personas que no existen presentadas como si fueran el equipo.
 */
export function instruccionesDeMarca(estilo: EstiloDeMarca | undefined): string {
  if (!estilo) {
    return (
      "No se pudo medir el estilo del sitio: usa una paleta sobria y profesional, " +
      "sin colores estridentes."
    );
  }
  const { colores, tipografia } = estilo;
  const fuente = tipografia.titulos ?? tipografia.cuerpo;
  return (
    `Paleta obligatoria de la marca: color principal ${colores.primario}, ` +
    `acento ${colores.acento}, fondo ${colores.fondo}, oscuro ${colores.oscuro}. ` +
    `Usa esos colores y no otros.` +
    (fuente ? ` Si aparece algún texto, que sea en una tipografía parecida a ${fuente}.` : "") +
    (estilo.origen === "sitio"
      ? " Están medidos del sitio real del cliente: respétalos."
      : " No están medidos del sitio: son una aproximación.")
  );
}

/**
 * Lo que nunca debe salir en una imagen de empresa.
 *
 * El texto dentro de imágenes generadas sigue saliendo con letras rotas, y una
 * portada con una palabra mal escrita es peor que una portada sin texto.
 */
export const PROHIBICIONES =
  "No escribas texto largo dentro de la imagen: los modelos deforman las letras y una palabra mal " +
  "escrita arruina la pieza. No inventes logotipos, marcas registradas ni nombres de empresa. " +
  "No pongas rostros reconocibles presentados como si fueran el equipo o los clientes del negocio. " +
  "Nada de marcas de agua ni firmas.";

/** El prompt final que recibe el modelo de imagen. */
export function armarPrompt(input: {
  idea: string;
  formato: FormatoImagen;
  estilo?: EstiloDeMarca;
}): string {
  const medida = medidaDe(input.formato);
  return [
    `Imagen profesional para ${PARA_QUE[input.formato]}, de ${medida.ancho}x${medida.alto} píxeles.`,
    input.idea.trim(),
    instruccionesDeMarca(input.estilo),
    PROHIBICIONES,
  ].join(" ");
}

/**
 * Nombre de archivo a partir de la idea: sin acentos, sin espacios y con
 * extensión coherente con lo que devolvió el modelo.
 */
export function nombreDeArchivo(idea: string, mimeType: string): string {
  const base =
    idea
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "imagen";
  const ext = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  return `${base}.${ext}`;
}
