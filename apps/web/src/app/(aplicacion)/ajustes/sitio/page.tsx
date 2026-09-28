import { ExternalLink, FolderGit2, Globe, KeyRound } from "lucide-react";
import { Badge } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { DisposicionAjustes } from "@/components/nav-ajustes";
import { FormularioSitio } from "@/components/negocio/formulario-sitio";
import { AvisoSoloLectura, SeccionAjustes } from "@/components/negocio/seccion-ajustes";
import { datosDelMarco } from "@/lib/marco";
import { accionConectarSitio } from "@/lib/sitio/acciones";
import { SeccionRepositorio } from "@/components/negocio/seccion-repositorio";
import { sitioDelEspacio, wordpressDelEspacio } from "@/lib/sitio/sitio";
import { RUTA_SITIO } from "@/lib/sitio/repositorio";

export const metadata = { title: "Sitio web" };
export const dynamic = "force-dynamic";

export default async function PaginaSitio({
  searchParams,
}: {
  searchParams: Promise<{ github?: string; detalle?: string }>;
}) {
  const marco = await datosDelMarco();
  const [sitio, wordpress, vuelta] = await Promise.all([
    sitioDelEspacio(marco.actual.workspaceId),
    wordpressDelEspacio(marco.actual.workspaceId),
    searchParams,
  ]);
  const puedeEditar = marco.actual.rol === "owner" || marco.actual.rol === "admin";

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      contexto="Ajustes"
      titulo="Sitio web"
    >
      <DisposicionAjustes
        titulo="Sitio web"
        descripcion="Conecta tu WordPress, o el repositorio de GitHub si tu web está hecha a medida, para que el Webmaster haga él mismo los cambios que le pidas."
      >
        {sitio && (
          <section className="strappy-slide-up flex flex-col gap-4 rounded-xl border border-border bg-raised p-5 shadow-e1 sm:flex-row sm:items-center">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-fg">
              {sitio.tipo === "repo" ? (
                <FolderGit2 size={22} strokeWidth={1.75} aria-hidden />
              ) : (
                <Globe size={22} strokeWidth={1.75} aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-lg font-semibold tracking-tight text-fg">{sitio.nombre}</p>
                {sitio.estado === "active" ? (
                  <Badge tone="exito">
                    <span aria-hidden className="size-1.5 rounded-full bg-success" />
                    Conectado
                  </Badge>
                ) : (
                  <Badge tone="aviso">Necesita reconectar</Badge>
                )}
              </div>
              <a
                href={sitio.url}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-sm text-fg-secondary transition-colors hover:text-primary-fg"
              >
                {sitio.url}
                <ExternalLink size={13} strokeWidth={2} aria-hidden />
              </a>
              <p className="mt-0.5 text-2xs text-fg-muted">
                {sitio.tipo === "repo"
                  ? `El Webmaster trabaja en el código de ${sitio.repositorio ?? "tu repositorio"}.`
                  : sitio.tipo === "custom"
                    ? "El Webmaster trabaja por el conector de tu sitio."
                    : "El Webmaster trabaja en tu WordPress."}
              </p>
            </div>
          </section>
        )}

        {!puedeEditar && (
          <AvisoSoloLectura>Solo el propietario o un administrador pueden conectar el sitio.</AvisoSoloLectura>
        )}

        <SeccionAjustes
          titulo={wordpress ? "Tu WordPress" : "¿Tu web es un WordPress?"}
          descripcion="Tres datos. No se instala nada en tu sitio."
          icono={<KeyRound size={18} strokeWidth={1.75} aria-hidden />}
        >
          <FormularioSitio
            accion={accionConectarSitio}
            url={wordpress?.url ?? ""}
            usuario={wordpress?.usuario ?? ""}
            puedeEditar={puedeEditar}
          />
        </SeccionAjustes>

        <SeccionRepositorio
          workspaceId={marco.actual.workspaceId}
          puedeEditar={puedeEditar}
          volver={`${RUTA_SITIO}#repositorio`}
          github={vuelta.github}
          detalle={vuelta.detalle}
        />
      </DisposicionAjustes>
    </MarcoApp>
  );
}
