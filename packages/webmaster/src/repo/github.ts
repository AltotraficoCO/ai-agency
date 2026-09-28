/**
 * Cliente de la API REST de GitHub para el Webmaster de repositorios.
 *
 * Todo pasa por la API, sin `git` instalado ni una copia en disco: el worker
 * no ejecuta nada del repositorio del cliente —ni hooks, ni `npm install`, ni
 * un build—, así que un repo malicioso no tiene por dónde correr código en
 * nuestra máquina. Leer es descargar el tarball; escribir es crear blobs, un
 * árbol y un commit con la Git Data API.
 *
 * Los errores salen en castellano y dicen qué hacer, porque el primero que
 * los lee es el modelo y el segundo, el cliente en el RESUMEN.
 */
import type { RepoCreds } from "../ports.js";

type Fetch = typeof globalThis.fetch;

export type GithubOptions = {
  readonly fetch?: Fetch;
  readonly abortSignal?: AbortSignal;
};

export const API_GITHUB = "https://api.github.com";

export class ErrorGithub extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ErrorGithub";
  }
}

function señal(timeoutMs: number, externa?: AbortSignal): AbortSignal {
  const propia = AbortSignal.timeout(timeoutMs);
  return externa ? AbortSignal.any([propia, externa]) : propia;
}

function cabeceras(token: string, accept = "application/vnd.github+json"): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "strappy-webmaster",
  };
}

/** Codifica cada segmento de una ruta de archivo o de rama, sin tocar las barras. */
export function rutaUrl(ruta: string): string {
  return ruta.split("/").map(encodeURIComponent).join("/");
}

function explicar(status: number, metodo: string, ruta: string, cuerpo: string): string {
  let mensaje = cuerpo.slice(0, 300);
  try {
    const d = JSON.parse(cuerpo) as { message?: string; errors?: { message?: string; code?: string }[] };
    const extra = (d.errors ?? []).map((e) => e.message ?? e.code).filter(Boolean).join("; ");
    mensaje = `${d.message ?? ""}${extra ? ` (${extra})` : ""}`;
  } catch {
    /* cuerpo no-JSON: va crudo */
  }
  const donde = `GitHub ${metodo} ${ruta} (${status})`;
  if (status === 401) {
    return `${donde}: GitHub rechazó el acceso. El token caducó o se revocó: el cliente tiene que reconectar el repositorio.`;
  }
  if (status === 403 && /rate limit/i.test(mensaje)) {
    return `${donde}: se agotó el cupo de llamadas de GitHub. Espera unos minutos antes de seguir.`;
  }
  if (status === 403) {
    return `${donde}: sin permiso (${mensaje}). El token necesita permiso de lectura y escritura sobre «Contents» y «Pull requests».`;
  }
  if (status === 404) {
    return `${donde}: no existe o el token no tiene acceso. ${mensaje}`;
  }
  return `${donde}: ${mensaje}`;
}

/** Llamada JSON a la API. */
export async function gh<T>(
  c: Pick<RepoCreds, "token" | "apiBase">,
  o: GithubOptions,
  metodo: string,
  ruta: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  const f = o.fetch ?? globalThis.fetch;
  const base = (c.apiBase ?? API_GITHUB).replace(/\/+$/, "");
  const res = await f(`${base}${ruta}`, {
    method: metodo,
    headers: {
      ...cabeceras(c.token),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: señal(timeoutMs, o.abortSignal),
  });
  const texto = await res.text();
  if (!res.ok) throw new ErrorGithub(explicar(res.status, metodo, ruta, texto), res.status);
  return (texto ? JSON.parse(texto) : null) as T;
}

/** Igual, pero `null` cuando GitHub dice 404. */
async function ghOpcional<T>(
  c: RepoCreds,
  o: GithubOptions,
  metodo: string,
  ruta: string,
): Promise<T | null> {
  try {
    return await gh<T>(c, o, metodo, ruta);
  } catch (e) {
    if (e instanceof ErrorGithub && e.status === 404) return null;
    throw e;
  }
}

/** Descarga binaria (tarball, logs). Sigue la redirección a codeload o al almacén de logs. */
async function descargar(c: RepoCreds, o: GithubOptions, ruta: string, timeoutMs: number): Promise<Response> {
  const f = o.fetch ?? globalThis.fetch;
  const base = (c.apiBase ?? API_GITHUB).replace(/\/+$/, "");
  // `fetch` quita la cabecera Authorization al seguir una redirección a otro
  // origen: justo lo que queremos, la URL firmada no la necesita.
  const res = await f(`${base}${ruta}`, {
    headers: cabeceras(c.token, "*/*"),
    redirect: "follow",
    signal: señal(timeoutMs, o.abortSignal),
  });
  if (!res.ok) {
    throw new ErrorGithub(explicar(res.status, "GET", ruta, await res.text().catch(() => "")), res.status);
  }
  return res;
}

const repoDe = (c: RepoCreds) => `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;

// ---------------------------------------------------------------------------
// Repositorio y ramas
// ---------------------------------------------------------------------------

export type InfoRepo = {
  readonly nombre: string;
  readonly privado: boolean;
  readonly ramaPorDefecto: string;
  readonly puedeEscribir: boolean;
  readonly url: string;
  readonly descripcion: string | null;
  readonly lenguaje: string | null;
  readonly web: string | null;
  readonly archivado: boolean;
};

export async function infoRepo(c: RepoCreds, o: GithubOptions = {}): Promise<InfoRepo> {
  const r = await gh<{
    full_name: string;
    private: boolean;
    default_branch: string;
    permissions?: { push?: boolean; admin?: boolean; maintain?: boolean };
    html_url: string;
    description: string | null;
    language: string | null;
    homepage: string | null;
    archived: boolean;
  }>(c, o, "GET", repoDe(c));
  return {
    nombre: r.full_name,
    privado: r.private,
    ramaPorDefecto: r.default_branch,
    // Sin el bloque `permissions` (tokens de instalación) no se sabe: se
    // descubre al primer commit, y el error de GitHub ya dice qué pasa.
    puedeEscribir: r.permissions ? Boolean(r.permissions.push || r.permissions.admin || r.permissions.maintain) : true,
    url: r.html_url,
    descripcion: r.description,
    lenguaje: r.language,
    web: r.homepage || null,
    archivado: r.archived,
  };
}

export type Rama = { readonly nombre: string; readonly sha: string; readonly protegida: boolean };

export async function listarRamas(c: RepoCreds, o: GithubOptions = {}): Promise<Rama[]> {
  const ramas: Rama[] = [];
  for (let pagina = 1; pagina <= 3; pagina++) {
    const lote = await gh<{ name: string; commit: { sha: string }; protected: boolean }[]>(
      c,
      o,
      "GET",
      `${repoDe(c)}/branches?per_page=100&page=${pagina}`,
    );
    ramas.push(...lote.map((b) => ({ nombre: b.name, sha: b.commit.sha, protegida: b.protected })));
    if (lote.length < 100) break;
  }
  return ramas;
}

/** El commit al que apunta una rama, o `null` si no existe. */
export async function shaDeRama(c: RepoCreds, rama: string, o: GithubOptions = {}): Promise<string | null> {
  const r = await ghOpcional<{ object: { sha: string } }>(c, o, "GET", `${repoDe(c)}/git/ref/heads/${rutaUrl(rama)}`);
  return r?.object.sha ?? null;
}

export async function crearRama(c: RepoCreds, rama: string, sha: string, o: GithubOptions = {}): Promise<void> {
  await gh(c, o, "POST", `${repoDe(c)}/git/refs`, { ref: `refs/heads/${rama}`, sha });
}

/** El tarball de una rama o commit, comprimido. */
export async function descargarTarball(c: RepoCreds, ref: string, o: GithubOptions = {}): Promise<Uint8Array> {
  const res = await descargar(c, o, `${repoDe(c)}/tarball/${rutaUrl(ref)}`, 120_000);
  return new Uint8Array(await res.arrayBuffer());
}

/** Un archivo en un commit concreto; `null` si ahí no existía. */
export async function archivoEn(
  c: RepoCreds,
  ruta: string,
  ref: string,
  o: GithubOptions = {},
): Promise<{ base64: string } | null> {
  const r = await ghOpcional<{ content?: string; encoding?: string; type: string; sha: string }>(
    c,
    o,
    "GET",
    `${repoDe(c)}/contents/${rutaUrl(ruta)}?ref=${encodeURIComponent(ref)}`,
  );
  if (!r || r.type !== "file") return null;
  if (r.content && r.encoding === "base64") return { base64: r.content.replace(/\n/g, "") };
  // Más de 1 MB: la API de contenidos no lo trae y hay que ir al blob.
  const blob = await gh<{ content: string }>(c, o, "GET", `${repoDe(c)}/git/blobs/${r.sha}`);
  return { base64: blob.content.replace(/\n/g, "") };
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

export type ArchivoCommit = {
  readonly ruta: string;
  /** `null` borra el archivo. */
  readonly contenido: { readonly texto: string } | { readonly base64: string } | null;
  /** Modo git; por defecto 100644. */
  readonly modo?: string;
};

/**
 * Un commit con varios archivos a la vez sobre `padre`, y la rama movida a él.
 * No fuerza: si alguien movió la rama entretanto, GitHub lo rechaza y el
 * trabajo de esa persona no se pisa.
 */
export async function commitArchivos(
  c: RepoCreds,
  input: { rama: string; padre: string; mensaje: string; archivos: readonly ArchivoCommit[] },
  o: GithubOptions = {},
): Promise<string> {
  const padre = await gh<{ tree: { sha: string } }>(c, o, "GET", `${repoDe(c)}/git/commits/${input.padre}`);
  const arbol: { path: string; mode: string; type: "blob"; sha: string | null }[] = [];
  for (const a of input.archivos) {
    if (a.contenido === null) {
      arbol.push({ path: a.ruta, mode: a.modo ?? "100644", type: "blob", sha: null });
      continue;
    }
    const blob = await gh<{ sha: string }>(
      c,
      o,
      "POST",
      `${repoDe(c)}/git/blobs`,
      "texto" in a.contenido
        ? { content: a.contenido.texto, encoding: "utf-8" }
        : { content: a.contenido.base64, encoding: "base64" },
      60_000,
    );
    arbol.push({ path: a.ruta, mode: a.modo ?? "100644", type: "blob", sha: blob.sha });
  }
  const nuevoArbol = await gh<{ sha: string }>(c, o, "POST", `${repoDe(c)}/git/trees`, {
    base_tree: padre.tree.sha,
    tree: arbol,
  });
  const commit = await gh<{ sha: string }>(c, o, "POST", `${repoDe(c)}/git/commits`, {
    message: input.mensaje,
    tree: nuevoArbol.sha,
    parents: [input.padre],
  });
  await gh(c, o, "PATCH", `${repoDe(c)}/git/refs/heads/${rutaUrl(input.rama)}`, { sha: commit.sha, force: false });
  return commit.sha;
}

export type CommitResumen = {
  readonly sha: string;
  readonly mensaje: string;
  readonly autor: string;
  readonly fecha: string;
};

export async function listarCommits(
  c: RepoCreds,
  input: { rama: string; ruta?: string; cantidad?: number },
  o: GithubOptions = {},
): Promise<CommitResumen[]> {
  const q = new URLSearchParams({ sha: input.rama, per_page: String(Math.min(input.cantidad ?? 10, 30)) });
  if (input.ruta) q.set("path", input.ruta);
  const r = await gh<{ sha: string; commit: { message: string; author: { name: string; date: string } | null } }[]>(
    c,
    o,
    "GET",
    `${repoDe(c)}/commits?${q}`,
  );
  return r.map((x) => ({
    sha: x.sha,
    mensaje: x.commit.message.split("\n")[0] ?? "",
    autor: x.commit.author?.name ?? "?",
    fecha: x.commit.author?.date ?? "",
  }));
}

export type ArchivoCambiado = {
  readonly ruta: string;
  readonly estado: string;
  readonly rutaAnterior?: string;
};

/** Qué archivos cambian entre dos commits, y cuántos commits lleva `cabeza` por delante. */
export async function comparar(
  c: RepoCreds,
  base: string,
  cabeza: string,
  o: GithubOptions = {},
): Promise<{ archivos: ArchivoCambiado[]; porDelante: number; porDetras: number }> {
  const r = await gh<{
    files?: { filename: string; status: string; previous_filename?: string }[];
    ahead_by: number;
    behind_by: number;
  }>(c, o, "GET", `${repoDe(c)}/compare/${rutaUrl(base)}...${rutaUrl(cabeza)}`);
  return {
    archivos: (r.files ?? []).map((f) => ({
      ruta: f.filename,
      estado: f.status,
      ...(f.previous_filename ? { rutaAnterior: f.previous_filename } : {}),
    })),
    porDelante: r.ahead_by,
    porDetras: r.behind_by,
  };
}

/** Los padres de un commit: para deshacer un merge hay que volver al primero. */
export async function padresDe(c: RepoCreds, sha: string, o: GithubOptions = {}): Promise<string[]> {
  const r = await gh<{ parents: { sha: string }[] }>(c, o, "GET", `${repoDe(c)}/git/commits/${sha}`);
  return r.parents.map((p) => p.sha);
}

export async function archivosDeCommit(c: RepoCreds, sha: string, o: GithubOptions = {}): Promise<ArchivoCambiado[]> {
  const r = await gh<{ files?: { filename: string; status: string; previous_filename?: string }[] }>(
    c,
    o,
    "GET",
    `${repoDe(c)}/commits/${sha}`,
  );
  return (r.files ?? []).map((f) => ({
    ruta: f.filename,
    estado: f.status,
    ...(f.previous_filename ? { rutaAnterior: f.previous_filename } : {}),
  }));
}

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

export type PullRequest = {
  readonly numero: number;
  readonly titulo: string;
  readonly estado: "abierto" | "cerrado" | "fusionado";
  readonly borrador: boolean;
  readonly url: string;
  readonly rama: string;
  readonly base: string;
  readonly shaCabeza: string;
  readonly fusionable: boolean | null;
  readonly estadoFusion: string | null;
  readonly shaFusion: string | null;
  readonly autor: string;
  readonly actualizado: string;
};

type PrApi = {
  number: number;
  title: string;
  state: "open" | "closed";
  merged_at: string | null;
  merged?: boolean;
  draft?: boolean;
  html_url: string;
  head: { ref: string; sha: string };
  base: { ref: string };
  mergeable?: boolean | null;
  mergeable_state?: string;
  merge_commit_sha?: string | null;
  user?: { login: string } | null;
  updated_at: string;
};

function pr(p: PrApi): PullRequest {
  return {
    numero: p.number,
    titulo: p.title,
    estado: p.merged_at || p.merged ? "fusionado" : p.state === "open" ? "abierto" : "cerrado",
    borrador: Boolean(p.draft),
    url: p.html_url,
    rama: p.head.ref,
    base: p.base.ref,
    shaCabeza: p.head.sha,
    fusionable: p.mergeable ?? null,
    estadoFusion: p.mergeable_state ?? null,
    shaFusion: p.merge_commit_sha ?? null,
    autor: p.user?.login ?? "?",
    actualizado: p.updated_at,
  };
}

export async function leerPR(c: RepoCreds, numero: number, o: GithubOptions = {}): Promise<PullRequest> {
  return pr(await gh<PrApi>(c, o, "GET", `${repoDe(c)}/pulls/${numero}`));
}

export async function listarPRs(
  c: RepoCreds,
  input: { estado?: "open" | "closed" | "all"; rama?: string; cantidad?: number },
  o: GithubOptions = {},
): Promise<PullRequest[]> {
  const q = new URLSearchParams({
    state: input.estado ?? "all",
    per_page: String(Math.min(input.cantidad ?? 20, 50)),
    sort: "updated",
    direction: "desc",
  });
  if (input.rama) q.set("head", `${c.owner}:${input.rama}`);
  return (await gh<PrApi[]>(c, o, "GET", `${repoDe(c)}/pulls?${q}`)).map(pr);
}

export async function crearPR(
  c: RepoCreds,
  input: { titulo: string; cuerpo: string; rama: string; base: string; borrador: boolean },
  o: GithubOptions = {},
): Promise<PullRequest> {
  return pr(
    await gh<PrApi>(c, o, "POST", `${repoDe(c)}/pulls`, {
      title: input.titulo,
      body: input.cuerpo,
      head: input.rama,
      base: input.base,
      draft: input.borrador,
    }),
  );
}

export async function actualizarPR(
  c: RepoCreds,
  numero: number,
  input: { titulo?: string; cuerpo?: string },
  o: GithubOptions = {},
): Promise<PullRequest> {
  return pr(
    await gh<PrApi>(c, o, "PATCH", `${repoDe(c)}/pulls/${numero}`, {
      ...(input.titulo ? { title: input.titulo } : {}),
      ...(input.cuerpo ? { body: input.cuerpo } : {}),
    }),
  );
}

export async function fusionarPR(
  c: RepoCreds,
  numero: number,
  input: { metodo: "squash" | "merge" | "rebase"; sha: string; titulo?: string },
  o: GithubOptions = {},
): Promise<{ sha: string }> {
  const r = await gh<{ sha: string; merged: boolean; message: string }>(
    c,
    o,
    "PUT",
    `${repoDe(c)}/pulls/${numero}/merge`,
    {
      merge_method: input.metodo,
      // Solo se fusiona lo que se revisó: si alguien empujó otro commit
      // después, GitHub responde 409 en vez de publicar algo que nadie miró.
      sha: input.sha,
      ...(input.titulo ? { commit_title: input.titulo } : {}),
    },
  );
  if (!r.merged) throw new Error(`GitHub no fusionó el PR #${numero}: ${r.message}`);
  return { sha: r.sha };
}

export async function archivosDePR(c: RepoCreds, numero: number, o: GithubOptions = {}): Promise<ArchivoCambiado[]> {
  const r = await gh<{ filename: string; status: string; previous_filename?: string }[]>(
    c,
    o,
    "GET",
    `${repoDe(c)}/pulls/${numero}/files?per_page=100`,
  );
  return r.map((f) => ({
    ruta: f.filename,
    estado: f.status,
    ...(f.previous_filename ? { rutaAnterior: f.previous_filename } : {}),
  }));
}

export type ComentarioPR = {
  readonly tipo: "conversacion" | "revision" | "linea";
  readonly autor: string;
  readonly texto: string;
  readonly fecha: string;
  readonly estado?: string;
  readonly archivo?: string;
  readonly linea?: number | null;
};

/** Todo lo que se dijo en un PR: conversación, revisiones y comentarios en líneas. */
export async function comentariosDePR(c: RepoCreds, numero: number, o: GithubOptions = {}): Promise<ComentarioPR[]> {
  const [conversacion, revisiones, lineas] = await Promise.all([
    gh<{ user: { login: string } | null; body: string; created_at: string }[]>(
      c,
      o,
      "GET",
      `${repoDe(c)}/issues/${numero}/comments?per_page=50`,
    ),
    gh<{ user: { login: string } | null; body: string | null; state: string; submitted_at: string | null }[]>(
      c,
      o,
      "GET",
      `${repoDe(c)}/pulls/${numero}/reviews?per_page=50`,
    ),
    gh<{ user: { login: string } | null; body: string; created_at: string; path: string; line: number | null }[]>(
      c,
      o,
      "GET",
      `${repoDe(c)}/pulls/${numero}/comments?per_page=100`,
    ),
  ]);
  const todos: ComentarioPR[] = [
    ...conversacion.map((x) => ({
      tipo: "conversacion" as const,
      autor: x.user?.login ?? "?",
      texto: x.body,
      fecha: x.created_at,
    })),
    ...revisiones
      .filter((x) => (x.body ?? "").trim() || x.state !== "COMMENTED")
      .map((x) => ({
        tipo: "revision" as const,
        autor: x.user?.login ?? "?",
        texto: x.body ?? "",
        fecha: x.submitted_at ?? "",
        estado: x.state,
      })),
    ...lineas.map((x) => ({
      tipo: "linea" as const,
      autor: x.user?.login ?? "?",
      texto: x.body,
      fecha: x.created_at,
      archivo: x.path,
      linea: x.line,
    })),
  ];
  return todos.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export async function comentarPR(c: RepoCreds, numero: number, texto: string, o: GithubOptions = {}): Promise<string> {
  const r = await gh<{ html_url: string }>(c, o, "POST", `${repoDe(c)}/issues/${numero}/comments`, { body: texto });
  return r.html_url;
}

// ---------------------------------------------------------------------------
// Checks, estados y despliegues
// ---------------------------------------------------------------------------

export type Comprobacion = {
  readonly nombre: string;
  /** en_curso · exito · fallo · neutral */
  readonly estado: "en_curso" | "exito" | "fallo" | "neutral";
  readonly url: string | null;
  readonly resumen: string | null;
  /** Si es un job de GitHub Actions, su id: de ahí se sacan los logs. */
  readonly jobId: number | null;
};

export type Despliegue = {
  readonly entorno: string;
  readonly estado: "en_curso" | "exito" | "fallo" | "neutral";
  readonly url: string | null;
  readonly logs: string | null;
  readonly creado: string;
};

function estadoDeCheck(status: string, conclusion: string | null): Comprobacion["estado"] {
  if (status !== "completed") return "en_curso";
  if (conclusion === "success") return "exito";
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "cancelled" || conclusion === "action_required") {
    return "fallo";
  }
  return "neutral";
}

function estadoDeStatus(state: string): Comprobacion["estado"] {
  if (state === "success") return "exito";
  if (state === "failure" || state === "error") return "fallo";
  if (state === "pending" || state === "queued" || state === "in_progress") return "en_curso";
  return "neutral";
}

/** Los checks (Actions, Vercel, Netlify…) y los estados clásicos de un commit. */
export async function comprobacionesDe(c: RepoCreds, sha: string, o: GithubOptions = {}): Promise<Comprobacion[]> {
  const [checks, estados] = await Promise.all([
    gh<{
      check_runs: {
        name: string;
        status: string;
        conclusion: string | null;
        details_url: string | null;
        html_url: string | null;
        output?: { title?: string | null; summary?: string | null; text?: string | null };
        app?: { slug?: string } | null;
      }[];
    }>(c, o, "GET", `${repoDe(c)}/commits/${sha}/check-runs?per_page=50`),
    gh<{ statuses: { context: string; state: string; target_url: string | null; description: string | null }[] }>(
      c,
      o,
      "GET",
      `${repoDe(c)}/commits/${sha}/status`,
    ),
  ]);
  const deChecks = checks.check_runs.map((r): Comprobacion => {
    const url = r.details_url ?? r.html_url;
    const job = r.app?.slug === "github-actions" ? /\/job\/(\d+)/.exec(url ?? "") : null;
    const resumen = [r.output?.title, r.output?.summary, r.output?.text].filter(Boolean).join("\n").trim();
    return {
      nombre: r.name,
      estado: estadoDeCheck(r.status, r.conclusion),
      url,
      resumen: resumen ? resumen.slice(0, 1500) : null,
      jobId: job ? Number(job[1]) : null,
    };
  });
  // Un contexto repite estados a lo largo del tiempo: vale el más reciente, que es el primero.
  const vistos = new Set<string>();
  const deEstados: Comprobacion[] = [];
  for (const s of estados.statuses) {
    if (vistos.has(s.context)) continue;
    vistos.add(s.context);
    deEstados.push({
      nombre: s.context,
      estado: estadoDeStatus(s.state),
      url: s.target_url,
      resumen: s.description,
      jobId: null,
    });
  }
  return [...deChecks, ...deEstados];
}

/** Los despliegues que las plataformas (Vercel, Netlify…) registraron para un commit. */
export async function desplieguesDe(c: RepoCreds, sha: string, o: GithubOptions = {}): Promise<Despliegue[]> {
  const deps = await gh<{ id: number; environment: string; created_at: string }[]>(
    c,
    o,
    "GET",
    `${repoDe(c)}/deployments?sha=${sha}&per_page=10`,
  );
  const out: Despliegue[] = [];
  for (const d of deps.slice(0, 5)) {
    const estados = await gh<{ state: string; environment_url?: string | null; target_url?: string | null; log_url?: string | null }[]>(
      c,
      o,
      "GET",
      `${repoDe(c)}/deployments/${d.id}/statuses?per_page=1`,
    );
    const e = estados[0];
    out.push({
      entorno: d.environment,
      estado: e ? estadoDeStatus(e.state) : "en_curso",
      url: e?.environment_url || null,
      logs: e?.log_url || e?.target_url || null,
      creado: d.created_at,
    });
  }
  return out;
}

/** El final del log de un job de GitHub Actions: ahí está casi siempre el error. */
export async function colaDeLogs(c: RepoCreds, jobId: number, o: GithubOptions = {}, max = 4000): Promise<string> {
  const res = await descargar(c, o, `${repoDe(c)}/actions/jobs/${jobId}/logs`, 30_000);
  const texto = await res.text();
  // Las marcas de tiempo de cada línea no dicen nada y ocupan un tercio.
  const limpio = texto.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /gm, "");
  return limpio.length > max ? `…${limpio.slice(-max)}` : limpio;
}
