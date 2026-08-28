"use client";

import * as React from "react";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Icono decorativo a la izquierda (18px). */
  leadingIcon?: React.ReactNode;
  trailingSlot?: React.ReactNode;
}

export const inputBase = cn(
  "h-9 w-full rounded-md border border-border bg-inset px-[14px] text-base text-fg",
  "placeholder:text-fg-muted transition-colors duration-[var(--dur-instant)]",
  "hover:border-border-strong",
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
