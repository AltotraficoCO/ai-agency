/**
 * Piezas comunes de las pantallas de Ajustes.
 *
 * Todas las secciones se leen igual: título, una frase y la acción a la
 * derecha. Cuando cada tarjeta decide su propia forma, la persona tiene que
 * volver a aprender la pantalla cada vez que cambia de pestaña.
 *
 * Sin "use client": sirven igual en páginas de servidor y dentro de los
 * formularios de cliente.
 */
import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, Lock } from "lucide-react";
import { cn } from "@strappy/ui";

export function SeccionAjustes({
  titulo,
  descripcion,
  accion,
  icono,
  children,
  className,
}: {
  titulo: ReactNode;
  descripcion?: ReactNode;
  /** Lo que se hace en esta sección, a la derecha y siempre a la vista. */
  accion?: ReactNode;
  icono?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "strappy-slide-up rounded-xl border border-border bg-raised shadow-e1",
        className,
      )}
    >
      <header
        className={cn(
          "flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between",
          children ? "border-b border-[var(--border-subtle)]" : null,
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          {icono ? (
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-hover text-fg-secondary">
              {icono}
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-fg">{titulo}</h2>
            {descripcion ? <p className="mt-0.5 text-sm text-fg-secondary">{descripcion}</p> : null}
          </div>
        </div>
        {accion ? <div className="flex shrink-0 flex-wrap items-center gap-2">{accion}</div> : null}
      </header>
      {children ? <div className="px-5 py-5">{children}</div> : null}
    </section>
  );
}

type TonoAviso = "info" | "exito" | "error" | "aviso";

const ESTILO_AVISO: Record<TonoAviso, string> = {
  info: "border-border bg-inset text-fg-secondary",
  exito: "border-success/30 bg-success-soft text-success-fg",
  error: "border-danger/30 bg-danger-soft text-danger-fg",
  aviso: "border-warning/30 bg-warning-soft text-warning-fg",
};

/** Un aviso de una o dos líneas, con icono: el color nunca va solo. */
export function AvisoAjustes({
  tono = "info",
  children,
  className,
}: {
  tono?: TonoAviso;
  children: ReactNode;
  className?: string;
}) {
  const Icono = tono === "exito" ? CircleCheck : tono === "info" ? Info : CircleAlert;
  return (
    <div
      role={tono === "error" ? "alert" : "status"}
      className={cn(
        "strappy-fade-in flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm",
        ESTILO_AVISO[tono],
        className,
      )}
    >
      <Icono size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Para quien puede mirar pero no tocar: se dice antes de que lo intente. */
export function AvisoSoloLectura({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-inset px-3.5 py-2.5 text-sm text-fg-muted">
      <Lock size={14} strokeWidth={2} className="shrink-0" aria-hidden />
      {children}
    </p>
  );
}
