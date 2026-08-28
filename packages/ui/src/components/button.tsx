"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";
import { Spinner } from "./spinner";

const buttonVariants = cva(
  cn(
    "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap",
    "rounded-md font-medium transition-colors duration-[var(--dur-instant)]",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:shrink-0",
    focusRing,
  ),
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-[var(--fg-on-brand)] shadow-e1 hover:bg-[var(--brand-hover)] active:bg-[var(--brand-active)]",
        secondary:
          "bg-raised text-fg border border-border hover:bg-hover active:bg-active",
        ghost: "bg-transparent text-fg-secondary hover:bg-hover hover:text-fg active:bg-active",
        human:
          "bg-human text-[var(--fg-on-human)] shadow-e1 hover:brightness-110 active:brightness-95",
        danger:
          "bg-danger text-white shadow-e1 hover:brightness-110 active:brightness-95",
        link: "bg-transparent text-primary-fg underline-offset-4 hover:underline px-0",
      },
      size: {
        sm: "h-[30px] px-2.5 text-sm",
        md: "h-9 px-[14px] text-base",
        lg: "h-11 px-[18px] text-md",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  /** Texto anunciado mientras carga. */
  loadingLabel?: string;
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    loading = false,
    loadingLabel = "Cargando",
    asChild = false,
    disabled,
    children,
    ...props
  },
  ref,
) {
  // Con `asChild` el hijo (normalmente un enlace) recibe los estilos y se
  // renderiza tal cual. No se envuelve ni se le anade el indicador de carga:
  // `Slot` exige un unico hijo y con dos lanza "Slot failed to slot onto its
  // children". Ademas un enlace de navegacion no tiene estado de carga, asi que
  // `loading` no aplica aqui, y por eso el tipo lo prohibe.
  if (asChild) {
    return (
      <Slot
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {children}
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...props}
    >
      {/* El contenido se mantiene en el flujo para que el botón no cambie de ancho al cargar. */}
      <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>
        {children}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner size={size === "sm" ? "sm" : "md"} label={loadingLabel} />
        </span>
      )}
    </button>
  );
});

export { buttonVariants };
