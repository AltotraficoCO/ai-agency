/**
 * La tabla que acompaña a toda gráfica.
 *
 * Una gráfica es una imagen: un lector de pantalla no la lee, y quien no
 * distingue el índigo del fucsia tampoco. La regla del producto es que NINGUNA
 * gráfica va sola: debajo hay siempre un enlace «Ver como tabla» con los mismos
 * números, en un `<details>` nativo que funciona sin JavaScript.
 *
 * Va como componente de servidor a propósito: los datos ya están calculados, y
 * mandar al navegador el código de una tabla plegada no aporta nada.
 */

export type ColumnaTabla = {
  readonly clave: string;
  readonly etiqueta: string;
  /** Alineación a la derecha para cifras, que es como se comparan. */
  readonly numerica?: boolean;
};

export function VerComoTabla({
  titulo,
  columnas,
  filas,
}: {
  titulo: string;
  columnas: readonly ColumnaTabla[];
  filas: readonly Record<string, string | number>[];
}) {
  return (
    <details className="group mt-3">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm text-fg-secondary underline decoration-dotted underline-offset-4 hover:text-fg focus-visible:outline-2">
        Ver como tabla
        <span aria-hidden className="text-fg-muted transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">{titulo}</caption>
          <thead className="sticky top-0 bg-inset">
            <tr>
              {columnas.map((c) => (
                <th
                  key={c.clave}
                  scope="col"
                  className={`px-3 py-2 text-2xs font-medium tracking-wide text-fg-muted uppercase ${
                    c.numerica ? "text-right" : "text-left"
                  }`}
                >
                  {c.etiqueta}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr>
                <td colSpan={columnas.length} className="px-3 py-4 text-center text-fg-muted">
                  Todavía no hay datos en este periodo.
                </td>
              </tr>
            )}
            {filas.map((fila, i) => (
              <tr key={i} className="border-t border-[var(--border-subtle)]">
                {columnas.map((c) => (
                  <td
                    key={c.clave}
                    className={`px-3 py-2 text-fg ${c.numerica ? "text-right tabular-nums" : ""}`}
                  >
                    {fila[c.clave] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
