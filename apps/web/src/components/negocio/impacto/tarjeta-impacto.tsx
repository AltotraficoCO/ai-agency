import { Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { Card, CardBody, cn } from "@strappy/ui";

/**
 * Tarjeta de una cifra del Impacto.
 *
 * Es la hermana de `TarjetaIndicador` de Analítica, con dos diferencias: el
 * valor llega ya formateado (aquí hay dinero en la moneda del negocio, horas y
 * veces, no solo enteros) y una de ellas, el dinero ahorrado, va DESTACADA:
 * es la respuesta a la pregunta con la que la persona abre la pantalla.
 *
 * Igual que en Analítica, el delta nunca va solo: lleva escrito contra qué se
 * compara, y la flecha dice lo mismo que el color.
 */
export function TarjetaImpacto({
  etiqueta,
  valor,
  icono: Icono,
  delta,
  anterior,
  explicacion,
  detalle,
  destacada = false,
  className,
}: {
  etiqueta: string;
  valor: string;
  icono: LucideIcon;
  /** Variación contra el periodo anterior; null si no había base. */
  delta: number | null;
  /** El valor del periodo anterior, ya formateado. */
  anterior: string;
  explicacion: string;
  /** Una segunda línea bajo la cifra: «1.240 créditos», «≈ $ 48.000». */
  detalle?: React.ReactNode;
  destacada?: boolean;
  className?: string;
}) {
  const porcentaje = delta === null ? 0 : Math.abs(Math.round(delta * 100));
  const Flecha = delta === null || porcentaje === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;

  return (
    <Card
      className={cn(
        "strappy-slide-up transition-colors duration-[var(--dur-fast)] hover:border-border-strong",
        destacada && "border-[color-mix(in_oklab,var(--brand),transparent_55%)] shadow-marca",
        className,
      )}
    >
      <CardBody className={cn("flex h-full flex-col gap-3 p-4", destacada && "sm:p-6")}>
        <div className="flex items-center justify-between gap-2">
          <span className={cn("text-sm text-fg-secondary", destacada && "font-medium text-fg")}>{etiqueta}</span>
          <span
            className={cn(
              "grid place-items-center rounded-lg bg-primary-soft text-primary-fg",
              destacada ? "size-10" : "size-8",
            )}
          >
            <Icono size={destacada ? 20 : 16} strokeWidth={1.75} aria-hidden />
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span
            className={cn(
              "font-semibold tracking-tight tabular-nums",
              destacada ? "text-4xl text-primary-fg sm:text-5xl" : "text-3xl text-fg",
            )}
          >
            {valor}
          </span>
          {detalle ? <span className="text-sm text-fg-muted tabular-nums">{detalle}</span> : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs">
          {delta === null ? (
            <span className="text-fg-muted">Sin datos del periodo anterior</span>
          ) : (
            <>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium tabular-nums",
                  delta >= 0 ? "bg-success-soft text-success-fg" : "bg-danger-soft text-danger-fg",
                )}
              >
                <Flecha size={12} strokeWidth={2.25} aria-hidden />
                {porcentaje}%
              </span>
              <span className="text-fg-muted">frente a {anterior} el periodo anterior</span>
            </>
          )}
        </div>

        <p className="mt-auto border-t border-[var(--border-subtle)] pt-2 text-2xs text-fg-muted">{explicacion}</p>
      </CardBody>
    </Card>
  );
}
