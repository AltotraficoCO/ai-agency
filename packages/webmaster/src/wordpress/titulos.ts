/**
 * Un título tiene que ser un titular, no un trozo de la petición.
 *
 * El caso real: el cliente pidió «crea un post sobre la importancia de la IA y
 * créale una plantilla de Elementor bonita…» y la entrada se publicó como «La
 * importancia y el uso responsable de la IA, pero también…». El modelo cortó
 * una frase y la dejó colgando. Rechazarlo con un error que dice qué hacer es
 * más barato que publicarlo y tener que corregirlo a mano.
 */

const MAXIMO = 90;

/** Palabras con las que un titular no termina: dejan la frase a medias. */
const CONECTORES_FINALES = new Set([
  "y", "e", "o", "u", "ni", "de", "del", "al", "a", "en", "por", "para", "con", "sin", "sobre",
  "que", "pero", "sino", "como", "un", "una", "el", "la", "los", "las", "su", "sus", "tu", "tus",
  "mi", "mis", "entre", "hacia", "desde", "hasta", "según", "cuando", "donde", "porque",
]);

/** Parejas finales que tampoco cierran una frase. */
const FINALES_COLGANTES = ["pero también", "y también", "así como", "además de", "no solo"];

const MENSAJE =
  "El título parece un fragmento de la petición, no un titular: escribe un titular completo y atractivo para el artículo (sin puntos suspensivos ni instrucciones como «créale una plantilla» o «acorde al diseño»), de 90 caracteres como mucho.";

/** Devuelve el motivo del rechazo, o null si el título sirve. */
export function motivoTituloInvalido(titulo: string): string | null {
  const limpio = titulo.replace(/\s+/g, " ").trim();
  if (!limpio) return `${MENSAJE} Ahora está vacío.`;
  if (limpio.length > MAXIMO) {
    return `${MENSAJE} Ahora tiene ${limpio.length} caracteres.`;
  }
  if (/(…|\.\.\.?)$/.test(limpio)) return `${MENSAJE} Ahora termina en puntos suspensivos: «${limpio}».`;
  if (/[,;:\-–—]$/.test(limpio)) return `${MENSAJE} Ahora termina a media frase: «${limpio}».`;

  const normal = limpio.toLowerCase().replace(/[¿?¡!"'«»“”]+$/g, "").trim();
  if (FINALES_COLGANTES.some((f) => normal.endsWith(` ${f}`) || normal === f)) {
    return `${MENSAJE} Ahora termina a media frase: «${limpio}».`;
  }
  const ultima = normal.split(" ").pop() ?? "";
  if (normal.includes(" ") && CONECTORES_FINALES.has(ultima)) {
    return `${MENSAJE} Ahora termina en «${ultima}»: «${limpio}».`;
  }
  if (/\b(cr[eé]ale|plantilla de elementor|acorde al dise[ñn]o)\b/i.test(limpio)) {
    return `${MENSAJE} Ahora incluye instrucciones de formato: «${limpio}».`;
  }
  return null;
}

/** Lanza el error accionable si el título no es un titular. */
export function exigirTituloValido(titulo: string): void {
  const motivo = motivoTituloInvalido(titulo);
  if (motivo) throw new Error(motivo);
}
