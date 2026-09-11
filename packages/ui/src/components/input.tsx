"use client";

import * as React from "react";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Icono decorativo a la izquierda (18px). */
  leadingIcon?: React.ReactNode;
  trailingSlot?: React.ReactNode;
}

/** Campo de plastilina: un hueco hundido en la superficie, que se enciende al escribir. */
export const inputBase = cn(
  "h-10 w-full rounded-md border-2 border-border bg-inset px-[14px] text-base text-fg shadow-hundido",
  "placeholder:text-fg-muted transition-[border-color,background-color] duration-[var(--dur-fast)]",
  "hover:border-border-strong focus-visible:border-[color-mix(in_oklab,var(--brand),transparent_40%)] focus-visible:bg-raised",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:outline-[var(--danger)]",
  "disabled:opacity-45 disabled:cursor-not-allowed",
  focusRing,
);

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, leadingIcon, trailingSlot, ...props },
  ref,
) {
  if (!leadingIcon && !trailingSlot) {
    return <input ref={ref} className={cn(inputBase, className)} {...props} />;
  }
  return (
    <div className="relative flex items-center">
      {leadingIcon && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-3 flex text-fg-muted [&_svg]:size-[18px]"
        >
          {leadingIcon}
        </span>
      )}
      <input
        ref={ref}
        className={cn(inputBase, leadingIcon && "pl-10", trailingSlot && "pr-10", className)}
        {...props}
      />
      {trailingSlot && (
        <span className="absolute right-2 flex items-center text-fg-muted">{trailingSlot}</span>
      )}
    </div>
  );
});
