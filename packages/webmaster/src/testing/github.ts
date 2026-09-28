/**
 * Un GitHub de mentira, en memoria, con lo que usa el Webmaster de repositorios:
 * ramas, tarball, la Git Data API, commits, comparaciones, PRs con sus
 * comentarios, checks, estados, despliegues y logs de Actions.
 *
 * Guarda cada commit como una foto completa de los archivos: es poco eficiente
 * y da igual, y así comprobar «qué hay en la rama» es mirar un mapa.
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export const API_GITHUB_FALSA = "https://api.github.test";

type Archivo = { bytes: Uint8Array; modo: string };
type Commit = { sha: string; arbol: string; padres: string[]; mensaje: string; fecha: string };

export type CheckFalso = {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "neutral" | null;
  details_url?: string;
  app?: { slug: string };
  output?: { title?: string; summary?: string };
};

export type PrFalso = {
  number: number;
  title: string;
  body: string;
  head: string;
  base: string;
  state: "open" | "closed";
  draft: boolean;
  merged_sha: string | null;
  /** La base cuando se abrió: contra ella se listan sus archivos, como la base de fusión de GitHub. */
  base_sha: string;
  comentarios: { user: string; body: string }[];
  revisiones: { user: string; body: string; state: string }[];
};

export type EstadoGithubFalso = {
  token: string;
  owner: string;
  repo: string;
  ramaPorDefecto: string;
  ramas: Map<string, string>;
  protegidas: Set<string>;
  commits: Map<string, Commit>;
  arboles: Map<string, Map<string, Archivo>>;
  blobs: Map<string, Uint8Array>;
  prs: PrFalso[];
  checks: Map<string, CheckFalso[]>;
  despliegues: Map<string, { id: number; environment: string; url: string | null; state: string }[]>;
  logs: Map<number, string>;
  /** Cuántas veces se descargó un tarball: para comprobar que no se recarga de más. */
  tarballs: number;
  peticiones: string[];
};

export type DobleGithub = {
  readonly estado: EstadoGithubFalso;
  readonly fetch: typeof globalThis.fetch;
  /** Los archivos de una rama, como texto. */
  archivos(rama: string): Record<string, string>;
  /** Empuja un commit «de otra persona» a una rama. */
  empujar(rama: string, cambios: Record<string, string | null>, mensaje?: string): string;
};

const codificar = new TextEncoder();
const decodificar = new TextDecoder();

function hash(...partes: string[]): string {
  return createHash("sha1").update(partes.join("|")).digest("hex");
}

// ---------------------------------------------------------------------------
// Tarball
// ---------------------------------------------------------------------------

function cabeceraTar(nombre: string, tamano: number, tipo: string, modo = "644"): Uint8Array {
  const h = new Uint8Array(512);
  const escribir = (texto: string, desde: number, largo: number) => {
    h.set(codificar.encode(texto).subarray(0, largo), desde);
  };
  escribir(nombre.slice(0, 100), 0, 100);
  escribir(`${modo.padStart(7, "0")}\0`, 100, 8);
  escribir("0000000\0", 108, 8);
  escribir("0000000\0", 116, 8);
  escribir(`${tamano.toString(8).padStart(11, "0")}\0`, 124, 12);
  escribir("00000000000\0", 136, 12);
  escribir("        ", 148, 8);
  escribir(tipo, 156, 1);
  escribir("ustar\0", 257, 6);
  escribir("00", 263, 2);
  const suma = h.reduce((a, b) => a + b, 0);
  escribir(`${suma.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return h;
}

function registroPax(clave: string, valor: string): string {
  const cuerpo = ` ${clave}=${valor}\n`;
  let largo = cuerpo.length + 1;
  while (String(largo).length + cuerpo.length !== largo) largo = String(largo).length + cuerpo.length;
  return `${largo}${cuerpo}`;
}

function relleno(n: number): Uint8Array {
  return new Uint8Array((512 - (n % 512)) % 512);
}

export function crearTarball(raiz: string, commit: string, archivos: Map<string, Archivo>): Uint8Array {
  const trozos: Uint8Array[] = [];
  const pax = codificar.encode(registroPax("comment", commit));
  trozos.push(cabeceraTar("pax_global_header", pax.length, "g"), pax, relleno(pax.length));
  trozos.push(cabeceraTar(`${raiz}/`, 0, "5", "755"));
  for (const [ruta, a] of [...archivos].sort(([x], [y]) => x.localeCompare(y))) {
    const nombre = `${raiz}/${ruta}`;
    if (nombre.length > 100) {
      const p = codificar.encode(registroPax("path", nombre));
      trozos.push(cabeceraTar("PaxHeader", p.length, "x"), p, relleno(p.length));
    }
    trozos.push(cabeceraTar(nombre, a.bytes.length, "0", a.modo === "100755" ? "755" : "644"), a.bytes, relleno(a.bytes.length));
  }
  trozos.push(new Uint8Array(1024));
  const total = trozos.reduce((n, t) => n + t.length, 0);
  const todo = new Uint8Array(total);
  let i = 0;
  for (const t of trozos) {
    todo.set(t, i);
    i += t.length;
  }
  return new Uint8Array(gzipSync(todo));
}

// ---------------------------------------------------------------------------
// El doble
// ---------------------------------------------------------------------------

export function crearDobleGithub(opciones: {
  archivos?: Record<string, string>;
  ramaPorDefecto?: string;
  otrasRamas?: string[];
} = {}): DobleGithub {
  const principal = opciones.ramaPorDefecto ?? "main";
  const e: EstadoGithubFalso = {
    token: "ghp_token_de_prueba_123",
    owner: "acme",
    repo: "web",
    ramaPorDefecto: principal,
    ramas: new Map(),
    protegidas: new Set([principal]),
    commits: new Map(),
    arboles: new Map(),
    blobs: new Map(),
    prs: [],
    checks: new Map(),
    despliegues: new Map(),
    logs: new Map(),
    tarballs: 0,
    peticiones: [],
  };

  const archivosIniciales = opciones.archivos ?? {
    "package.json": JSON.stringify(
      { name: "web", scripts: { dev: "next dev", build: "next build" }, dependencies: { next: "15.1.0", react: "19.0.0" }, devDependencies: { tailwindcss: "4.0.0", typescript: "5.7.0" } },
      null,
      2,
    ),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "src/app/page.tsx": [
      'import { Hero } from "@/components/hero";',
      "",
      "export default function Page() {",
      "  return <Hero titulo=\"Diseñamos espacios\" />;",
      "}",
    ].join("\n"),
    "src/components/hero.tsx": [
      "export function Hero({ titulo }: { titulo: string }) {",
      '  return <section className="bg-white py-20"><h1>{titulo}</h1><p>Llámanos al 600 000 000</p></section>;',
      "}",
    ].join("\n"),
    "public/logo.png": "\u0089PNG\0\0binario",
    "README.md": "# Web de Acme\n",
    ".env": "SECRETO=1\n",
  };

  let n = 0;
  const nuevoArbol = (archivos: Map<string, Archivo>) => {
    const id = hash("arbol", String(++n));
    e.arboles.set(id, archivos);
    return id;
  };
  const nuevoCommit = (arbol: string, padres: string[], mensaje: string) => {
    const sha = hash("commit", String(++n), mensaje);
    e.commits.set(sha, { sha, arbol, padres, mensaje, fecha: new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString() });
    return sha;
  };
  const archivosDe = (sha: string) => e.arboles.get(e.commits.get(sha)!.arbol)!;

  const inicial = new Map<string, Archivo>(
    Object.entries(archivosIniciales).map(([r, t]) => [r, { bytes: codificar.encode(t), modo: "100644" }]),
  );
  const raiz = nuevoCommit(nuevoArbol(inicial), [], "Primer commit");
  e.ramas.set(principal, raiz);
  for (const r of opciones.otrasRamas ?? []) e.ramas.set(r, raiz);

  const resolver = (ref: string) => e.ramas.get(ref) ?? (e.commits.has(ref) ? ref : null);

  const diferencias = (a: string, b: string) => {
    const x = archivosDe(a);
    const y = archivosDe(b);
    const out: { filename: string; status: string }[] = [];
    for (const [r, f] of y) {
      const antes = x.get(r);
      if (!antes) out.push({ filename: r, status: "added" });
      else if (Buffer.compare(Buffer.from(antes.bytes), Buffer.from(f.bytes)) !== 0) out.push({ filename: r, status: "modified" });
    }
    for (const r of x.keys()) if (!y.has(r)) out.push({ filename: r, status: "removed" });
    return out;
  };

  const esAncestro = (ancestro: string, sha: string): boolean => {
    if (ancestro === sha) return true;
    return (e.commits.get(sha)?.padres ?? []).some((p) => esAncestro(ancestro, p));
  };

  const prApi = (p: PrFalso) => ({
    number: p.number,
    title: p.title,
    body: p.body,
    state: p.state,
    merged_at: p.merged_sha ? "2026-09-01T00:00:00Z" : null,
    draft: p.draft,
    html_url: `https://github.com/${e.owner}/${e.repo}/pull/${p.number}`,
    head: { ref: p.head, sha: e.ramas.get(p.head) ?? p.merged_sha ?? "" },
    base: { ref: p.base },
    mergeable: true,
    mergeable_state: "clean",
    merge_commit_sha: p.merged_sha,
    user: { login: "strappy-bot" },
    updated_at: "2026-09-01T00:00:00Z",
  });

  const json = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
  const noEncontrado = () => json({ message: "Not Found" }, 404);

  const fetchFalso: typeof globalThis.fetch = async (entrada, init) => {
    const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
    const metodo = (init?.method ?? "GET").toUpperCase();
    e.peticiones.push(`${metodo} ${url.pathname}${url.search}`);
    const auth = new Headers(init?.headers).get("authorization");
    if (auth !== `Bearer ${e.token}`) return json({ message: "Bad credentials" }, 401);
    const cuerpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    const base = `/repos/${e.owner}/${e.repo}`;
    if (!url.pathname.startsWith(base)) return noEncontrado();
    const ruta = decodeURIComponent(url.pathname.slice(base.length));
    let m: RegExpExecArray | null;

    if (ruta === "" && metodo === "GET") {
      return json({
        full_name: `${e.owner}/${e.repo}`,
        private: true,
        default_branch: e.ramaPorDefecto,
        permissions: { push: true, admin: false },
        html_url: `https://github.com/${e.owner}/${e.repo}`,
        description: "Web de Acme",
        language: "TypeScript",
        homepage: "https://acme.test",
        archived: false,
      });
    }
    if (ruta === "/branches") {
      return json([...e.ramas].map(([name, sha]) => ({ name, commit: { sha }, protected: e.protegidas.has(name) })));
    }
    if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(ruta))) {
      const sha = e.ramas.get(m[1]!);
      return sha ? json({ object: { sha } }) : noEncontrado();
    }
    if (ruta === "/git/refs" && metodo === "POST") {
      const nombre = String(cuerpo.ref).replace(/^refs\/heads\//, "");
      if (e.ramas.has(nombre)) return json({ message: "Reference already exists" }, 422);
      e.ramas.set(nombre, String(cuerpo.sha));
      return json({ ref: cuerpo.ref, object: { sha: cuerpo.sha } }, 201);
    }
    if ((m = /^\/git\/refs\/heads\/(.+)$/.exec(ruta)) && metodo === "PATCH") {
      const actual = e.ramas.get(m[1]!);
      const nuevo = String(cuerpo.sha);
      if (!actual) return noEncontrado();
      if (!esAncestro(actual, nuevo)) return json({ message: "Update is not a fast forward" }, 422);
      e.ramas.set(m[1]!, nuevo);
      return json({ object: { sha: nuevo } });
    }
    if ((m = /^\/tarball\/(.+)$/.exec(ruta))) {
      const sha = resolver(m[1]!);
      if (!sha) return noEncontrado();
      e.tarballs++;
      return new Response(Buffer.from(crearTarball(`${e.owner}-${e.repo}-${sha.slice(0, 7)}`, sha, archivosDe(sha))), { status: 200 });
    }
    if ((m = /^\/contents\/(.+)$/.exec(ruta))) {
      const sha = resolver(url.searchParams.get("ref") ?? e.ramaPorDefecto);
      const f = sha ? archivosDe(sha).get(m[1]!) : undefined;
      if (!f) return noEncontrado();
      return json({ type: "file", encoding: "base64", content: Buffer.from(f.bytes).toString("base64"), sha: "x" });
    }
    if ((m = /^\/git\/commits\/([0-9a-f]+)$/.exec(ruta)) && metodo === "GET") {
      const c = e.commits.get(m[1]!);
      return c ? json({ sha: c.sha, tree: { sha: c.arbol }, parents: c.padres.map((sha) => ({ sha })) }) : noEncontrado();
    }
    if (ruta === "/git/blobs" && metodo === "POST") {
      const bytes =
        cuerpo.encoding === "base64" ? new Uint8Array(Buffer.from(String(cuerpo.content), "base64")) : codificar.encode(String(cuerpo.content));
      const sha = hash("blob", Buffer.from(bytes).toString("base64"));
      e.blobs.set(sha, bytes);
      return json({ sha }, 201);
    }
    if (ruta === "/git/trees" && metodo === "POST") {
      const partida = e.arboles.get(String(cuerpo.base_tree));
      if (!partida) return json({ message: "base_tree no existe" }, 422);
      const copia = new Map(partida);
      for (const x of cuerpo.tree as { path: string; mode: string; sha: string | null }[]) {
        if (x.sha === null) copia.delete(x.path);
        else copia.set(x.path, { bytes: e.blobs.get(x.sha)!, modo: x.mode });
      }
      return json({ sha: nuevoArbol(copia) }, 201);
    }
    if (ruta === "/git/commits" && metodo === "POST") {
      const sha = nuevoCommit(String(cuerpo.tree), cuerpo.parents as string[], String(cuerpo.message));
      return json({ sha }, 201);
    }
    if (ruta === "/commits" && metodo === "GET") {
      let sha = resolver(url.searchParams.get("sha") ?? e.ramaPorDefecto);
      const lista: Commit[] = [];
      while (sha && lista.length < Number(url.searchParams.get("per_page") ?? 30)) {
        const c = e.commits.get(sha)!;
        lista.push(c);
        sha = c.padres[0] ?? null;
      }
      return json(lista.map((c) => ({ sha: c.sha, commit: { message: c.mensaje, author: { name: "Ana", date: c.fecha } } })));
    }
    if ((m = /^\/commits\/([0-9a-f]+)\/check-runs$/.exec(ruta))) {
      return json({ check_runs: e.checks.get(m[1]!) ?? [] });
    }
    if ((m = /^\/commits\/([0-9a-f]+)\/status$/.exec(ruta))) {
      return json({ statuses: [] });
    }
    if ((m = /^\/commits\/([0-9a-f]+)$/.exec(ruta))) {
      const c = e.commits.get(m[1]!);
      if (!c) return noEncontrado();
      return json({ files: c.padres[0] ? diferencias(c.padres[0], c.sha) : [] });
    }
    if ((m = /^\/compare\/(.+)\.\.\.(.+)$/.exec(ruta))) {
      const a = resolver(m[1]!);
      const b = resolver(m[2]!);
      if (!a || !b) return noEncontrado();
      return json({ files: diferencias(a, b), ahead_by: a === b ? 0 : 1, behind_by: 0 });
    }
    if (ruta === "/deployments") {
      const deps = e.despliegues.get(url.searchParams.get("sha") ?? "") ?? [];
      return json(deps.map((d) => ({ id: d.id, environment: d.environment, created_at: "2026-09-01T00:00:00Z" })));
    }
    if ((m = /^\/deployments\/(\d+)\/statuses$/.exec(ruta))) {
      const d = [...e.despliegues.values()].flat().find((x) => x.id === Number(m![1]));
      return json(d ? [{ state: d.state, environment_url: d.url }] : []);
    }
    if ((m = /^\/actions\/jobs\/(\d+)\/logs$/.exec(ruta))) {
      const log = e.logs.get(Number(m[1]));
      return log ? new Response(log, { status: 200 }) : noEncontrado();
    }
    if (ruta === "/pulls" && metodo === "GET") {
      const head = url.searchParams.get("head")?.split(":")[1];
      const estado = url.searchParams.get("state") ?? "open";
      return json(
        e.prs
          .filter((p) => (!head || p.head === head) && (estado === "all" || p.state === estado))
          .map(prApi)
          .reverse(),
      );
    }
    if (ruta === "/pulls" && metodo === "POST") {
      if (!e.ramas.has(String(cuerpo.head))) return json({ message: "Validation Failed", errors: [{ message: "head no existe" }] }, 422);
      const p: PrFalso = {
        number: e.prs.length + 1,
        title: String(cuerpo.title),
        body: String(cuerpo.body),
        head: String(cuerpo.head),
        base: String(cuerpo.base),
        state: "open",
        draft: Boolean(cuerpo.draft),
        merged_sha: null,
        base_sha: e.ramas.get(String(cuerpo.base)) ?? "",
        comentarios: [],
        revisiones: [],
      };
      e.prs.push(p);
      return json(prApi(p), 201);
    }
    if ((m = /^\/pulls\/(\d+)(\/.*)?$/.exec(ruta))) {
      const p = e.prs.find((x) => x.number === Number(m![1]));
      if (!p) return noEncontrado();
      const resto = m[2] ?? "";
      if (resto === "" && metodo === "GET") return json(prApi(p));
      if (resto === "" && metodo === "PATCH") {
        if (cuerpo.title) p.title = String(cuerpo.title);
        if (cuerpo.body) p.body = String(cuerpo.body);
        return json(prApi(p));
      }
      if (resto === "/merge" && metodo === "PUT") {
        const cabeza = e.ramas.get(p.head)!;
        if (cuerpo.sha !== cabeza) return json({ message: "Head branch was modified" }, 409);
        const destino = e.ramas.get(p.base)!;
        // Squash: un commit nuevo en la base con el árbol de la rama.
        const sha = nuevoCommit(e.commits.get(cabeza)!.arbol, [destino], `${p.title} (#${p.number})`);
        e.ramas.set(p.base, sha);
        p.state = "closed";
        p.merged_sha = sha;
        return json({ sha, merged: true, message: "Pull Request successfully merged" });
      }
      if (resto === "/files") return json(diferencias(p.base_sha, p.merged_sha ?? e.ramas.get(p.head)!));
      if (resto === "/reviews") return json(p.revisiones.map((r) => ({ user: { login: r.user }, body: r.body, state: r.state, submitted_at: "2026-09-01T00:00:00Z" })));
      if (resto === "/comments") return json([]);
    }
    if ((m = /^\/issues\/(\d+)\/comments$/.exec(ruta))) {
      const p = e.prs.find((x) => x.number === Number(m![1]));
      if (!p) return noEncontrado();
      if (metodo === "POST") {
        p.comentarios.push({ user: "strappy-bot", body: String(cuerpo.body) });
        return json({ html_url: `https://github.com/${e.owner}/${e.repo}/pull/${p.number}#c${p.comentarios.length}` }, 201);
      }
      return json(p.comentarios.map((c) => ({ user: { login: c.user }, body: c.body, created_at: "2026-09-01T00:00:00Z" })));
    }
    return json({ message: `El doble no sabe ${metodo} ${ruta}` }, 501);
  };

  return {
    estado: e,
    fetch: fetchFalso,
    archivos(rama) {
      const sha = e.ramas.get(rama);
      if (!sha) throw new Error(`No hay rama ${rama}`);
      return Object.fromEntries([...archivosDe(sha)].map(([r, a]) => [r, decodificar.decode(a.bytes)]));
    },
    empujar(rama, cambios, mensaje = "Cambio de otra persona") {
      const padre = e.ramas.get(rama)!;
      const copia = new Map(archivosDe(padre));
      for (const [r, t] of Object.entries(cambios)) {
        if (t === null) copia.delete(r);
        else copia.set(r, { bytes: codificar.encode(t), modo: "100644" });
      }
      const sha = nuevoCommit(nuevoArbol(copia), [padre], mensaje);
      e.ramas.set(rama, sha);
      return sha;
    },
  };
}
