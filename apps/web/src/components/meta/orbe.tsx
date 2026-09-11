"use client";

/**
 * Strap.
 *
 * El personaje de plastilina —escudo morado, corona, gafas, capa y tablet— es
 * lo primero que se ve al entrar y lo único que se mueve mientras no pasa nada.
 * Respira cada cuatro segundos, el ritmo de una respiración tranquila y no el de
 * una carga, para decir «estoy aquí, sin prisa» en vez de «estoy ocupado».
 *
 * Se enseña de cuerpo entero, sin recortarlo en círculo: detrás solo hay un
 * halo morado y dorado, los colores de su capa y su corona.
 *
 * Los keyframes viajan con el componente y no en la hoja global: es la única
 * pieza que los usa.
 */
import * as React from "react";
import Image from "next/image";
import { cn, type StrapPose } from "@strappy/ui";

const CSS = `
@keyframes strap-orbe-respira {
  0%, 100% { transform: translateY(0) scale(1); }
  50%      { transform: translateY(-2%) scale(1.03); }
}
@keyframes strap-orbe-aura {
  0%, 100% { opacity: .45; transform: scale(.92); }
  50%      { opacity: .75; transform: scale(1.05); }
}
.strap-orbe-respira { animation: strap-orbe-respira 4s ease-in-out infinite; transform-origin: 50% 90%; }
.strap-orbe-aura    { animation: strap-orbe-aura 4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .strap-orbe-respira, .strap-orbe-aura { animation: none; }
}
`;

const HALO =
  "radial-gradient(circle at 50% 55%, rgba(124,58,237,0.55) 0%, rgba(234,179,8,0.22) 45%, rgba(124,58,237,0) 70%)";

export interface OrbeProps {
  size?: number;
  /** Se conserva por compatibilidad: el personaje de plastilina no cambia de pose. */
  pose?: StrapPose;
  /** Deja de respirar y se queda quieto: Strap está trabajando, no esperando. */
  quieto?: boolean;
  className?: string;
}

export function Orbe({ size = 56, quieto = false, className }: OrbeProps) {
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <span
        aria-hidden
        className={cn("absolute -inset-[15%] rounded-full blur-md", !quieto && "strap-orbe-aura")}
        style={{ background: HALO }}
      />
      <Image
        src="/agentes/strap.webp"
        alt="Strap"
        width={Math.max(64, size * 2)}
        height={Math.max(64, size * 2)}
        priority={size >= 48}
        className={cn(
          "relative size-full object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.35)]",
          !quieto && "strap-orbe-respira",
        )}
      />
    </span>
  );
}
