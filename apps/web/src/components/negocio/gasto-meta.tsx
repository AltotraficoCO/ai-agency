import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle } from "@strappy/ui";
import { VerComoTabla } from "./tabla-equivalente";
import { dolares } from "@/lib/negocio/creditos";
import type { GastoEnMeta } from "@/lib/negocio/meta";

/**
 * «Tu gasto en Meta».
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ESTE BLOQUE NUNCA SE SUMA AL DE STRAPPY
 * ════════════════════════════════════════════════════════════════════════════
 * Somos Tech Provider: la cuenta de WhatsApp es del cliente, su método de pago
 * está en su Meta Business Manager y Meta le cobra a él. Nosotros no revendemos
 * mensajería —la tarifa `message_out` está a cero en `credit_rates` por eso—.
 *
 * Se lo enseñamos porque, si no, ve un cargo de Meta y cree que se lo hicimos
 * nosotros. Y lo enseñamos APARTE, en dólares y con el aviso escrito, porque si
 * lo sumáramos a los créditos creería que se lo cobramos dos veces.
 *
 * Las dos confusiones cuestan lo mismo: un ticket y la sospecha de que la
 * factura está inflada.
 */
export function TarjetaGastoMeta({ gasto }: { gasto: GastoEnMeta }) {
  return (
    <Card className="border-dashed">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Tu gasto en Meta</CardTitle>
          <CardDescription>
            Lo que WhatsApp te cobra por la mensajería, leído de tu propia cuenta.
          </CardDescription>
        </div>
        <Badge tone="info">Lo cobra Meta</Badge>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {!gasto.hayDatos ? (
          <p className="text-sm text-fg-muted">
            Todavía no hay datos de tu cuenta de WhatsApp en este periodo. En cuanto conectes tu número
            y empiecen las conversaciones, aquí verás lo que Meta te factura.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight text-fg tabular-nums">
                {dolares(gasto.costeUsd)}
              </span>
              <span className="text-sm text-fg-secondary">
                en {gasto.conversaciones.toLocaleString("es-CO")} conversaciones de WhatsApp
              </span>
            </div>

            {gasto.porCategoria.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {gasto.porCategoria.slice(0, 6).map((c) => (
                  <li key={c.categoria} className="flex items-center justify-between gap-3">
                    <span className="text-fg-secondary">{c.etiqueta}</span>
                    <span className="tabular-nums text-fg">{dolares(c.costeUsd)}</span>
                  </li>
                ))}
              </ul>
            )}

            <VerComoTabla
              titulo="Gasto en Meta, día a día"
              columnas={[
                { clave: "dia", etiqueta: "Día" },
                { clave: "conversaciones", etiqueta: "Conversaciones", numerica: true },
                { clave: "coste", etiqueta: "Coste (USD)", numerica: true },
                { clave: "estado", etiqueta: "Estado" },
              ]}
              filas={gasto.serie.map((p) => ({
                dia: p.dia,
                conversaciones: p.conversaciones,
                coste: dolares(p.costeUsd),
                estado: p.provisional ? "Provisional" : "Consolidado",
              }))}
            />
          </>
        )}

        <p className="rounded-lg bg-info-soft px-3 py-2 text-2xs text-info-fg">{gasto.aviso}</p>
      </CardBody>
    </Card>
  );
}
