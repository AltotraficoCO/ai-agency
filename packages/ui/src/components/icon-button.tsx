"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";
import { Spinner } from "./spinner";

const iconButtonVariants = cva(
  cn(
    "relative inline-grid place-items-center rounded-md transition-colors duration-[var(--dur-instant)]",
    "disabled:pointer-events-none disabled:opacity-45",
    focusRing,
  ),
  {
    variants: {
      variant: {
        primary: "bg-primary text-[var(--fg-on-brand)] hover:bg-[var(--brand-hover)] active:bg-[var(--brand-active)]",
        secondary: "bg-raised text-fg border border-border hover:bg-hover active:bg-active",
        ghost: "bg-transparent text-fg-secondary hover:bg-hover hover:text-fg active:bg-active",
        human: "bg-human text-[var(--fg-on-human)] hover:brightness-110 active:brightness-95",
        danger: "bg-transparent text-danger-fg hover:bg-[var(--danger-soft)] active:brightness-95",
      },
      size: { sm: "size-[30px]", md: "size-9", lg: "size-11" },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  /** Obligatorio: un botón sin texto necesita nombre accesible. */
  label: string;
  loading?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ className, variant, size, label, loading, disabled, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        aria-busy={loading || undefined}
        disabled={disabled ?? loading}
        className={cn(iconButtonVariants({ variant, size }), className)}
        {...props}
      >
        {loading ? <Spinner size={size === "sm" ? "sm" : "md"} /> : children}
      </button>
    );
  },
);

export { iconButtonVariants };
