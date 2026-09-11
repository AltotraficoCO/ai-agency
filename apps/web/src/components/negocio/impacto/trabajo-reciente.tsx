import Link from "next/link";
import { ChevronRight, Clock3 } from "lucide-react";
import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle } from "@strappy/ui";
import {
  TRABAJOS,
  formatearDinero,
  formatearHoras,
  type AjustesImpacto,
  type EncargoConImpacto,
} from "@/lib/negocio/impacto-calculo";
import type { AgenteDelNegocio } from "@/lib/negocio/impacto";
import { CaraAgente } from "./desglose";

/**
 * Los últimos encargos terminados, cada uno con lo que ahorró.
 *
 * Es la prueba de las cifras de arriba: el total deja de ser un número mágico
 * cuando se ve de qué encargos sale. Cada fila lleva a la conversación con el
 * agente, donde está el registro de lo que hizo paso a paso.
 */
export function TrabajoReciente({
  encargos,
  agentes,
  ajustes,
  zonaHoraria,
  enCurso,
  fallidos,
}: {
  encargos: readonly EncargoConImpacto[];
  agentes: readonly AgenteDelNegocio[];
  ajustes: AjustesImpacto;
  zonaHoraria: string;
  enCurso: number;
  fallidos: number;
}) {
  const fecha = new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: zonaHoraria,
  });

  return (
    <Card className="strappy-slide-up">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle>Trabajo reciente</CardTitle>
            <CardDescription>Cada encargo terminado, con el tiempo y el dinero que te ahorró.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {enCurso > 0 ? (
              <Badge tone="info">
                {enCurso} en curso
              </Badge>
            ) : null}
            {fallidos > 0 ? (
              <Badge tone="aviso" title="Los encargos que no terminaron no cuentan como ahorro.">
                {fallidos} sin terminar · no cuentan
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardBody className="px-2 pt-0 sm:px-3">
        <ul className="flex flex-col">
          {encargos.map((encargo) => {
            const agente = agentes.find((a) => a.id === encargo.agenteId);
            const contenido = (
              <>
                {agente ? (
                  <CaraAgente slug={agente.slug} nombre={agente.nombre} tamano={36} />
                ) : (
                  <span className="size-9 shrink-0" />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate font-medium text-fg">{encargo.titulo}</span>
                  <div className="flex flex-wrap items-center gap-1.5 text-2xs text-fg-muted">
                    <span>
                      {agente?.nombre ?? "Agente"} · {fecha.format(new Date(encargo.terminado))}
                    </span>
                    {encargo.tipos.map((tipo) => (
                      <Badge key={tipo} tone="neutral">
                        {TRABAJOS[tipo].etiqueta}
                      </Badge>
                    ))}
                    {encargo.porTitulo ? (
                      <span title="Este encargo no guardó sus pasos: lo estimamos por lo que pediste.">
                        · estimado por el título
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                  <span className="font-semibold text-primary-fg tabular-nums">
                    {formatearDinero(encargo.ahorro, ajustes.moneda)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-2xs text-fg-muted tabular-nums">
                    <Clock3 size={12} strokeWidth={2} aria-hidden />
                    {formatearHoras(encargo.minutos)}
                  </span>
                </div>
              </>
            );
            const clase =
              "flex items-center gap-3 rounded-lg px-2 py-3 transition-colors duration-[var(--dur-fast)] sm:px-3";
            return (
              <li key={encargo.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
                {encargo.agenteId ? (
                  <Link href={`/agentes/${encargo.agenteId}/probar`} className={`${clase} group hover:bg-hover`}>
                    {contenido}
                    <ChevronRight
                      size={16}
                      strokeWidth={1.75}
                      className="shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                ) : (
                  <div className={clase}>{contenido}</div>
                )}
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
