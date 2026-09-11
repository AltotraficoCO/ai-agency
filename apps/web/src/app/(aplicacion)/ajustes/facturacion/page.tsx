import {
  Bell,
  Check,
  Download,
  FileText,
  Gauge,
  Layers,
  OctagonAlert,
  RefreshCw,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { Badge } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { DisposicionAjustes } from "@/components/nav-ajustes";
import { BannerCreditos } from "@/components/negocio/banner-creditos";
import { BarraConsumo } from "@/components/negocio/barra-consumo";
import { FacturaCombinada } from "@/components/negocio/factura-combinada";
import { BotonPago, BotonPortal, FormularioLimites } from "@/components/negocio/formularios-ajustes";
import { AvisoAjustes, SeccionAjustes } from "@/components/negocio/seccion-ajustes";
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

/**
 * Facturación, en el orden en que se pregunta:
 *   1. ¿Qué plan tengo y cuánto pago este mes? — arriba y en grande.
 *   2. ¿Cuánto llevo gastado y dónde acabaré? — la barra con la proyección.
 *   3. ¿Cómo consigo más? — recargas y planes como tarjetas que se eligen.
 *   4. Lo que se toca una vez: topes, facturas y avisos.
 */
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
  const plan = negocio.plan;

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      contexto="Ajustes"
      titulo="Facturación"
    >
      <DisposicionAjustes
        ancho="amplio"
        titulo="Facturación"
        descripcion="Tu plan, lo que llevas gastado este periodo y cómo conseguir más créditos."
        acciones={puedeEditar ? <BotonPortal /> : undefined}
      >
        <BannerCreditos estado={negocio.cartera.estado} proyeccion={negocio.cartera.proyeccion} />

        {!hayStripe() && (
          <AvisoAjustes>
            Los pagos aún no están configurados en esta instalación: los botones de pago te lo dirán al pulsarlos.
          </AvisoAjustes>
        )}

        <div className="grid gap-4 lg:grid-cols-5">
          <section className="strappy-slide-up relative flex flex-col overflow-hidden rounded-xl border border-border bg-raised p-5 shadow-e1 lg:col-span-3">
            <span
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-20 size-56 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--brand),transparent_86%),transparent_70%)]"
            />
            <div className="relative flex items-start justify-between gap-3">
              <div>
                <p className="text-2xs font-medium tracking-wide text-fg-muted uppercase">Tu plan</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-fg">{plan.nombre}</p>
                <p className="text-sm text-fg-secondary">
                  {creditosCompactos(plan.creditosIncluidos)} créditos al mes ·{" "}
                  {plan.precioUsd === 0 ? "Gratis" : `${dolares(plan.precioUsd)} al mes`}
                </p>
              </div>
              <Badge tone={negocio.estadoSuscripcion === "active" ? "exito" : "aviso"}>
                {ESTADO[negocio.estadoSuscripcion] ?? negocio.estadoSuscripcion}
              </Badge>
            </div>
            <p className="relative mt-4 text-sm text-fg-secondary">{plan.resumen}</p>
            <ul className="relative mt-3 grid gap-2 sm:grid-cols-2">
              {plan.incluye.map((linea) => (
                <li key={linea} className="flex items-center gap-2 text-sm text-fg">
                  <Check size={14} strokeWidth={2.5} className="shrink-0 text-primary-fg" aria-hidden />
                  {linea}
                </li>
              ))}
            </ul>
          </section>

          <FacturaCombinada
            className="lg:col-span-2"
            factura={negocio.factura}
            agentes={negocio.agentes}
            enFacturacion
          />
        </div>

        <SeccionAjustes
          titulo="Consumo del periodo"
          descripcion="Créditos de IA: lo único que te cobramos por uso."
          icono={<Gauge size={18} strokeWidth={1.75} aria-hidden />}
        >
          <div className="flex flex-col gap-5">
            <BarraConsumo proyeccion={negocio.cartera.proyeccion} segmentos={analitica.consumoPorAgente} />
            <dl className="grid gap-3 sm:grid-cols-3">
              <Cifra etiqueta="Saldo del plan">{creditosCompactos(negocio.cartera.saldoIncluido)} créditos</Cifra>
              <Cifra etiqueta="Saldo comprado" nota="no caduca">
                {creditosCompactos(negocio.cartera.saldoComprado)} créditos
              </Cifra>
              <Cifra etiqueta="Equivale a">
                {creditosEnDolares(negocio.cartera.saldoIncluido + negocio.cartera.saldoComprado)}
              </Cifra>
            </dl>
          </div>
        </SeccionAjustes>

        <SeccionAjustes
          titulo="Recargar créditos"
          descripcion="No caducan: primero se gasta lo incluido en tu plan y después lo que compraste."
          icono={<Zap size={18} strokeWidth={1.75} aria-hidden />}
        >
          <ul className="grid gap-3 sm:grid-cols-3">
            {RECARGAS.map((r) => (
              <li
                key={r.clave}
                className="group flex flex-col gap-4 rounded-xl border border-border bg-page p-4 transition-[transform,border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out-quart)] hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--brand),transparent_55%)] hover:shadow-e2 motion-reduce:hover:translate-y-0"
              >
                <div>
                  <p className="text-2xl font-semibold tracking-tight text-fg tabular-nums">
                    {creditosCompactos(r.creditos)}
                    <span className="ml-1.5 text-sm font-normal text-fg-secondary">créditos</span>
                  </p>
                  <p className="mt-1 text-lg font-medium text-fg tabular-nums">{dolares(r.precioUsd)}</p>
                  <p className="text-2xs text-fg-muted">
                    {dolares(r.precioUsd / (r.creditos / 1000))} por cada 1.000
                  </p>
                </div>
                {puedeEditar && (
                  <BotonPago cuerpo={{ recarga: r.clave }} variant="secondary" size="md" anchoCompleto>
                    Recargar
                  </BotonPago>
                )}
              </li>
            ))}
          </ul>
        </SeccionAjustes>

        <SeccionAjustes
          titulo="Cambiar de plan"
          descripcion="Lo que cambia es cuántos créditos incluye cada mes."
          icono={<Layers size={18} strokeWidth={1.75} aria-hidden />}
        >
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {PLANES.map((p) => {
              const actual = p.clave === plan.clave;
              return (
                <li
                  key={p.clave}
                  className={`flex flex-col gap-3 rounded-xl border p-4 transition-[border-color,box-shadow] duration-[var(--dur-base)] ${
                    actual
                      ? "border-primary bg-primary-soft"
                      : "border-border bg-page hover:border-[color-mix(in_oklab,var(--brand),transparent_55%)] hover:shadow-e2"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-semibold text-fg">{p.nombre}</span>
                    {actual ? (
                      <Badge tone="ia">Tu plan</Badge>
                    ) : p.destacado ? (
                      <Badge tone="info">Recomendado</Badge>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-xl font-semibold tracking-tight text-fg tabular-nums">
                      {p.precioUsd === 0 ? "Gratis" : dolares(p.precioUsd)}
                      {p.precioUsd > 0 && <span className="ml-1 text-sm font-normal text-fg-secondary">al mes</span>}
                    </p>
                    <p className="text-2xs text-fg-muted">{creditosCompactos(p.creditosIncluidos)} créditos al mes</p>
                  </div>
                  {puedeEditar && !actual && p.precioUsd > 0 && (
                    <div className="mt-auto">
                      <BotonPago cuerpo={{ plan: p.clave }} variant="secondary" anchoCompleto>
                        Cambiar a {p.nombre}
                      </BotonPago>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </SeccionAjustes>

        <SeccionAjustes
          titulo="Topes de gasto"
          descripcion="Frenan el consumo antes de que se dispare, no después."
          icono={<ShieldAlert size={18} strokeWidth={1.75} aria-hidden />}
        >
          <FormularioLimites
            accion={accionGuardarLimites}
            diario={negocio.limites.diario}
            porConversacion={negocio.limites.porConversacion}
            parada={negocio.limites.parada}
            puedeEditar={puedeEditar}
          />
        </SeccionAjustes>

        <div className="grid gap-4 lg:grid-cols-2">
          <SeccionAjustes
            titulo="Facturas"
            descripcion="Las emite Stripe a nombre de tu organización."
            icono={<FileText size={18} strokeWidth={1.75} aria-hidden />}
          >
            {facturas.length === 0 ? (
              <p className="text-sm text-fg-muted">
                Aún no hay facturas. Aparecerán aquí en cuanto se cobre el primer periodo.
              </p>
            ) : (
              <ul className="-my-2 flex flex-col divide-y divide-[var(--border-subtle)]">
                {facturas.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{f.numero}</p>
                      <p className="text-2xs text-fg-muted">{FECHA.format(new Date(f.fecha))}</p>
                    </div>
                    <span className="tabular-nums text-sm text-fg">{dolares(f.totalUsd)}</span>
                    {f.urlPdf && (
                      <a
                        href={f.urlPdf}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Descargar la factura ${f.numero} en PDF`}
                        className="grid size-8 cursor-pointer place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-primary-fg"
                      >
                        <Download size={16} strokeWidth={1.75} aria-hidden />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SeccionAjustes>

          <SeccionAjustes
            titulo="Avisos de consumo"
            descripcion={`Te escribimos a ${marco.actual.correo}.`}
            icono={<Bell size={18} strokeWidth={1.75} aria-hidden />}
          >
            <ul className="flex flex-col gap-3 text-sm">
              <Aviso icono={<Bell size={14} strokeWidth={2} aria-hidden />} tono="text-warning-fg" titulo="Al 80% del saldo">
                Un correo y un aviso ámbar, una vez por periodo.
              </Aviso>
              <Aviso
                icono={<OctagonAlert size={14} strokeWidth={2} aria-hidden />}
                tono="text-danger-fg"
                titulo="Al 100%"
              >
                El agente deja de responder solo; tu equipo sigue contestando a mano.
              </Aviso>
              <Aviso icono={<RefreshCw size={14} strokeWidth={2} aria-hidden />} tono="text-primary-fg" titulo="Al renovar">
                Se reponen los créditos del plan; los comprados siguen intactos.
              </Aviso>
            </ul>
          </SeccionAjustes>
        </div>
      </DisposicionAjustes>
    </MarcoApp>
  );
}

function Cifra({
  etiqueta,
  nota,
  children,
}: {
  etiqueta: string;
  nota?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-inset px-3.5 py-3">
      <dt className="text-2xs text-fg-muted">{etiqueta}</dt>
      <dd className="mt-0.5 text-base font-medium text-fg tabular-nums">
        {children}
        {nota && <span className="ml-1.5 text-2xs font-normal text-fg-muted">{nota}</span>}
      </dd>
    </div>
  );
}

function Aviso({
  icono,
  tono,
  titulo,
  children,
}: {
  icono: React.ReactNode;
  tono: string;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-hover ${tono}`}>{icono}</span>
      <span className="text-fg-secondary">
        <strong className="font-medium text-fg">{titulo}.</strong> {children}
      </span>
    </li>
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
