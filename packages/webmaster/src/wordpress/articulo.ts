/**
 * Qué es una entrada de blog de verdad.
 *
 * El caso de producción: «Crea un blog de Inteligencia Artificial y Uso
 * Responsable» terminó en tres entradas publicadas con UN hero cada una
 * (≈25 palabras y un botón «Leer la guía completa» que no llevaba a ningún
 * sitio), y el hero con un titular distinto al de la entrada. Después cada
 * una se reescribió encima con menos contenido todavía.
 *
 * Este módulo es puro: cuenta palabras y decide si lo que el modelo manda es un
 * artículo o si una reescritura destruye lo que había. Las herramientas lo
 * usan antes de tocar el sitio, para que el error llegue sin haber escrito nada.
 */
import type { SeccionSpec } from "./elementor.js";

/** Mínimos de un artículo. Por debajo, es un anuncio y no una entrada. */
export const ARTICULO = { palabras: 400, secciones: 3, palabrasTexto: 60 } as const;

/** Por debajo de esta proporción, reescribir se considera destruir el contenido. */
export const PROPORCION_MINIMA_REESCRITURA = 0.6;

/** Con menos palabras que esto, lo que había no merece protección (un borrador, un «Hola mundo»). */
const PALABRAS_PARA_PROTEGER = 80;

const ENTIDADES: Readonly<Record<string, string>> = { nbsp: " ", amp: "&", quot: '"', lt: "<", gt: ">" };

function textoVisible(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#\d+|[a-z]+);/gi, (_, e: string) => (e.startsWith("#") ? " " : (ENTIDADES[e.toLowerCase()] ?? " ")));
}

export function contarPalabras(texto: string | undefined | null): number {
  if (!texto) return 0;
  return textoVisible(texto)
    .split(/\s+/)
    .filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
}

function palabrasDeSeccion(s: SeccionSpec): number {
  let n = contarPalabras(s.titulo) + contarPalabras(s.subtitulo) + contarPalabras(s.html);
  for (const it of s.items ?? []) {
    n += [it.titulo, it.texto, it.cifra, it.etiqueta, it.autor, it.cargo, it.pregunta, it.respuesta]
      .map(contarPalabras)
      .reduce((a, b) => a + b, 0);
  }
  for (const p of s.planes ?? []) n += contarPalabras(p.nombre) + p.incluye.map(contarPalabras).reduce((a, b) => a + b, 0);
  return n;
}

/** Palabras de texto visible que pintarían estas secciones (los botones no cuentan). */
export function palabrasDeSecciones(specs: readonly SeccionSpec[]): number {
  return specs.map(palabrasDeSeccion).reduce((a, b) => a + b, 0);
}

/** Claves de ajustes de widgets de Elementor que llevan texto que se ve. */
const CLAVES_CON_TEXTO = [
  "title",
  "editor",
  "description_text",
  "title_text",
  "testimonial_content",
  "tab_title",
  "tab_content",
  "blockquote_content",
  "html",
];

/** Palabras visibles de un `_elementor_data` ya guardado. */
export function palabrasDeElementor(nodos: readonly unknown[] | null | undefined): number {
  let total = 0;
  const recorrer = (lista: readonly unknown[] | undefined) => {
    for (const nodo of lista ?? []) {
      if (!nodo || typeof nodo !== "object") continue;
      const n = nodo as { elType?: unknown; settings?: Record<string, unknown>; elements?: unknown[] };
      if (n.elType === "widget" && n.settings) {
        for (const clave of CLAVES_CON_TEXTO) {
          const v = n.settings[clave];
          if (typeof v === "string") total += contarPalabras(v);
        }
      }
      recorrer(n.elements);
    }
  };
  recorrer(nodos ?? []);
  return total;
}

/**
 * Por qué estas secciones NO son una entrada de blog completa, o null si lo son.
 * El mensaje dice qué falta con números, para que el modelo sepa qué añadir.
 */
export function motivoArticuloIncompleto(specs: readonly SeccionSpec[]): string | null {
  const palabras = palabrasDeSecciones(specs);
  const textos = specs.filter((s) => s.tipo === "texto" && contarPalabras(s.html) >= ARTICULO.palabrasTexto);
  const faltas: string[] = [];
  if (textos.length === 0) faltas.push(`ninguna sección "texto" con cuerpo (al menos ${ARTICULO.palabrasTexto} palabras de desarrollo)`);
  if (specs.length < ARTICULO.secciones) faltas.push(`hacen falta al menos ${ARTICULO.secciones} secciones`);
  if (palabras < ARTICULO.palabras) faltas.push(`faltan ≈${ARTICULO.palabras - palabras} palabras`);
  if (faltas.length === 0) return null;

  const enviado =
    specs.length === 1
      ? `solo enviaste un ${specs[0]!.tipo} (≈${palabras} palabras)`
      : `enviaste ${specs.length} secciones (${specs.map((s) => s.tipo).join(", ")}) con ≈${palabras} palabras`;
  return (
    `Una entrada de blog necesita el artículo completo: ${enviado}; ${faltas.join("; ")}. ` +
    `Añade secciones "texto" con el desarrollo (introducción, 3-5 apartados con subtítulos <h2>/<h3> dentro del html, conclusión); mínimo ${ARTICULO.palabras} palabras. ` +
    "No inventes botones: un botón solo se pinta con boton_url real del sitio."
  );
}

/**
 * Por qué reescribir un contenido de `antes` palabras con uno de `despues`
 * destruiría lo que había, o null si no.
 */
export function motivoReescrituraDestructiva(id: number, antes: number, despues: number): string | null {
  if (antes < PALABRAS_PARA_PROTEGER) return null;
  if (despues >= antes * PROPORCION_MINIMA_REESCRITURA) return null;
  const porcentaje = Math.round((despues / antes) * 100);
  return (
    `Reescribir el contenido ${id} lo dejaría con ≈${despues} palabras cuando ahora tiene ≈${antes} (${porcentaje} %, menos del ${Math.round(PROPORCION_MINIMA_REESCRITURA * 100)} %): se perdería el texto que ya estaba. ` +
    "Lee el contenido, conserva lo que ya estaba y envía el contenido COMPLETO mejorado. Solo si el cliente pidió reemplazarlo todo, pasa reemplazar_todo=true."
  );
}

/**
 * En una entrada, el hero lleva el mismo titular que la entrada: dos titulares
 * distintos arriba del todo parecen dos artículos.
 */
export function conTituloDeEntradaEnHero(
  specs: readonly SeccionSpec[],
  titulo: string,
): { secciones: SeccionSpec[]; cambiado: boolean } {
  let cambiado = false;
  const secciones = specs.map((s) => {
    if (s.tipo !== "hero" || s.titulo === titulo) return s;
    cambiado = true;
    return { ...s, titulo };
  });
  return { secciones, cambiado };
}
