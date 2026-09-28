"use client";

/**
 * Los atajos de teclado de la bandeja.
 */
import * as React from "react";
import type { ConversacionResumen } from "@/lib/bandeja/tipos";

export function useTecladoBandeja({
  conversaciones,
  abrir,
  alternarControl,
  seleccionadaRef,
  refBusqueda,
  refEtiquetas,
  setFichaAbierta,
}: {
  conversaciones: ConversacionResumen[];
  abrir: (id: string) => Promise<void>;
  alternarControl: () => void;
  seleccionadaRef: React.RefObject<string | null>;
  refBusqueda: React.RefObject<HTMLInputElement | null>;
  refEtiquetas: React.RefObject<HTMLButtonElement | null>;
  setFichaAbierta: (abierta: boolean) => void;
}) {
  React.useEffect(() => {
    const escribiendo = (destino: EventTarget | null): boolean => {
      const nodo = destino as HTMLElement | null;
      if (!nodo) return false;
      return (
        nodo.tagName === "INPUT" ||
        nodo.tagName === "TEXTAREA" ||
        nodo.isContentEditable === true
      );
    };

    const alPulsar = (evento: KeyboardEvent) => {
      const meta = evento.metaKey || evento.ctrlKey;

      // Alternar el mando funciona incluso escribiendo: es el atajo que se usa
      // con las manos ya en el teclado, a mitad de una frase.
      if (meta && evento.key === ".") {
        evento.preventDefault();
        alternarControl();
        return;
      }
      if (meta && (evento.key === "l" || evento.key === "L")) {
        evento.preventDefault();
        refEtiquetas.current?.click();
        return;
      }
      if (evento.key === "Escape" && escribiendo(evento.target)) {
        (evento.target as HTMLElement).blur();
        return;
      }
      if (escribiendo(evento.target)) return;

      if (evento.key === "/") {
        evento.preventDefault();
        refBusqueda.current?.focus();
        return;
      }
      if (evento.key === "j" || evento.key === "k") {
        evento.preventDefault();
        const actual = conversaciones.findIndex((c) => c.id === seleccionadaRef.current);
        const siguiente =
          evento.key === "j"
            ? Math.min(actual + 1, conversaciones.length - 1)
            : Math.max(actual - 1, 0);
        const destino = conversaciones[actual === -1 ? 0 : siguiente];
        if (destino) {
          void abrir(destino.id);
          document
            .querySelector(`[data-conversacion="${destino.id}"]`)
            ?.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      if (evento.key === "Escape") {
        setFichaAbierta(false);
        return;
      }
    };

    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [conversaciones, abrir, alternarControl, seleccionadaRef, refBusqueda, refEtiquetas, setFichaAbierta]);
}
