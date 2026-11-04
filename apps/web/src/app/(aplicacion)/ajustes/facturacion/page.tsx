import { Bell, CreditCard, FileText, Gauge, OctagonAlert, RefreshCw, ShieldAlert, Wallet, Zap } from "lucide-react";
import { obtenerTrm } from "@strappy/core/recargas";
import { tokensDeAceptacion } from "@strappy/core/wompi";
import { Badge } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { DisposicionAjustes } from "@/components/nav-ajustes";
import { BannerCreditos } from "@/components/negocio/banner-creditos";
import { BarraConsumo } from "@/components/negocio/barra-consumo";
import { FacturaCombinada } from "@/components/negocio/factura-combinada";
import { FormularioLimites } from "@/components/negocio/formularios-ajustes";
import { FormularioRecarga, RecargaAutomaticaPanel } from "@/components/negocio/recarga";
import { AvisoAjustes, SeccionAjustes } from "@/components/negocio/seccion-ajustes";
import { datosDelMarco } from "@/lib/marco";
import { accionGuardarLimites, accionGuardarRecargaAutomatica, accionOlvidarTarjeta } from "@/lib/negocio/acciones";
import { analiticaDeStrappy } from "@/lib/negocio/analitica";
import { ajustesDelEspacio, estadoDelNegocio } from "@/lib/negocio/cartera";
import { avisarSiHaceFalta } from "@/lib/negocio/avisos";
import { creditosCompactos, creditosEnDolares, dolares, fraseDeRitmo } from "@/lib/negocio/creditos";
import { recargaAutomaticaDelEspacio, recargasDelEspacio } from "@/lib/negocio/facturacion";
import { obtenerConfigCobro, obtenerLlavesWompi } from "@/lib/plataforma/config";
import { diaEnZona, type RangoDias } from "@/lib/negocio/fechas";

export const metadata = { title: "Facturación" };
export const dynamic = "force-dynamic";

/**
 * Facturación, en el orden en que se pregunta:
 *   1. ¿Cuánto me queda y cuánto pagué este mes? — arriba y en grande.
 *   2. ¿Cómo consigo más? — la recarga, y que se haga sola.
 *   3. ¿En qué se me va? — el consumo del mes.
 *   4. Lo que se toca una vez: topes, historial y avisos.
 */
export default async function PaginaFacturacion({
  searchParams,
}: {
  searchParams: Promise<{ resultado?: string }>;
}) {
  const { resultado } = await searchParams;
  const marco = await datosDelMarco();
  const espacio = await ajustesDelEspacio(marco.actual.workspaceId);
  const negocio = await estadoDelNegocio(marco.actual.workspaceId);
  const { cartera } = negocio;

  const rango: RangoDias = {
    desde: diaEnZona(cartera.inicioMes, espacio.zonaHoraria),
    hasta: diaEnZona(new Date(), espacio.zonaHoraria),
  };

  const [llaves, config] = await Promise.all([obtenerLlavesWompi(), obtenerConfigCobro()]);
  const llavePublica = llaves.publica || null;
  const [analitica, recargas, automatica, trm, contratos] = await Promise.all([
    analiticaDeStrappy(marco.actual.workspaceId, rango),
    recargasDelEspacio(marco.actual.workspaceId),
    recargaAutomaticaDelEspacio(marco.actual.workspaceId),
    // La TRM cambia una vez al día: no hace falta pedirla en cada visita.
    obtenerTrm({ peticion: { next: { revalidate: 3600 } } as RequestInit }),
    llavePublica ? tokensDeAceptacion(llavePublica) : Promise.resolve(null),
  ]);

  // El aviso se dispara aquí y una sola vez por recarga. La página no depende de
  // ello para pintarse.
  await avisarSiHaceFalta({
    workspaceId: marco.actual.workspaceId,
    correo: marco.actual.correo,
    nombreEspacio: espacio.nombre,
    estado: cartera.estado,
    disponible: cartera.disponible,
    ciclo: cartera.cicloDeAvisos,
  }).catch(() => null);

  const puedeEditar = marco.actual.rol === "owner" || marco.actual.rol === "admin";

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
        descripcion="Tu saldo, cómo recargarlo y en qué se va."
      >
        <BannerCreditos estado={cartera.estado} disponible={cartera.disponible} />

        {resultado === "procesando" && (
          <AvisoAjustes>
            Estamos confirmando tu pago con Wompi. Los créditos entran en cuanto se apruebe: puede tardar unos minutos.
          </AvisoAjustes>
        )}

        {!llavePublica && (
          <AvisoAjustes>
            Los pagos aún no están configurados en esta instalación: los botones de pago te lo dirán al pulsarlos.
          </AvisoAjustes>
        )}

        <div className="grid gap-4 lg:grid-cols-5">
          <section className="strappy-slide-up relative flex flex-col justify-center overflow-hidden rounded-xl border border-border bg-raised p-5 shadow-e1 lg:col-span-3">
            <span
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-20 size-56 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--brand),transparent_86%),transparent_70%)]"
            />
            <div className="relative flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-2xs font-medium tracking-wide text-fg-muted uppercase">
                  <Wallet size={13} strokeWidth={2} aria-hidden />
                  Tu saldo
                </p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-fg tabular-nums">
                  {creditosCompactos(cartera.disponible)}
                  <span className="ml-1.5 text-base font-normal text-fg-secondary">créditos</span>
                </p>
                <p className="text-sm text-fg-secondary">Equivalen a {creditosEnDolares(cartera.disponible)}. No caducan.</p>
              </div>
              <Badge tone={automatica.activa ? "exito" : "aviso"}>
                {automatica.activa ? `Recarga automática: ${dolares(automatica.usd)}` : "Recarga manual"}
              </Badge>
            </div>
            {fraseDeRitmo(cartera.diasDeSaldo) && (
              <p className="relative mt-4 text-sm text-fg-secondary">{fraseDeRitmo(cartera.diasDeSaldo)}</p>
            )}
          </section>

          <FacturaCombinada
            className="lg:col-span-2"
            factura={negocio.factura}
            agentes={negocio.agentes}
            enFacturacion
          />
        </div>

        <SeccionAjustes
          titulo="Recargar créditos"
          descripcion="Elige cuánto. Los créditos no caducan y tus agentes gastan de ahí."
          icono={<Zap size={18} strokeWidth={1.75} aria-hidden />}
        >
          <FormularioRecarga trm={trm} puedeEditar={puedeEditar} config={config} />
        </SeccionAjustes>

        <SeccionAjustes
          titulo="Recarga automática"
          descripcion="Para que tus agentes no se detengan: al acabarse el saldo, se carga tu tarjeta."
          icono={<CreditCard size={18} strokeWidth={1.75} aria-hidden />}
        >
          <RecargaAutomaticaPanel
            estado={automatica}
            llavePublica={llavePublica}
            contratos={contratos}
            trm={trm}
            config={config}
            puedeEditar={puedeEditar}
            guardar={accionGuardarRecargaAutomatica}
            olvidar={accionOlvidarTarjeta}
          />
        </SeccionAjustes>

        <SeccionAjustes
          titulo="Consumo del mes"
          descripcion="Créditos de IA: lo único que te cobramos por uso."
          icono={<Gauge size={18} strokeWidth={1.75} aria-hidden />}
        >
          <BarraConsumo
            consumidos={cartera.consumidosEnMes}
            disponible={cartera.disponible}
            fraseRitmo={fraseDeRitmo(cartera.diasDeSaldo)}
            segmentos={analitica.consumoPorAgente}
          />
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
            puedeEditar={puedeEditar}
          />
        </SeccionAjustes>

        <div className="grid gap-4 lg:grid-cols-2">
          <SeccionAjustes
            titulo="Historial de recargas"
            descripcion="Lo que has recargado y cómo terminó cada pago."
            icono={<FileText size={18} strokeWidth={1.75} aria-hidden />}
          >
            {recargas.length === 0 ? (
              <p className="text-sm text-fg-muted">Aún no hay recargas. Aparecerán aquí en cuanto hagas la primera.</p>
            ) : (
              <ul className="-my-2 flex flex-col divide-y divide-[var(--border-subtle)]">
                {recargas.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">
                        {creditosCompactos(r.creditos)} créditos
                        {r.automatica && <span className="ml-1.5 text-2xs font-normal text-fg-muted">automática</span>}
                      </p>
                      <p className="text-2xs text-fg-muted">
                        {FECHA.format(new Date(r.fecha))} · {PESOS.format(r.pesos)}
                      </p>
                    </div>
                    <span className="tabular-nums text-sm text-fg">{dolares(r.usd)}</span>
                    <Badge tone={TONO_RECARGA[r.estado] ?? "aviso"}>{ESTADO_RECARGA[r.estado] ?? r.estado}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </SeccionAjustes>

          <SeccionAjustes
            titulo="Avisos de saldo"
            descripcion={`Te escribimos a ${marco.actual.correo}.`}
            icono={<Bell size={18} strokeWidth={1.75} aria-hidden />}
          >
            <ul className="flex flex-col gap-3 text-sm">
              <Aviso icono={<Bell size={14} strokeWidth={2} aria-hidden />} tono="text-warning-fg" titulo="Con poco saldo">
                Un correo y un aviso ámbar cuando bajas de {creditosCompactos(config.umbralAviso)} créditos.
              </Aviso>
              <Aviso
                icono={<OctagonAlert size={14} strokeWidth={2} aria-hidden />}
                tono="text-danger-fg"
                titulo="Sin saldo"
              >
                El agente deja de responder solo; tu equipo sigue contestando a mano.
              </Aviso>
              <Aviso icono={<RefreshCw size={14} strokeWidth={2} aria-hidden />} tono="text-primary-fg" titulo="Al recargar">
                El agente vuelve a trabajar en cuanto se confirma el pago.
              </Aviso>
            </ul>
          </SeccionAjustes>
        </div>
      </DisposicionAjustes>
    </MarcoApp>
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

const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

const ESTADO_RECARGA: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  declined: "Rechazada",
  voided: "Anulada",
  error: "Con error",
};

const TONO_RECARGA: Record<string, "exito" | "aviso"> = {
  approved: "exito",
};
