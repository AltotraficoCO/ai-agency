"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "../lib/cn";

export interface LabelProps extends React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> {
  optional?: boolean;
}

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  LabelProps
>(function Label({ className, optional, children, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(
        "flex items-center gap-1.5 text-base font-medium text-fg",
        "has-[+_*_:disabled]:opacity-45",
        className,
      )}
      {...props}
    >
      {children}
      {optional && <span className="text-sm font-normal text-fg-muted">(opcional)</span>}
    </LabelPrimitive.Root>
  );
});
