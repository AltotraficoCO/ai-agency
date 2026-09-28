/**
 * La GitHub App de Strappy: la forma cómoda de conectar un repositorio.
 *
 * El cliente la instala en su cuenta u organización y elige qué repositorios
 * ve. No guardamos ningún token suyo: guardamos el número de instalación, y el
 * worker pide por cada encargo un token de instalación que dura una hora y
 * solo sirve para esos repositorios.
 *
 * El número de instalación que llega en la URL de vuelta NO prueba nada: se
 * puede escribir a mano. Por eso la instalación pide también autorización del
 * usuario (OAuth) y se comprueba con SU token que la instalación es suya antes
 * de dejarla enganchada al espacio.
 */
import { createPrivateKey, createSign } from "node:crypto";
import { API_GITHUB, gh, type GithubOptions } from "./github.js";

export type ConfigApp = {
  readonly appId: string;
  /** La clave privada PEM de la App. Admite «\n» escapados, como llega de una variable de entorno. */
  readonly clavePrivada: string;
  readonly apiBase?: string;
};

export type ConfigOAuthApp = ConfigApp & {
  readonly slug: string;
  readonly clientId: string;
  readonly clientSecret: string;
};

/** Lee la configuración de la App del entorno; `null` si no está completa. */
export function configAppDesdeEnv(env: NodeJS.ProcessEnv = process.env): ConfigOAuthApp | null {
  const appId = env.GITHUB_APP_ID?.trim();
  const clavePrivada = env.GITHUB_APP_PRIVATE_KEY?.trim();
  const slug = env.GITHUB_APP_SLUG?.trim();
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET?.trim();
  if (!appId || !clavePrivada || !slug || !clientId || !clientSecret) return null;
  return { appId, clavePrivada, slug, clientId, clientSecret };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** El JWT con el que la App se identifica ante GitHub. Dura nueve minutos. */
export function jwtDeApp(config: ConfigApp, ahora = Math.floor(Date.now() / 1000)): string {
  const cabecera = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // Un minuto hacia atrás por si el reloj de GitHub va por delante del nuestro.
  const cuerpo = b64url(JSON.stringify({ iat: ahora - 60, exp: ahora + 9 * 60, iss: config.appId }));
  const clave = createPrivateKey(config.clavePrivada.replace(/\\n/g, "\n"));
  const firma = createSign("RSA-SHA256").update(`${cabecera}.${cuerpo}`).sign(clave);
  return `${cabecera}.${cuerpo}.${b64url(firma)}`;
}

/** Token de instalación: una hora, solo los repositorios que el cliente dio. */
export async function tokenDeInstalacion(
  config: ConfigApp,
  installationId: number,
  o: GithubOptions = {},
): Promise<{ token: string; expira: string }> {
  const r = await gh<{ token: string; expires_at: string }>(
    { token: jwtDeApp(config), ...(config.apiBase ? { apiBase: config.apiBase } : {}) },
    o,
    "POST",
    `/app/installations/${installationId}/access_tokens`,
  );
  return { token: r.token, expira: r.expires_at };
}

export type RepoDeInstalacion = {
  readonly owner: string;
  readonly repo: string;
  readonly ramaPorDefecto: string;
  readonly privado: boolean;
  readonly web: string | null;
};

/** Los repositorios que el cliente dejó ver a la App en esta instalación. */
export async function reposDeInstalacion(
  config: ConfigApp,
  installationId: number,
  o: GithubOptions = {},
): Promise<RepoDeInstalacion[]> {
  const { token } = await tokenDeInstalacion(config, installationId, o);
  const c = { token, ...(config.apiBase ? { apiBase: config.apiBase } : {}) };
  const out: RepoDeInstalacion[] = [];
  for (let pagina = 1; pagina <= 5; pagina++) {
    const r = await gh<{
      repositories: {
        name: string;
        owner: { login: string };
        default_branch: string;
        private: boolean;
        homepage: string | null;
      }[];
    }>(c, o, "GET", `/installation/repositories?per_page=100&page=${pagina}`);
    out.push(
      ...r.repositories.map((x) => ({
        owner: x.owner.login,
        repo: x.name,
        ramaPorDefecto: x.default_branch,
        privado: x.private,
        web: x.homepage || null,
      })),
    );
    if (r.repositories.length < 100) break;
  }
  return out;
}

/** URL a la que se manda al cliente para instalar la App. `state` vuelve tal cual. */
export function urlDeInstalacion(config: Pick<ConfigOAuthApp, "slug">, state: string): string {
  return `https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new?state=${encodeURIComponent(state)}`;
}

/**
 * Canjea el `code` de la vuelta de la instalación por un token del usuario y
 * comprueba que ese usuario tiene acceso a la instalación. Es lo que impide
 * que alguien enganche a su espacio la instalación de otro escribiendo su
 * número en la URL.
 */
export async function verificarInstalacion(
  config: ConfigOAuthApp,
  input: { code: string; installationId: number },
  o: GithubOptions = {},
): Promise<boolean> {
  const f = o.fetch ?? globalThis.fetch;
  const res = await f("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code: input.code }),
    signal: AbortSignal.timeout(20_000),
  });
  const datos = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!res.ok || !datos.access_token) return false;
  const c = { token: datos.access_token, apiBase: config.apiBase ?? API_GITHUB };
  for (let pagina = 1; pagina <= 5; pagina++) {
    const r = await gh<{ installations: { id: number }[] }>(c, o, "GET", `/user/installations?per_page=100&page=${pagina}`);
    if (r.installations.some((i) => i.id === input.installationId)) return true;
    if (r.installations.length < 100) break;
  }
  return false;
}
