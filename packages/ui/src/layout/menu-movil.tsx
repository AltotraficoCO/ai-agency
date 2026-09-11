"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { cn } from "../lib/cn";
import { focusRing } from "../lib/focus";

export interface MenuMovilProps {
  abierto: boolean;
  onAbiertoCambia: (abierto: boolean) => void;
  /** Normalmente el mismo `Sidebar` del escritorio. */
  children: React.ReactNode;
}

/**
 * El menú en pantallas estrechas.
 *
 * En un teléfono un menú fijo de 248 px se come media pantalla, así que se
 * esconde tras un botón y entra desde la izquierda, que es de donde viene en
 * escritorio: la misma navegación, en el mismo sitio mental.
 */
export function MenuMovil({ abierto, onAbiertoCambia, children }: MenuMovilProps) {
  return (
    <DialogPrimitive.Root open={abierto} onOpenChange={onAbiertoCambia}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="Abrir el menú"
          className={cn(
            "-ml-1 grid size-10 cursor-pointer place-items-center rounded-md text-fg-secondary transition-colors hover:bg-hover hover:text-fg md:hidden",
            focusRing,
          )}
        >
          <Menu size={20} strokeWidth={1.75} aria-hidden />
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="strappy-fade-in fixed inset-0 z-50 bg-[var(--scrim)] md:hidden" />
        <DialogPrimitive.Content
          className="strappy-menu-izquierda fixed inset-y-0 left-0 z-50 flex w-[min(84vw,300px)] flex-col shadow-e3 md:hidden"
        >
          <DialogPrimitive.Title className="sr-only">Menú</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Navegación principal de Strappy
          </DialogPrimitive.Description>
          {children}
          <DialogPrimitive.Close asChild>
            <button
              type="button"
              aria-label="Cerrar el menú"
              className={cn(
                "absolute right-2 top-2.5 grid size-9 cursor-pointer place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg",
                focusRing,
              )}
            >
              <X size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
