import { Info, Receipt } from "lucide-react";
import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle } from "@strappy/ui";
import { EnlaceBoton } from "@/components/enlace-boton";
import { dolares } from "@/lib/negocio/creditos";
import type { AgenteContratado } from "@/lib/negocio/cartera";
import type { ResumenFactura } from "@/lib/negocio/factura";

/**
 * «¿Cuánto pago este mes?», respondido de un vistazo.
 *
 * Es la tarjeta que la competencia no tiene. En Dapta el plan está en una
 * pantalla, los add-ons en otra y el consumo en una tercera, así que la
 * pregunta —que es LA pregunta de quien firma— no se puede responder sin abrir
 * tres pestañas y sumar a mano.
 *
 * Por eso el total va ARRIBA y en grande, y el desglose debajo: primero la
 * respuesta, después la cuenta. Ninguno de los sumandos es el gasto de Meta:
 * eso lo cobra Meta directamente y tiene su propia tarjeta, con su propio aviso.
 */
export function FacturaCombinada({
  factura,
  agentes,
  enFacturacion = false,
  className,
}: {
  factura: ResumenFactura;
  agentes: readonly AgenteContratado[];
  /** Ya estamos en Facturación: el enlace a sí misma sobra. */
  enFacturacion?: boolean;
  className?: string;
}) {
  const activos = agentes.filter((a) => a.estado === "active");

  return (
    <Card className={["strappy-slide-up flex flex-col", className].filter(Boolean).join(" ")}>
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Lo que pagas este mes</CardTitle>
          <span className="grid size-8 place-items-center rounded-lg bg-hover text-fg-secondary">
            <Receipt size={16} strokeWidth={1.75} aria-hidden />
          </span>
        </div>
        <p className="text-3xl font-semibold tracking-tight text-fg tabular-nums" data-total-factura={factura.totalUsd}>
          {dolares(factura.totalUsd)}
        </p>
        <CardDescription>Tu plan, tus agentes y lo que hayas recargado. Sin sorpresas.</CardDescription>
      </CardHeader>
      <CardBody className="flex flex-1 flex-col gap-4">
        <dl className="flex flex-col divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-inset text-sm">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <dt className="text-fg-secondary">Plan {factura.plan.nombre}</dt>
            <dd className="tabular-nums text-fg">{dolares(factura.planUsd)}</dd>
          </div>

          {activos.length === 0 ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <dt className="text-fg-secondary">Agentes contratados</dt>
              <dd className="text-fg-muted">Ninguno todavía</dd>
            </div>
          ) : (
            activos.map((a) => (
              <div key={a.slug} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <dt className="flex items-center gap-2 text-fg-secondary">
                  {a.nombre}
                  <Badge tone="ia">Contratado</Badge>
                </dt>
                <dd className="tabular-nums text-fg">
                  {a.costeUsd > 0 ? dolares(a.costeUsd) : "Incluido"}
                </dd>
              </div>
            ))
          )}

          {factura.recargasUsd > 0 && (
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <dt className="text-fg-secondary">
                Recargas de crédito
                <span className="ml-2 text-2xs text-fg-muted">no caducan</span>
              </dt>
              <dd className="tabular-nums text-fg">{dolares(factura.recargasUsd)}</dd>
            </div>
          )}
        </dl>

        <p className="flex items-start gap-2 text-2xs text-fg-muted">
          <Info size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
          No incluye lo que Meta te cobra por WhatsApp: eso lo factura Meta aparte.
        </p>

        <div className="mt-auto flex flex-wrap gap-2">
          {!enFacturacion && (
            <EnlaceBoton href="/ajustes/facturacion" variant="secondary" size="sm">
              Ver mi facturación
            </EnlaceBoton>
          )}
          <EnlaceBoton href="/contratar" variant="ghost" size="sm">
            Contratar otro agente
          </EnlaceBoton>
        </div>
      </CardBody>
    </Card>
  );
}
