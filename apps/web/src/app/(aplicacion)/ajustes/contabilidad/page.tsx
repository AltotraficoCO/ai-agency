import { KeyRound, Receipt } from "lucide-react";
import { Badge } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { DisposicionAjustes } from "@/components/nav-ajustes";
import { FormularioContabilidad } from "@/components/negocio/formulario-contabilidad";
import { AvisoSoloLectura, SeccionAjustes } from "@/components/negocio/seccion-ajustes";
import { datosDelMarco } from "@/lib/marco";
import { accionConectarContabilidad } from "@/lib/contabilidad/acciones";
import { contabilidadDelEspacio } from "@/lib/contabilidad/contabilidad";

export const metadata = { title: "Contabilidad" };
export const dynamic = "force-dynamic";

export default async function PaginaContabilidad() {
  const marco = await datosDelMarco();
  const contabilidad = await contabilidadDelEspacio(marco.actual.workspaceId);
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
