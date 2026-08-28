/**
 * Descubrimiento y descarga de páginas web.
 *
 * Primero el sitemap: si el sitio lo publica, es la lista que el propio dueño
 * declara como su contenido, y sale infinitamente más limpia que rastrear.
 * Solo si no hay sitemap se rastrea en anchura, acotado a 50 páginas del mismo
 * dominio. El tope no es una constante caprichosa: sin él, un catálogo con
 * facetas genera decenas de miles de URL y la primera factura de embeddings
 * del cliente es impagable.
 */
import type { FetchPort } from "../ports.js";
import type { DocumentoCrudo } from "../types.js";
import { htmlAMarkdown } from "./html.js";
import { parsearRobots, permiteRuta, ROBOTS_PERMISIVO, type ReglasRobots } from "./robots.js";

export const MAXIMO_PAGINAS = 50;

export type OpcionesWeb = {
  readonly maximoPaginas: number;
  readonly timeoutMs: number;
  readonly agente: string;
  /** Respetar robots.txt. Solo se desactiva en pruebas. */
  readonly respetarRobots: boolean;
  /** Mínimo de caracteres de markdown para que una página valga la pena. */
  readonly minimoCaracteres: number;
};

export const WEB_POR_DEFECTO: OpcionesWeb = {
  maximoPaginas: MAXIMO_PAGINAS,
  timeoutMs: 15_000,
  agente: "StrappyBot",
  respetarRobots: true,
  minimoCaracteres: 120,
};

export type PaginaDescubierta = {
  readonly url: string;
  readonly documento: DocumentoCrudo;
};

export type ResultadoRastreo = {
  readonly paginas: readonly PaginaDescubierta[];
  readonly metodo: "sitemap" | "rastreo";
  readonly descartadas: readonly { url: string; motivo: string }[];
  readonly topeAlcanzado: boolean;
};

function mismaBase(url: string, base: URL): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    // Se acepta www ↔ sin www; cualquier otro subdominio es otro sitio.
    const limpio = (h: string): string => h.replace(/^www\./i, "").toLowerCase();
    return limpio(u.hostname) === limpio(base.hostname);
  } catch {
    return false;
  }
}

/** Descarta lo que nunca es contenido: binarios, feeds, imágenes. */
const RE_EXTENSION_NO_HTML =
  /\.(pdf|zip|rar|7z|gz|tar|png|jpe?g|gif|webp|avif|svg|ico|mp4|mp3|wav|mov|avi|css|js|json|xml|rss|atom|woff2?|ttf|eot|exe|dmg|apk)(\?|$)/i;

export async function leerRobots(
  fetchPort: FetchPort,
  base: URL,
  opts: OpcionesWeb,
): Promise<ReglasRobots> {
  if (!opts.respetarRobots) return ROBOTS_PERMISIVO;
  try {
    const r = await fetchPort.obtener({
      url: new URL("/robots.txt", base).toString(),
      timeoutMs: opts.timeoutMs,
    });
    if (r.status !== 200) return ROBOTS_PERMISIVO;
    return parsearRobots(r.body, opts.agente);
  } catch {
    // Sin robots.txt legible se asume permisivo: es lo que hace todo el mundo.
    return ROBOTS_PERMISIVO;
  }
}

/** Lee un sitemap (o índice de sitemaps, recursivamente) y devuelve URLs. */
export async function leerSitemap(
  fetchPort: FetchPort,
  url: string,
  opts: OpcionesWeb,
  visitados = new Set<string>(),
): Promise<string[]> {
  if (visitados.has(url) || visitados.size > 20) return [];
  visitados.add(url);
  let cuerpo: string;
  try {
    const r = await fetchPort.obtener({ url, timeoutMs: opts.timeoutMs });
    if (r.status !== 200 || r.body.trim() === "") return [];
    cuerpo = r.body;
  } catch {
    return [];
  }

  const locs = [...cuerpo.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((m) =>
    (m[1] ?? "").trim(),
  );
  const esIndice = /<sitemapindex/i.test(cuerpo);
  if (!esIndice) return locs;

  const salida: string[] = [];
  for (const hijo of locs) {
    salida.push(...(await leerSitemap(fetchPort, hijo, opts, visitados)));
    if (salida.length >= opts.maximoPaginas * 4) break;
  }
  return salida;
}

async function descargarPagina(
  fetchPort: FetchPort,
  url: string,
  opts: OpcionesWeb,
): Promise<PaginaDescubierta | { error: string; enlaces?: readonly string[] }> {
  const r = await fetchPort.obtener({ url, timeoutMs: opts.timeoutMs });
  if (r.status >= 400) return { error: `HTTP ${r.status}` };
  if (r.contentType !== "" && !/text\/html|application\/xhtml/i.test(r.contentType)) {
    return { error: `tipo no soportado (${r.contentType})` };
  }
  const { titulo, markdown, enlaces } = htmlAMarkdown(r.body, r.finalUrl || url);
  if (markdown.length < opts.minimoCaracteres) {
    return { error: "página sin texto suficiente", enlaces };
  }
  return {
    url: r.finalUrl || url,
    documento: {
      tipo: "url",
      titulo,
      uri: r.finalUrl || url,
      mimeType: "text/html",
      markdown,
      // La lista de enlaces viaja en la metadata solo para alimentar la cola
      // del rastreo; no se guarda en la fuente.
      metadata: { enlacesLista: enlaces },
    },
  };
}

/**
 * Punto de entrada de la ingesta web. Devuelve un documento por página, listo
 * para trocear. No escribe nada: quien decide qué se guarda es `indexarFuente`.
 */
export async function rastrearSitio(
  fetchPort: FetchPort,
  urlInicial: string,
  opciones?: Partial<OpcionesWeb>,
): Promise<ResultadoRastreo> {
  const opts = { ...WEB_POR_DEFECTO, ...opciones };
  const base = new URL(urlInicial);
  const reglas = await leerRobots(fetchPort, base, opts);

  const candidatasSitemap = new Set<string>();
  const desdeRobots = reglas.sitemaps.length > 0
    ? reglas.sitemaps
    : [new URL("/sitemap.xml", base).toString()];
  for (const sm of desdeRobots) {
    for (const u of await leerSitemap(fetchPort, sm, opts)) {
      if (mismaBase(u, base) && !RE_EXTENSION_NO_HTML.test(u)) candidatasSitemap.add(u);
    }
  }

  const metodo: "sitemap" | "rastreo" = candidatasSitemap.size > 0 ? "sitemap" : "rastreo";
  const cola: string[] = metodo === "sitemap" ? [...candidatasSitemap] : [urlInicial];
  const vistos = new Set<string>(cola);
  const paginas: PaginaDescubierta[] = [];
  const descartadas: { url: string; motivo: string }[] = [];
  let topeAlcanzado = false;

  while (cola.length > 0) {
    if (paginas.length >= opts.maximoPaginas) {
      topeAlcanzado = true;
      break;
    }
    const url = cola.shift();
    if (url === undefined) break;

    if (opts.respetarRobots && !permiteRuta(reglas, url)) {
      descartadas.push({ url, motivo: "excluida por robots.txt" });
      continue;
    }

    let resultado: Awaited<ReturnType<typeof descargarPagina>>;
    try {
      resultado = await descargarPagina(fetchPort, url, opts);
    } catch (error) {
      descartadas.push({ url, motivo: error instanceof Error ? error.message : "fallo de red" });
      continue;
    }

    if ("error" in resultado) {
      descartadas.push({ url, motivo: resultado.error });
      if (metodo === "rastreo") encolar(resultado.enlaces ?? []);
      continue;
    }

    paginas.push(resultado);
    if (metodo === "rastreo") encolar(extraerEnlacesDe(resultado));
    if (reglas.esperaMs > 0) await esperar(reglas.esperaMs);
  }

  return { paginas, metodo, descartadas, topeAlcanzado };

  function encolar(enlaces: readonly string[]): void {
    for (const enlace of enlaces) {
      if (vistos.size >= opts.maximoPaginas * 6) return;
      if (vistos.has(enlace)) continue;
      if (!mismaBase(enlace, base)) continue;
      if (RE_EXTENSION_NO_HTML.test(enlace)) continue;
      if (opts.respetarRobots && !permiteRuta(reglas, enlace)) continue;
      vistos.add(enlace);
      cola.push(enlace);
    }
  }
}

/** Los enlaces se guardan durante la conversión; aquí se recuperan. */
function extraerEnlacesDe(pagina: PaginaDescubierta): readonly string[] {
  const guardados = pagina.documento.metadata?.["enlacesLista"];
  return Array.isArray(guardados) ? (guardados as string[]) : [];
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
