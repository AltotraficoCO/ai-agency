"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";

export interface FilterChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  count?: number;
  /** Muestra el chevron de los chips que abren un menú de opciones. */
  hasMenu?: boolean;
}

/** Chip de filtro: estado activo con marca visible además del color. */
export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  function FilterChip({ className, active, count, hasMenu, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={active}
        className={cn(
          "inline-flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
          "transition-colors duration-[var(--dur-instant)] disabled:opacity-45 disabled:pointer-events-none",
          active
            ? "border-[var(--brand)] bg-primary-soft text-primary-fg"
            : "border-border bg-raised text-fg-secondary hover:border-border-strong hover:text-fg",
          focusRing,
          className,
        )}
        {...props}
      >
        {active && <Check size={14} strokeWidth={2.25} aria-hidden />}
        {children}
        {typeof count === "number" && (
          <span className="tnum text-fg-muted">{count}</span>
        )}
        {hasMenu && <ChevronDown size={14} strokeWidth={1.75} aria-hidden />}
      </button>
    );
  },
);
