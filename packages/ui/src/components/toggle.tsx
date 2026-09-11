"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";

export interface ToggleProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  /** `human` marca los interruptores que ceden el control a una persona. */
  tone?: "brand" | "human";
}

export const Toggle = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  ToggleProps
>(function Toggle({ className, tone = "brand", ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-hundido",
        "bg-[var(--border-strong)] transition-colors duration-[var(--dur-fast)]",
        tone === "brand" ? "data-[state=checked]:bg-primary" : "data-[state=checked]:bg-human",
        "data-[disabled]:opacity-45 data-[disabled]:pointer-events-none",
        focusRing,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-[18px] translate-x-0.5 rounded-full bg-white shadow-e1 [transition-timing-function:var(--ease-spring)]",
          "transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out-quart)]",
          "data-[state=checked]:translate-x-[18px]",
        )}
      />
    </SwitchPrimitive.Root>
  );
});

export interface ToggleFieldProps extends ToggleProps {
  label: React.ReactNode;
  description?: React.ReactNode;
}

export function ToggleField({ label, description, className, ...props }: ToggleFieldProps) {
  const id = React.useId();
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-base font-medium text-fg">
          {label}
        </label>
        {description && <span className="text-sm text-fg-muted">{description}</span>}
      </div>
      <Toggle id={id} className="mt-0.5" {...props} />
    </div>
  );
}
