"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";
import { IconButton } from "./icon-button";

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/** Devuelve las páginas a mostrar, con `null` donde va una elipsis. */
function pageWindow(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, null, pageCount];
  if (page >= pageCount - 3) return [1, null, pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount];
  return [1, null, page - 1, page, page + 1, null, pageCount];
}

export function Pagination({ page, pageCount, onPageChange, className }: PaginationProps) {
  return (
    <nav aria-label="Paginación" className={cn("flex items-center gap-1", className)}>
      <IconButton
        label="Página anterior"
        size="sm"
        variant="secondary"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
      </IconButton>
      {pageWindow(page, pageCount).map((item, index) =>
        item === null ? (
          <span key={`salto-${index}`} className="px-1 text-fg-muted" aria-hidden>
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            aria-label={`Página ${item}`}
            aria-current={item === page ? "page" : undefined}
            onClick={() => onPageChange(item)}
            className={cn(
              "tnum grid size-[30px] place-items-center rounded-md text-sm font-medium",
              "transition-colors duration-[var(--dur-instant)]",
              item === page
                ? "bg-primary-soft text-primary-fg"
                : "text-fg-secondary hover:bg-hover hover:text-fg",
              focusRing,
            )}
          >
            {item}
          </button>
        ),
      )}
      <IconButton
        label="Página siguiente"
        size="sm"
        variant="secondary"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight size={18} strokeWidth={1.75} aria-hidden />
      </IconButton>
    </nav>
  );
}
