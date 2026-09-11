import { CheckCheck, Coins, Hourglass, PiggyBank, Repeat2, SearchX } from "lucide-react";
import { Card, CardBody, CardDescription, CardHeader, CardTitle, EmptyState, EncabezadoPagina } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { EnlaceBoton } from "@/components/enlace-boton";
import { SelectorFechas } from "@/components/negocio/selector-fechas";
import { VerComoTabla } from "@/components/negocio/tabla-equivalente";
import { ComoCalculamos } from "@/components/negocio/impacto/como-calculamos";
import { DesglosePorAgente, DesglosePorTipo } from "@/components/negocio/impacto/desglose";
import { GraficoImpacto } from "@/components/negocio/impacto/grafico-impacto";
import { TarjetaImpacto } from "@/components/negocio/impacto/tarjeta-impacto";
import { TarjetaTarifa } from "@/components/negocio/impacto/tarjeta-tarifa";
import { TrabajoReciente } from "@/components/negocio/impacto/trabajo-reciente";
import { datosDelMarco } from "@/lib/marco";
import { ajustesDelEspacio } from "@/lib/negocio/cartera";
import { etiquetaDeRango, rangoDesdeParametros } from "@/lib/negocio/fechas";
import { impactoDelNegocio } from "@/lib/negocio/impacto";
import {
  formatearDinero,
  formatearHoras,
  formatearRetorno,
  variacion,
} from "@/lib/negocio/impacto-calculo";

export const metadata = { title: "Impacto" };

// Cuenta encargos que terminan a lo largo del día: nada que prerenderizar.
export const dynamic = "force-dynamic";

type Parametros = Promise<{ atajo?: string; desde?: string; hasta?: string }>;

const PAPELES_QUE_EDITAN = new Set(["owner", "admin", "builder"]);
const ENTERO = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

/**
 * Impacto de los agentes del negocio: qué hicieron y cuánto le ahorraron al
 * negocio frente a hacerlo una persona.
 *
 * Arriba la respuesta (dinero ahorrado, destacado), debajo de dónde sale
 * (gráfica, desglose y encargos uno a uno) y al lado las dos cosas que la
 * hacen creíble: la tarifa, que pone el negocio, y la tabla del cálculo.
 */
export default async function PaginaImpacto({ searchParams }: { searchParams: Parametros }) {
  const parametros = await searchParams;
  const marco = await datosDelMarco();
  const espacio = await ajustesDelEspacio(marco.actual.workspaceId);
  const { rango, atajo } = rangoDesdeParametros(parametros, new Date(), espacio.zonaHoraria);
  const impacto = await impactoDelNegocio(marco.actual.workspaceId, rango, espacio.zonaHoraria);
  const { actual, anterior, ajustes } = impacto;
  const puedeEditar = PAPELES_QUE_EDITAN.has(marco.actual.rol);

  const dinero = (valor: number) => formatearDinero(valor, ajustes.moneda);
  const primerAgente = impacto.agentes[0];

  // El coste siempre en dólares, que es como se cobran los créditos; si la
  // moneda del negocio es otra y dijo cuánto vale el dólar, también en la suya.
  const costeEnMoneda =
    ajustes.moneda !== "USD" && ajustes.usdAMoneda ? actual.costeUsd * ajustes.usdAMoneda : null;

  return (
    <MarcoApp usuario={marco.usuario} creditos={marco.creditos} pendientes={marco.pendientes} titulo="Impacto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
        <EncabezadoPagina
          titulo="Impacto de tus agentes"
          descripcion={`${etiquetaDeRango(rango)} · Lo que hicieron tus agentes del negocio y cuánto te ahorraron frente a hacerlo una persona.`}
          acciones={impacto.agentes.length > 0 ? <SelectorFechas rango={rango} atajo={atajo} /> : undefined}
        />

        {impacto.agentes.length === 0 ? (
          <Card className="strappy-slide-up">
            <EmptyState
              title="Aún no tienes agentes del negocio"
              description="Contrata al Webmaster o a Marketing y aquí verás el trabajo que hacen por ti y cuánto te ahorran."
              action={<EnlaceBoton href="/contratar">Contratar agente</EnlaceBoton>}
            />
          </Card>
        ) : (
          <>
            <section aria-label="Resumen del periodo" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <TarjetaImpacto
                destacada
                className="sm:col-span-2"
                etiqueta="Dinero ahorrado"
                icono={PiggyBank}
                valor={dinero(actual.ahorro)}
                detalle={`Lo que habrías pagado a una persona por ${formatearHoras(actual.minutos)} de trabajo`}
                delta={variacion(actual.ahorro, anterior.ahorro)}
                anterior={dinero(anterior.ahorro)}
                explicacion={`Estimación: horas de trabajo × tu tarifa de ${dinero(ajustes.tarifaHora)} por hora.`}
              />
              <TarjetaImpacto
                etiqueta="Retorno"
                icono={Repeat2}
                valor={actual.retorno === null ? "—" : formatearRetorno(actual.retorno)}
                detalle={
                  actual.retorno !== null
                    ? "Por cada dólar en créditos"
                    : actual.costeUsd <= 0
                      ? "Sin gasto en este periodo"
                      : (
                          // Sin tipo de cambio no hay retorno: se lleva a donde se pone.
                          <a
                            href="#tarifa"
                            className="text-primary-fg underline decoration-dotted underline-offset-4 hover:decoration-solid"
                          >
                            Pon el valor del dólar para verlo
                          </a>
                        )
                }
                delta={
                  actual.retorno !== null && anterior.retorno !== null
                    ? variacion(actual.retorno, anterior.retorno)
                    : null
                }
                anterior={anterior.retorno === null ? "—" : formatearRetorno(anterior.retorno)}
                explicacion="Dinero ahorrado ÷ lo que costaron esos encargos en créditos."
              />
              <TarjetaImpacto
                etiqueta="Encargos terminados"
                icono={CheckCheck}
                valor={ENTERO.format(actual.completados)}
                delta={variacion(actual.completados, anterior.completados)}
                anterior={ENTERO.format(anterior.completados)}
                explicacion="Solo cuentan los terminados: los que fallaron o siguen en curso, no."
              />
              <TarjetaImpacto
                etiqueta="Horas ahorradas"
                icono={Hourglass}
                valor={formatearHoras(actual.minutos)}
                delta={variacion(actual.minutos, anterior.minutos)}
                anterior={formatearHoras(anterior.minutos)}
                explicacion="Lo que le habría llevado a una persona, según el tipo de trabajo."
              />
              <TarjetaImpacto
                etiqueta="Lo que costó"
                icono={Coins}
                valor={formatearDinero(actual.costeUsd, "USD")}
                detalle={`${ENTERO.format(actual.creditos)} créditos${
                  costeEnMoneda !== null ? ` · ≈ ${dinero(costeEnMoneda)}` : ""
                }`}
                delta={variacion(actual.costeUsd, anterior.costeUsd)}
                anterior={formatearDinero(anterior.costeUsd, "USD")}
                explicacion="Créditos gastados por esos encargos. 1.000 créditos = 1 USD."
              />
            </section>

            <div className="grid items-start gap-6 lg:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
                {actual.completados === 0 ? (
                  <Card className="strappy-slide-up">
                    <EmptyState
                      variant="sin-resultados"
                      size="sm"
                      title="Ningún encargo terminado en este periodo"
                      description="Prueba con otro rango de fechas o pídele algo a tu agente: cada encargo terminado suma aquí."
                      action={
                        primerAgente ? (
                          <EnlaceBoton href={`/agentes/${primerAgente.id}/probar`}>
                            Hacer un encargo a {primerAgente.nombre}
                          </EnlaceBoton>
                        ) : undefined
                      }
                    />
                  </Card>
                ) : (
                  <>
                    <Card className="strappy-slide-up">
                      <CardHeader>
                        <CardTitle>Trabajo y ahorro en el tiempo</CardTitle>
                        <CardDescription>
                          Encargos terminados cada día y el ahorro que llevas acumulado en el periodo.
                        </CardDescription>
                      </CardHeader>
                      <CardBody>
                        <GraficoImpacto
                          moneda={ajustes.moneda}
                          datos={impacto.serie.map((p) => ({
                            dia: p.dia,
                            completados: p.completados,
                            ahorroAcumulado: Math.round(p.ahorroAcumulado * 100) / 100,
                          }))}
                        />
                        <VerComoTabla
                          titulo="Encargos y ahorro por día"
                          columnas={[
                            { clave: "dia", etiqueta: "Día" },
                            { clave: "completados", etiqueta: "Encargos", numerica: true },
                            { clave: "ahorro", etiqueta: "Ahorro del día", numerica: true },
                            { clave: "acumulado", etiqueta: "Acumulado", numerica: true },
                          ]}
                          filas={impacto.serie.map((p) => ({
                            dia: p.dia,
                            completados: p.completados,
                            ahorro: dinero(p.ahorro),
                            acumulado: dinero(p.ahorroAcumulado),
                          }))}
                        />
                      </CardBody>
                    </Card>

                    <div className="grid items-start gap-6 md:grid-cols-2">
                      <DesglosePorAgente resumen={impacto} agentes={impacto.agentes} ajustes={ajustes} />
                      <DesglosePorTipo resumen={impacto} ajustes={ajustes} />
                    </div>

                    <TrabajoReciente
                      encargos={impacto.recientes}
                      agentes={impacto.agentes}
                      ajustes={ajustes}
                      zonaHoraria={espacio.zonaHoraria}
                      enCurso={impacto.enCurso}
                      fallidos={impacto.fallidos}
                    />
                  </>
                )}
              </div>

              <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-20">
                <TarjetaTarifa ajustes={ajustes} puedeEditar={puedeEditar} />
                <ComoCalculamos ajustes={ajustes} />
                {actual.completados === 0 && (impacto.enCurso > 0 || impacto.fallidos > 0) ? (
                  <p className="flex items-center gap-2 px-1 text-sm text-fg-muted">
                    <SearchX size={16} strokeWidth={1.75} aria-hidden />
                    {impacto.enCurso > 0 ? `${impacto.enCurso} en curso` : ""}
                    {impacto.enCurso > 0 && impacto.fallidos > 0 ? " · " : ""}
                    {impacto.fallidos > 0 ? `${impacto.fallidos} sin terminar` : ""}
                  </p>
                ) : null}
              </aside>
            </div>
          </>
        )}
      </div>
    </MarcoApp>
  );
}
