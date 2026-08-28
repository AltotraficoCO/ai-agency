"use client";

import * as React from "react";
import { cn } from "../lib/cn";

export type StrapPose =
  | "saludando"
  | "esperando"
  | "construyendo"
  | "dormido"
  | "perdido"
  | "celebrando"
  | "buscando";

interface PoseDefinition {
  /** Trazo único sobre retícula de 20px, menos de 12 nodos. */
  d: string;
  /** Centro de la cabeza; de ahí cuelgan los ojos. */
  eyes: { x: number; y: number };
  /** Ojos cerrados: la mascota duerme. */
  asleep?: boolean;
  /** Descripción para lectores de pantalla cuando la mascota no es decorativa. */
  alt: string;
}

const poses: Record<StrapPose, PoseDefinition> = {
  esperando: {
    d: "M40 130 L60 130 L60 80 A20 20 0 0 1 100 80 L100 130 L120 130",
    eyes: { x: 80, y: 74 },
    alt: "Strap esperando, de pie y tranquilo",
  },
  saludando: {
    d: "M40 130 L60 130 L60 80 A20 20 0 0 1 100 80 L100 108 L132 62",
    eyes: { x: 80, y: 74 },
    alt: "Strap saludando con la cinta levantada",
  },
  construyendo: {
    d: "M40 130 L60 130 L60 80 A20 20 0 0 1 100 80 L100 100 L136 100 L136 68",
    eyes: { x: 80, y: 74 },
    alt: "Strap montando una pieza",
  },
  dormido: {
    d: "M24 132 L84 132 A26 26 0 0 0 84 80 A14 14 0 0 0 84 108",
    eyes: { x: 84, y: 106 },
    asleep: true,
    alt: "Strap dormido, enrollado sobre sí mismo",
  },
  perdido: {
    d: "M28 118 L56 128 L60 84 A20 20 0 0 1 100 84 L104 128 L132 116",
    eyes: { x: 80, y: 78 },
    alt: "Strap desorientado, con los extremos caídos",
  },
  celebrando: {
    d: "M34 62 L56 100 L60 82 A20 20 0 0 1 100 82 L104 100 L126 62",
    eyes: { x: 80, y: 76 },
    alt: "Strap celebrando con los brazos en alto",
  },
  buscando: {
    d: "M40 128 L68 98 A26 26 0 0 1 104 62 A26 26 0 0 1 68 98",
    eyes: { x: 86, y: 78 },
    alt: "Strap buscando con una lupa",
  },
};

export interface StrapProps extends Omit<React.SVGProps<SVGSVGElement>, "children"> {
  pose?: StrapPose;
  size?: number;
  /** Se dibuja sola al aparecer; desactívalo si ya hay otra animación protagonista. */
  animate?: boolean;
  /** Respiración continua de ±3px. */
  breathe?: boolean;
  /** Si se le da un texto propio deja de ser decorativa. */
  title?: string;
}

/**
 * Strap: una cinta de trazo único que se pliega en figuras.
 * El color viene de `currentColor`, así que hereda el tono de quien habla.
 */
export function Strap({
  pose = "esperando",
  size = 160,
  animate = true,
  breathe = false,
  title,
  className,
  ...props
}: StrapProps) {
  const definition = poses[pose];
  const pathRef = React.useRef<SVGPathElement>(null);
  const [length, setLength] = React.useState<number | null>(null);

  React.useLayoutEffect(() => {
    if (!animate) return;
    setLength(pathRef.current?.getTotalLength() ?? null);
  }, [animate, definition.d]);

  const decorative = !title;

  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      fill="none"
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : title}
      className={cn("text-primary-fg", className)}
      {...props}
    >
      {!decorative && <title>{title}</title>}
      <g className={cn(breathe && "strappy-breathe")}>
        {/* Relleno plano: la sombra de la cinta, siempre por detrás del trazo. */}
        <path d={definition.d} fill="var(--brand-soft)" stroke="none" />
        <path
          ref={pathRef}
          d={definition.d}
          stroke="currentColor"
          strokeWidth={8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(animate && length !== null && "strappy-draw")}
          style={length !== null ? ({ "--strap-length": length } as React.CSSProperties) : undefined}
        />
        <g fill="currentColor" stroke="none">
          {definition.asleep ? (
            <>
              <path
                d={`M${definition.eyes.x - 13} ${definition.eyes.y} a5 5 0 0 1 10 0`}
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
              />
              <path
                d={`M${definition.eyes.x + 3} ${definition.eyes.y} a5 5 0 0 1 10 0`}
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
              />
            </>
          ) : (
            <>
              <circle cx={definition.eyes.x - 8} cy={definition.eyes.y} r={3.5} />
              <circle cx={definition.eyes.x + 8} cy={definition.eyes.y} r={3.5} />
            </>
          )}
        </g>
      </g>
    </svg>
  );
}

export const strapPoses = Object.keys(poses) as StrapPose[];
export function strapAlt(pose: StrapPose): string {
  return poses[pose].alt;
}
