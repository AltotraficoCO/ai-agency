"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";
import { Spinner } from "./spinner";

const iconButtonVariants = cva(
  cn(
    "relative inline-grid cursor-pointer place-items-center rounded-md transition-[color,background-color,box-shadow,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)] active:scale-x-[1.06] active:scale-y-[0.9] motion-reduce:active:scale-100",
    "disabled:pointer-events-none disabled:opacity-45",
    focusRing,
  ),
  {
    variants: {
      variant: {
        primary: "bg-primary text-[var(--fg-on-brand)] hover:bg-[var(--brand-hover)] active:bg-[var(--brand-active)]",
        secondary: "border-2 border-border bg-raised text-fg shadow-e1 hover:-translate-y-0.5 hover:bg-hover active:translate-y-0 active:shadow-hundido",
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
