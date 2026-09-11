"use client";

import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";

export const RadioGroup = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(function RadioGroup({ className, ...props }, ref) {
  return <RadioGroupPrimitive.Root ref={ref} className={cn("grid gap-2.5", className)} {...props} />;
});

export const Radio = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(function Radio({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        "grid size-5 shrink-0 cursor-pointer place-items-center rounded-full border-2 border-border-strong shadow-hundido transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] active:scale-90",
        "bg-inset transition-colors duration-[var(--dur-instant)] hover:border-[var(--brand)]",
        "data-[state=checked]:border-[var(--brand)] data-[state=checked]:bg-primary",
        "data-[disabled]:opacity-45 data-[disabled]:pointer-events-none",
        focusRing,
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="size-1.5 rounded-full bg-[var(--fg-on-brand)]" />
    </RadioGroupPrimitive.Item>
  );
});

export interface RadioFieldProps
  extends React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> {
  label: React.ReactNode;
  description?: React.ReactNode;
}

export function RadioField({ label, description, className, ...props }: RadioFieldProps) {
  const id = React.useId();
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <Radio id={id} className="mt-0.5" {...props} />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-base text-fg">
          {label}
        </label>
        {description && <span className="text-sm text-fg-muted">{description}</span>}
      </div>
    </div>
  );
}
