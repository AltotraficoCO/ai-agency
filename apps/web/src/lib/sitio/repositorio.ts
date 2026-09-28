import "server-only";

/**
 * El repositorio de GitHub de un sitio hecho a medida (React, Next, Astro…).
 *
 * Vive en `public.connections` con `provider = 'github'`, igual que el
 * WordPress vive con `provider = 'wordpress'`: de ahí lo lee el worker
 * (`apps/worker/src/adaptadores/postgres.ts`). Si la forma de `metadata` o de
 * las credenciales cambia aquí, el worker deja de encontrar el repositorio sin
 * que nada falle al guardar.
 *
 * Dos formas de dar acceso:
 *  - La GitHub App de Strappy: el cliente la instala y elige qué repositorios
 *    ve. No guardamos ningún token suyo, solo el número de instalación.
 *  - Un token personal de grano fino, para quien no quiere instalar nada o si
 *    la App no está configurada en este servidor.
 *
 * Como con el WordPress, se prueba ANTES de guardar: un repositorio sin
 * permiso de escritura no es un sitio conectado, es un encargo que fallará.
 */
import { cookies } from "next/headers";
import { decryptJson, encryptJson, masterKeyFromEnv } from "@strappy/webmaster/crypto";
import { infoRepo, listarRamas, ErrorGithub } from "@strappy/webmaster/github";
import {
  configAppDesdeEnv,
  reposDeInstalacion,
  tokenDeInstalacion,
  urlDeInstalacion,
  type RepoDeInstalacion,
} from "@strappy/webmaster/github-app";
import { conEspacio } from "@/lib/db/pool";

export const RUTA_SITIO = "/ajustes/sitio";
const COOKIE_INSTALACION = "strappy_github_instalacion";
/** El enlace de instalación y la instalación recién hecha caducan: un valor viejo no sirve. */
const VIGENCIA_ESTADO_MS = 20 * 60_000;
const VIGENCIA_INSTALACION_MS = 30 * 60_000;

export type RepoGuardado = {
  id: string;
  repositorio: string;
  url: string;
  ramaPrincipal: string;
  acceso: "token" | "app";
  estado: string;
  conBypass: boolean;
};

export type ResultadoRepo = { ok: true; nombre: string } | { ok: false; error: string };

/** ¿Está la GitHub App configurada en este servidor? */
export function hayAppDeGithub(): boolean {
  return configAppDesdeEnv() !== null;
}

/** El repositorio conectado del espacio, o `null`. Por ahora hay uno por espacio. */
export async function repoDelEspacio(workspaceId: string): Promise<RepoGuardado | null> {
  return conEspacio(workspaceId, async (scope) => {
    const { rows } = await scope.query<{
      id: string;
      metadata: Record<string, unknown> | null;
      estado: string;
    }>(
      `select id, metadata, status as estado
         from public.connections
        where workspace_id = $1 and provider = 'github' and status <> 'revoked'
        order by updated_at desc
        limit 1`,
      [workspaceId],
    );
    const f = rows[0];
    const m = f?.metadata ?? {};
    if (!f || typeof m.owner !== "string" || typeof m.repo !== "string") return null;
    return {
      id: f.id,
      repositorio: `${m.owner}/${m.repo}`,
      url: typeof m.url === "string" ? m.url : "",
      ramaPrincipal: typeof m.rama_principal === "string" ? m.rama_principal : "main",
      acceso: m.acceso === "app" ? "app" : "token",
      estado: f.estado,
      conBypass: m.con_bypass === true,
    };
  });
}

// ---------------------------------------------------------------------------
// Datos del formulario
// ---------------------------------------------------------------------------

/** «acme/web», «https://github.com/acme/web» o «git@github.com:acme/web.git» → {owner, repo}. */
export function leerRepositorio(valor: string): { owner: string; repo: string } | null {
  const texto = valor.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const m =
    /^(?:https?:\/\/)?(?:www\.)?github\.com[/:]([\w.-]+)\/([\w.-]+)$/i.exec(texto) ??
    /^git@github\.com:([\w.-]+)\/([\w.-]+)$/i.exec(texto) ??
    /^([\w.-]+)\/([\w.-]+)$/.exec(texto);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}

function normalizarUrl(valor: string): string | null {
  const texto = valor.trim();
  if (!texto) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`);
    if (!url.hostname.includes(".")) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function clave(): Buffer | null {
  try {
    return masterKeyFromEnv();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Probar y guardar
// ---------------------------------------------------------------------------

type Entrada = {
  workspaceId: string;
  usuarioId: string;
  repositorio: string;
  url: string;
  rama: string;
  bypass: string;
};

/**
 * Comprueba con el token que el repositorio existe, que se puede escribir y que
 * la rama principal es real. Devuelve lo que hay que guardar o un error que el
 * cliente entiende.
 */
async function probar(
  token: string,
  entrada: Pick<Entrada, "repositorio" | "url" | "rama">,
): Promise<
  | { ok: true; owner: string; repo: string; url: string; rama: string; nombre: string }
  | { ok: false; error: string }
> {
  const nombre = leerRepositorio(entrada.repositorio);
  if (!nombre) {
    return { ok: false, error: "Escribe el repositorio como dueño/nombre, por ejemplo acme/web, o pega su dirección de GitHub." };
  }
  const creds = { proveedor: "github" as const, ...nombre, ramaPrincipal: "main", token, urlProduccion: "" };
  let info: Awaited<ReturnType<typeof infoRepo>>;
  try {
    info = await infoRepo(creds);
  } catch (e) {
    if (e instanceof ErrorGithub && (e.status === 404 || e.status === 403)) {
      return { ok: false, error: `No encontramos ${nombre.owner}/${nombre.repo} con ese acceso. Revisa el nombre y que el token o la App incluyan ese repositorio.` };
    }
    if (e instanceof ErrorGithub && e.status === 401) {
      return { ok: false, error: "GitHub rechazó el token: está mal copiado, caducó o se revocó." };
    }
    return { ok: false, error: `No pudimos hablar con GitHub (${e instanceof Error ? e.message.slice(0, 160) : "sin respuesta"}).` };
  }
  if (info.archivado) return { ok: false, error: `${info.nombre} está archivado en GitHub: no admite cambios.` };
  if (!info.puedeEscribir) {
    return {
      ok: false,
      error: "Ese acceso solo puede leer el repositorio. El Webmaster necesita permiso de escritura en «Contents» y «Pull requests».",
    };
  }

  const rama = entrada.rama.trim() || info.ramaPorDefecto;
  if (rama !== info.ramaPorDefecto) {
    const ramas = await listarRamas({ ...creds, owner: nombre.owner, repo: nombre.repo });
    if (!ramas.some((r) => r.nombre === rama)) {
      return { ok: false, error: `La rama «${rama}» no existe en ${info.nombre}.` };
    }
  }

  const url = normalizarUrl(entrada.url) ?? (info.web ? normalizarUrl(info.web) : null);
  if (!url) {
    return { ok: false, error: "Escribe la dirección donde se ve tu sitio en vivo, por ejemplo https://misitio.com." };
  }
  const [owner, repo] = info.nombre.split("/") as [string, string];
  return { ok: true, owner, repo, url, rama, nombre: info.nombre };
}

async function guardar(input: {
  workspaceId: string;
  usuarioId: string;
  owner: string;
  repo: string;
  url: string;
  rama: string;
  acceso: "token" | "app";
  credenciales: { token?: string; installationId?: number; bypassVistaPrevia?: string };
  clave: Buffer;
}): Promise<void> {
  await conEspacio(input.workspaceId, async (scope) => {
    // `name` es owner/repo: reconectar el mismo repositorio actualiza la fila y
    // el `id` que ya tengan los encargos sigue valiendo.
    await scope.query(
      `insert into public.connections
         (workspace_id, provider, name, auth_type, credentials_encrypted, key_version,
          metadata, status, last_verified_at, created_by)
       values ($1, 'github', $2, 'bearer', $3, 1, $4::jsonb, 'active', now(), $5)
       on conflict (workspace_id, provider, name) do update set
         credentials_encrypted = excluded.credentials_encrypted,
         key_version = excluded.key_version,
         metadata = public.connections.metadata || excluded.metadata,
         status = 'active',
         last_verified_at = now(),
         updated_at = now()`,
      [
        input.workspaceId,
        `${input.owner}/${input.repo}`,
        encryptJson(input.credenciales, input.clave),
        JSON.stringify({
          url: input.url,
          tipo: "repo",
          owner: input.owner,
          repo: input.repo,
          rama_principal: input.rama,
          nombre: new URL(input.url).hostname,
          acceso: input.acceso,
          con_bypass: Boolean(input.credenciales.bypassVistaPrevia),
          // Ejecuta desde el primer encargo: nada llega a producción sin que el
          // cliente elija la rama y, si es un PR, sin su clic para publicar.
          primer_contacto: false,
        }),
        input.usuarioId,
      ],
    );
    // Un espacio cuida UN sitio. Si antes era otro repositorio, deja de estar activo.
    await scope.query(
      `update public.connections set status = 'revoked', updated_at = now()
        where workspace_id = $1 and provider = 'github' and name <> $2 and status = 'active'`,
      [input.workspaceId, `${input.owner}/${input.repo}`],
    );
  });
}

/** Conectar con un token personal de grano fino. */
export async function conectarRepoConToken(input: Entrada & { token: string }): Promise<ResultadoRepo> {
  const k = clave();
  if (!k) return { ok: false, error: "Falta configurar la clave de cifrado del Webmaster en el servidor." };
  const token = input.token.trim();
  if (!token) return { ok: false, error: "Pega el token de acceso de GitHub." };
  if (!/^(github_pat_|ghp_|gho_|ghs_)[\w]+$/.test(token)) {
    return { ok: false, error: "Eso no parece un token de GitHub: empieza por github_pat_ o ghp_." };
  }
  const p = await probar(token, input);
  if (!p.ok) return p;
  await guardar({
    workspaceId: input.workspaceId,
    usuarioId: input.usuarioId,
    owner: p.owner,
    repo: p.repo,
    url: p.url,
    rama: p.rama,
    acceso: "token",
    credenciales: { token, ...(input.bypass.trim() ? { bypassVistaPrevia: input.bypass.trim() } : {}) },
    clave: k,
  });
  return { ok: true, nombre: p.nombre };
}

/** Conectar un repositorio de la instalación de la App que acaba de hacer este espacio. */
export async function conectarRepoConApp(input: Entrada): Promise<ResultadoRepo> {
  const k = clave();
  const config = configAppDesdeEnv();
  if (!k || !config) return { ok: false, error: "La GitHub App no está configurada en este servidor. Conecta con un token." };
  const instalacion = await instalacionPendiente(input.workspaceId);
  if (!instalacion) {
    return { ok: false, error: "La instalación de la App caducó o no es de este espacio. Vuelve a pulsar «Instalar la App de Strappy»." };
  }
  const nombre = leerRepositorio(input.repositorio);
  const repos = await reposDeInstalacion(config, instalacion.installationId);
  const elegido = nombre && repos.find((r) => r.owner.toLowerCase() === nombre.owner.toLowerCase() && r.repo.toLowerCase() === nombre.repo.toLowerCase());
  if (!elegido) return { ok: false, error: "Ese repositorio no está entre los que diste a la App. Elige uno de la lista." };

  const { token } = await tokenDeInstalacion(config, instalacion.installationId);
  const p = await probar(token, { ...input, url: input.url || elegido.web || "" });
  if (!p.ok) return p;
  await guardar({
    workspaceId: input.workspaceId,
    usuarioId: input.usuarioId,
    owner: p.owner,
    repo: p.repo,
    url: p.url,
    rama: p.rama,
    acceso: "app",
    credenciales: {
      installationId: instalacion.installationId,
      ...(input.bypass.trim() ? { bypassVistaPrevia: input.bypass.trim() } : {}),
    },
    clave: k,
  });
  (await cookies()).delete(COOKIE_INSTALACION);
  return { ok: true, nombre: p.nombre };
}

export async function desconectarRepo(workspaceId: string): Promise<void> {
  await conEspacio(workspaceId, async (scope) => {
    await scope.query(
      `update public.connections set status = 'revoked', updated_at = now()
        where workspace_id = $1 and provider = 'github' and status <> 'revoked'`,
      [workspaceId],
    );
  });
}

// ---------------------------------------------------------------------------
// La instalación de la GitHub App: ida, vuelta y lo que queda entre medias
// ---------------------------------------------------------------------------

/** A dónde mandar al navegador para instalar la App. `null` sin App configurada. */
export function urlParaInstalar(input: { workspaceId: string; userId: string; volver: string }): string | null {
  const config = configAppDesdeEnv();
  const k = clave();
  if (!config || !k) return null;
  const state = encryptJson({ w: input.workspaceId, u: input.userId, v: input.volver, exp: Date.now() + VIGENCIA_ESTADO_MS }, k);
  return urlDeInstalacion(config, Buffer.from(state).toString("base64url"));
}

export function leerEstadoInstalacion(state: string): { workspaceId: string; userId: string; volver: string } | null {
  const k = clave();
  if (!k) return null;
  try {
    const d = decryptJson<{ w?: unknown; u?: unknown; v?: unknown; exp?: unknown }>(Buffer.from(state, "base64url").toString(), k);
    if (typeof d.w !== "string" || typeof d.u !== "string" || typeof d.exp !== "number" || d.exp < Date.now()) return null;
    return { workspaceId: d.w, userId: d.u, volver: rutaDeVuelta(typeof d.v === "string" ? d.v : null) };
  } catch {
    return null;
  }
}

/** Solo rutas de esta app: un `volver` con dominio sería un redireccionamiento abierto. */
export function rutaDeVuelta(valor: string | null | undefined): string {
  if (!valor || !valor.startsWith("/") || valor.startsWith("//") || valor.startsWith("/api/")) return RUTA_SITIO;
  return valor;
}

/**
 * Deja la instalación ya verificada en una cookie cifrada y de vida corta: el
 * formulario la usa para ofrecer los repositorios y para guardar el elegido.
 * No viaja en la URL ni en un campo oculto, que cualquiera podría cambiar.
 */
export async function recordarInstalacion(workspaceId: string, installationId: number): Promise<void> {
  const k = clave();
  if (!k) return;
  (await cookies()).set(
    COOKIE_INSTALACION,
    encryptJson({ w: workspaceId, i: installationId, exp: Date.now() + VIGENCIA_INSTALACION_MS }, k),
    { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: VIGENCIA_INSTALACION_MS / 1000 },
  );
}

export async function instalacionPendiente(workspaceId: string): Promise<{ installationId: number } | null> {
  const k = clave();
  const valor = (await cookies()).get(COOKIE_INSTALACION)?.value;
  if (!k || !valor) return null;
  try {
    const d = decryptJson<{ w?: unknown; i?: unknown; exp?: unknown }>(valor, k);
    if (d.w !== workspaceId || typeof d.i !== "number" || typeof d.exp !== "number" || d.exp < Date.now()) return null;
    return { installationId: d.i };
  } catch {
    return null;
  }
}

/** Los repositorios que el cliente dio a la App en la instalación pendiente. */
export async function reposDisponibles(workspaceId: string): Promise<RepoDeInstalacion[] | null> {
  const config = configAppDesdeEnv();
  const instalacion = await instalacionPendiente(workspaceId);
  if (!config || !instalacion) return null;
  try {
    return await reposDeInstalacion(config, instalacion.installationId);
  } catch {
    return null;
  }
}
