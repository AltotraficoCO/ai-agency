import { cn } from "../lib/cn";

export interface EncabezadoPaginaProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  titulo: React.ReactNode;
  /** Una frase: qué se hace aquí. Si necesita dos, la pantalla hace demasiado. */
  descripcion?: React.ReactNode;
  /** La acción principal va aquí, a la derecha, siempre a la vista. */
  acciones?: React.ReactNode;
  /** Icono o avatar a la izquierda del título. */
  icono?: React.ReactNode;
}

/**
 * El encabezado de cada pantalla.
 *
 * Dice dónde estás y qué puedes hacer sin tener que buscarlo: título,
 * una frase y la acción principal a la derecha. En móvil las acciones bajan
 * debajo del texto en vez de apretarlo.
 */
export function EncabezadoPagina({
  titulo,
  descripcion,
  acciones,
  icono,
  className,
  ...props
}: EncabezadoPaginaProps) {
  return (
    <div
      className={cn(
        "strappy-slide-up flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icono ? <div className="shrink-0">{icono}</div> : null}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{titulo}</h1>
          {descripcion ? (
            <p className="max-w-[70ch] text-base text-fg-secondary">{descripcion}</p>
          ) : null}
        </div>
      </div>
      {acciones ? <div className="flex shrink-0 flex-wrap items-center gap-2">{acciones}</div> : null}
    </div>
  );
}
