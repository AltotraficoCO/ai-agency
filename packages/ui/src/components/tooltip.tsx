"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "../lib/cn";

export const TooltipProvider = TooltipPrimitive.Provider;

export interface TooltipProps {
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Atajo de teclado que se muestra a la derecha del texto. */
  shortcut?: string;
  children: React.ReactNode;
}

export function Tooltip({ content, side = "top", shortcut, children }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            "strappy-fade-in z-50 flex items-center gap-2 rounded-md border border-border",
            "bg-overlay px-2 py-1 text-sm text-fg shadow-e2",
          )}
        >
          {content}
          {shortcut && (
            <span className="font-mono text-2xs text-fg-muted">{shortcut}</span>
          )}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
