"use client";

/**
 * El indicador de la conexión en vivo, en la barra de arriba de la bandeja.
 */
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@strappy/ui";
import type { EstadoConexion } from "./vivo";

export function IndicadorConexion({
  estado,
  alReintentar,
}: {
  estado: EstadoConexion;
  alReintentar: () => void;
}) {
  if (estado === "vivo") {
    return (
      <Badge tone="exito" title="Los mensajes nuevos llegan solos">
        <Wifi size={12} strokeWidth={2} aria-hidden />
        En vivo
      </Badge>
    );
  }
  if (estado === "conectando") {
    return (
      <Badge tone="neutral">
        <Wifi size={12} strokeWidth={2} aria-hidden />
        Conectando…
      </Badge>
    );
  }
  if (estado === "sondeo") {
    return (
      <Badge tone="neutral" title="Esta instalación no tiene tiempo real: la bandeja se refresca sola cada 8 segundos">
        <RefreshCw size={12} strokeWidth={2} aria-hidden />
        Actualizando cada 8 s
      </Badge>
    );
  }
  return (
    <button type="button" onClick={alReintentar} title="Reintentar la conexión en vivo">
      <Badge tone="aviso">
        <WifiOff size={12} strokeWidth={2} aria-hidden />
        Sin conexión en vivo
      </Badge>
    </button>
  );
}
