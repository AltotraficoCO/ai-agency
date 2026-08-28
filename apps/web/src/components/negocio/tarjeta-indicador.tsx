import { Card, CardBody } from "@strappy/ui";
import type { Indicador } from "@/lib/negocio/analitica";

/**
 * Tarjeta de indicador con delta contra el periodo anterior.
 *
 * El delta lleva SIEMPRE la comparación escrita al lado («frente a 128 el
 * periodo anterior»). Un «+12%» suelto no dice sobre qué, y sobre una base
 * pequeña engaña: pasar de 8 a 9 también es «+12%».
 *
 * Para el tiempo de primera respuesta, bajar es bueno: el color del delta lo
 * decide `mejorEsMenor`, no el signo.
 */
export function TarjetaIndicador({ indicador }: { indicador: Indicador }) {
  const bueno =
    indicador.delta === null
      ? null
      : indicador.mejorEsMenor
        ? indicador.delta <= 0
        : indicador.delta >= 0;

  return (
    <Card>
      <CardBody className="flex flex-col gap-1 pt-4">
        <span className="text-sm text-fg-secondary">{indicador.etiqueta}</span>
        <span className="text-3xl font-semibold tracking-tight text-fg tabular-nums">
          {formatear(indicador.valor, indicador.formato)}
        </span>
        <span className="text-2xs text-fg-muted">
          {indicador.delta === null ? (
            "Sin datos del periodo anterior"
          ) : (
            <>
              <span className={bueno ? "text-success-fg" : "text-danger-fg"}>
                {indicador.delta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(indicador.delta * 100))}%
              </span>{" "}
              frente a {formatear(indicador.anterior, indicador.formato)} el periodo anterior
            </>
          )}
        </span>
        <span className="mt-1 text-2xs text-fg-muted">{indicador.explicacion}</span>
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
