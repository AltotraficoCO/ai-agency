/**
 * HTML → Markdown limpio.
 *
 * Sin librería externa a propósito: un DOM completo es 3 MB de dependencia
 * para lo que aquí es un recorrido de etiquetas. Lo que sí importa es tirar
 * navegación, pies, menús y scripts: en una web de PYME eso es el 70% del
 * texto de cada página, y si entra al índice el agente recupera el menú
 * principal como respuesta a "¿cuánto cuesta el plan pro?".
 */
import { limpiarMarkdown } from "../texto.js";

/** Etiquetas cuyo contenido se descarta entero. */
const BASURA = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "object",
  "form",
  "nav",
  "header",
  "footer",
  "aside",
  "menu",
  "dialog",
]);

/** Pistas de clase/id que delatan navegación o pie aunque la etiqueta sea <div>. */
const RE_CLASE_BASURA =
  /(^|[\s_-])(nav|navbar|menu|breadcrumb|sidebar|footer|header|cookie|banner|popup|modal|newsletter|social|share|comment|advert|ads?|skip-link)([\s_-]|$)/i;

const VACIAS = new Set([
  "br", "hr", "img", "input", "meta", "link", "source", "col", "area", "base", "wbr",
]);

type Nodo =
  | { readonly tipo: "texto"; readonly texto: string }
  | {
      readonly tipo: "elemento";
      readonly etiqueta: string;
      readonly atributos: Readonly<Record<string, string>>;
      readonly hijos: Nodo[];
    };

const RE_TAG = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\/?>/g;

function parsearAtributos(crudo: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(crudo)) !== null) {
    attrs[(m[1] ?? "").toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  }
  return attrs;
}

const ENTIDADES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»",
  hellip: "…", mdash: "—", ndash: "–", eacute: "é", aacute: "á", iacute: "í",
  oacute: "ó", uacute: "ú", ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", euro: "€", copy: "©",
  reg: "®", trade: "™", deg: "°", middot: "·", bull: "•", rsquo: "'", lsquo: "'",
  ldquo: '"', rdquo: '"',
};

export function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (todo, ent: string) => {
    if (ent.startsWith("#")) {
      const codigo = ent.startsWith("#x") || ent.startsWith("#X")
        ? Number.parseInt(ent.slice(2), 16)
        : Number.parseInt(ent.slice(1), 10);
      return Number.isFinite(codigo) && codigo > 0 ? String.fromCodePoint(codigo) : todo;
    }
    return ENTIDADES[ent] ?? todo;
  });
}

/** Árbol laxo: el HTML real viene mal cerrado y no vale la pena ser estricto. */
function parsear(html: string): Nodo {
  const raiz: Nodo = { tipo: "elemento", etiqueta: "#root", atributos: {}, hijos: [] };
  const pila: Extract<Nodo, { tipo: "elemento" }>[] = [raiz as Extract<Nodo, { tipo: "elemento" }>];
  let ultimo = 0;
  let m: RegExpExecArray | null;
  RE_TAG.lastIndex = 0;

  const cima = (): Extract<Nodo, { tipo: "elemento" }> => pila[pila.length - 1] ?? (raiz as Extract<Nodo, { tipo: "elemento" }>);
  const texto = (t: string): void => {
    if (t === "") return;
    cima().hijos.push({ tipo: "texto", texto: decodificarEntidades(t) });
  };

  while ((m = RE_TAG.exec(html)) !== null) {
    texto(html.slice(ultimo, m.index));
    ultimo = m.index + m[0].length;
    const etiqueta = (m[1] ?? "").toLowerCase();
    if (etiqueta === "") continue; // comentario
    const cierre = m[0].startsWith("</");

    if (etiqueta === "script" || etiqueta === "style") {
      if (!cierre) {
        const fin = html.toLowerCase().indexOf(`</${etiqueta}`, ultimo);
        ultimo = fin === -1 ? html.length : fin;
        RE_TAG.lastIndex = ultimo;
      }
      continue;
    }

    if (cierre) {
      for (let i = pila.length - 1; i > 0; i--) {
        if (pila[i]?.etiqueta === etiqueta) {
          pila.length = i;
          break;
        }
      }
      continue;
    }

    const nodo: Extract<Nodo, { tipo: "elemento" }> = {
      tipo: "elemento",
      etiqueta,
      atributos: parsearAtributos(m[2] ?? ""),
      hijos: [],
    };
    cima().hijos.push(nodo);
    if (!VACIAS.has(etiqueta) && !m[0].endsWith("/>")) pila.push(nodo);
  }
  texto(html.slice(ultimo));
  return raiz;
}

function esDescartable(nodo: Extract<Nodo, { tipo: "elemento" }>): boolean {
  if (BASURA.has(nodo.etiqueta)) return true;
  if (nodo.atributos["role"] === "navigation" || nodo.atributos["role"] === "banner") return true;
  if (nodo.atributos["aria-hidden"] === "true") return true;
  if (nodo.atributos["hidden"] !== undefined) return true;
  const señas = `${nodo.atributos["class"] ?? ""} ${nodo.atributos["id"] ?? ""}`;
  return señas.trim() !== "" && RE_CLASE_BASURA.test(señas);
}

function buscar(nodo: Nodo, predicado: (n: Extract<Nodo, { tipo: "elemento" }>) => boolean): Nodo | null {
  if (nodo.tipo !== "elemento") return null;
  if (nodo.etiqueta !== "#root" && predicado(nodo)) return nodo;
  for (const hijo of nodo.hijos) {
    const encontrado = buscar(hijo, predicado);
    if (encontrado) return encontrado;
  }
  return null;
}

function textoPlano(nodo: Nodo): string {
  if (nodo.tipo === "texto") return nodo.texto;
  if (esDescartable(nodo)) return "";
  return nodo.hijos.map(textoPlano).join("");
}

function normalizarLinea(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/** Recorre el árbol emitiendo markdown en bloque. */
function convertir(nodo: Nodo, salida: string[], enLinea: string[]): void {
  const volcar = (): void => {
    const linea = normalizarLinea(enLinea.join(""));
    enLinea.length = 0;
    if (linea !== "") salida.push(linea);
  };

  if (nodo.tipo === "texto") {
    enLinea.push(nodo.texto.replace(/\s+/g, " "));
    return;
  }
  if (nodo.etiqueta !== "#root" && esDescartable(nodo)) return;

  switch (nodo.etiqueta) {
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
      volcar();
      const nivel = Number.parseInt(nodo.etiqueta.slice(1), 10);
      const titulo = normalizarLinea(textoPlano(nodo));
      if (titulo !== "") salida.push(`${"#".repeat(nivel)} ${titulo}`);
      return;
    }
    case "br":
      volcar();
      return;
    case "hr":
      volcar();
      salida.push("---");
      return;
    case "p": case "div": case "section": case "article": case "main": case "blockquote":
    case "dl": case "dd": case "dt": case "figure": case "figcaption": case "address": {
      volcar();
      for (const hijo of nodo.hijos) convertir(hijo, salida, enLinea);
      volcar();
      if (nodo.etiqueta === "blockquote") {
        const ultima = salida.pop();
        if (ultima !== undefined) salida.push(`> ${ultima.replace(/\n/g, "\n> ")}`);
      }
      return;
    }
    case "ul": case "ol": {
      volcar();
      const ordenada = nodo.etiqueta === "ol";
      let n = 1;
      for (const hijo of nodo.hijos) {
        if (hijo.tipo !== "elemento" || hijo.etiqueta !== "li") continue;
        if (esDescartable(hijo)) continue;
        const interno: string[] = [];
        convertir(hijo, interno, []);
        const texto = interno.join(" ").replace(/\s+/g, " ").trim();
        if (texto === "") continue;
        salida.push(ordenada ? `${n}. ${texto}` : `- ${texto}`);
        n += 1;
      }
      return;
    }
    case "li": {
      for (const hijo of nodo.hijos) convertir(hijo, salida, enLinea);
      volcar();
      return;
    }
    case "table": {
      volcar();
      salida.push(...convertirTabla(nodo));
      return;
    }
    case "pre": {
      volcar();
      const codigo = textoPlano(nodo).replace(/\n+$/, "");
      if (codigo.trim() !== "") salida.push("```", codigo, "```");
      return;
    }
    case "code": {
      const codigo = normalizarLinea(textoPlano(nodo));
      if (codigo !== "") enLinea.push(`\`${codigo}\``);
      return;
    }
    case "strong": case "b": {
      const t = normalizarLinea(textoPlano(nodo));
      if (t !== "") enLinea.push(`**${t}**`);
      return;
    }
    case "em": case "i": {
      const t = normalizarLinea(textoPlano(nodo));
      if (t !== "") enLinea.push(`*${t}*`);
      return;
    }
    case "a": {
      const t = normalizarLinea(textoPlano(nodo));
      const href = nodo.atributos["href"] ?? "";
      // Solo se conserva el destino si aporta: un enlace a "#" es ruido.
      if (t === "") return;
      enLinea.push(href !== "" && !href.startsWith("#") && !href.startsWith("javascript:")
        ? `[${t}](${href})`
        : t);
      return;
    }
    case "img": {
      const alt = normalizarLinea(nodo.atributos["alt"] ?? "");
      if (alt !== "") enLinea.push(`(imagen: ${alt})`);
      return;
    }
    default: {
      for (const hijo of nodo.hijos) convertir(hijo, salida, enLinea);
      if (nodo.etiqueta === "#root") volcar();
      return;
    }
  }
}

function convertirTabla(tabla: Extract<Nodo, { tipo: "elemento" }>): string[] {
  const filas: string[][] = [];
  const recoger = (n: Nodo): void => {
    if (n.tipo !== "elemento") return;
    if (esDescartable(n)) return;
    if (n.etiqueta === "tr") {
      const celdas: string[] = [];
      const recogerCelda = (c: Nodo): void => {
        if (c.tipo !== "elemento") return;
        if (c.etiqueta === "td" || c.etiqueta === "th") {
          celdas.push(normalizarLinea(textoPlano(c)).replace(/\|/g, "\\|"));
          return;
        }
        for (const h of c.hijos) recogerCelda(h);
      };
      for (const h of n.hijos) recogerCelda(h);
      if (celdas.some((c) => c !== "")) filas.push(celdas);
      return;
    }
    for (const h of n.hijos) recoger(h);
  };
  recoger(tabla);
  if (filas.length === 0) return [];

  const ancho = Math.max(...filas.map((f) => f.length));
  const nivelar = (f: string[]): string[] => [...f, ...Array<string>(ancho - f.length).fill("")];
  const [cabecera, ...resto] = filas.map(nivelar);
  const lineas = [`| ${(cabecera ?? []).join(" | ")} |`, `| ${Array<string>(ancho).fill("---").join(" | ")} |`];
  for (const f of resto) lineas.push(`| ${f.join(" | ")} |`);
  return lineas;
}

export type HtmlConvertido = {
  readonly titulo: string;
  readonly markdown: string;
  /** Enlaces absolutos encontrados en el cuerpo, para el rastreo. */
  readonly enlaces: readonly string[];
};

/** Título de la página: <title>, o el primer <h1>, o la URL. */
function extraerTitulo(raiz: Nodo, html: string, url?: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const deTitle = m ? normalizarLinea(decodificarEntidades(m[1] ?? "")) : "";
  if (deTitle !== "") return deTitle;
  const h1 = buscar(raiz, (n) => n.etiqueta === "h1");
  const deH1 = h1 ? normalizarLinea(textoPlano(h1)) : "";
  if (deH1 !== "") return deH1;
  return url ?? "Página sin título";
}

export function htmlAMarkdown(html: string, url?: string): HtmlConvertido {
  const raiz = parsear(html);
  const titulo = extraerTitulo(raiz, html, url);
  // Si la página declara <main> o <article>, ahí está el contenido de verdad y
  // todo lo demás sobra sin necesidad de heurísticas.
  const cuerpo =
    buscar(raiz, (n) => n.etiqueta === "main" || n.atributos["role"] === "main") ??
    buscar(raiz, (n) => n.etiqueta === "article") ??
    buscar(raiz, (n) => n.etiqueta === "body") ??
    raiz;

  const salida: string[] = [];
  convertir(cuerpo, salida, []);
  const markdown = limpiarMarkdown(unirBloques(salida));
  return { titulo, markdown, enlaces: extraerEnlaces(html, url) };
}

/** Une bloques dejando una línea en blanco salvo dentro de listas y tablas. */
function unirBloques(bloques: readonly string[]): string {
  const out: string[] = [];
  for (const bloque of bloques) {
    const anterior = out[out.length - 1];
    const contiguo =
      anterior !== undefined &&
      ((/^(-|\d+\.)\s/.test(bloque) && /^(-|\d+\.)\s/.test(anterior)) ||
        (bloque.startsWith("|") && anterior.startsWith("|")) ||
        bloque === "```" ||
        anterior === "```");
    out.push(contiguo ? bloque : `\n${bloque}`);
  }
  return out.join("\n").trim();
}

/** Enlaces absolutos del documento, resueltos contra la URL base. */
export function extraerEnlaces(html: string, base?: string): string[] {
  const encontrados = new Set<string>();
  const re = /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = decodificarEntidades(m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (href === "" || href.startsWith("#") || /^(javascript|mailto|tel):/i.test(href)) continue;
    try {
      const url = base ? new URL(href, base) : new URL(href);
      url.hash = "";
      encontrados.add(url.toString());
    } catch {
      // href relativo sin base utilizable: se ignora en silencio.
    }
  }
  return [...encontrados];
}
