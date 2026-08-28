"use client";

import { cn } from "../lib/cn";
import { Strap, type StrapPose } from "../mascot/strap";

export type EmptyStateVariant = "primera-vez" | "sin-resultados" | "error" | "sin-permiso";

const poseByVariant: Record<EmptyStateVariant, StrapPose> = {
  "primera-vez": "saludando",
  "sin-resultados": "buscando",
  error: "perdido",
  "sin-permiso": "dormido",
};

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: EmptyStateVariant;
  title: string;
  /** Máximo dos líneas: si necesita más, el vacío está explicando de más. */
  description: string;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  size?: "sm" | "md";
}

export function EmptyState({
  variant = "primera-vez",
  title,
  description,
  action,
  secondaryAction,
  size = "md",
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 px-6 text-center",
        size === "md" ? "py-14" : "py-8",
        className,
      )}
      {...props}
    >
      <Strap
        pose={poseByVariant[variant]}
        size={size === "md" ? 120 : 88}
        breathe={variant === "primera-vez"}
        className={cn(
          variant === "error" && "text-danger-fg",
          variant === "sin-permiso" && "text-fg-muted",
        )}
      />
      <div className="flex flex-col gap-1.5">
        {/* El título va en el color de texto pleno: en gris medio se lee como deshabilitado. */}
        <h3 className="text-xl font-semibold tracking-tight text-fg">{title}</h3>
        <p className="mx-auto max-w-[56ch] text-base text-fg-secondary">{description}</p>
      </div>
      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
