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
  consumidos: number;
  total: number;
  /** Fecha de renovación ya formateada, p. ej. "3 de septiembre". */
  renovacion: string;
  onAmpliar?: () => void;
  colapsado?: boolean;
}

/** Por encima de este consumo el widget deja de solo informar y pide atención. */
const UMBRAL_AVISO = 0.85;

/**
 * Widget de créditos. Informa; no vende.
 * Solo cuando el consumo pasa del 85 % se vuelve persuasivo, y entonces lo hace
 * con un borde de aviso, no con un mensaje comercial.
 */
export function CreditsWidget({
  consumidos,
  total,
  renovacion,
  onAmpliar,
  colapsado,
  className,
  ...props
}: CreditsWidgetProps) {
  const proporcion = total > 0 ? Math.min(consumidos / total, 1) : 0;
  const avisando = proporcion >= UMBRAL_AVISO;
  const porcentaje = Math.round(proporcion * 100);

  if (colapsado) {
    return (
      <div
        className={cn("px-2 py-3", className)}
        title={`${porcentaje} % de créditos consumidos`}
        {...props}
      >
        <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--border-default)]">
          <div
            className={cn("h-full rounded-full", avisando ? "bg-warning" : "bg-primary")}
            style={{ width: `${porcentaje}%` }}
          />
        </div>
        <span className="sr-only">{`${porcentaje} % de créditos consumidos`}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "textura flex flex-col gap-2 rounded-lg border-2 bg-raised p-3 shadow-e1",
        avisando ? "border-[var(--warning)]" : "border-border",
        props.onClick &&
          "cursor-pointer transition-colors duration-[var(--dur-fast)] hover:border-border-strong hover:bg-hover",
        className,
      )}
      {...(props.onClick ? { role: "link", tabIndex: 0, title: "Ver consumo y plan" } : {})}
      {...props}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-fg-secondary">Créditos</span>
        <span className="tnum text-sm text-fg">
          {formatear(consumidos)} / {formatear(total)}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={consumidos}
        aria-valuetext={`${formatear(consumidos)} de ${formatear(total)} créditos, ${porcentaje} %`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border-default)]"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-[var(--dur-base)] ease-[var(--ease-out-quart)]",
            avisando ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${porcentaje}%` }}
        />
      </div>

      <p className="text-2xs text-fg-muted">
        {avisando
          ? `Te queda el ${100 - porcentaje} %. Se renueva el ${renovacion}.`
          : `Se renueva el ${renovacion}.`}
      </p>

      {/* Solo se ofrece ampliar cuando de verdad queda poco: antes es ruido comercial. */}
      {onAmpliar && avisando && (
        <Button
          variant="secondary"
          size="sm"
          onClick={(evento) => {
            evento.stopPropagation();
            onAmpliar();
          }}
          className="w-full"
        >
          Ampliar plan
        </Button>
      )}
    </div>
  );
}
