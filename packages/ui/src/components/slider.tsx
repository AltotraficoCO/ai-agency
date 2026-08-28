"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";

export const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(function Slider({ className, ...props }, ref) {
  const values = props.value ?? props.defaultValue ?? [0];
  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex h-9 w-full touch-none select-none items-center",
        "data-[disabled]:opacity-45 data-[disabled]:pointer-events-none",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-[var(--border-strong)]">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {values.map((_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          className={cn(
            "block size-4 rounded-full border-2 border-[var(--brand)] bg-raised shadow-e1",
            "transition-transform duration-[var(--dur-instant)] hover:scale-110 active:scale-95",
            focusRing,
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
});
