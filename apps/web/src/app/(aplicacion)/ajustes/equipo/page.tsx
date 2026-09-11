import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { NavAjustes } from "@/components/nav-ajustes";
import {
  BotonAccion,
  FormularioInvitar,
  SelectorPapel,
} from "@/components/negocio/formularios-ajustes";
import { datosDelMarco } from "@/lib/marco";
import { accionCambiarPapel, accionInvitar, accionRevocarInvitacion } from "@/lib/negocio/acciones";
import { equipoDelEspacio, NOMBRE_PAPEL, PAPELES } from "@/lib/negocio/equipo";

export const metadata = { title: "Equipo" };
export const dynamic = "force-dynamic";

export default async function PaginaEquipo() {
  const marco = await datosDelMarco();
  const { miembros, invitaciones } = await equipoDelEspacio(marco.actual.workspaceId);
  const puedeEditar = marco.actual.rol === "owner" || marco.actual.rol === "admin";

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo="Equipo"
    >
      <NavAjustes />
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Invitar a alguien</CardTitle>
            <CardDescription>
              Recibirá un enlace por correo. El enlace caduca a los siete días.
            </CardDescription>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <FormularioInvitar accion={accionInvitar} papeles={PAPELES} puedeEditar={puedeEditar} />
            <ul className="flex flex-col gap-1 text-2xs text-fg-muted">
              {PAPELES.map((p) => (
                <li key={p.clave}>
                  <strong className="text-fg-secondary">{p.nombre}:</strong> {p.descripcion}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quién está dentro</CardTitle>
            <CardDescription>{miembros.length} persona(s) en este espacio.</CardDescription>
          </CardHeader>
          <CardBody>
            <ul className="flex flex-col">
              {miembros.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] py-2.5 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{m.nombre}</p>
                    <p className="truncate text-2xs text-fg-muted">{m.correo}</p>
                  </div>
                  {m.rol === "owner" ? (
                    <Badge tone="ia">{NOMBRE_PAPEL[m.rol]}</Badge>
                  ) : (
                    <SelectorPapel
                      accion={accionCambiarPapel}
                      miembroId={m.id}
                      papelActual={m.rol}
                      papeles={PAPELES}
                      puedeEditar={puedeEditar}
                    />
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        {invitaciones.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Invitaciones pendientes</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="flex flex-col">
                {invitaciones.map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] py-2.5 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{i.correo}</span>
                    <Badge tone="neutral">{NOMBRE_PAPEL[i.rol] ?? i.rol}</Badge>
                    {puedeEditar && (
                      <BotonAccion accion={accionRevocarInvitacion} campos={{ id: i.id }}>
                        Revocar
                      </BotonAccion>
                    )}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>
    </MarcoApp>
  );
}
