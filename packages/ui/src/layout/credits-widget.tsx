"use client";

import { cn } from "../lib/cn";
import { Button } from "../components/button";

const decimal = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });

/** 12 400 → "12,4 K". Los miles se abrevian; por debajo se muestra la cifra exacta. */
function formatear(valor: number): string {
  if (valor < 1000) return decimal.format(valor);
  return `${decimal.format(Math.round(valor / 100) / 10)} K`;
}

export interface CreditsWidgetProps extends React.HTMLAttributes<HTMLDivElement> {
  disponibles: number;
  /** El saldo bajó del umbral de aviso del espacio. */
  pocos: boolean;
  onRecargar?: () => void;
  colapsado?: boolean;
}

/**
 * Widget de créditos. Informa; no vende.
 * El crédito es prepago: lo único que importa es cuánto queda. Solo con poco
 * saldo pide atención, y lo hace con un borde de aviso, no con un mensaje comercial.
 */
export function CreditsWidget({
  disponibles,
  pocos,
  onRecargar,
  colapsado,
  className,
  ...props
}: CreditsWidgetProps) {
  const texto = `${formatear(disponibles)} créditos disponibles`;

  if (colapsado) {
    return (
      <div className={cn("px-2 py-3", className)} title={texto} {...props}>
        <div className={cn("h-1 w-full rounded-full", pocos ? "bg-warning" : "bg-primary")} />
        <span className="sr-only">{texto}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "textura flex flex-col gap-2 rounded-lg border-2 bg-raised p-3 shadow-e1",
        pocos ? "border-[var(--warning)]" : "border-border",
        props.onClick &&
          "cursor-pointer transition-colors duration-[var(--dur-fast)] hover:border-border-strong hover:bg-hover",
        className,
      )}
      {...(props.onClick ? { role: "link", tabIndex: 0, title: "Ver saldo y recargar" } : {})}
      {...props}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-fg-secondary">Créditos</span>
        <span className="tnum text-sm text-fg">{formatear(disponibles)}</span>
      </div>

      <p className="text-2xs text-fg-muted">{pocos ? "Te queda poco saldo." : "Disponibles. No caducan."}</p>

      {onRecargar && pocos && (
        <Button
          variant="secondary"
          size="sm"
          onClick={(evento) => {
            evento.stopPropagation();
            onRecargar();
          }}
          className="w-full"
        >
          Recargar
        </Button>
      )}
    </div>
  );
}
