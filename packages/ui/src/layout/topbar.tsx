"use client";

import { cn } from "../lib/cn";

export interface TopbarProps extends React.HTMLAttributes<HTMLElement> {
  titulo: React.ReactNode;
  /** Migas o subtítulo corto a la izquierda del título. */
  contexto?: React.ReactNode;
  acciones?: React.ReactNode;
  /** Lo que va antes de todo: en móvil, el botón del menú. */
  inicio?: React.ReactNode;
}

export function Topbar({ titulo, contexto, acciones, inicio, className, ...props }: TopbarProps) {
  return (
    <header
      className={cn(
        "flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-border bg-page/85 px-4 backdrop-blur-md",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        {inicio}
        {contexto && (
          <>
            <span className="hidden truncate text-base text-fg-muted sm:inline">{contexto}</span>
            <span aria-hidden className="hidden text-fg-disabled sm:inline">
              /
            </span>
          </>
        )}
        <h1 className="truncate text-base font-semibold text-fg">{titulo}</h1>
      </div>
      {acciones && <div className="flex shrink-0 items-center gap-1.5">{acciones}</div>}
    </header>
  );
}
