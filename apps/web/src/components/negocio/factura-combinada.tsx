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
 * Aquí los tres sumandos aparecen desglosados y sumados en el mismo sitio. Y
 * ninguno de ellos es el gasto de Meta: eso lo cobra Meta directamente y tiene
 * su propia tarjeta, con su propio aviso.
 */
export function FacturaCombinada({
  factura,
  agentes,
}: {
  factura: ResumenFactura;
  agentes: readonly AgenteContratado[];
}) {
  const activos = agentes.filter((a) => a.estado === "active");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lo que pagas este mes</CardTitle>
        <CardDescription>
          Tu plan, los agentes que tienes contratados y lo que hayas recargado. Todo junto, sin
          sorpresas al final del periodo.
        </CardDescription>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-fg-secondary">Plan {factura.plan.nombre}</dt>
            <dd className="tabular-nums text-fg">{dolares(factura.planUsd)}</dd>
          </div>

          {activos.length === 0 ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-fg-secondary">Agentes contratados</dt>
              <dd className="text-fg-muted">Ninguno todavía</dd>
            </div>
          ) : (
            activos.map((a) => (
              <div key={a.slug} className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-fg-secondary">
                  {a.nombre}
                  <Badge tone="ia">Contratado</Badge>
                </dt>
                <dd className="tabular-nums text-fg">
                  {a.costeUsd > 0 ? dolares(a.costeUsd) : "Incluido en tu plan"}
                </dd>
              </div>
            ))
          )}

          {factura.recargasUsd > 0 && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-fg-secondary">
                Recargas de crédito
                <span className="ml-2 text-2xs text-fg-muted">no caducan</span>
              </dt>
              <dd className="tabular-nums text-fg">{dolares(factura.recargasUsd)}</dd>
            </div>
          )}

          <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-3">
            <dt className="font-medium text-fg">Total de este periodo</dt>
            <dd className="text-xl font-semibold tabular-nums text-fg" data-total-factura={factura.totalUsd}>
              {dolares(factura.totalUsd)}
            </dd>
          </div>
        </dl>

        <p className="text-2xs text-fg-muted">
          Este total es lo que te cobramos nosotros. Lo que WhatsApp te cobra por la mensajería va
          aparte y lo factura Meta directamente a tu método de pago.
        </p>

        <div className="flex flex-wrap gap-2">
          <EnlaceBoton href="/ajustes/facturacion" variant="secondary" size="sm">
            Ver mi facturación
          </EnlaceBoton>
          <EnlaceBoton href="/contratar" variant="ghost" size="sm">
            Contratar otro agente
          </EnlaceBoton>
        </div>
      </CardBody>
    </Card>
  );
}
