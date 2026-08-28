"use client";

import { cn } from "../lib/cn";

export interface TopbarProps extends React.HTMLAttributes<HTMLElement> {
  titulo: React.ReactNode;
  /** Migas o subtítulo corto a la izquierda del título. */
  contexto?: React.ReactNode;
  acciones?: React.ReactNode;
}

export function Topbar({ titulo, contexto, acciones, className, ...props }: TopbarProps) {
  return (
    <header
      className={cn(
        "flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-border bg-page px-4",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        {contexto && (
          <>
            <span className="truncate text-base text-fg-muted">{contexto}</span>
            <span aria-hidden className="text-fg-disabled">
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
