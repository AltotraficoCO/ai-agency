"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { IconButton } from "./icon-button";

export const Modal = DialogPrimitive.Root;
export const ModalTrigger = DialogPrimitive.Trigger;
export const ModalClose = DialogPrimitive.Close;

const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" } as const;

export interface ModalContentProps
  extends Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  size?: keyof typeof widths;
}

export const ModalContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  ModalContentProps
>(function ModalContent({ className, title, description, footer, size = "md", children, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="strappy-fade-in fixed inset-0 z-50 bg-[var(--scrim)]" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "strappy-slide-up fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2",
          "textura rounded-xl border-2 border-[var(--border-subtle)] bg-overlay shadow-e3",
          widths[size],
          className,
        )}
        {...props}
      >
        <header className="flex items-start justify-between gap-4 p-5 pb-3">
          <div className="flex flex-col gap-1">
            <DialogPrimitive.Title className="text-xl font-semibold tracking-tight text-fg">
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="max-w-[56ch] text-base text-fg-secondary">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <IconButton label="Cerrar" size="sm" className="-mr-1 -mt-1">
              <X size={18} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </DialogPrimitive.Close>
        </header>
        {children && <div className="px-5 pb-2">{children}</div>}
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] p-4">
            {footer}
          </footer>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
