import "server-only";

/**
 * De archivo subido a documento que `@strappy/rag` sabe trocear.
 *
 * `@strappy/rag` deja fuera a propósito los parsers binarios (ver
 * `ExtractorDocumentosPort`): aquí se enchufan los de esta aplicación.
 *  · PDF con `unpdf`: pdf.js empaquetado sin binarios nativos, funciona en
 *    una función serverless de Vercel.
 *  · Word (DOCX) con `mammoth` a HTML, y de HTML a Markdown con el mismo
 *    conversor que usa el rastreo web: así los títulos y las tablas del
 *    documento llegan como encabezados y tablas, que es lo que trocea bien.
 *  · Excel (XLSX) con `read-excel-file`, cada hoja como tabla Markdown: una
 *    tabla se trocea conservando la cabecera, que es lo que hace que el agente
 *    sepa que 89000 es un precio y no un código.
 */
import mammoth from "mammoth";
import readXlsxFile from "read-excel-file/node";
import { extractText } from "unpdf";
import {
  htmlAMarkdown,
  ingerirArchivo,
  tituloDesdeNombre,
  type DocumentoCrudo,
  type ExtractorDocumentosPort,
} from "@strappy/rag";

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type ArchivoSubido = {
  readonly nombre: string;
  readonly mimeType?: string;
  readonly bytes: Uint8Array;
};

export function extensionDe(nombre: string): string {
  return (/\.([a-z0-9]+)$/i.exec(nombre)?.[1] ?? "").toLowerCase();
}

export const extractorDocumentos: ExtractorDocumentosPort = {
  async extraer({ bytes, mimeType, nombreArchivo }) {
    const esPdf = extensionDe(nombreArchivo) === "pdf" || mimeType.includes("pdf");
    if (esPdf) {
      const { totalPages, text } = await extractText(new Uint8Array(bytes), { mergePages: true });
      return { markdown: normalizarTexto(text), paginas: totalPages };
    }
    const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
    return { markdown: htmlAMarkdown(`<main>${value}</main>`).markdown };
  },
};

/** El texto de un PDF llega con saltos de línea de maqueta: se juntan los párrafos sin perder la estructura. */
function normalizarTexto(texto: string): string {
  return texto
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function celdaATexto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

function tablaMarkdown(filas: readonly (readonly string[])[]): string {
  const ancho = Math.max(...filas.map((f) => f.length));
  const nivelar = (f: readonly string[]): string[] => [
    ...f,
    ...Array<string>(Math.max(0, ancho - f.length)).fill(""),
  ];
  const [cabecera, ...resto] = filas.map(nivelar);
  return [
    `| ${(cabecera ?? []).join(" | ")} |`,
    `| ${Array<string>(ancho).fill("---").join(" | ")} |`,
    ...resto.map((f) => `| ${f.join(" | ")} |`),
  ].join("\n");
}

async function excelADocumento(archivo: ArchivoSubido): Promise<DocumentoCrudo> {
  const hojas = await readXlsxFile(Buffer.from(archivo.bytes));
  const titulo = tituloDesdeNombre(archivo.nombre);
  const partes: string[] = [];
  for (const hoja of hojas) {
    const filas = hoja.data
      .map((fila) => fila.map((celda) => celdaATexto(celda)))
      .filter((fila) => fila.some((celda) => celda !== ""));
    if (filas.length === 0) continue;
    if (hojas.length > 1) partes.push(`## ${hoja.sheet}`);
    partes.push(tablaMarkdown(filas));
  }
  return {
    tipo: "file",
    titulo,
    uri: archivo.nombre,
    mimeType: archivo.mimeType || MIME_XLSX,
    // Sin filas con datos, el Markdown queda vacío y el indexado marca la
    // fuente como «conviene revisar» en vez de fingir que aprendió algo.
    markdown: partes.length > 0 ? `# ${titulo}\n\n${partes.join("\n\n")}` : "",
    metadata: { formato: "xlsx", hojas: hojas.length },
  };
}

/** Cualquier formato aceptado → `DocumentoCrudo`, con `uri` = nombre del archivo. */
export async function archivoADocumento(archivo: ArchivoSubido): Promise<DocumentoCrudo> {
  if (extensionDe(archivo.nombre) === "xlsx") return excelADocumento(archivo);
  return ingerirArchivo(
    {
      nombre: archivo.nombre,
      bytes: archivo.bytes,
      ...(archivo.mimeType ? { mimeType: archivo.mimeType } : {}),
    },
    extractorDocumentos,
  );
}

/** Nombre legible del formato de una fuente, para la interfaz. */
export function formatoLegible(input: {
  kind: string;
  mimeType: string | null;
  uri: string | null;
}): string | null {
  if (input.kind === "url") return "Página web";
  if (input.kind === "sitemap") return "Sitio web";
  if (input.kind === "faq") return "Preguntas frecuentes";
  if (input.kind === "table") return "Tabla";
  if (input.kind === "text") return "Texto";
  const ext = input.uri ? extensionDe(input.uri) : "";
  const mt = (input.mimeType ?? "").toLowerCase();
  if (ext === "pdf" || mt.includes("pdf")) return "PDF";
  if (ext === "docx" || mt.includes("wordprocessingml")) return "Word";
  if (ext === "xlsx" || mt.includes("spreadsheetml")) return "Excel";
  if (ext === "csv" || mt.includes("csv")) return "CSV";
  if (ext === "md" || mt.includes("markdown")) return "Markdown";
  if (ext === "txt" || mt.startsWith("text/")) return "Texto";
  return input.kind === "file" ? "Archivo" : null;
}
