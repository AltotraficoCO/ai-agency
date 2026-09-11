import { Mail, UserPlus, Users } from "lucide-react";
import { Avatar, Badge } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { DisposicionAjustes } from "@/components/nav-ajustes";
import {
  BotonAccion,
  FormularioInvitar,
  SelectorPapel,
} from "@/components/negocio/formularios-ajustes";
import { AvisoSoloLectura, SeccionAjustes } from "@/components/negocio/seccion-ajustes";
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
      contexto="Ajustes"
      titulo="Equipo"
    >
      <DisposicionAjustes
        titulo="Equipo"
        descripcion="Invita a quien te ayuda a atender y decide qué puede hacer cada uno."
      >
        {!puedeEditar && (
          <AvisoSoloLectura>Solo el propietario o un administrador pueden invitar o cambiar papeles.</AvisoSoloLectura>
        )}

        <SeccionAjustes
          titulo="Invitar a alguien"
          descripcion="Recibirá un enlace por correo que caduca a los siete días."
          icono={<UserPlus size={18} strokeWidth={1.75} aria-hidden />}
        >
          <div className="flex flex-col gap-5">
            <FormularioInvitar accion={accionInvitar} papeles={PAPELES} puedeEditar={puedeEditar} />
            <div>
              <p className="mb-2 text-2xs font-medium tracking-wide text-fg-muted uppercase">Qué puede hacer cada papel</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {PAPELES.map((p) => (
                  <li
                    key={p.clave}
                    className="rounded-lg border border-[var(--border-subtle)] bg-inset px-3 py-2.5"
                  >
                    <p className="text-sm font-medium text-fg">{p.nombre}</p>
                    <p className="text-2xs text-fg-muted">{p.descripcion}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </SeccionAjustes>

        <SeccionAjustes
          titulo="Quién está dentro"
          descripcion={`${miembros.length} ${miembros.length === 1 ? "persona" : "personas"} en este espacio.`}
          icono={<Users size={18} strokeWidth={1.75} aria-hidden />}
        >
          <ul className="-my-2 flex flex-col divide-y divide-[var(--border-subtle)]">
            {miembros.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar name={m.nombre} size="md" tone="humano" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-fg">{m.nombre}</p>
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
        </SeccionAjustes>

        {invitaciones.length > 0 && (
          <SeccionAjustes
            titulo="Invitaciones pendientes"
            descripcion="Todavía no han aceptado. Puedes retirar la invitación cuando quieras."
            icono={<Mail size={18} strokeWidth={1.75} aria-hidden />}
          >
            <ul className="-my-2 flex flex-col divide-y divide-[var(--border-subtle)]">
              {invitaciones.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-hover text-fg-muted">
                    <Mail size={14} strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-base text-fg">{i.correo}</span>
                  <Badge tone="neutral">{NOMBRE_PAPEL[i.rol] ?? i.rol}</Badge>
                  {puedeEditar && (
                    <BotonAccion accion={accionRevocarInvitacion} campos={{ id: i.id }}>
                      Retirar
                    </BotonAccion>
                  )}
                </li>
              ))}
            </ul>
          </SeccionAjustes>
        )}
      </DisposicionAjustes>
    </MarcoApp>
  );
}
