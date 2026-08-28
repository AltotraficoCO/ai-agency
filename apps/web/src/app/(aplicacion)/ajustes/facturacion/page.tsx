import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { BannerCreditos } from "@/components/negocio/banner-creditos";
import { BarraConsumo } from "@/components/negocio/barra-consumo";
import { FacturaCombinada } from "@/components/negocio/factura-combinada";
import { BotonPago, BotonPortal, FormularioLimites } from "@/components/negocio/formularios-ajustes";
import { datosDelMarco } from "@/lib/marco";
import { accionGuardarLimites } from "@/lib/negocio/acciones";
import { analiticaDeStrappy } from "@/lib/negocio/analitica";
import { ajustesDelEspacio, estadoDelNegocio } from "@/lib/negocio/cartera";
import { avisarSiHaceFalta } from "@/lib/negocio/avisos";
import { creditosCompactos, creditosEnDolares, dolares } from "@/lib/negocio/creditos";
import { clienteStripeDelEspacio } from "@/lib/negocio/facturacion";
import { diaEnZona, type RangoDias } from "@/lib/negocio/fechas";
import { PLANES, RECARGAS } from "@/lib/negocio/planes";
import { facturasDelCliente, hayStripe } from "@/lib/negocio/stripe";

export const metadata = { title: "Facturación" };
export const dynamic = "force-dynamic";

export default async function PaginaFacturacion() {
  const marco = await datosDelMarco();
  const espacio = await ajustesDelEspacio(marco.actual.workspaceId);
  const negocio = await estadoDelNegocio(marco.actual.workspaceId);

  // El consumo detallado se mira sobre el PERIODO DE FACTURACIÓN, no sobre los
  // últimos 30 días: es el periodo que el cliente va a ver en su factura.
  const rango: RangoDias = {
    desde: diaEnZona(negocio.cartera.inicioPeriodo, espacio.zonaHoraria),
    hasta: diaEnZona(new Date(), espacio.zonaHoraria),
  };

  const [analitica, cliente] = await Promise.all([
    analiticaDeStrappy(marco.actual.workspaceId, rango),
    clienteStripeDelEspacio(marco.actual.workspaceId),
  ]);
  const facturas = await facturasDelCliente(cliente);

  // Aviso del 80% / 100%: se dispara aquí y una sola vez por periodo. La página
  // no depende de ello para pintarse.
  await avisarSiHaceFalta({
    workspaceId: marco.actual.workspaceId,
    correo: marco.actual.correo,
    nombreEspacio: espacio.nombre,
    proyeccion: negocio.cartera.proyeccion,
    inicioPeriodo: negocio.cartera.inicioPeriodo,
  }).catch(() => null);

  const puedeEditar = marco.actual.rol === "owner" || marco.actual.rol === "admin";

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo="Facturación"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        <BannerCreditos estado={negocio.cartera.estado} proyeccion={negocio.cartera.proyeccion} />

        {!hayStripe() && (
          <p className="rounded-xl border border-dashed border-border bg-inset px-4 py-3 text-sm text-fg-secondary">
            Esta instalación todavía no tiene pasarela de pago configurada. Puedes ver tu plan y tu
            consumo con normalidad; los botones de pago te lo dirán al pulsarlos en vez de fallar.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div>
                <CardTitle>Tu plan</CardTitle>
                <CardDescription>
                  {negocio.plan.nombre} · {creditosCompactos(negocio.plan.creditosIncluidos)} créditos
                  al mes
                </CardDescription>
              </div>
              <Badge tone={negocio.estadoSuscripcion === "active" ? "exito" : "aviso"}>
                {ESTADO[negocio.estadoSuscripcion] ?? negocio.estadoSuscripcion}
              </Badge>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              <p className="text-sm text-fg-secondary">{negocio.plan.resumen}</p>
              <ul className="flex flex-col gap-1 text-sm text-fg-secondary">
                {negocio.plan.incluye.map((linea) => (
                  <li key={linea}>· {linea}</li>
                ))}
              </ul>
              <div className="flex flex-wrap items-start gap-2">{puedeEditar && <BotonPortal />}</div>
            </CardBody>
          </Card>

          <FacturaCombinada factura={negocio.factura} agentes={negocio.agentes} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Consumo del periodo</CardTitle>
            <CardDescription>
              Créditos de IA. Es lo único que te facturamos por uso: la mensajería de WhatsApp la cobra
              Meta directamente a tu cuenta.
            </CardDescription>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <BarraConsumo
              proyeccion={negocio.cartera.proyeccion}
              segmentos={analitica.consumoPorAgente}
            />
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-fg-muted">Saldo del plan</dt>
                <dd className="text-fg">{creditosCompactos(negocio.cartera.saldoIncluido)} créditos</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Saldo comprado</dt>
                <dd className="text-fg">
                  {creditosCompactos(negocio.cartera.saldoComprado)} créditos
                  <span className="ml-1 text-2xs text-fg-muted">no caduca</span>
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">Equivale a</dt>
                <dd className="text-fg">
                  {creditosEnDolares(negocio.cartera.saldoIncluido + negocio.cartera.saldoComprado)}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recargar créditos</CardTitle>
            <CardDescription>
              Se suman a tu saldo y no caducan: siguen ahí el mes que viene y el otro. Primero se gasta
              lo incluido en tu plan y solo después lo que compraste.
            </CardDescription>
          </CardHeader>
          <CardBody className="flex flex-wrap gap-3">
            {RECARGAS.map((r) => (
              <div
                key={r.clave}
                className="flex min-w-44 flex-col gap-2 rounded-lg border border-border p-3"
              >
                <span className="text-lg font-semibold text-fg">
                  {creditosCompactos(r.creditos)} créditos
                </span>
                <span className="text-sm text-fg-secondary">{dolares(r.precioUsd)}</span>
                {puedeEditar && <BotonPago cuerpo={{ recarga: r.clave }}>Recargar</BotonPago>}
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cambiar de plan</CardTitle>
            <CardDescription>Lo que cambia es cuántos créditos incluye cada mes.</CardDescription>
          </CardHeader>
          <CardBody className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {PLANES.map((p) => (
              <div
                key={p.clave}
                className={`flex flex-col gap-2 rounded-lg border p-3 ${
                  p.clave === negocio.plan.clave ? "border-[var(--brand)] bg-primary-soft" : "border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-fg">{p.nombre}</span>
                  {p.clave === negocio.plan.clave && <Badge tone="ia">Tu plan</Badge>}
                </div>
                <span className="text-sm text-fg-secondary">
                  {p.precioUsd === 0 ? "Gratis" : `${dolares(p.precioUsd)} al mes`}
                </span>
                <span className="text-2xs text-fg-muted">
                  {creditosCompactos(p.creditosIncluidos)} créditos al mes
                </span>
                {puedeEditar && p.clave !== negocio.plan.clave && p.precioUsd > 0 && (
                  <BotonPago cuerpo={{ plan: p.clave }} variant="secondary">
                    Cambiar
                  </BotonPago>
                )}
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Topes de gasto</CardTitle>
            <CardDescription>Qué pasa cuando el consumo se dispara o se acaba el saldo.</CardDescription>
          </CardHeader>
          <CardBody>
            <FormularioLimites
              accion={accionGuardarLimites}
              diario={negocio.limites.diario}
              porConversacion={negocio.limites.porConversacion}
              parada={negocio.limites.parada}
              puedeEditar={puedeEditar}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Facturas</CardTitle>
            <CardDescription>Las emite Stripe a nombre de tu organización.</CardDescription>
          </CardHeader>
          <CardBody>
            {facturas.length === 0 ? (
              <p className="text-sm text-fg-muted">
                Todavía no hay facturas. Aparecerán aquí en cuanto se cobre el primer periodo.
              </p>
            ) : (
              <ul className="flex flex-col">
                {facturas.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] py-2.5 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{f.numero}</span>
                    <span className="text-sm text-fg-secondary">{FECHA.format(new Date(f.fecha))}</span>
                    <span className="tabular-nums text-sm text-fg">{dolares(f.totalUsd)}</span>
                    {f.urlPdf && (
                      <a
                        href={f.urlPdf}
                        className="text-sm text-primary-fg underline decoration-dotted underline-offset-4"
                      >
                        PDF
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notificaciones</CardTitle>
            <CardDescription>Cuándo te escribimos por temas de consumo.</CardDescription>
          </CardHeader>
          <CardBody>
            <ul className="flex flex-col gap-2 text-sm text-fg-secondary">
              <li>
                <strong className="text-fg">Al 80% del saldo.</strong> Un aviso por correo y un banner
                ámbar, una sola vez por periodo.
              </li>
              <li>
                <strong className="text-fg">Al 100%.</strong> Aviso en rojo: el agente deja de responder
                solo, pero tu bandeja sigue funcionando y tu equipo puede contestar a mano.
              </li>
              <li>
                <strong className="text-fg">Al renovar.</strong> Los créditos del plan se reponen; los
                que compraste aparte siguen intactos.
              </li>
            </ul>
            <p className="mt-3 text-2xs text-fg-muted">
              Los avisos se envían a {marco.actual.correo}.
            </p>
          </CardBody>
        </Card>
      </div>
    </MarcoApp>
  );
}

const FECHA = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" });

const ESTADO: Record<string, string> = {
  trialing: "En prueba",
  active: "Activo",
  past_due: "Pago pendiente",
  paused: "En pausa",
  cancelled: "Cancelado",
};
