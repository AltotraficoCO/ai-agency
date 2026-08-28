"use client";

/**
 * El orbe de Strap.
 *
 * Es lo primero que se ve al entrar y lo único que se mueve mientras no pasa
 * nada. Respira cada cuatro segundos —el ritmo de una respiración tranquila,
 * no el de una carga— para decir «estoy aquí, sin prisa» en vez de «estoy
 * ocupado».
 *
 * Los keyframes viajan con el componente y no en la hoja global: es la única
 * pieza que los usa, y una animación suelta en `globals.css` acaba siendo un
 * misterio para quien la lea dentro de seis meses.
 */
import * as React from "react";
import { Strap, cn, type StrapPose } from "@strappy/ui";

const CSS = `
@keyframes strap-orbe-respira {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.045); }
}
@keyframes strap-orbe-aura {
  0%, 100% { opacity: .35; transform: scale(1); }
  50%      { opacity: .6;  transform: scale(1.12); }
}
.strap-orbe-respira { animation: strap-orbe-respira 4s ease-in-out infinite; }
.strap-orbe-aura    { animation: strap-orbe-aura 4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .strap-orbe-respira, .strap-orbe-aura { animation: none; }
}
`;

export interface OrbeProps {
  size?: number;
  pose?: StrapPose;
  /** Deja de respirar y se queda quieto: Strap está trabajando, no esperando. */
  quieto?: boolean;
  className?: string;
}

export function Orbe({ size = 56, pose = "esperando", quieto = false, className }: OrbeProps) {
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <span
        aria-hidden
        className={cn("absolute inset-0 rounded-full blur-md", !quieto && "strap-orbe-aura")}
        style={{ background: "linear-gradient(135deg, #6355F0 0%, #E549A0 100%)", opacity: 0.35 }}
      />
      <span
        className={cn(
          "relative grid h-full w-full place-items-center rounded-full text-white shadow-e2",
          !quieto && "strap-orbe-respira",
        )}
        style={{ background: "linear-gradient(135deg, #6355F0 0%, #E549A0 100%)" }}
      >
        <Strap pose={pose} size={Math.round(size * 0.62)} animate={false} aria-hidden />
      </span>
    </span>
  );
}
