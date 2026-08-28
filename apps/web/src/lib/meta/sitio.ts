import "server-only";

/**
 * Lectura del sitio web del cliente.
 *
 * Scraping de verdad: `@strappy/rag` descubre por sitemap —y solo rastrea si
 * no hay— y convierte el HTML a Markdown tirando menús, pies y banners. No
 * hay ninguna simulación aquí: si el sitio no existe, Strap lo dice.
 *
 * El resultado se guarda unos minutos en memoria porque el guion lo pide dos
 * veces seguidas: primero para contarte qué encontró y luego, si dices que sí,
 * para indexarlo. Volver a descargar cuarenta páginas entre una frase y la
 * siguiente sería maleducado con el sitio del cliente.
 */
import { crearFetch, rastrearSitio, type ResultadoRastreo } from "@strappy/rag";

const VIDA_CACHE_MS = 10 * 60 * 1000;
const PAGINAS_POR_DEFECTO = 12;

type Entrada = { readonly resultado: ResultadoRastreo; readonly caduca: number };

declare global {
  var __strappySitios: Map<string, Entrada> | undefined;
}

function cache(): Map<string, Entrada> {
  globalThis.__strappySitios ??= new Map();
  return globalThis.__strappySitios;
}

export function normalizarUrl(valor: string): string {
  const limpio = valor.trim();
  const conEsquema = /^https?:\/\//i.test(limpio) ? limpio : `https://${limpio}`;
  // `new URL` lanza con basura; que lance aquí es correcto: la herramienta lo
  // convierte en un mensaje entendible en vez de rastrear a ciegas.
  return new URL(conEsquema).toString();
}

export async function analizarSitio(
  urlCruda: string,
  opciones: { maximoPaginas?: number } = {},
): Promise<ResultadoRastreo & { url: string }> {
  const url = normalizarUrl(urlCruda);
  const maximoPaginas = Math.min(30, Math.max(1, opciones.maximoPaginas ?? PAGINAS_POR_DEFECTO));
  const clave = `${url}|${maximoPaginas}`;

  const guardado = cache().get(clave);
  if (guardado && guardado.caduca > Date.now()) {
    return { ...guardado.resultado, url };
  }

  const resultado = await rastrearSitio(crearFetch(), url, { maximoPaginas });
  cache().set(clave, { resultado, caduca: Date.now() + VIDA_CACHE_MS });
  return { ...resultado, url };
}

/** Un par de frases sobre lo que se encontró, para que Strap no tenga que inventarlas. */
export function resumirSitio(resultado: ResultadoRastreo): string {
  const titulos = resultado.paginas
    .slice(0, 6)
    .map((p) => p.documento.titulo)
    .filter((t) => t.trim().length > 0);
  if (titulos.length === 0) return "No se encontró texto aprovechable.";
  return titulos.join(" · ");
}
