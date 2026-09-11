import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { NavAjustes } from "@/components/nav-ajustes";
import { FormularioSitio } from "@/components/negocio/formulario-sitio";
import { datosDelMarco } from "@/lib/marco";
import { accionConectarSitio } from "@/lib/sitio/acciones";
import { sitioDelEspacio } from "@/lib/sitio/sitio";

export const metadata = { title: "Sitio web" };
export const dynamic = "force-dynamic";

export default async function PaginaSitio() {
  const marco = await datosDelMarco();
  const sitio = await sitioDelEspacio(marco.actual.workspaceId);
  const puedeEditar = marco.actual.rol === "owner" || marco.actual.rol === "admin";

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo="Sitio web"
    >
      <NavAjustes />
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Tu sitio web</CardTitle>
              <CardDescription>
                El Webmaster entra a tu WordPress con una contraseña de aplicación. Probamos la conexión antes de
                guardarla, y la contraseña se guarda cifrada.
              </CardDescription>
            </div>
            {sitio &&
              (sitio.estado === "active" ? (
                <Badge>Conectado</Badge>
              ) : (
                <Badge tone="aviso">Necesita reconectar</Badge>
              ))}
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            {sitio && (
              <p className="text-sm text-fg-secondary">
                <span className="font-medium text-fg">{sitio.nombre}</span> · {sitio.url}
              </p>
            )}
            {!puedeEditar && (
              <p className="rounded-lg bg-inset px-3 py-2 text-2xs text-fg-muted">
                Solo el propietario o un administrador pueden conectar el sitio.
              </p>
            )}
            <FormularioSitio
              accion={accionConectarSitio}
              url={sitio?.url ?? ""}
              usuario={sitio?.usuario ?? ""}
              puedeEditar={puedeEditar}
            />
          </CardBody>
        </Card>
      </div>
    </MarcoApp>
  );
}
