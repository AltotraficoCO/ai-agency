"use client";

/**
 * Strap.
 *
 * El personaje de plastilina —escudo morado, corona, gafas, capa y tablet— va
 * en un círculo, como una foto de perfil: se encuadra de pecho para arriba para
 * que la cara se reconozca también a 32 px en el chat. Es lo único que se mueve
 * mientras no pasa nada: respira cada cuatro segundos, el ritmo de una
 * respiración tranquila y no el de una carga.
 *
 * Los keyframes viajan con el componente y no en la hoja global: es la única
 * pieza que los usa.
 */
import * as React from "react";
import Image from "next/image";
import { cn, type StrapPose } from "@strappy/ui";

const CSS = `
@keyframes strap-orbe-respira {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.035); }
}
@keyframes strap-orbe-aura {
  0%, 100% { opacity: .35; transform: scale(.95); }
  50%      { opacity: .65; transform: scale(1.06); }
}
.strap-orbe-respira { animation: strap-orbe-respira 4s ease-in-out infinite; }
.strap-orbe-aura    { animation: strap-orbe-aura 4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .strap-orbe-respira, .strap-orbe-aura { animation: none; }
}
`;

/** Halo verde de la marca con un toque del morado de su capa. */
const HALO =
  "radial-gradient(circle, rgba(57,255,20,0.35) 0%, rgba(124,58,237,0.18) 45%, rgba(57,255,20,0) 70%)";

/** Fondo del círculo: el morado profundo de su capa, para que el personaje resalte. */
const FONDO = "radial-gradient(circle at 50% 30%, #3B2A80 0%, #21184A 70%, #150F30 100%)";

export interface OrbeProps {
  size?: number;
  /** Se conserva por compatibilidad: el personaje de plastilina no cambia de pose. */
  pose?: StrapPose;
  /** Deja de respirar y se queda quieto: Strap está trabajando, no esperando. */
  quieto?: boolean;
  className?: string;
}

export function Orbe({ size = 56, quieto = false, className }: OrbeProps) {
  const grande = size >= 64;
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <span
        aria-hidden
        className={cn("absolute -inset-[18%] rounded-full blur-lg", !quieto && "strap-orbe-aura")}
        style={{ background: HALO }}
      />
      <span
        className={cn(
          "relative size-full overflow-hidden rounded-full shadow-e2",
          grande ? "border-[3px]" : "border-2",
          "border-[color-mix(in_oklab,var(--brand),transparent_45%)]",
          !quieto && "strap-orbe-respira",
        )}
        style={{ background: FONDO }}
      >
        {/* Encuadre de foto de perfil: la imagen es más grande que el círculo
            y sube, así la cara y la corona quedan en el centro. */}
        <Image
          src="/agentes/strap.webp"
          alt="Strap"
          width={Math.max(96, size * 3)}
          height={Math.max(96, size * 3)}
          priority={grande}
          className="absolute left-1/2 top-[2%] h-auto w-[155%] max-w-none -translate-x-1/2"
        />
      </span>
    </span>
  );
}
