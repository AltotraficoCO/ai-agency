import { Building2, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { Avatar, Badge, Button } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { DisposicionAjustes } from "@/components/nav-ajustes";
import { SeccionAjustes } from "@/components/negocio/seccion-ajustes";
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
      contexto="Ajustes"
      titulo="Tu cuenta"
    >
      <DisposicionAjustes titulo="Tu cuenta" descripcion="Quién eres dentro de Strappy y en qué espacio trabajas.">
        <SeccionAjustes
          titulo="Perfil"
          descripcion="Estos datos vienen de la cuenta con la que entras."
          icono={<UserRound size={18} strokeWidth={1.75} aria-hidden />}
        >
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <Avatar
                name={marco.actual.nombre}
                src={marco.usuario.avatar}
                size="lg"
                tone="humano"
                className="size-14 text-lg"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-xl font-semibold tracking-tight text-fg">{marco.actual.nombre}</p>
                  {marco.actual.esDesarrollo && <Badge tone="aviso">Cuenta de desarrollo</Badge>}
                </div>
                <p className="truncate text-sm text-fg-secondary">{marco.actual.correo}</p>
              </div>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              <Dato icono={<Building2 size={16} strokeWidth={1.75} aria-hidden />} etiqueta="Espacio de trabajo">
                {marco.actual.workspaceNombre}
              </Dato>
              <Dato icono={<ShieldCheck size={16} strokeWidth={1.75} aria-hidden />} etiqueta="Tu papel">
                {PAPEL[marco.actual.rol] ?? marco.actual.rol}
              </Dato>
            </dl>
          </div>
        </SeccionAjustes>

        <SeccionAjustes
          titulo="Sesión"
          descripcion="Cierra la sesión en este navegador. Tus agentes siguen atendiendo."
          icono={<LogOut size={18} strokeWidth={1.75} aria-hidden />}
          accion={
            <form action="/auth/salir" method="post">
              <Button type="submit" variant="secondary">
                <LogOut size={16} strokeWidth={1.75} aria-hidden />
                Cerrar sesión
              </Button>
            </form>
          }
        />
      </DisposicionAjustes>
    </MarcoApp>
  );
}

function Dato({
  icono,
  etiqueta,
  children,
}: {
  icono: React.ReactNode;
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-inset px-3.5 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-hover text-fg-muted">{icono}</span>
      <div className="min-w-0">
        <dt className="text-2xs text-fg-muted">{etiqueta}</dt>
        <dd className="truncate text-base font-medium text-fg">{children}</dd>
      </div>
    </div>
  );
}

const PAPEL: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  builder: "Constructor",
  agent: "Atención",
  analyst: "Analista",
};
