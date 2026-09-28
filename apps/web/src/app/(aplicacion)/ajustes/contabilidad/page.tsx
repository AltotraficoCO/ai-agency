import { KeyRound, Receipt, Sparkles, Unplug } from "lucide-react";
import { Badge, Button } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { DisposicionAjustes } from "@/components/nav-ajustes";
import { FormularioContabilidad } from "@/components/negocio/formulario-contabilidad";
import { AvisoAjustes, AvisoSoloLectura, SeccionAjustes } from "@/components/negocio/seccion-ajustes";
import { datosDelMarco } from "@/lib/marco";
import { accionConectarContabilidad, accionDesconectarAlegraCompleto } from "@/lib/contabilidad/acciones";
import { contabilidadDelEspacio } from "@/lib/contabilidad/contabilidad";
import { alegraCompletoDelEspacio, RUTA_CONTABILIDAD } from "@/lib/contabilidad/alegra-completo";

export const metadata = { title: "Contabilidad" };
export const dynamic = "force-dynamic";

export default async function PaginaContabilidad({
  searchParams,
}: {
  searchParams: Promise<{ alegra?: string; detalle?: string }>;
}) {
  const marco = await datosDelMarco();
  const [contabilidad, completo, vuelta] = await Promise.all([
    contabilidadDelEspacio(marco.actual.workspaceId),
    alegraCompletoDelEspacio(marco.actual.workspaceId),
    searchParams,
  ]);
  const puedeEditar = marco.actual.rol === "owner" || marco.actual.rol === "admin";

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      contexto="Ajustes"
      titulo="Contabilidad"
    >
      <DisposicionAjustes
        titulo="Contabilidad"
        descripcion="Conecta tu sistema de facturación para que tu agente financiero sepa cuánto te deben y persiga los cobros."
      >
        {contabilidad && (
          <section className="strappy-slide-up flex flex-col gap-4 rounded-xl border border-border bg-raised p-5 shadow-e1 sm:flex-row sm:items-center">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-fg">
              <Receipt size={22} strokeWidth={1.75} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-lg font-semibold tracking-tight text-fg">
                  {contabilidad.sistema}
                </p>
                {contabilidad.estado === "active" ? (
                  <Badge tone="exito">
                    <span aria-hidden className="size-1.5 rounded-full bg-success" />
                    Conectado
                  </Badge>
                ) : (
                  <Badge tone="aviso">Necesita reconectar</Badge>
                )}
                {contabilidad.estado === "active" && !contabilidad.puedeEmitir && (
                  <Badge tone="aviso">Solo mirar</Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-sm text-fg-secondary">{contabilidad.usuario}</p>
            </div>
          </section>
        )}

        {!puedeEditar && (
          <AvisoSoloLectura>
            Solo el propietario o un administrador pueden conectar la facturación.
          </AvisoSoloLectura>
        )}

        <SeccionAjustes
          titulo="Tu cuenta de Alegra completa"
          descripcion="Nómina, empleados, gastos, proveedores, inventario y reportes. Solo consulta: nunca cambia nada."
          icono={<Sparkles size={18} strokeWidth={1.75} aria-hidden />}
        >
          <div className="flex flex-col gap-4">
            {vuelta.alegra && vuelta.detalle ? (
              <AvisoAjustes tono={vuelta.alegra === "ok" ? "exito" : "error"}>{vuelta.detalle.slice(0, 300)}</AvisoAjustes>
            ) : null}
            {completo ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-2 text-sm text-fg-secondary">
                  <Badge tone="exito">Conectada</Badge>
                  Tu agente puede consultar {completo.consultas || "todas las"} partes de tu Alegra, nómina incluida.
                </p>
                <form action={accionDesconectarAlegraCompleto}>
                  <Button type="submit" variant="ghost" disabled={!puedeEditar}>
                    <Unplug size={16} strokeWidth={2} aria-hidden />
                    Desconectar
                  </Button>
                </form>
              </div>
            ) : (
              <p className="text-sm text-fg-secondary">
                Con los dos datos de abajo tu agente ve facturas y cobros. Para que también vea la nómina y todo lo demás,
                entra con tu cuenta de Alegra: no hay que copiar nada y lo puedes quitar cuando quieras.
              </p>
            )}
            <form action="/api/alegra/conectar" method="get">
              <input type="hidden" name="volver" value={RUTA_CONTABILIDAD} />
              <Button type="submit" size="lg" variant={completo ? "secondary" : "primary"} disabled={!puedeEditar}>
                <Sparkles size={16} strokeWidth={2} aria-hidden />
                {completo ? "Volver a conectar" : "Conectar con mi cuenta de Alegra"}
              </Button>
            </form>
          </div>
        </SeccionAjustes>

        <SeccionAjustes
          titulo={contabilidad ? "Actualizar la conexión" : "Conectar Alegra"}
          descripcion="Dos datos. Nada se emite sin que tú lo apruebes."
          icono={<KeyRound size={18} strokeWidth={1.75} aria-hidden />}
        >
          <FormularioContabilidad
            accion={accionConectarContabilidad}
            usuario={contabilidad?.usuario ?? ""}
            soloLectura={contabilidad ? !contabilidad.puedeEmitir : false}
            puedeEditar={puedeEditar}
          />
        </SeccionAjustes>
      </DisposicionAjustes>
    </MarcoApp>
  );
}
