/**
 * La sección «Repositorio de tu web» con sus datos cargados.
 *
 * Sale en dos sitios —Ajustes → Sitio web y la ficha del Webmaster— porque el
 * cliente la busca en los dos: en Ajustes cuando conecta cosas, y en la ficha
 * cuando está configurando a su agente. Es la misma pieza para que no existan
 * dos formularios que se desincronicen.
 */
import { FolderGit2 } from "lucide-react";
import { SeccionAjustes } from "./seccion-ajustes";
import { FormularioRepositorio } from "./formulario-repositorio";
import { accionConectarRepo, accionDesconectarRepo } from "@/lib/sitio/acciones";
import { hayAppDeGithub, repoDelEspacio, reposDisponibles } from "@/lib/sitio/repositorio";

export async function SeccionRepositorio({
  workspaceId,
  puedeEditar,
  volver,
  agenteId,
  github,
  detalle,
}: {
  workspaceId: string;
  puedeEditar: boolean;
  /** Página a la que vuelve GitHub tras instalar la App: esta misma. */
  volver: string;
  agenteId?: string;
  /** `?github=` de la vuelta de GitHub. */
  github?: string | undefined;
  detalle?: string | undefined;
}) {
  const [repo, reposDeApp] = await Promise.all([repoDelEspacio(workspaceId), reposDisponibles(workspaceId)]);
  const avisoUrl =
    github === "error" && detalle
      ? { tono: "error" as const, texto: detalle.slice(0, 300) }
      : github === "elige" && reposDeApp
        ? { tono: "exito" as const, texto: "App instalada. Elige cuál es el repositorio de tu web." }
        : null;

  return (
    <div id="repositorio" className="scroll-mt-24">
      <SeccionAjustes
        titulo={repo ? "Repositorio de tu web" : "¿Tu web está hecha a medida?"}
        descripcion="React, Next, Astro, Vue…: conecta su repositorio de GitHub y el Webmaster trabajará directamente en el código."
        icono={<FolderGit2 size={18} strokeWidth={1.75} aria-hidden />}
      >
        <FormularioRepositorio
          accion={accionConectarRepo}
          accionDesconectar={accionDesconectarRepo}
          repo={repo}
          appDisponible={hayAppDeGithub()}
          reposDeApp={reposDeApp}
          puedeEditar={puedeEditar}
          volver={volver}
          {...(agenteId ? { agenteId } : {})}
          avisoUrl={avisoUrl}
        />
      </SeccionAjustes>
    </div>
  );
}
