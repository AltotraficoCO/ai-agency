"use client";

import { Wallet } from "lucide-react";
import { EnlaceBoton } from "@/components/enlace-boton";

/** Ocupa el lugar de la caja de escribir cuando no hay créditos para hablar con Strap. */
export function AvisoSinCreditos({ minimoUsd }: { minimoUsd: number }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-4 rounded-xl border border-border bg-raised p-4 shadow-e1 sm:flex-row sm:items-center"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-fg">
        <Wallet size={18} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium text-fg">Para hablar con Strap necesitas créditos</p>
        <p className="text-sm text-fg-secondary">
          Puedes recargar desde {minimoUsd} USD. Tus conversaciones quedan guardadas para seguirlas después.
        </p>
      </div>
      <EnlaceBoton href="/ajustes/facturacion" variant="primary" className="w-fit shrink-0">
        Recargar créditos
      </EnlaceBoton>
    </div>
  );
}
