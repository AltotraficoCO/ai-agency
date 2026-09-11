import { MarcoApp } from "@/components/marco-app";
import { DisposicionAjustes } from "@/components/nav-ajustes";
import { FormularioEspacio } from "@/components/negocio/formularios-ajustes";
import { AvisoSoloLectura } from "@/components/negocio/seccion-ajustes";
import { datosDelMarco } from "@/lib/marco";
import { accionGuardarEspacio } from "@/lib/negocio/acciones";
import { ajustesDelEspacio } from "@/lib/negocio/cartera";
import { DIAS_SEMANA, horarioDesdeAjustes } from "@/lib/negocio/equipo";

export const metadata = { title: "Espacio de trabajo" };
export const dynamic = "force-dynamic";

export default async function PaginaEspacio() {
  const marco = await datosDelMarco();
  const espacio = await ajustesDelEspacio(marco.actual.workspaceId);
  const horario = horarioDesdeAjustes(espacio.settings);
  const puedeEditar = marco.actual.rol === "owner" || marco.actual.rol === "admin";

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      contexto="Ajustes"
      titulo="Espacio de trabajo"
    >
      <DisposicionAjustes
        titulo="Espacio de trabajo"
        descripcion="El nombre de tu negocio, su zona horaria y cuándo atiende tu equipo."
      >
        {!puedeEditar && (
          <AvisoSoloLectura>Solo el propietario o un administrador pueden cambiar estos ajustes.</AvisoSoloLectura>
        )}
        <FormularioEspacio
          accion={accionGuardarEspacio}
          nombre={espacio.nombre}
          zona={espacio.zonaHoraria}
          horario={horario}
          dias={DIAS_SEMANA}
          puedeEditar={puedeEditar}
        />
      </DisposicionAjustes>
    </MarcoApp>
  );
}
