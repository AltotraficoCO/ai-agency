"use client";

import * as React from "react";
import { Send } from "lucide-react";
import { Button, Textarea } from "@strappy/ui";
import type { Resultado } from "@/lib/negocio/acciones";
import type { SitioConectado } from "./comun";
import type { OficioEncargos } from "./oficios";

/** La caja para encargar, abajo del todo, como en cualquier chat. */
export function Composer({
  nombreAgente,
  oficio,
  sitio,
  caja,
  texto,
  setTexto,
  estado,
  enviar,
  pendiente,
}: {
  nombreAgente: string;
  oficio: OficioEncargos;
  sitio: SitioConectado | null;
  /** La caja de texto: la cabecera y los ejemplos le dan el foco desde fuera. */
  caja: React.RefObject<HTMLTextAreaElement | null>;
  texto: string;
  setTexto: (texto: string) => void;
  estado: Resultado | null;
  enviar: (datos: FormData) => void;
  pendiente: boolean;
}) {
  const formulario = React.useRef<HTMLFormElement>(null);

  return (
    <div className="shrink-0 border-t-2 border-[var(--border-subtle)] bg-page">
      <form ref={formulario} action={enviar} className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-4">
        <div className="flex items-end gap-2 rounded-2xl border-2 border-border bg-raised p-2 shadow-e1 transition-colors focus-within:border-[color-mix(in_oklab,var(--brand),transparent_45%)]">
          <Textarea
            ref={caja}
            name="texto"
            rows={2}
            required
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter envía; Mayús+Enter hace salto de línea, como en cualquier chat.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (texto.trim()) formulario.current?.requestSubmit();
              }
            }}
            disabled={(oficio.conexion.bloquea && !sitio) || pendiente}
            placeholder={
              sitio || !oficio.conexion.bloquea
                ? oficio.placeholder(nombreAgente)
                : `${oficio.conexion.ctaTexto} para encargarle trabajo`
            }
            className="min-h-12 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:outline-none"
          />
          <Button
            type="submit"
            loading={pendiente}
            loadingLabel="Encargando"
            disabled={(oficio.conexion.bloquea && !sitio) || !texto.trim()}
            aria-label="Encargar"
          >
            <Send size={16} aria-hidden />
            Encargar
          </Button>
        </div>
        {estado && !estado.ok ? (
          <p className="px-1 text-sm text-danger-fg" role="alert">
            {estado.error}
          </p>
        ) : (
          <p className="px-1 text-2xs text-fg-muted">
            Enter para encargar · Mayús+Enter para otra línea. Guarda una copia antes de cada cambio.
          </p>
        )}
      </form>
    </div>
  );
}
