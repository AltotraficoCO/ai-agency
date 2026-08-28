/**
 * robots.txt mínimo pero honesto.
 *
 * Se respeta porque rastrear la web de un cliente con su permiso no autoriza a
 * rastrear lo que su robots.txt excluye, y porque un bloqueo de IP deja al
 * cliente sin poder reindexar su propia web.
 */

export type ReglasRobots = {
  readonly permitir: readonly string[];
  readonly prohibir: readonly string[];
  readonly sitemaps: readonly string[];
  readonly esperaMs: number;
};

export const ROBOTS_PERMISIVO: ReglasRobots = {
  permitir: [],
  prohibir: [],
  sitemaps: [],
  esperaMs: 0,
};

/** `agente` se compara en minúsculas contra User-agent; `*` siempre cuenta. */
export function parsearRobots(texto: string, agente = "strappybot"): ReglasRobots {
  const permitir: string[] = [];
  const prohibir: string[] = [];
  const sitemaps: string[] = [];
  let esperaMs = 0;

  let aplicaGrupo = false;
  let grupoAnterior: "agente" | "regla" = "regla";
  let especifico = false;

  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.replace(/#.*$/, "").trim();
    if (linea === "") continue;
    const idx = linea.indexOf(":");
    if (idx === -1) continue;
    const campo = linea.slice(0, idx).trim().toLowerCase();
    const valor = linea.slice(idx + 1).trim();

    if (campo === "sitemap") {
      sitemaps.push(valor);
      continue;
    }
    if (campo === "user-agent") {
      // Un nuevo bloque de User-agent tras reglas cierra el grupo anterior.
      if (grupoAnterior === "regla") aplicaGrupo = false;
      grupoAnterior = "agente";
      const ua = valor.toLowerCase();
      if (ua === agente.toLowerCase()) {
        // Un grupo dirigido a nosotros gana al comodín: se descarta lo del `*`.
        if (!especifico) {
          permitir.length = 0;
          prohibir.length = 0;
        }
        especifico = true;
        aplicaGrupo = true;
      } else if (ua === "*" && !especifico) {
        aplicaGrupo = true;
      }
      continue;
    }
    grupoAnterior = "regla";
    if (!aplicaGrupo) continue;
    if (campo === "disallow" && valor !== "") prohibir.push(valor);
    else if (campo === "allow" && valor !== "") permitir.push(valor);
    else if (campo === "crawl-delay") {
      const s = Number.parseFloat(valor);
      if (Number.isFinite(s) && s > 0) esperaMs = Math.min(s * 1000, 10_000);
    }
  }
  return { permitir, prohibir, sitemaps, esperaMs };
}

function coincide(patron: string, ruta: string): number {
  // Soporte de `*` y `$` como en la extensión de Google; el resto es prefijo.
  const escapado = patron
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\\$$/, "$");
  const anclado = patron.endsWith("$") ? `^${escapado.slice(0, -1)}$` : `^${escapado}`;
  try {
    return new RegExp(anclado).test(ruta) ? patron.replace(/[*$]/g, "").length : -1;
  } catch {
    return ruta.startsWith(patron) ? patron.length : -1;
  }
}

/** La regla más específica gana; a igualdad, Allow. Es lo que hace Google. */
export function permiteRuta(reglas: ReglasRobots, urlOruta: string): boolean {
  let ruta = urlOruta;
  try {
    const u = new URL(urlOruta);
    ruta = `${u.pathname}${u.search}`;
  } catch {
    // Ya era una ruta.
  }
  let mejorPermitir = -1;
  let mejorProhibir = -1;
  for (const p of reglas.permitir) mejorPermitir = Math.max(mejorPermitir, coincide(p, ruta));
  for (const p of reglas.prohibir) mejorProhibir = Math.max(mejorProhibir, coincide(p, ruta));
  if (mejorProhibir === -1) return true;
  return mejorPermitir >= mejorProhibir;
}
