"use client";

/**
 * Lo hecho a mano: subrayados, flechas y círculos de rotulador.
 *
 * El truco que los hace parecer animación de plastilina y no vectores es el
 * «hervor» (*line boil*): un filtro de ruido que cambia de semilla unas ocho
 * veces por segundo, así el trazo tiembla como en el stop-motion, donde cada
 * fotograma se dibuja o se modela de nuevo y nunca queda idéntico.
 */
import { useEffect, useRef } from "react";

export function FiltroHervor() {
  const ruido = useRef<SVGFETurbulenceElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let semilla = 1;
    const t = window.setInterval(() => {
      semilla = (semilla % 4) + 1;
      ruido.current?.setAttribute("seed", String(semilla));
    }, 125);
    return () => window.clearInterval(t);
  }, []);

  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <filter id="hervor" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence ref={ruido} type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="1" />
        <feDisplacementMap in="SourceGraphic" scale="3.2" />
      </filter>
    </svg>
  );
}

type Trazo = { className?: string; color?: string };

/** Subrayado de rotulador, dos pasadas como cuando se repasa con prisa. */
export function Subrayado({ className, color = "#39FF14" }: Trazo) {
  return (
    <svg className={`lp-garabato ${className ?? ""}`} viewBox="0 0 300 30" preserveAspectRatio="none" aria-hidden>
      <path
        data-trazo
        d="M4 19 C 60 9, 130 7, 205 11 S 285 16, 296 12"
        stroke={color}
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        data-trazo
        d="M22 25 C 90 18, 170 17, 280 21"
        stroke={color}
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Flecha torcida, de las que se pintan en una pizarra para señalar algo. */
export function Flecha({ className, color = "#E4E4E7" }: Trazo) {
  return (
    <svg className={`lp-garabato ${className ?? ""}`} viewBox="0 0 120 90" aria-hidden>
      <path
        data-trazo
        d="M8 12 C 30 4, 70 6, 86 30 C 96 46, 92 62, 84 74"
        stroke={color}
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        data-trazo
        d="M68 64 L 84 78 L 100 62"
        stroke={color}
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Círculo hecho de una vez, que no cierra donde empezó. */
export function Circulo({ className, color = "#39FF14" }: Trazo) {
  return (
    <svg className={`lp-garabato ${className ?? ""}`} viewBox="0 0 220 90" preserveAspectRatio="none" aria-hidden>
      <path
        data-trazo
        d="M150 10 C 90 0, 20 12, 10 42 C 2 70, 70 86, 130 80 C 190 74, 216 52, 206 30 C 198 14, 160 6, 120 8"
        stroke={color}
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** El chulo de una lista, a mano. */
export function Chulo({ className, color = "#39FF14" }: Trazo) {
  return (
    <svg className={`lp-garabato ${className ?? ""}`} viewBox="0 0 32 32" aria-hidden>
      <path
        data-trazo
        d="M5 17 C 8 19, 11 23, 13 26 C 17 17, 22 10, 28 5"
        stroke={color}
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
