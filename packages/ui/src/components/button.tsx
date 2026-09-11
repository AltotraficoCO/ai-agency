"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";
import { Spinner } from "./spinner";

/**
 * Botones de plastilina.
 *
 * Tienen volumen (luz arriba, canto abajo) y al pulsarlos se APLASTAN: se
 * ensanchan y bajan un poco, y al soltar rebotan con la curva elástica. Es el
 * gesto que hace que la herramienta se sienta blandita en la mano.
 */
const buttonVariants = cva(
  cn(
    "relative inline-flex cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap",
    "rounded-md font-semibold",
    "transition-[color,background-color,border-color,box-shadow,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)]",
    "active:scale-x-[1.04] active:scale-y-[0.92] active:duration-[var(--dur-instant)]",
    "motion-reduce:transition-none motion-reduce:active:scale-100",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:shrink-0",
    focusRing,
  ),
  {
    variants: {
      variant: {
        primary: cn(
          "bg-primary text-[var(--fg-on-brand)] shadow-marca",
          "[background-image:linear-gradient(180deg,rgb(255_255_255/0.18),transparent_65%)]",
          "hover:-translate-y-0.5 hover:bg-[var(--brand-hover)]",
          "active:translate-y-0 active:bg-[var(--brand-active)] active:shadow-marca-pulsado",
        ),
        secondary: cn(
          "border-2 border-border bg-raised text-fg shadow-e1",
          "hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--brand),transparent_55%)] hover:text-primary-fg",
          "active:translate-y-0 active:shadow-hundido",
        ),
        ghost: "bg-transparent text-fg-secondary hover:bg-hover hover:text-fg active:bg-active",
        human: cn(
          "bg-human text-[var(--fg-on-human)]",
          "[box-shadow:inset_0_2px_0_rgb(255_255_255/0.35),inset_0_-4px_0_rgb(120_30_20/0.25),0_8px_16px_-6px_rgb(255_107_87/0.5)]",
          "hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 active:brightness-95",
        ),
        danger: cn(
          "bg-danger text-white",
          "[box-shadow:inset_0_2px_0_rgb(255_255_255/0.3),inset_0_-4px_0_rgb(110_20_25/0.3),0_8px_16px_-6px_rgb(229_72_77/0.45)]",
          "hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 active:brightness-95",
        ),
        link: "bg-transparent px-0 text-primary-fg underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-base",
        lg: "h-12 px-5 text-md",
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
