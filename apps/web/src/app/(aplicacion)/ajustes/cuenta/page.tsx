import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { datosDelMarco } from "@/lib/marco";

export const metadata = { title: "Tu cuenta" };
export const dynamic = "force-dynamic";

export default async function PaginaCuenta() {
  const marco = await datosDelMarco();

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo="Tu cuenta"
    >
      <div className="mx-auto max-w-xl p-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>{marco.actual.nombre}</CardTitle>
              <p className="text-sm text-fg-secondary">{marco.actual.correo}</p>
            </div>
            {marco.actual.esDesarrollo && <Badge tone="aviso">Cuenta de desarrollo</Badge>}
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-fg-muted">Espacio de trabajo</dt>
              <dd className="text-fg">{marco.actual.workspaceNombre}</dd>
              <dt className="text-fg-muted">Tu papel</dt>
              <dd className="text-fg">{PAPEL[marco.actual.rol] ?? marco.actual.rol}</dd>
            </dl>
            <form action="/auth/salir" method="post">
              <Button type="submit" variant="secondary">
                Cerrar sesión
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </MarcoApp>
  );
}

const PAPEL: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  builder: "Constructor",
  agent: "Atención",
  analyst: "Analista",
};
