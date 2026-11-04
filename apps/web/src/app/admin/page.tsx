import {
  Building2,
  CircleDollarSign,
  Coins,
  HandCoins,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Card, CardBody, CardDescription, CardHeader, CardTitle, EncabezadoPagina } from "@strappy/ui";
import { GraficoVentas } from "@/components/admin/grafico-ventas";
import { creditosCompactos, dolares } from "@/lib/negocio/creditos";
import { exigirSuperAdmin } from "@/lib/plataforma/acceso";
import { estadisticasDeVenta } from "@/lib/plataforma/estadisticas";
import { mesCorto } from "@/lib/plataforma/meses";

export const metadata = { title: "Ventas · Super admin" };

const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

/** La misma tarjeta que los indicadores de Analítica. */
function Cifra({
  etiqueta,
  valor,
  nota,
  icono: Icono,
}: {
  etiqueta: string;
  valor: string;
  nota?: React.ReactNode;
  icono: LucideIcon;
}) {
  return (
    <Card className="strappy-slide-up transition-colors duration-[var(--dur-fast)] hover:border-border-strong">
      <CardBody className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-fg-secondary">{etiqueta}</span>
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-fg">
            <Icono size={16} strokeWidth={1.75} aria-hidden />
          </span>
        </div>
        <p className="text-2xl font-semibold tracking-tight text-fg tabular-nums">{valor}</p>
        {nota && <p className="flex items-center gap-1 text-2xs text-fg-muted">{nota}</p>}
      </CardBody>
    </Card>
  );
}

export default async function PaginaVentas() {
  await exigirSuperAdmin();
  const e = await estadisticasDeVenta();
  const tasa = e.espacios.total > 0 ? Math.round((e.espacios.pagaron / e.espacios.total) * 100) : 0;
  const recientes = [...e.meses].reverse().filter((m) => m.recargas > 0);

  return (
    <>
      <EncabezadoPagina
        titulo="Ventas"
        descripcion="Recargas aprobadas por Wompi. Los créditos dados a mano no cuentan como venta."
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Este mes">
        <Cifra
          etiqueta="Ventas este mes" icono={CircleDollarSign}
          valor={dolares(e.actual.usd)}
          nota={
            e.variacionMes === null ? (
              "Sin mes anterior con ventas"
            ) : (
              <>
                {e.variacionMes >= 0 ? (
                  <TrendingUp size={13} strokeWidth={2} aria-hidden />
                ) : (
                  <TrendingDown size={13} strokeWidth={2} aria-hidden />
                )}
                {`${e.variacionMes >= 0 ? "+" : ""}${Math.round(e.variacionMes * 100)} % frente al mes anterior`}
              </>
            )
          }
        />
        <Cifra etiqueta="Clientes que pagaron este mes" icono={UserCheck} valor={String(e.actual.clientes)} nota={`${e.actual.recargas} recargas`} />
        <Cifra etiqueta="Ventas totales" icono={HandCoins} valor={dolares(e.ventasTotalUsd)} nota={`Recarga media: ${dolares(e.ticketMedioUsd)}`} />
        <Cifra
          etiqueta="De recarga automática este mes" icono={RefreshCw}
          valor={dolares(e.automaticasMesUsd)}
          nota={`${e.espacios.conAutomatica} espacios la tienen encendida`}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Ventas por mes</CardTitle>
          <CardDescription>Últimos 12 meses, en dólares, según el mes en Colombia.</CardDescription>
        </CardHeader>
        <CardBody>
          <GraficoVentas meses={e.meses} />
        </CardBody>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Clientes y créditos">
        <Cifra
          etiqueta="Espacios" icono={Building2}
          valor={String(e.espacios.total)}
          nota={`${e.espacios.nuevosMes} ${e.espacios.nuevosMes === 1 ? "nuevo" : "nuevos"} este mes · ${e.espacios.suspendidos} ${e.espacios.suspendidos === 1 ? "suspendido" : "suspendidos"}`}
        />
        <Cifra etiqueta="Han pagado alguna vez" icono={Users} valor={String(e.espacios.pagaron)} nota={`${tasa} % de los espacios`} />
        <Cifra
          etiqueta="Créditos este mes" icono={Coins}
          valor={creditosCompactos(e.creditos.consumidosMes)}
          nota={`consumidos · ${creditosCompactos(e.creditos.vendidosMes)} vendidos`}
        />
        <Cifra
          etiqueta="Créditos sin gastar" icono={Wallet}
          valor={creditosCompactos(e.creditos.saldoVivo)}
          nota="Lo que los clientes aún pueden consumir"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Detalle por mes</CardTitle>
          </CardHeader>
          <CardBody>
            {recientes.length === 0 ? (
              <p className="text-sm text-fg-muted">Todavía no hay ventas.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-2xs tracking-wide text-fg-muted uppercase">
                    <th scope="col" className="py-2 text-left font-medium">Mes</th>
                    <th scope="col" className="py-2 text-right font-medium">USD</th>
                    <th scope="col" className="py-2 text-right font-medium">COP</th>
                    <th scope="col" className="py-2 text-right font-medium">Recargas</th>
                    <th scope="col" className="py-2 text-right font-medium">Clientes</th>
                  </tr>
                </thead>
                <tbody>
                  {recientes.map((m) => (
                    <tr key={m.mes} className="border-b border-[var(--border-subtle)] tabular-nums">
                      <th scope="row" className="py-2 text-left font-normal text-fg">{mesCorto(m.mes)}</th>
                      <td className="py-2 text-right text-fg">{dolares(m.usd)}</td>
                      <td className="py-2 text-right text-fg-secondary">{PESOS.format(m.pesos)}</td>
                      <td className="py-2 text-right text-fg-secondary">{m.recargas}</td>
                      <td className="py-2 text-right text-fg-secondary">{m.clientes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mejores clientes</CardTitle>
            <CardDescription>Por ventas de los últimos 12 meses.</CardDescription>
          </CardHeader>
          <CardBody>
            {e.mejores.length === 0 ? (
              <p className="text-sm text-fg-muted">Todavía no hay ventas.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-[var(--border-subtle)]">
                {e.mejores.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link href={`/admin/clientes/${c.id}`} className="truncate text-fg underline-offset-2 hover:underline">
                      {c.nombre}
                    </Link>
                    <span className="tabular-nums text-fg">{dolares(c.usd)}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
