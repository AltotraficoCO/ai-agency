import { CircleAlert, ShieldAlert } from "lucide-react";
import { cn } from "@strappy/ui";
import type { AvisoDelSitio } from "./comun";

/**
 * Un aviso de la vigilancia.
 *
 * Va arriba del todo y antes de los encargos porque es lo único de esta
 * pantalla que la persona no pidió: si su web está caída, eso es lo primero que
 * tiene que leer al entrar. La propuesta va en su propia línea: un aviso sin
 * «qué hago ahora» es una alarma, no un empleado.
 */
export function AvisoDeVigilancia({ aviso }: { aviso: AvisoDelSitio }) {
  const tono =
    aviso.severidad === "grave"
      ? "border-danger/40 bg-danger-soft text-danger-fg"
      : aviso.severidad === "aviso"
        ? "border-warning/40 bg-warning-soft text-warning-fg"
        : "border-border bg-raised text-fg-secondary";
  const Icono = aviso.severidad === "grave" ? ShieldAlert : aviso.severidad === "aviso" ? CircleAlert : null;

  return (
    <li className={cn("strappy-slide-up flex gap-3 rounded-xl border-2 px-4 py-3", tono)}>
      {Icono && <Icono size={18} className="mt-0.5 shrink-0" aria-hidden />}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-display text-sm font-semibold">{aviso.titulo}</p>
        <p className="text-sm text-fg-secondary">{aviso.cuerpo}</p>
        {aviso.propuesta && <p className="text-2xs text-fg-muted">{aviso.propuesta}</p>}
      </div>
    </li>
  );
}
