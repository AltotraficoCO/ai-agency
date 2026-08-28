"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { IconButton } from "./icon-button";

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export interface DrawerContentProps
  extends Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}

/** Panel lateral: para detalle contextual que no debe sacar al usuario de la lista. */
export const DrawerContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(function DrawerContent({ className, title, description, footer, width = 420, children, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="strappy-fade-in fixed inset-0 z-50 bg-[var(--scrim)]" />
      <DialogPrimitive.Content
        ref={ref}
        style={{ width }}
        className={cn(
          "strappy-slide-in-right fixed inset-y-0 right-0 z-50 flex max-w-[100vw] flex-col",
          "border-l border-border bg-raised shadow-e3",
          className,
        )}
        {...props}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-subtle)] p-4">
          <div className="flex flex-col gap-0.5">
            <DialogPrimitive.Title className="text-lg font-semibold text-fg">{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="text-sm text-fg-muted">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <IconButton label="Cerrar" size="sm" className="-mr-1">
              <X size={18} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </DialogPrimitive.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-subtle)] p-4">
            {footer}
          </footer>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
