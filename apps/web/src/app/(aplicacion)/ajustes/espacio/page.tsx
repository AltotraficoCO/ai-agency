import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { FormularioEspacio } from "@/components/negocio/formularios-ajustes";
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
      titulo="Espacio de trabajo"
    >
      <div className="mx-auto max-w-2xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Tu espacio</CardTitle>
            <CardDescription>
              El nombre, la zona horaria y cuándo hay alguien de tu equipo disponible.
            </CardDescription>
          </CardHeader>
          <CardBody>
            {!puedeEditar && (
              <p className="mb-3 rounded-lg bg-inset px-3 py-2 text-2xs text-fg-muted">
                Solo el propietario o un administrador pueden cambiar estos ajustes.
              </p>
            )}
            <FormularioEspacio
              accion={accionGuardarEspacio}
              nombre={espacio.nombre}
              zona={espacio.zonaHoraria}
              horario={horario}
              dias={DIAS_SEMANA}
              puedeEditar={puedeEditar}
            />
          </CardBody>
        </Card>
      </div>
    </MarcoApp>
  );
}
