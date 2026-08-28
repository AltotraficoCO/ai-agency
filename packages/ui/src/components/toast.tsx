"use client";

import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";

/**
 * Envoltorio de sonner con los tokens del sistema.
 * Los iconos acompañan siempre al color: el tono nunca es la única señal.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      gap={8}
      offset={16}
      icons={{
        success: <CircleCheck size={18} strokeWidth={1.75} />,
        error: <CircleAlert size={18} strokeWidth={1.75} />,
        warning: <TriangleAlert size={18} strokeWidth={1.75} />,
        info: <Info size={18} strokeWidth={1.75} />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[360px] items-start gap-2.5 rounded-lg border border-border bg-overlay p-3 shadow-e3",
          title: "text-base font-medium text-fg",
          description: "text-sm text-fg-secondary",
          actionButton:
            "ml-auto h-[30px] shrink-0 rounded-md bg-primary px-2.5 text-sm font-medium text-[var(--fg-on-brand)]",
          cancelButton: "h-[30px] shrink-0 rounded-md px-2.5 text-sm text-fg-secondary",
          success: "[&_[data-icon]]:text-success-fg",
          error: "[&_[data-icon]]:text-danger-fg",
          warning: "[&_[data-icon]]:text-warning-fg",
          info: "[&_[data-icon]]:text-info-fg",
        },
      }}
    />
  );
}

export const toast = sonnerToast;
