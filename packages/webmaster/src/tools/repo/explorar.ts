/**
 * Explorar (repo:read): nunca cambian nada.
 */
import { z } from "zod";
import { defineTool } from "@strappy/tools";
import { SCOPES } from "../../context.js";
import { recortar } from "../comun.js";
import * as gh from "../../repo/github.js";
import { analizarProyecto } from "../../repo/reglas.js";
import { trabajo, soloApi, ruta, conNumeros, globARegex } from "./sesion.js";

export const repoInfo = defineTool({
  slug: "repo_info",
  label: "Conocer el repositorio",
  description:
    "Resumen del repositorio del sitio: framework y versión, lenguaje, estilos, hosting, scripts, carpetas principales, rama principal, rama de trabajo del encargo, cambios pendientes y PR abierto.",
  whenToUse: "SIEMPRE lo primero: antes de leer o tocar nada, para saber qué tipo de proyecto es",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.repoRead],
  effect: "read",
  kind: "http",
  async execute(ctx) {
    const { creds, sesion } = await trabajo(ctx, "repo_info");
    const rutas = sesion.rutas();
    const proyecto = analizarProyecto(rutas, (r) => {
      try {
        return sesion.leer(r);
      } catch {
        return undefined;
      }
    });
    const carpetas = new Map<string, number>();
    for (const r of rutas) {
      const primera = r.includes("/") ? `${r.split("/")[0]}/` : r;
      carpetas.set(primera, (carpetas.get(primera) ?? 0) + 1);
    }
    let readme: string | undefined;
    const rutaReadme = rutas.find((r) => /^readme(\.md)?$/i.test(r));
    if (rutaReadme) readme = recortar(sesion.leer(rutaReadme), 1200);
    const { estado } = sesion;
    return {
      repositorio: `${creds.owner}/${creds.repo}`,
      sitio_en_vivo: creds.urlProduccion,
      rama_principal: creds.ramaPrincipal,
      rama_cargada: sesion.ramaCargada,
      rama_de_trabajo: estado.rama ?? "(sin elegir: usa repo_elegir_rama antes de editar)",
      tipo_de_rama: estado.tipoRama,
      pr_abierto: estado.pr,
      cambios_pendientes: sesion.pendientes(),
      proyecto,
      archivos: rutas.length,
      carpetas: Object.fromEntries([...carpetas].sort((a, b) => b[1] - a[1]).slice(0, 30)),
      ...(sesion.archivosOmitidos ? { omitidos_por_tamano: sesion.archivosOmitidos } : {}),
      ...(readme ? { readme } : {}),
    };
  },
});

export const repoArbol = defineTool({
  slug: "repo_arbol",
  label: "Ver las carpetas del repositorio",
  description:
    "Lista archivos y carpetas del repositorio bajo una ruta, hasta cierta profundidad, opcionalmente filtrando con un patrón (*.tsx, src/components/**, *.{css,scss}).",
  whenToUse: "para ubicarte en la estructura antes de buscar o leer; nunca adivines rutas",
  inputSchema: z.object({
    ruta: z.string().max(400).default("").describe("Carpeta de partida; vacío = raíz."),
    profundidad: z.number().int().min(1).max(8).default(3),
    patron: z.string().max(120).optional().describe("Filtro tipo glob sobre la ruta completa."),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.repoRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sesion } = await trabajo(ctx, "repo_arbol");
    const base = input.ruta.replace(/^\.?\/+|\/+$/g, "");
    const prefijo = base ? `${base}/` : "";
    const filtro = input.patron ? globARegex(input.patron) : null;
    const lineas = new Set<string>();
    let total = 0;
    for (const r of sesion.rutas()) {
      if (prefijo && !r.startsWith(prefijo)) continue;
      if (filtro && !filtro.test(r)) continue;
      total++;
      const partes = r.slice(prefijo.length).split("/");
      const corte = partes.slice(0, input.profundidad);
      const esCarpeta = partes.length > input.profundidad;
      lineas.add(prefijo + corte.join("/") + (esCarpeta ? "/" : ""));
      if (lineas.size >= 500) break;
    }
    if (total === 0) return { ruta: base || "/", archivos: [], nota: "No hay nada ahí. Revisa la ruta con repo_arbol desde la raíz." };
    return { ruta: base || "/", coincidencias: total, archivos: [...lineas].sort(), ...(lineas.size >= 500 ? { recortado: true } : {}) };
  },
});

export const repoLeer = defineTool({
  slug: "repo_leer",
  label: "Leer un archivo",
  description:
    "Lee un archivo del repositorio con números de línea, tal como está en la rama de trabajo con tus cambios sin subir. Para archivos largos, pide un rango.",
  whenToUse: "SIEMPRE antes de editar un archivo: repo_editar necesita el texto exacto",
  inputSchema: z.object({
    ruta,
    desde: z.number().int().min(1).optional(),
    hasta: z.number().int().min(1).optional(),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.repoRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sesion } = await trabajo(ctx, "repo_leer");
    const lineas = sesion.leer(input.ruta).split("\n");
    const desde = Math.min(input.desde ?? 1, Math.max(lineas.length, 1));
    const hasta = Math.min(input.hasta ?? desde + 599, lineas.length, desde + 999);
    let trozo = lineas.slice(desde - 1, hasta).join("\n");
    let recortado = hasta < lineas.length;
    if (trozo.length > 60_000) {
      trozo = trozo.slice(0, 60_000);
      recortado = true;
    }
    return {
      ruta: input.ruta,
      lineas_totales: lineas.length,
      desde,
      hasta,
      contenido: conNumeros(trozo, desde),
      ...(recortado ? { nota: `Hay más: pide desde=${hasta + 1}.` } : {}),
    };
  },
});

export const repoBuscar = defineTool({
  slug: "repo_buscar",
  label: "Buscar en el código",
  description:
    "Busca un texto (o una expresión regular) en todos los archivos del repositorio y devuelve archivo, línea y contenido. Es cómo encuentras dónde está el texto que el cliente quiere cambiar, qué componente pinta una sección o dónde se usa algo.",
  whenToUse:
    "para encontrar DÓNDE está algo antes de leerlo: el texto visible de la página, el nombre de un componente, un color, una ruta",
  inputSchema: z.object({
    patron: z.string().min(1).max(300),
    es_regex: z.boolean().default(false),
    ignorar_mayusculas: z.boolean().default(true),
    ruta: z.string().max(400).optional().describe("Limitar a esta carpeta."),
    archivos: z.string().max(120).optional().describe("Filtro tipo glob: *.tsx, *.{css,scss}…"),
    max: z.number().int().min(1).max(200).default(60),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.repoRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sesion } = await trabajo(ctx, "repo_buscar");
    let patron: RegExp;
    try {
      const fuente = input.es_regex ? input.patron : input.patron.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      patron = new RegExp(fuente, input.ignorar_mayusculas ? "i" : "");
    } catch (e) {
      throw new Error(`Expresión regular inválida: ${e instanceof Error ? e.message : String(e)}`);
    }
    const prefijo = input.ruta ? `${input.ruta.replace(/^\.?\/+|\/+$/g, "")}/` : "";
    const glob = input.archivos ? globARegex(input.archivos) : null;
    const resultados = sesion.buscar(
      patron,
      (r) => (!prefijo || r.startsWith(prefijo)) && (!glob || glob.test(r)),
      input.max,
    );
    return {
      coincidencias: resultados.length,
      resultados: resultados.map((x) => `${x.ruta}:${x.linea}: ${x.texto}`),
      ...(resultados.length >= input.max ? { nota: "Hay más: acota con ruta o archivos." } : {}),
      ...(resultados.length === 0
        ? {
            nota:
              "Nada. Si buscabas un texto visible del sitio, puede venir de un CMS, de un archivo de traducciones o partido en varias líneas: busca un trozo más corto.",
          }
        : {}),
    };
  },
});

export const repoRamas = defineTool({
  slug: "repo_ramas",
  label: "Ver las ramas",
  description: "Lista las ramas del repositorio, cuáles están protegidas y cuáles tienen un PR abierto.",
  whenToUse: "antes de recomendar al cliente en qué rama trabajar",
  inputSchema: z.object({}),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.repoRead],
  effect: "read",
  kind: "http",
  async execute(ctx) {
    const { creds, opciones } = soloApi(ctx, "repo_ramas");
    const [ramas, prs] = await Promise.all([
      gh.listarRamas(creds, opciones),
      gh.listarPRs(creds, { estado: "open", cantidad: 50 }, opciones),
    ]);
    const conPR = new Map(prs.map((p) => [p.rama, p]));
    return {
      rama_principal: creds.ramaPrincipal,
      total: ramas.length,
      ramas: ramas.slice(0, 80).map((r) => ({
        nombre: r.nombre,
        ...(r.nombre === creds.ramaPrincipal ? { principal: true } : {}),
        ...(r.protegida ? { protegida: true } : {}),
        ...(conPR.get(r.nombre) ? { pr_abierto: `#${conPR.get(r.nombre)!.numero} ${conPR.get(r.nombre)!.titulo}` } : {}),
      })),
    };
  },
});

export const repoHistorial = defineTool({
  slug: "repo_historial",
  label: "Ver el historial",
  description: "Últimos commits de la rama de trabajo (o de la principal), opcionalmente de un archivo concreto.",
  whenToUse: "para entender cómo trabaja el equipo (estilo de mensajes) o qué cambió hace poco en un archivo",
  inputSchema: z.object({
    ruta: z.string().max(400).optional(),
    de: z.enum(["trabajo", "principal"]).default("trabajo"),
    cantidad: z.number().int().min(1).max(30).default(10),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.repoRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { creds, opciones, sesion } = await trabajo(ctx, "repo_historial");
    const rama = input.de === "principal" ? creds.ramaPrincipal : sesion.ramaCargada;
    return {
      rama,
      commits: await gh.listarCommits(
        creds,
        { rama, cantidad: input.cantidad, ...(input.ruta ? { ruta: input.ruta } : {}) },
        opciones,
      ),
    };
  },
});

export const repoCambiosRecientes = defineTool({
  slug: "repo_cambios_recientes",
  label: "Ver los cambios recientes",
  description:
    "Los PRs recientes del repositorio (abiertos, fusionados y cerrados), los que hizo Strappy marcados. Es de donde salen los números para deshacer un cambio.",
  whenToUse:
    "cuando el cliente dice que algo quedó mal, que no le gusta o que lo dejes como estaba: lo PRIMERO, para saber qué PR deshacer con repo_deshacer",
  inputSchema: z.object({ cantidad: z.number().int().min(1).max(40).default(15) }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.repoRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { creds, opciones } = soloApi(ctx, "repo_cambios_recientes");
    const [prs, commits] = await Promise.all([
      gh.listarPRs(creds, { estado: "all", cantidad: input.cantidad }, opciones),
      gh.listarCommits(creds, { rama: creds.ramaPrincipal, cantidad: 8 }, opciones),
    ]);
    return {
      prs: prs.map((p) => ({
        numero: p.numero,
        titulo: p.titulo,
        estado: p.estado,
        rama: p.rama,
        hacia: p.base,
        de_strappy: p.rama.startsWith("strappy/"),
        actualizado: p.actualizado,
        url: p.url,
      })),
      ultimos_commits_en_principal: commits,
    };
  },
});

export const repoVerCambios = defineTool({
  slug: "repo_ver_cambios",
  label: "Revisar tus cambios",
  description: "El diff exacto de tus cambios sin subir (todos o de un archivo), en formato unificado.",
  whenToUse: "SIEMPRE antes de repo_guardar_cambios: revisa que cambiaste solo lo que tocaba y que no rompiste la sintaxis",
  inputSchema: z.object({ ruta: z.string().max(400).optional() }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.repoRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sesion } = await trabajo(ctx, "repo_ver_cambios");
    const pendientes = sesion.pendientes();
    if (pendientes.length === 0) return { pendientes: [], nota: "No hay cambios sin subir." };
    return {
      rama: sesion.estado.rama,
      pendientes,
      diff: recortar(sesion.diff(input.ruta?.replace(/^\.?\/+/, "")), 24_000),
    };
  },
});
