import { BellRing } from "lucide-react";
import { Badge } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { DisposicionAjustes } from "@/components/nav-ajustes";
import { FormularioAvisos } from "@/components/negocio/formulario-avisos";
import { AvisoSoloLectura, SeccionAjustes } from "@/components/negocio/seccion-ajustes";
import { datosDelMarco } from "@/lib/marco";
import { accionGuardarAvisos, accionProbarAviso } from "@/lib/avisos/acciones";
import { estadoDeAvisos } from "@/lib/avisos/avisos";

export const metadata = { title: "Avisos" };
export const dynamic = "force-dynamic";

export default async function PaginaAvisos() {
  const marco = await datosDelMarco();
  const estado = await estadoDeAvisos(marco.actual.workspaceId);
  const puedeEditar = marco.actual.rol === "owner" || marco.actual.rol === "admin";

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      contexto="Ajustes"
      titulo="Avisos"
    >
      <DisposicionAjustes
        titulo="Avisos"
        descripcion="Tu Webmaster revisa el sitio cada 15 minutos. Dile a qué número escribirte cuando algo se rompa."
      >
        {!puedeEditar && (
          <AvisoSoloLectura>
            Solo el propietario o un administrador pueden cambiar los avisos.
          </AvisoSoloLectura>
        )}

        <SeccionAjustes
          titulo="Avisos por WhatsApp"
          descripcion="Solo cuando algo cambia: si el sitio se cae, si vuelve, si el candado de seguridad está por vencer."
          icono={<BellRing size={18} strokeWidth={1.75} aria-hidden />}
          accion={
            estado.config?.activo ? (
              <Badge tone="exito">
                <span aria-hidden className="size-1.5 rounded-full bg-success" />
                Encendidos
              </Badge>
            ) : (
              <Badge tone="neutral">Apagados</Badge>
            )
          }
        >
          <FormularioAvisos
            guardar={accionGuardarAvisos}
            probar={accionProbarAviso}
            destino={estado.config?.destino ?? ""}
            plantilla={estado.config?.plantilla ?? ""}
            idioma={estado.config?.idioma ?? "es"}
            activo={estado.config?.activo ?? false}
            numeros={estado.numeros}
            puedeEnviar={estado.puedeEnviar}
            puedeEditar={puedeEditar}
          />
        </SeccionAjustes>
      </DisposicionAjustes>
    </MarcoApp>
  );
}
