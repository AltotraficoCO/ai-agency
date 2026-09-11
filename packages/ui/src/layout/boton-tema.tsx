"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { IconButton } from "../components/icon-button";
import { Tooltip } from "../components/tooltip";

const sinSuscripcion = () => () => {};

/**
 * Modo día / modo noche en un clic.
 *
 * El icono enseña a dónde vas, no dónde estás: con el tema oscuro sale el sol.
 * Hasta que el cliente monta no se sabe el tema real, y se pinta como oscuro
 * (la base) para no parpadear.
 */
export function BotonTema({ side = "right", className }: { side?: "right" | "top"; className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const montado = React.useSyncExternalStore(sinSuscripcion, () => true, () => false);
  const oscuro = !montado || resolvedTheme !== "light";
  const etiqueta = oscuro ? "Cambiar a modo día" : "Cambiar a modo noche";

  return (
    <Tooltip content={etiqueta} side={side}>
      <IconButton
        label={etiqueta}
        className={className}
        onClick={() => setTheme(oscuro ? "light" : "dark")}
      >
        {oscuro ? (
          <Sun size={18} strokeWidth={1.75} aria-hidden />
        ) : (
          <Moon size={18} strokeWidth={1.75} aria-hidden />
        )}
      </IconButton>
    </Tooltip>
  );
}
