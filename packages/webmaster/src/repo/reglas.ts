/**
 * Las reglas del Webmaster sobre el código del cliente.
 *
 * Tres clases de archivo:
 *  - PROHIBIDOS: no se escriben nunca, con aprobación o sin ella. Los `.env`
 *    llevan secretos, y un secreto en un commit queda en el historial para
 *    siempre; los lockfiles no se pueden regenerar sin ejecutar el gestor de
 *    paquetes, y uno editado a mano rompe el build de producción.
 *  - SENSIBLES: se pueden cambiar, pero el commit espera el clic del cliente:
 *    el despliegue, la autenticación, los pagos, las dependencias.
 *  - El resto, que es casi todo el trabajo: componentes, páginas, estilos,
 *    textos e imágenes.
 */
import type { ArchivoPendiente } from "../ports.js";

/** Carpetas que no son código del cliente: generadas, dependencias o caché. */
export const CARPETAS_IGNORADAS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".vercel",
  ".netlify",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "__pycache__",
]);

export function ignorada(ruta: string): boolean {
  return ruta.split("/").some((parte) => CARPETAS_IGNORADAS.has(parte));
}

const LOCKFILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|npm-shrinkwrap\.json|composer\.lock|Gemfile\.lock|poetry\.lock)$/;
const ENV = /(^|\/)\.env(\.[\w.-]+)?$/;
const ENV_EJEMPLO = /(^|\/)\.env\.(example|sample|template)$/;

/** Por qué no se puede escribir esta ruta, o `null` si se puede. */
export function motivoProhibido(ruta: string): string | null {
  const r = ruta.replace(/^\/+/, "");
  if (!r || r.includes("\0")) return "la ruta está vacía o es inválida";
  if (r.split("/").some((p) => p === ".." || p === ".")) return "la ruta no puede subir de carpeta";
  if (r.startsWith(".git/") || r === ".git") return "es la carpeta interna de git";
  if (ENV.test(r) && !ENV_EJEMPLO.test(r)) {
    return "es un archivo de variables de entorno: lleva secretos y un secreto en un commit queda en el historial para siempre. Las variables se configuran en la plataforma de hosting";
  }
  if (LOCKFILES.test(r)) {
    return "es un lockfile: solo lo puede regenerar el gestor de paquetes al instalar. Editado a mano rompe el build. Si hace falta una dependencia nueva, cámbiala en package.json y dilo en el PR para que el equipo instale";
  }
  if (ignorada(r)) return "es una carpeta generada o de dependencias, no código del cliente";
  return null;
}

const DESPLIEGUE = /(^|\/)(\.github\/|vercel\.json$|netlify\.toml$|Dockerfile$|docker-compose\.ya?ml$|fly\.toml$|render\.yaml$|firebase\.json$|amplify\.yml$|wrangler\.toml$)/;
const CONFIG_DEL_FRAMEWORK = /(^|\/)(next|nuxt|vite|astro|svelte|remix|gatsby)\.config\.[cm]?[jt]s$|(^|\/)middleware\.[cm]?[jt]s$/;
const DINERO_Y_ACCESO = /(auth|login|signin|signup|session|password|payment|checkout|stripe|paypal|mercadopago|wompi|billing|pricing|precio|pago|carrito|cart|suscrip|subscription)/i;

export type Sensibilidad = { readonly sensible: boolean; readonly motivo: string };

function depsDe(texto: string | undefined): Record<string, string> | null {
  if (!texto) return null;
  try {
    const p = JSON.parse(texto) as Record<string, Record<string, string> | undefined>;
    return { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}), ...(p.peerDependencies ?? {}) };
  } catch {
    return null;
  }
}

/**
 * Si subir estos cambios necesita el clic del cliente. `original` da el
 * contenido de antes, para saber si en package.json cambiaron dependencias o
 * solo un script.
 */
export function sensibilidadDeCambios(
  cambios: Readonly<Record<string, ArchivoPendiente>>,
  original: (ruta: string) => string | undefined,
): Sensibilidad {
  const motivos: string[] = [];
  const rutas = Object.keys(cambios);

  const despliegue = rutas.filter((r) => DESPLIEGUE.test(r));
  if (despliegue.length) motivos.push(`cambia cómo se construye o despliega el sitio (${despliegue.join(", ")})`);

  const config = rutas.filter((r) => CONFIG_DEL_FRAMEWORK.test(r));
  if (config.length) motivos.push(`toca la configuración del framework (${config.join(", ")})`);

  const dinero = rutas.filter((r) => DINERO_Y_ACCESO.test(r));
  if (dinero.length) motivos.push(`toca el acceso, los pagos o los precios (${dinero.slice(0, 4).join(", ")})`);

  const borrados = rutas.filter((r) => cambios[r] === null);
  if (borrados.length) motivos.push(`borra archivos (${borrados.slice(0, 4).join(", ")}${borrados.length > 4 ? "…" : ""})`);

  for (const r of rutas.filter((x) => /(^|\/)package\.json$/.test(x))) {
    const nuevo = cambios[r];
    const antes = depsDe(original(r));
    const despues = nuevo && "texto" in nuevo ? depsDe(nuevo.texto) : null;
    if (JSON.stringify(antes) !== JSON.stringify(despues)) {
      motivos.push(`cambia las dependencias en ${r}: el equipo tendrá que instalar antes de desplegar`);
    }
  }

  return motivos.length ? { sensible: true, motivo: motivos.join("; ") } : { sensible: false, motivo: "" };
}

// ---------------------------------------------------------------------------
// Ramas
// ---------------------------------------------------------------------------

/** Por qué no vale este nombre de rama, o `null` si vale. Las reglas de `git check-ref-format`. */
export function motivoRamaInvalida(nombre: string): string | null {
  if (!nombre || nombre.length > 100) return "el nombre de la rama está vacío o es demasiado largo";
  if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(nombre)) return "el nombre no puede llevar espacios ni ~ ^ : ? * [ \\";
  if (nombre.includes("..") || nombre.includes("@{") || nombre.includes("//")) return "el nombre no puede llevar «..», «@{» ni «//»";
  if (/^[/.-]|[/.]$|\.lock$|\/\./.test(nombre)) return "el nombre no puede empezar ni terminar en «/» o «.», ni acabar en .lock";
  return null;
}

/** «Cambiar el banner de la portada» → «cambiar-el-banner-de-la-portada». */
export function slugRama(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

// ---------------------------------------------------------------------------
// Qué tipo de proyecto es
// ---------------------------------------------------------------------------

export type Proyecto = {
  readonly frameworks: readonly string[];
  readonly gestor: string | null;
  readonly scripts: Readonly<Record<string, string>>;
  readonly estilos: readonly string[];
  readonly hosting: readonly string[];
  readonly lenguaje: "typescript" | "javascript" | "otro";
  readonly pistas: readonly string[];
};

const FRAMEWORKS: [string, string][] = [
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["@remix-run/react", "Remix"],
  ["react-router", "React Router"],
  ["gatsby", "Gatsby"],
  ["astro", "Astro"],
  ["@sveltejs/kit", "SvelteKit"],
  ["svelte", "Svelte"],
  ["vue", "Vue"],
  ["@angular/core", "Angular"],
  ["solid-js", "Solid"],
  ["vite", "Vite"],
  ["react", "React"],
  ["express", "Express"],
];

const ESTILOS: [string, string][] = [
  ["tailwindcss", "Tailwind CSS"],
  ["styled-components", "styled-components"],
  ["@emotion/react", "Emotion"],
  ["sass", "Sass"],
  ["@mui/material", "Material UI"],
  ["@chakra-ui/react", "Chakra UI"],
  ["bootstrap", "Bootstrap"],
  ["@radix-ui/react-slot", "shadcn/ui (Radix)"],
];

/** Lo que se deduce del repo sin ejecutar nada: package.json y los archivos que hay. */
export function analizarProyecto(rutas: readonly string[], leer: (ruta: string) => string | undefined): Proyecto {
  const hay = (r: string | RegExp) => (typeof r === "string" ? rutas.includes(r) : rutas.some((x) => r.test(x)));
  let deps: Record<string, string> = {};
  let scripts: Record<string, string> = {};
  const pkg = leer("package.json");
  if (pkg) {
    try {
      const p = JSON.parse(pkg) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
      deps = { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) };
      scripts = p.scripts ?? {};
    } catch {
      /* package.json roto: se dice en las pistas */
    }
  }
  const conVersion = (d: string, nombre: string) => (deps[d] ? `${nombre} ${deps[d]}` : null);
  const frameworks = FRAMEWORKS.map(([d, n]) => conVersion(d, n)).filter((x): x is string => x !== null);
  if (!pkg && hay(/\.html$/)) frameworks.push("HTML estático");
  if (hay(/(^|\/)(composer\.json|artisan)$/)) frameworks.push("PHP");

  const estilos = ESTILOS.filter(([d]) => deps[d]).map(([, n]) => n);
  if (hay("components.json")) estilos.push("shadcn/ui");

  const hosting: string[] = [];
  if (hay("vercel.json") || hay(/^\.vercel\//)) hosting.push("Vercel");
  if (hay("netlify.toml")) hosting.push("Netlify");
  if (hay(/^\.github\/workflows\//)) hosting.push("GitHub Actions");
  if (hay("Dockerfile")) hosting.push("Docker");
  if (hay("firebase.json")) hosting.push("Firebase");
  if (hay("wrangler.toml")) hosting.push("Cloudflare");

  const gestor = hay("pnpm-lock.yaml")
    ? "pnpm"
    : hay("yarn.lock")
      ? "yarn"
      : hay(/^bun\.lockb?$/)
        ? "bun"
        : hay("package-lock.json")
          ? "npm"
          : null;

  const pistas: string[] = [];
  if (pkg && !Object.keys(deps).length) pistas.push("package.json sin dependencias legibles");
  if (deps.next) {
    if (hay(/^(src\/)?app\/.*(page|layout)\.[jt]sx?$/)) pistas.push("Next.js con App Router (carpeta app/)");
    if (hay(/^(src\/)?pages\/.*\.[jt]sx?$/)) pistas.push("Next.js con Pages Router (carpeta pages/)");
  }
  if (hay(/^(src\/)?components\//)) pistas.push("componentes en components/");
  if (hay(/^public\//)) pistas.push("estáticos (imágenes, favicon) en public/");
  if (hay(/\.(mdx?|json)$/) && hay(/^(content|data|posts|_posts)\//)) pistas.push("contenido en archivos (content/, data/ o posts/)");
  if (hay(/(^|\/)(messages|locales|i18n)\//)) pistas.push("textos traducidos en archivos de idioma (i18n)");
  if (hay(/^(apps|packages)\//)) pistas.push("monorepo: el sitio puede estar dentro de apps/ o packages/");

  return {
    frameworks,
    gestor,
    scripts,
    estilos,
    hosting,
    lenguaje: hay(/\.tsx?$/) ? "typescript" : hay(/\.jsx?$/) ? "javascript" : "otro",
    pistas,
  };
}
