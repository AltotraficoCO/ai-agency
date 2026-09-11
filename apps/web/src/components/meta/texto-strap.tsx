"use client";

/**
 * El texto de Strap, pintado como texto y no como Markdown crudo.
 *
 * Los modelos escriben `**negritas**`, listas, separadores `---` y emojis por
 * mucho que el prompt lo prohíba. Enseñar esa sintaxis a un dueño de negocio es
 * enseñarle las tripas del producto, así que aquí se hace lo mínimo: negritas,
 * listas, párrafos y enlaces seguros. Lo decorativo (separadores, encabezados,
 * emojis) se tira. Sin dependencias: son cuarenta líneas, no un parser.
 */
import * as React from "react";
import Link from "next/link";

const EMOJI = /\p{Extended_Pictographic}️?/gu;
const SEPARADOR = /^\s*([-*_])\1{2,}\s*$/;
const ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;

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
          tramo.lista ? (
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

type Tramo = { lista: boolean; lineas: string[] };

function tramos(lineas: readonly string[]): Tramo[] {
  const salida: Tramo[] = [];
  for (const linea of lineas) {
    const lista = ITEM.test(linea);
    const ultimo = salida[salida.length - 1];
    if (ultimo && ultimo.lista === lista) ultimo.lineas.push(linea);
    else salida.push({ lista, lineas: [linea] });
  }
  return salida;
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
