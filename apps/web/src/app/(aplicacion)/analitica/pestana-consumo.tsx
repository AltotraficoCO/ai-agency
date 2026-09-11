import { Coins, MessageCircle } from "lucide-react";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@strappy/ui";
import { BarraConsumo } from "@/components/negocio/barra-consumo";
import { FacturaCombinada } from "@/components/negocio/factura-combinada";
import { TarjetaGastoMeta } from "@/components/negocio/gasto-meta";
import { VerComoTabla } from "@/components/negocio/tabla-equivalente";
import { creditosCompactos, creditosEnDolares } from "@/lib/negocio/creditos";
import type { AnaliticaStrappy } from "@/lib/negocio/analitica";
import type { EstadoNegocio } from "@/lib/negocio/cartera";
import type { GastoEnMeta } from "@/lib/negocio/meta";

/**
 * La pantalla que evita la factura sorpresa.
 *
 * Está partida en DOS BLOQUES QUE JAMÁS SE MEZCLAN y se anuncian como tales:
 *
 *   · «Tu consumo en Strappy» — créditos de IA, que sí facturamos nosotros.
 *   · «Tu gasto en Meta»      — dólares que Meta cobra directamente al cliente.
 *
 * No hay ninguna cifra que los sume, y no debe haberla nunca. Si un día alguien
 * añade un «total general», habrá convertido el argumento comercial más fuerte
 * del producto —«la mensajería la pagas a Meta, no a nosotros»— en la queja más
 * frecuente del soporte.
 */
export function PestanaConsumo({
  analitica,
  negocio,
  meta,
}: {
  analitica: AnaliticaStrappy;
  negocio: EstadoNegocio;
  meta: GastoEnMeta;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <header className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-fg">
            <Coins size={18} strokeWidth={1.75} aria-hidden />
          </span>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-fg">Tu consumo en Strappy</h2>
            <p className="text-sm text-fg-secondary">
              Créditos de inteligencia artificial. Es lo único que te facturamos por uso.
            </p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Créditos del periodo</CardTitle>
            <CardDescription>
              Del {formatoFecha(negocio.cartera.inicioPeriodo)} al {formatoFecha(negocio.cartera.finPeriodo)}.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <BarraConsumo
              proyeccion={negocio.cartera.proyeccion}
              segmentos={analitica.consumoPorAgente}
            />
          </CardBody>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>En qué se van tus créditos</CardTitle>
              <CardDescription>Desglose del periodo seleccionado, por concepto.</CardDescription>
            </CardHeader>
            <CardBody>
              {analitica.consumoPorConcepto.length === 0 ? (
                <p className="text-sm text-fg-muted">Todavía no hay consumo en este periodo.</p>
              ) : (
                <table className="w-full text-sm">
                  <caption className="sr-only">Consumo de créditos por concepto</caption>
                  <thead>
                    <tr className="border-b border-border text-2xs tracking-wide text-fg-muted uppercase">
                      <th scope="col" className="py-2 text-left font-medium">
                        Concepto
                      </th>
                      <th scope="col" className="py-2 text-right font-medium">
                        Créditos
                      </th>
                      <th scope="col" className="py-2 text-right font-medium">
                        Equivale a
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {analitica.consumoPorConcepto.map((l) => (
                      <tr key={l.concepto} className="border-b border-[var(--border-subtle)]">
                        <th scope="row" className="py-2.5 text-left font-normal">
                          <span className="block text-fg">{l.etiqueta}</span>
                          <span className="block text-2xs text-fg-muted">{l.explicacion}</span>
                        </th>
                        <td className="py-2.5 text-right align-top tabular-nums text-fg">
                          {creditosCompactos(l.creditos)}
                        </td>
                        <td className="py-2.5 text-right align-top tabular-nums text-fg-secondary">
                          {creditosEnDolares(l.creditos)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <VerComoTabla
                titulo="Consumo por concepto"
                columnas={[
                  { clave: "etiqueta", etiqueta: "Concepto" },
                  { clave: "creditos", etiqueta: "Créditos", numerica: true },
                  { clave: "usd", etiqueta: "USD", numerica: true },
                ]}
                filas={analitica.consumoPorConcepto.map((l) => ({
                  etiqueta: l.etiqueta,
                  creditos: creditosCompactos(l.creditos),
                  usd: creditosEnDolares(l.creditos),
                }))}
              />
            </CardBody>
          </Card>

          <FacturaCombinada factura={negocio.factura} agentes={negocio.agentes} />
        </div>
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-8">
        <header className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-info-soft text-info-fg">
            <MessageCircle size={18} strokeWidth={1.75} aria-hidden />
          </span>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-fg">Tu gasto en Meta</h2>
            <p className="text-sm text-fg-secondary">
              Tu cuenta de WhatsApp es tuya y Meta te cobra a ti directamente. Te lo enseñamos aquí para que lo
              tengas todo en un sitio, pero nunca se suma a tu factura con nosotros.
            </p>
          </div>
        </header>
        <TarjetaGastoMeta gasto={meta} />
      </section>
    </div>
  );
}

const FECHA = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long" });

function formatoFecha(valor: Date): string {
  return FECHA.format(valor);
}
