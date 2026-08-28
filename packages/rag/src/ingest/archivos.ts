/**
 * Ingesta de archivos: PDF, DOCX, CSV, Markdown y texto plano.
 *
 * Los formatos de texto se resuelven aquí. Los binarios (PDF, DOCX) salen por
 * `ExtractorDocumentosPort`: encerrar un parser de PDF dentro de este paquete
 * lo ataría a una librería nativa concreta y lo volvería imposible de ejecutar
 * en un runtime que no sea Node.
 */
import type { ExtractorDocumentosPort } from "../ports.js";
import { limpiarMarkdown } from "../texto.js";
import type { DocumentoCrudo } from "../types.js";

export type ArchivoEntrante = {
  readonly nombre: string;
  readonly mimeType?: string;
  /** Contenido binario. Para texto plano puede venir ya decodificado. */
  readonly bytes?: Uint8Array;
  readonly texto?: string;
};

export type FormatoArchivo = "pdf" | "docx" | "csv" | "markdown" | "texto" | "html" | "desconocido";

export function detectarFormato(nombre: string, mimeType?: string): FormatoArchivo {
  const ext = (/\.([a-z0-9]+)$/i.exec(nombre)?.[1] ?? "").toLowerCase();
  const mt = (mimeType ?? "").toLowerCase();
  if (ext === "pdf" || mt.includes("pdf")) return "pdf";
  if (ext === "docx" || mt.includes("wordprocessingml")) return "docx";
  if (ext === "csv" || ext === "tsv" || mt.includes("csv")) return "csv";
  if (ext === "md" || ext === "markdown" || mt.includes("markdown")) return "markdown";
  if (ext === "html" || ext === "htm" || mt.includes("html")) return "html";
  if (ext === "txt" || ext === "text" || mt.startsWith("text/")) return "texto";
  return "desconocido";
}

/** Título legible por defecto: el nombre del archivo sin extensión ni guiones. */
export function tituloDesdeNombre(nombre: string): string {
  const base = nombre.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  return base === "" ? nombre : base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * CSV → tabla markdown.
 *
 * Una tabla se conserva entera al trocear, así que un catálogo de 300 filas
 * queda en trozos que siempre llevan la cabecera: "Producto | Precio | Stock"
 * repetida es lo que hace que el agente sepa que 89000 es un precio.
 */
export function csvAMarkdown(texto: string, separador?: string): string {
  const filas = parsearCsv(texto, separador ?? detectarSeparador(texto));
  if (filas.length === 0) return "";
  const ancho = Math.max(...filas.map((f) => f.length));
  const nivelar = (f: readonly string[]): string[] => [
    ...f.map((c) => c.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim()),
    ...Array<string>(Math.max(0, ancho - f.length)).fill(""),
  ];
  const [cabecera, ...resto] = filas.map(nivelar);
  const lineas = [
    `| ${(cabecera ?? []).join(" | ")} |`,
    `| ${Array<string>(ancho).fill("---").join(" | ")} |`,
    ...resto.map((f) => `| ${f.join(" | ")} |`),
  ];
  return lineas.join("\n");
}

function detectarSeparador(texto: string): string {
  const primera = texto.split(/\r?\n/, 1)[0] ?? "";
  const candidatos = [",", ";", "\t", "|"];
  let mejor = ",";
  let max = -1;
  for (const c of candidatos) {
    const n = primera.split(c).length;
    if (n > max) {
      max = n;
      mejor = c;
    }
  }
  return mejor;
}

/** Parser CSV con comillas dobles escapadas, suficiente para RFC 4180. */
export function parsearCsv(texto: string, separador = ","): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let enComillas = false;
  const limpio = texto.replace(/\r\n?/g, "\n");

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (enComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else enComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') {
      enComillas = true;
      continue;
    }
    if (c === separador) {
      fila.push(campo);
      campo = "";
      continue;
    }
    if (c === "\n") {
      fila.push(campo);
      campo = "";
      if (fila.some((v) => v.trim() !== "")) filas.push(fila);
      fila = [];
      continue;
    }
    campo += c;
  }
  fila.push(campo);
  if (fila.some((v) => v.trim() !== "")) filas.push(fila);
  return filas;
}

function decodificar(archivo: ArchivoEntrante): string {
  if (archivo.texto !== undefined) return archivo.texto;
  if (archivo.bytes === undefined) return "";
  return new TextDecoder("utf-8", { fatal: false }).decode(archivo.bytes);
}

export async function ingerirArchivo(
  archivo: ArchivoEntrante,
  extractor?: ExtractorDocumentosPort,
): Promise<DocumentoCrudo> {
  const formato = detectarFormato(archivo.nombre, archivo.mimeType);
  const titulo = tituloDesdeNombre(archivo.nombre);
  const comun = {
    tipo: "file" as const,
    titulo,
    uri: archivo.nombre,
    ...(archivo.mimeType ? { mimeType: archivo.mimeType } : {}),
  };

  if (formato === "pdf" || formato === "docx") {
    if (!extractor) {
      throw new Error(
        `Para leer «${archivo.nombre}» hace falta un extractor de documentos y no hay ninguno configurado.`,
      );
    }
    if (!archivo.bytes) {
      throw new Error(`«${archivo.nombre}» llegó sin contenido.`);
    }
    const { markdown, paginas } = await extractor.extraer({
      bytes: archivo.bytes,
      mimeType: archivo.mimeType ?? (formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      nombreArchivo: archivo.nombre,
    });
    const limpio = limpiarMarkdown(markdown);
    // Un PDF escaneado devuelve páginas pero cero texto. No es un error de
    // formato: es un documento que necesita OCR y hay que decirlo, porque si
    // no el cliente cree que su catálogo está cargado y no lo está.
    const necesitaOcr = limpio.replace(/\s/g, "").length < 40;
    return {
      ...comun,
      markdown: limpio,
      necesitaOcr,
      metadata: { formato, ...(paginas !== undefined ? { paginas } : {}) },
    };
  }

  const crudo = decodificar(archivo);
  if (formato === "csv") {
    return { ...comun, markdown: `# ${titulo}\n\n${csvAMarkdown(crudo)}`, metadata: { formato } };
  }
  if (formato === "html") {
    const { htmlAMarkdown } = await import("./html.js");
    const convertido = htmlAMarkdown(crudo, archivo.nombre);
    return { ...comun, titulo: convertido.titulo || titulo, markdown: convertido.markdown, metadata: { formato } };
  }
  if (formato === "desconocido" && crudo.trim() === "") {
    throw new Error(`No sé leer «${archivo.nombre}». Formatos admitidos: PDF, DOCX, CSV, Markdown y texto.`);
  }
  const markdown = limpiarMarkdown(crudo);
  const conTitulo = /^#{1,6}\s/.test(markdown) ? markdown : `# ${titulo}\n\n${markdown}`;
  return { ...comun, markdown: conTitulo, metadata: { formato } };
}

/** Texto pegado directamente en la interfaz («Nota»). */
export function ingerirTexto(input: {
  titulo: string;
  texto: string;
  uri?: string;
}): DocumentoCrudo {
  const markdown = limpiarMarkdown(input.texto);
  const conTitulo = /^#{1,6}\s/.test(markdown)
    ? markdown
    : `# ${input.titulo}\n\n${markdown}`;
  return {
    tipo: "text",
    titulo: input.titulo,
    ...(input.uri ? { uri: input.uri } : {}),
    markdown: conTitulo,
    metadata: { formato: "nota" },
  };
}
