/**
 * La sesión de cada encargo y las piezas que comparten todas las herramientas
 * del repositorio.
 */
import { z } from "zod";
import type { ToolContext } from "@strappy/tools";
import { entorno } from "../comun.js";
import { requireRepo, type SitioContext } from "../../ports.js";
import * as gh from "../../repo/github.js";
import { RepoSesion } from "../../repo/sesion.js";

/**
 * Una sesión por ejecución. La clave es el contexto del sitio, que el bucle
 * crea una vez por encargo: dos encargos del mismo proceso nunca comparten
 * copia del repositorio.
 */
export const SESIONES = new WeakMap<SitioContext, Promise<RepoSesion>>();
/** La vista previa que dio GitHub en esta ejecución. El modelo nunca elige el host. */
export const VISTAS_PREVIAS = new WeakMap<SitioContext, { url: string; conBypass: boolean }>();

export type Trabajo = {
  readonly sitio: SitioContext;
  readonly creds: ReturnType<typeof requireRepo>;
  readonly opciones: gh.GithubOptions;
  readonly sesion: RepoSesion;
};

export async function trabajo(ctx: ToolContext, slug: string): Promise<Trabajo> {
  const { sitio, opciones } = entorno(ctx, slug);
  const creds = requireRepo(sitio, slug);
  let promesa = SESIONES.get(sitio);
  if (!promesa) {
    promesa = RepoSesion.abrir(creds, {
      workspaceId: ctx.workspaceId,
      taskId: sitio.taskId,
      siteId: sitio.siteId,
      approvals: sitio.approvals,
      ...(sitio.repoEstado ? { puerto: sitio.repoEstado } : {}),
      opciones,
    });
    SESIONES.set(sitio, promesa);
    // Si la descarga falla, que el siguiente intento vuelva a probar.
    promesa.catch(() => SESIONES.delete(sitio));
  }
  return { sitio, creds, opciones, sesion: await promesa };
}

/** Sin sesión: para lo que solo consulta GitHub y no necesita la copia del repo. */
export function soloApi(ctx: ToolContext, slug: string) {
  const { sitio, opciones } = entorno(ctx, slug);
  return { sitio, creds: requireRepo(sitio, slug), opciones };
}

export const ruta = z
  .string()
  .min(1)
  .max(400)
  .transform((r) => r.replace(/^\.?\/+/, ""))
  .describe("Ruta del archivo dentro del repositorio, p. ej. src/app/page.tsx");

export function conNumeros(texto: string, desde: number): string {
  return texto
    .split("\n")
    .map((l, i) => `${String(desde + i).padStart(5)}  ${l}`)
    .join("\n");
}

/** Patrón simple tipo glob: «*.tsx», «src/components/**», «*.{css,scss}». */
export function globARegex(glob: string): RegExp {
  let r = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*" && glob[i + 1] === "*") {
      r += ".*";
      i++;
    } else if (ch === "*") r += "[^/]*";
    else if (ch === "?") r += "[^/]";
    else if (ch === "{") r += "(";
    else if (ch === "}") r += ")";
    else if (ch === "," && r.includes("(")) r += "|";
    else r += ch.replace(/[.+^$|()[\]\\]/g, "\\$&");
  }
  return new RegExp(glob.includes("/") ? `^${r}$` : `(^|/)${r}$`, "i");
}
