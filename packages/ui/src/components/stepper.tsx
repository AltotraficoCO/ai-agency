"use client";

import { Check } from "lucide-react";
import { cn } from "../lib/cn";

export interface StepperStep {
  id: string;
  label: string;
  description?: string;
}

export interface StepperProps extends React.HTMLAttributes<HTMLElement> {
  steps: readonly StepperStep[];
  /** Índice del paso en curso; los anteriores se marcan como completados. */
  current: number;
  orientation?: "horizontal" | "vertical";
}

export function Stepper({ steps, current, orientation = "horizontal", className, ...props }: StepperProps) {
  return (
    <nav
      aria-label="Progreso"
      className={cn(orientation === "horizontal" ? "flex items-start gap-2" : "flex flex-col gap-1", className)}
      {...props}
    >
      <ol className={cn("flex w-full", orientation === "horizontal" ? "items-start" : "flex-col gap-4")}>
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li
              key={step.id}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex min-w-0 gap-2.5",
                orientation === "horizontal" ? "flex-1 items-start" : "items-start",
              )}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border text-2xs font-semibold",
                  done && "border-transparent bg-primary text-[var(--fg-on-brand)]",
                  active && "border-[var(--brand)] bg-primary-soft text-primary-fg",
                  !done && !active && "border-border text-fg-muted",
                )}
              >
                {done ? <Check size={14} strokeWidth={2.5} aria-hidden /> : index + 1}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                <span
                  className={cn(
                    "truncate text-base font-medium",
                    active || done ? "text-fg" : "text-fg-muted",
                  )}
                >
                  {step.label}
                  <span className="sr-only">
                    {done ? " (completado)" : active ? " (paso actual)" : " (pendiente)"}
                  </span>
                </span>
                {step.description && (
                  <span className="truncate text-sm text-fg-muted">{step.description}</span>
                )}
              </span>
              {orientation === "horizontal" && index < steps.length - 1 && (
                <span
                  aria-hidden
                  className={cn("mt-3 h-px flex-1", done ? "bg-primary" : "bg-[var(--border-default)]")}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
