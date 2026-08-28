"use client";

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";

export const Accordion = AccordionPrimitive.Root;

export const AccordionItem = React.forwardRef<
  React.ComponentRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(function AccordionItem({ className, ...props }, ref) {
  return (
    <AccordionPrimitive.Item
      ref={ref}
      className={cn("border-b border-[var(--border-subtle)] last:border-b-0", className)}
      {...props}
    />
  );
});

export const AccordionTrigger = React.forwardRef<
  React.ComponentRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(function AccordionTrigger({ className, children, ...props }, ref) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        ref={ref}
        className={cn(
          "flex flex-1 items-center justify-between gap-3 py-3 text-base font-medium text-fg",
          "transition-colors duration-[var(--dur-instant)] hover:text-primary-fg",
          "data-[disabled]:opacity-45 data-[disabled]:pointer-events-none",
          "[&[data-state=open]_svg]:rotate-180",
          focusRing,
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown
          size={18}
          strokeWidth={1.75}
          aria-hidden
          className="shrink-0 text-fg-muted transition-transform duration-[var(--dur-fast)] motion-reduce:transition-none"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
});

export const AccordionContent = React.forwardRef<
  React.ComponentRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(function AccordionContent({ className, children, ...props }, ref) {
  return (
    <AccordionPrimitive.Content ref={ref} className="overflow-hidden" {...props}>
      <div className={cn("pb-3 text-base text-fg-secondary", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
});
