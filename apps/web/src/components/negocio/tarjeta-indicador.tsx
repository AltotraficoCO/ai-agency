import {
  ChartColumn,
  MessageCircle,
  MessagesSquare,
  Minus,
  Timer,
  TrendingDown,
  TrendingUp,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Card, CardBody, cn } from "@strappy/ui";
import type { Indicador } from "@/lib/negocio/analitica";

/**
 * Tarjeta de indicador con delta contra el periodo anterior.
 *
 * El delta lleva SIEMPRE la comparación escrita al lado («frente a 128 el
 * periodo anterior»). Un «+12%» suelto no dice sobre qué, y sobre una base
 * pequeña engaña: pasar de 8 a 9 también es «+12%».
 *
 * Para el tiempo de primera respuesta, bajar es bueno: el color del delta lo
 * decide `mejorEsMenor`, no el signo. Y el color nunca va solo: la flecha dice
 * lo mismo para quien no distingue el verde del rojo.
 */
const ICONOS: Readonly<Record<string, LucideIcon>> = {
  conversaciones: MessagesSquare,
  mensajes: MessageCircle,
  contactos: UserPlus,
  primera_respuesta: Timer,
};

export function TarjetaIndicador({ indicador }: { indicador: Indicador }) {
  const bueno =
    indicador.delta === null
      ? null
      : indicador.mejorEsMenor
        ? indicador.delta <= 0
        : indicador.delta >= 0;
  const Icono = ICONOS[indicador.clave] ?? ChartColumn;
  const porcentaje = indicador.delta === null ? 0 : Math.abs(Math.round(indicador.delta * 100));
  const Flecha =
    indicador.delta === null || porcentaje === 0 ? Minus : indicador.delta > 0 ? TrendingUp : TrendingDown;

  return (
    <Card className="strappy-slide-up transition-colors duration-[var(--dur-fast)] hover:border-border-strong">
      <CardBody className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-fg-secondary">{indicador.etiqueta}</span>
          <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary-fg">
            <Icono size={16} strokeWidth={1.75} aria-hidden />
          </span>
        </div>

        <span className="text-3xl font-semibold tracking-tight text-fg tabular-nums">
          {formatear(indicador.valor, indicador.formato)}
        </span>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs">
          {indicador.delta === null ? (
            <span className="text-fg-muted">Sin datos del periodo anterior</span>
          ) : (
            <>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium tabular-nums",
                  bueno ? "bg-success-soft text-success-fg" : "bg-danger-soft text-danger-fg",
                )}
              >
                <Flecha size={12} strokeWidth={2.25} aria-hidden />
                {porcentaje}%
              </span>
              <span className="text-fg-muted">
                frente a {formatear(indicador.anterior, indicador.formato)} el periodo anterior
              </span>
            </>
          )}
        </div>

        <p className="border-t border-[var(--border-subtle)] pt-2 text-2xs text-fg-muted">
          {indicador.explicacion}
        </p>
      </CardBody>
    </Card>
  );
}

const ENTERO = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

export function formatear(valor: number, formato: Indicador["formato"]): string {
  if (formato === "duracion") return duracion(valor);
  return ENTERO.format(valor);
}

/** Milisegundos en la unidad que se lee de un vistazo: «1 min 20 s», no «80.000 ms». */
export function duracion(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const segundos = Math.round(ms / 1000);
  if (segundos < 60) return `${segundos} s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `${minutos} min ${segundos % 60} s`;
  const horas = Math.floor(minutos / 60);
  return `${horas} h ${minutos % 60} min`;
}
