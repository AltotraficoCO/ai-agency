"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";

export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "peer grid size-5 shrink-0 cursor-pointer place-items-center rounded-[7px] border-2 border-border-strong shadow-hundido transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] active:scale-90",
        "bg-inset transition-colors duration-[var(--dur-instant)] hover:border-[var(--brand)]",
        "data-[state=checked]:border-[var(--brand)] data-[state=checked]:bg-primary",
        "data-[state=indeterminate]:border-[var(--brand)] data-[state=indeterminate]:bg-primary",
        "data-[disabled]:opacity-45 data-[disabled]:pointer-events-none",
        focusRing,
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="text-[var(--fg-on-brand)]">
        {props.checked === "indeterminate" ? (
          <Minus size={14} strokeWidth={2.5} aria-hidden />
        ) : (
          <Check size={14} strokeWidth={2.5} aria-hidden />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

export interface CheckboxFieldProps
  extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  label: React.ReactNode;
  description?: React.ReactNode;
}

/** Casilla con etiqueta clicable y descripción opcional. */
export function CheckboxField({ label, description, className, ...props }: CheckboxFieldProps) {
  const id = React.useId();
  const descriptionId = description ? `${id}-desc` : undefined;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <Checkbox id={id} aria-describedby={descriptionId} className="mt-0.5" {...props} />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-base text-fg">
          {label}
        </label>
        {description && (
          <span id={descriptionId} className="text-sm text-fg-muted">
            {description}
          </span>
        )}
      </div>
    </div>
  );
}
