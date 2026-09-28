"use client";

/**
 * Conectar el repositorio de GitHub de un sitio hecho a medida.
 *
 * Tres estados, en el orden en que los vive el cliente:
 *  1. Recién instalada la GitHub App: elige cuál de sus repositorios es la web.
 *  2. Sin nada: instalar la App (lo recomendado) o, debajo, pegar un token.
 *  3. Ya conectado: qué repositorio, qué rama se publica, y desconectar.
 *
 * El token nunca vuelve al navegador: el campo sale siempre vacío. La
 * instalación de la App tampoco viaja por aquí: la guarda el servidor en una
 * cookie cifrada tras comprobar que es de quien la instaló.
 */
import * as React from "react";
import { useActionState } from "react";
import { ChevronDown, CircleHelp, FolderGit2, GitBranch, PlugZap, ShieldCheck, Unplug } from "lucide-react";
import { Badge, Button, Input, inputBase, cn } from "@strappy/ui";
import type { Resultado } from "@/lib/negocio/acciones";
import { AvisoAjustes } from "./seccion-ajustes";

export type RepoConectado = {
  repositorio: string;
  url: string;
  ramaPrincipal: string;
  acceso: "token" | "app";
  estado: string;
  conBypass: boolean;
};

export type RepoDeLaApp = { owner: string; repo: string; ramaPorDefecto: string; privado: boolean; web: string | null };

export function FormularioRepositorio({
  accion,
  accionDesconectar,
  repo,
  appDisponible,
  reposDeApp,
  puedeEditar,
  volver,
  agenteId,
  avisoUrl,
}: {
  accion: (datos: FormData) => Promise<Resultado>;
  accionDesconectar: (datos: FormData) => Promise<Resultado>;
  repo: RepoConectado | null;
  appDisponible: boolean;
  /** Los repositorios de la instalación recién hecha, o `null` si no hay ninguna pendiente. */
  reposDeApp: RepoDeLaApp[] | null;
  puedeEditar: boolean;
  /** Página a la que vuelve GitHub tras instalar la App. */
  volver: string;
  /** Si se conecta desde la ficha del agente, para refrescarla. */
  agenteId?: string;
  /** Lo que dijo la vuelta de GitHub: `?github=error&detalle=…`. */
  avisoUrl?: { tono: "error" | "exito"; texto: string } | null;
}) {
  const [estado, enviar, pendiente] = useActionState<Resultado | null, FormData>(
    async (_previo, datos) => accion(datos),
    null,
  );
  const [estadoDesconexion, desconectar, desconectando] = useActionState<Resultado | null, FormData>(
    async (_previo, datos) => accionDesconectar(datos),
    null,
  );
  const [cambiando, setCambiando] = React.useState(false);
  const id = React.useId();
  const [elegido, setElegido] = React.useState(reposDeApp?.[0] ? `${reposDeApp[0].owner}/${reposDeApp[0].repo}` : "");
  const repoElegido = reposDeApp?.find((r) => `${r.owner}/${r.repo}` === elegido);

  const aviso = pendiente ? (
    <AvisoAjustes>Entrando a GitHub para comprobar el acceso…</AvisoAjustes>
  ) : estado ? (
    <AvisoAjustes tono={estado.ok ? "exito" : "error"}>{estado.ok ? estado.mensaje : estado.error}</AvisoAjustes>
  ) : estadoDesconexion ? (
    <AvisoAjustes tono={estadoDesconexion.ok ? "exito" : "error"}>
      {estadoDesconexion.ok ? estadoDesconexion.mensaje : estadoDesconexion.error}
    </AvisoAjustes>
  ) : avisoUrl ? (
    <AvisoAjustes tono={avisoUrl.tono}>{avisoUrl.texto}</AvisoAjustes>
  ) : null;

  const oculto = agenteId ? <input type="hidden" name="agente" value={agenteId} /> : null;

  // --- 3. Ya conectado -------------------------------------------------------
  if (repo && !reposDeApp && !cambiando) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-inset p-4 sm:flex-row sm:items-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-fg">
            <FolderGit2 size={20} strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-semibold text-fg">{repo.repositorio}</p>
              {repo.estado === "active" ? (
                <Badge tone="exito">Conectado</Badge>
              ) : (
                <Badge tone="aviso">Necesita reconectar</Badge>
              )}
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-secondary">
              <span className="inline-flex items-center gap-1">
                <GitBranch size={13} strokeWidth={2} aria-hidden />
                Se publica desde «{repo.ramaPrincipal}»
              </span>
              <span>{repo.url}</span>
              <span>{repo.acceso === "app" ? "Con la App de Strappy" : "Con token"}</span>
            </p>
          </div>
        </div>
        <p className="text-sm text-fg-secondary">
          En cada encargo el Webmaster te propone dónde guardar los cambios —una rama nueva, «{repo.ramaPrincipal}» o una
          rama que ya tengas— y tú eliges con un botón. Publicar un PR siempre espera tu clic.
        </p>
        {aviso}
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] pt-4">
          <Button type="button" variant="secondary" onClick={() => setCambiando(true)} disabled={!puedeEditar}>
            <PlugZap size={16} strokeWidth={2} aria-hidden />
            Cambiar de repositorio o de acceso
          </Button>
          <form action={desconectar}>
            {oculto}
            <Button type="submit" variant="ghost" loading={desconectando} loadingLabel="Desconectando…" disabled={!puedeEditar}>
              <Unplug size={16} strokeWidth={2} aria-hidden />
              Desconectar
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // --- 1. Recién instalada la App: elegir el repositorio ------------------------
  if (reposDeApp) {
    return (
      <form action={enviar} className="flex flex-col gap-5">
        <input type="hidden" name="acceso" value="app" />
        {oculto}
        <fieldset className="flex flex-col gap-5" disabled={!puedeEditar}>
          {reposDeApp.length === 0 ? (
            <AvisoAjustes tono="aviso">
              La App quedó instalada pero sin ningún repositorio. En GitHub, en la configuración de la App, dale acceso al
              repositorio de tu web y vuelve a pulsar «Instalar».
            </AvisoAjustes>
          ) : (
            <Paso numero={1} etiqueta="¿Cuál es el repositorio de tu web?" ayuda="Los que diste a la App al instalarla." htmlFor={`${id}-repo`}>
              <select
                id={`${id}-repo`}
                name="repositorio"
                value={elegido}
                onChange={(e) => setElegido(e.target.value)}
                className={cn(inputBase, "h-10 cursor-pointer")}
              >
                {reposDeApp.map((r) => (
                  <option key={`${r.owner}/${r.repo}`} value={`${r.owner}/${r.repo}`}>
                    {r.owner}/{r.repo}
                    {r.privado ? " · privado" : ""}
                  </option>
                ))}
              </select>
            </Paso>
          )}
          <CamposComunes id={id} numero={2} url={repoElegido?.web ?? ""} rama={repoElegido?.ramaPorDefecto ?? ""} />
        </fieldset>
        {aviso}
        <Pie pendiente={pendiente} puedeEditar={puedeEditar && reposDeApp.length > 0} texto="Conectar este repositorio" />
      </form>
    );
  }

  // --- 2. Sin conectar: la App, o un token --------------------------------------
  return (
    <div className="flex flex-col gap-5">
      {appDisponible && (
        <form action="/api/github/instalar" method="get" className="flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-inset p-4">
          <input type="hidden" name="volver" value={volver} />
          <div>
            <p className="font-medium text-fg">Instala la App de Strappy en tu GitHub</p>
            <p className="mt-0.5 text-sm text-fg-secondary">
              Eliges tú a qué repositorios accede y la puedes quitar cuando quieras. No hay que copiar ningún token.
            </p>
          </div>
          <Button type="submit" size="lg" disabled={!puedeEditar} className="w-fit">
            <FolderGit2 size={16} strokeWidth={2} aria-hidden />
            Instalar la App de Strappy
          </Button>
        </form>
      )}

      <form action={enviar} className="flex flex-col gap-5">
        <input type="hidden" name="acceso" value="token" />
        {oculto}
        {appDisponible && <p className="text-sm font-medium text-fg-secondary">O conéctalo con un token de acceso:</p>}
        <fieldset className="flex flex-col gap-5" disabled={!puedeEditar}>
          <Paso
            numero={1}
            etiqueta="Repositorio"
            ayuda="Como dueño/nombre, o pega su dirección de GitHub."
            htmlFor={`${id}-repositorio`}
          >
            <Input
              id={`${id}-repositorio`}
              name="repositorio"
              placeholder="miempresa/web"
              defaultValue={repo?.repositorio ?? ""}
              autoComplete="off"
              required
            />
          </Paso>
          <Paso
            numero={2}
            etiqueta="Token de acceso"
            ayuda="Uno de grano fino, solo para este repositorio. Lo puedes revocar cuando quieras."
            htmlFor={`${id}-token`}
          >
            <Input id={`${id}-token`} name="token" type="password" autoComplete="off" placeholder="github_pat_…" required />
            <details className="group mt-2 rounded-lg border border-[var(--border-subtle)] bg-inset">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-fg-secondary transition-colors hover:text-fg [&::-webkit-details-marker]:hidden">
                <CircleHelp size={14} strokeWidth={2} aria-hidden />
                ¿Cómo lo creo?
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  aria-hidden
                  className="ml-auto transition-transform duration-[var(--dur-fast)] group-open:rotate-180"
                />
              </summary>
              <ol className="flex list-decimal flex-col gap-1.5 px-3 pb-3 pl-8 text-sm text-fg-secondary">
                <li>En GitHub, ve a Settings → Developer settings → Personal access tokens → Fine-grained tokens.</li>
                <li>Pulsa «Generate new token», ponle «Strappy» y una caducidad.</li>
                <li>En «Repository access» elige «Only select repositories» y marca el de tu web.</li>
                <li>
                  En permisos del repositorio: «Contents», «Pull requests» y «Commit statuses» en lectura y escritura;
                  «Actions», «Checks» y «Deployments» en lectura.
                </li>
                <li>Genera el token, cópialo y pégalo aquí.</li>
              </ol>
            </details>
          </Paso>
          <CamposComunes id={id} numero={3} url={repo?.url ?? ""} rama={repo?.ramaPrincipal ?? ""} />
        </fieldset>
        {aviso}
        <div className="flex flex-wrap items-center gap-3">
          <Pie pendiente={pendiente} puedeEditar={puedeEditar} texto={repo ? "Probar y actualizar" : "Probar y conectar"} />
          {cambiando && (
            <Button type="button" variant="ghost" onClick={() => setCambiando(false)}>
              Cancelar
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

/** Dónde se ve el sitio, qué rama se publica y, si hace falta, el secreto de Vercel. */
function CamposComunes({ id, numero, url, rama }: { id: string; numero: number; url: string; rama: string }) {
  return (
    <>
      <Paso
        numero={numero}
        etiqueta="Dirección del sitio en vivo"
        ayuda="Donde lo ven tus clientes. El Webmaster comprueba ahí cada cambio publicado."
        htmlFor={`${id}-url`}
      >
        <Input id={`${id}-url`} name="url" inputMode="url" placeholder="https://misitio.com" defaultValue={url} key={url} />
      </Paso>
      <Paso
        numero={numero + 1}
        etiqueta="Rama que se publica"
        ayuda="La que despliega tu hosting a producción. Vacío = la rama por defecto del repositorio."
        htmlFor={`${id}-rama`}
        ultimo
      >
        <Input id={`${id}-rama`} name="rama" placeholder="main" defaultValue={rama} key={rama} autoComplete="off" />
        <details className="group mt-2 rounded-lg border border-[var(--border-subtle)] bg-inset">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-fg-secondary transition-colors hover:text-fg [&::-webkit-details-marker]:hidden">
            <CircleHelp size={14} strokeWidth={2} aria-hidden />
            ¿Tus vistas previas de Vercel piden iniciar sesión?
            <ChevronDown
              size={14}
              strokeWidth={2}
              aria-hidden
              className="ml-auto transition-transform duration-[var(--dur-fast)] group-open:rotate-180"
            />
          </summary>
          <div className="flex flex-col gap-2 px-3 pb-3 text-sm text-fg-secondary">
            <p>
              Para que el Webmaster pueda mirar la vista previa de cada cambio, en Vercel ve a Settings → Deployment
              Protection → «Protection Bypass for Automation», crea el secreto y pégalo aquí. Es opcional.
            </p>
            <Input name="bypass" type="password" autoComplete="off" placeholder="Secreto de bypass (opcional)" />
          </div>
        </details>
      </Paso>
    </>
  );
}

function Pie({ pendiente, puedeEditar, texto }: { pendiente: boolean; puedeEditar: boolean; texto: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] pt-4">
      <Button type="submit" size="lg" loading={pendiente} loadingLabel="Probando el acceso…" disabled={!puedeEditar}>
        <PlugZap size={16} strokeWidth={2} aria-hidden />
        {texto}
      </Button>
      <span className="flex items-center gap-1.5 text-2xs text-fg-muted">
        <ShieldCheck size={14} strokeWidth={2} aria-hidden />
        Probamos el acceso antes de guardar. Todo se guarda cifrado.
      </span>
    </div>
  );
}

function Paso({
  numero,
  etiqueta,
  ayuda,
  htmlFor,
  ultimo = false,
  children,
}: {
  numero: number;
  etiqueta: string;
  ayuda: string;
  htmlFor: string;
  ultimo?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[28px_1fr] gap-x-3">
      <div className="flex flex-col items-center">
        <span className="grid size-7 place-items-center rounded-full border border-border bg-page text-sm font-semibold text-fg tnum">
          {numero}
        </span>
        {!ultimo ? <span aria-hidden className="mt-1 w-px flex-1 bg-[var(--border-subtle)]" /> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 pb-1">
        <label htmlFor={htmlFor} className="pt-1 text-base font-medium text-fg">
          {etiqueta}
        </label>
        <p className="text-2xs text-fg-muted">{ayuda}</p>
        {children}
      </div>
    </div>
  );
}
