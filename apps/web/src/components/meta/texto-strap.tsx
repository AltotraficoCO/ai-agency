"use client";

/**
 * El texto de Strap, pintado como texto y no como Markdown crudo.
 *
 * Los modelos escriben `**negritas**`, listas, separadores `---` y emojis por
 * mucho que el prompt lo prohíba. Enseñar esa sintaxis a un dueño de negocio es
 * enseñarle las tripas del producto, así que aquí se hace lo mínimo: negritas,
 * listas, párrafos, enlaces seguros y TABLAS. Lo decorativo (separadores,
 * encabezados, emojis) se tira. Sin dependencias: no es un parser.
 *
 * Las tablas están porque una nómina, una lista de facturas o unos gastos por
 * proveedor escritos en párrafo son ilegibles: «Pedro 2.079.547, Victor
 * 1.504.547…» obliga a leer tres veces lo que en una tabla se ve de un vistazo.
 */
import * as React from "react";
import Link from "next/link";

const EMOJI = /\p{Extended_Pictographic}️?/gu;
const SEPARADOR = /^\s*([-*_])\1{2,}\s*$/;
const ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;
/** Una fila de tabla Markdown: empieza por «|». */
const FILA = /^\s*\|/;
/** La fila de guiones bajo el encabezado: «|---|:--:|». */
const FILA_GUIONES = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** El texto sin lo decorativo. Vacío si no queda nada que decir. */
export function limpiarTextoStrap(texto: string): string {
  return texto
    .replace(EMOJI, "")
    .split("\n")
    .filter((linea) => !SEPARADOR.test(linea))
    .map((linea) => linea.replace(/^\s*#{1,6}\s+/, "").replace(/[ \t]+$/, ""))
    .join("\n")
    // `[Abrir el agente]` sin dirección es un botón fingido: se queda el texto.
    .replace(/\[([^\]]+)\](?!\()/g, "$1")
    // Un `**` huérfano al empezar (el modelo abrió negrita y no la cerró) no es
    // formato: es basura y se tira.
    .replace(/^\*\*\s+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function TextoStrap({ texto }: { texto: string }) {
  const limpio = limpiarTextoStrap(texto);
  if (limpio.length === 0) return null;

  const bloques = limpio.split(/\n\s*\n/);
  return (
    <div className="flex flex-col gap-2 text-md leading-relaxed text-fg">
      {bloques.flatMap((bloque, i) =>
        // Un bloque puede mezclar una frase y su lista debajo sin línea en
        // blanco: se parte en tramos de texto y tramos de lista.
        tramos(bloque.split("\n").filter((l) => l.trim().length > 0)).map((tramo, j) =>
          tramo.tipo === "tabla" ? (
            <Tabla key={`${i}-${j}`} lineas={tramo.lineas} />
          ) : tramo.tipo === "lista" ? (
            <ul key={`${i}-${j}`} className="flex flex-col gap-1 pl-1">
              {tramo.lineas.map((linea, k) => (
                <li key={k} className="flex gap-2">
                  <span aria-hidden className="mt-[9px] size-1 shrink-0 rounded-full bg-primary" />
                  <span>{enLinea(linea.replace(ITEM, ""))}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p key={`${i}-${j}`}>
              {tramo.lineas.map((linea, k) => (
                <React.Fragment key={k}>
                  {k > 0 ? <br /> : null}
                  {enLinea(linea)}
                </React.Fragment>
              ))}
            </p>
          ),
        ),
      )}
    </div>
  );
}

type Tramo = { tipo: "texto" | "lista" | "tabla"; lineas: string[] };

function tramos(lineas: readonly string[]): Tramo[] {
  const salida: Tramo[] = [];
  for (const linea of lineas) {
    const tipo = FILA.test(linea) ? "tabla" : ITEM.test(linea) ? "lista" : "texto";
    const ultimo = salida[salida.length - 1];
    if (ultimo && ultimo.tipo === tipo) ultimo.lineas.push(linea);
    else salida.push({ tipo, lineas: [linea] });
  }
  return salida;
}

function celdas(linea: string): string[] {
  return linea
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** Una celda con cifras se alinea a la derecha: así se comparan de un vistazo. */
const NUMERICA = /^[-−]?\s*[$€]?\s*[\d.,]+\s*%?$|^\*\*[-−]?\s*[$€]?\s*[\d.,]+\s*%?\*\*$/;

function Tabla({ lineas }: { lineas: readonly string[] }) {
  const filas = lineas.filter((l) => !FILA_GUIONES.test(l)).map(celdas);
  const conEncabezado = lineas.length > 1 && FILA_GUIONES.test(lineas[1]!);
  const cabecera = conEncabezado ? (filas[0] ?? null) : null;
  const cuerpo = conEncabezado ? filas.slice(1) : filas;
  const columnas = Math.max(...filas.map((f) => f.length));
  const completar = (f: string[]) => [...f, ...Array.from({ length: columnas - f.length }, () => "")];
  // Una fila de total (primera celda en negrita que dice «total») se destaca.
  const esTotal = (f: string[]) => /^\*\*\s*total/i.test(f[0] ?? "");

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-max border-collapse overflow-hidden rounded-lg border border-border text-sm">
        {cabecera ? (
          <thead className="bg-inset">
            <tr>
              {completar(cabecera).map((c, k) => (
                <th key={k} scope="col" className="border-b border-border px-3 py-2 text-left font-semibold text-fg">
                  {enLinea(c)}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {cuerpo.map((fila, r) => (
            <tr
              key={r}
              className={esTotal(fila) ? "bg-inset font-semibold" : "border-b border-[var(--border-subtle)] last:border-b-0"}
            >
              {completar(fila).map((c, k) => (
                <td
                  key={k}
                  className={`px-3 py-2 align-top text-fg ${NUMERICA.test(c) ? "tnum whitespace-nowrap text-right" : ""}`}
                >
                  {enLinea(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TOKEN = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|`[^`]+`)/g;

function enLinea(texto: string): React.ReactNode[] {
  return texto.split(TOKEN).map((trozo, i) => {
    if (trozo.startsWith("**") && trozo.endsWith("**") && trozo.length > 4) {
      return (
        <strong key={i} className="font-semibold text-fg">
          {trozo.slice(2, -2)}
        </strong>
      );
    }
    const enlace = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(trozo);
    if (enlace) {
      const [, etiqueta, destino] = enlace;
      const clase = "font-medium text-primary-fg underline-offset-4 hover:underline";
      if (destino!.startsWith("/")) {
        return (
          <Link key={i} href={destino!} className={clase}>
            {etiqueta}
          </Link>
        );
      }
      if (destino!.startsWith("https://")) {
        return (
          <a key={i} href={destino} target="_blank" rel="noreferrer" className={clase}>
            {etiqueta}
          </a>
        );
      }
      return <React.Fragment key={i}>{etiqueta}</React.Fragment>;
    }
    if (trozo.startsWith("`") && trozo.endsWith("`") && trozo.length > 2) {
      return (
        <code key={i} className="rounded bg-inset px-1 py-0.5 text-sm">
          {trozo.slice(1, -1)}
        </code>
      );
    }
    // Un asterisco suelto que no cerró nada no es formato: es ruido.
    return <React.Fragment key={i}>{trozo.replace(/\*\*/g, "")}</React.Fragment>;
  });
}
