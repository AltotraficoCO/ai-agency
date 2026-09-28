/**
 * Herramientas del Webmaster sobre el repositorio de un sitio hecho a medida.
 *
 * El agente trabaja como un desarrollador con cuidado: explora, lee antes de
 * tocar, cambia lo mínimo con ediciones exactas, revisa su diff, sube UN
 * commit, mira el build y la vista previa, y solo publica con el clic del
 * cliente. En qué rama trabaja lo decide el cliente con un botón, a propuesta
 * del agente.
 *
 * Tres familias:
 *  - Lectura (repo:read): nunca cambian nada.
 *  - Edición (repo:write, efecto interno): cambian la copia del encargo, no el
 *    repositorio. Por eso funcionan también en simulación: el plan de un primer
 *    contacto puede enseñar el diff exacto sin haber subido nada.
 *  - Efecto externo (repo:write): commit, PR, comentario y publicar. Estas sí
 *    tocan GitHub, se simulan en seco y pasan por la aprobación cuando toca.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolDef } from "@strappy/tools";
import { SCOPES } from "../context.js";
import { entorno, recortar } from "./comun.js";
import { requireBrowser, requireRepo, type SitioContext, type TipoRama } from "../ports.js";
import { huellaAccion, puertaDeAprobacion, type Bloqueo } from "../aprobacion.js";
import * as gh from "../repo/github.js";
import { RepoSesion } from "../repo/sesion.js";
import { analizarProyecto, motivoProhibido, motivoRamaInvalida, sensibilidadDeCambios, slugRama } from "../repo/reglas.js";

// ---------------------------------------------------------------------------
// La sesión de cada encargo
// ---------------------------------------------------------------------------

/**
 * Una sesión por ejecución. La clave es el contexto del sitio, que el bucle
 * crea una vez por encargo: dos encargos del mismo proceso nunca comparten
 * copia del repositorio.
 */
const SESIONES = new WeakMap<SitioContext, Promise<RepoSesion>>();
/** La vista previa que dio GitHub en esta ejecución. El modelo nunca elige el host. */
const VISTAS_PREVIAS = new WeakMap<SitioContext, { url: string; conBypass: boolean }>();

type Trabajo = {
  readonly sitio: SitioContext;
  readonly creds: ReturnType<typeof requireRepo>;
  readonly opciones: gh.GithubOptions;
  readonly sesion: RepoSesion;
};

async function trabajo(ctx: ToolContext, slug: string): Promise<Trabajo> {
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
function soloApi(ctx: ToolContext, slug: string) {
  const { sitio, opciones } = entorno(ctx, slug);
  return { sitio, creds: requireRepo(sitio, slug), opciones };
}

const ruta = z
  .string()
  .min(1)
  .max(400)
  .transform((r) => r.replace(/^\.?\/+/, ""))
  .describe("Ruta del archivo dentro del repositorio, p. ej. src/app/page.tsx");

function conNumeros(texto: string, desde: number): string {
  return texto
    .split("\n")
    .map((l, i) => `${String(desde + i).padStart(5)}  ${l}`)
    .join("\n");
}

/** Patrón simple tipo glob: «*.tsx», «src/components/**», «*.{css,scss}». */
function globARegex(glob: string): RegExp {
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

// ---------------------------------------------------------------------------
// Explorar
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// La rama: la elige el cliente con un botón
// ---------------------------------------------------------------------------

function recortarEtiqueta(texto: string): string {
  return texto.length <= 80 ? texto : `${texto.slice(0, 77)}…`;
}

export const repoElegirRama = defineTool({
  slug: "repo_elegir_rama",
  label: "Proponer la rama de trabajo",
  description:
    "Le pregunta al cliente, con botones, dónde van los cambios de este encargo: una rama NUEVA (que tú nombras), la rama PRINCIPAL (se publica en vivo) o una rama EXISTENTE. Tú haces la recomendación y va primera. La tarea se pausa hasta que el cliente pulse, y al volver la rama elegida ya está puesta.",
  whenToUse:
    "después de explorar y ANTES de editar nada, una sola vez por encargo. Si ya hay rama de trabajo (repo_info la dice), no vuelvas a preguntar",
  inputSchema: z.object({
    recomendacion: z
      .enum(["nueva", "principal", "existente"])
      .describe("Lo que recomiendas. Casi siempre «nueva»: permite revisar la vista previa antes de publicar."),
    rama_nueva: z
      .string()
      .min(3)
      .max(80)
      .describe("Nombre para la rama nueva, en minúsculas y con guiones, que diga qué cambia: strappy/nuevo-banner-portada."),
    rama_existente: z
      .string()
      .max(100)
      .optional()
      .describe("Si recomiendas una existente (p. ej. develop o staging), cuál."),
    otras_existentes: z.array(z.string().max(100)).max(2).optional().describe("Otras ramas existentes que tenga sentido ofrecer."),
    motivo: z.string().min(10).max(240).describe("Por qué recomiendas esa opción, en una frase para el cliente."),
  }),
  sensitive: false,
  creditCost: 0,
  scopes: [SCOPES.repoRead],
  effect: "write_internal",
  kind: "system",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { sitio, creds, opciones, sesion } = await trabajo(ctx, "repo_elegir_rama");

    // Retomado: si el cliente ya contestó, la sesión lo aplicó al abrirse.
    if (sesion.estado.rama) {
      return {
        rama: sesion.estado.rama,
        tipo: sesion.estado.tipoRama,
        nota:
          sesion.estado.tipoRama === "principal"
            ? `El cliente eligió trabajar directo en «${sesion.estado.rama}»: lo que subas se publica en vivo. Sé especialmente cuidadoso y verifica el build.`
            : `Trabajas en «${sesion.estado.rama}». Sigue con el encargo.`,
      };
    }
    const resuelta = await sesion.resolverPreguntaPendiente();
    if (resuelta.aplicada) {
      return { rama: sesion.estado.rama, tipo: sesion.estado.tipoRama, respuesta_del_cliente: resuelta.respuesta };
    }
    // La pudo resolver ya la sesión al abrirse: se entrega aquí una sola vez.
    const libre = resuelta.respuesta ?? sesion.tomarRespuestaLibre();
    if (libre !== null) {
      return {
        respuesta_libre_del_cliente: libre,
        nota:
          "El cliente escribió en vez de pulsar, y no nombra una de las ramas ofrecidas. Interpreta lo que pide y vuelve a llamar a repo_elegir_rama con una propuesta que lo recoja.",
      };
    }

    // La rama nueva lleva siempre el prefijo: así se reconocen los cambios de Strappy.
    const nueva = input.rama_nueva.startsWith("strappy/") ? input.rama_nueva : `strappy/${slugRama(input.rama_nueva) || "cambio"}`;
    const invalida = motivoRamaInvalida(nueva);
    if (invalida) throw new Error(`«${nueva}»: ${invalida}.`);

    const ramas = await gh.listarRamas(creds, opciones);
    const existentes = new Set(ramas.map((r) => r.nombre));
    if (existentes.has(nueva)) {
      throw new Error(`Ya existe una rama «${nueva}». Propón otro nombre, u ofrécela como existente.`);
    }
    const pedidas = [
      ...(input.recomendacion === "existente" && input.rama_existente ? [input.rama_existente] : []),
      ...(input.otras_existentes ?? []),
    ].filter((r, i, a) => r !== creds.ramaPrincipal && a.indexOf(r) === i);
    const inexistentes = pedidas.filter((r) => !existentes.has(r));
    if (inexistentes.length) {
      throw new Error(`No existen: ${inexistentes.join(", ")}. Mira las ramas reales con repo_ramas.`);
    }
    if (input.recomendacion === "existente" && !input.rama_existente) {
      throw new Error("Recomiendas una rama existente: di cuál en rama_existente.");
    }

    type Destino = { etiqueta: string; tipo: TipoRama; rama: string };
    const destinos: Destino[] = [
      { tipo: "nueva", rama: nueva, etiqueta: `Rama nueva «${nueva}»` },
      { tipo: "principal", rama: creds.ramaPrincipal, etiqueta: `Directo a «${creds.ramaPrincipal}» (se publica en vivo)` },
      ...pedidas.map((r) => ({ tipo: "existente" as const, rama: r, etiqueta: `Rama existente «${r}»` })),
    ];
    const recomendado =
      input.recomendacion === "existente"
        ? destinos.find((d) => d.tipo === "existente" && d.rama === input.rama_existente)
        : destinos.find((d) => d.tipo === input.recomendacion);
    const ordenados = recomendado ? [recomendado, ...destinos.filter((d) => d !== recomendado)] : destinos;
    const finales = ordenados.map((d, i) => ({
      ...d,
      etiqueta: recortarEtiqueta(i === 0 && recomendado ? `${d.etiqueta} · recomendado` : d.etiqueta),
    }));

    const pregunta = `¿Dónde guardo los cambios en ${creds.owner}/${creds.repo}? Te recomiendo: ${input.motivo}`.slice(0, 300);
    const entrada = {
      pregunta,
      opciones: finales.map((d) => d.etiqueta),
      // Solo botones: «publica en vivo» no se deduce de un texto libre.
      permite_texto: false,
      destinos: finales,
    };

    if (ctx.dryRun) {
      return {
        simulado: true,
        pregunta,
        opciones: entrada.opciones,
        nota: "Simulación: no se preguntó. Inclúyelo en el plan: el cliente elegirá la rama con un botón.",
      };
    }

    const huella = huellaAccion(sitio.taskId, "repo_elegir_rama", { destinos: finales.map((d) => `${d.tipo}:${d.rama}`) });
    // La misma pregunta ya contestada no se vuelve a hacer: quedaría esperando
    // un clic que ya se dio, y el encargo no se reanudaría nunca.
    if (await sitio.approvals.check({ workspaceId: ctx.workspaceId, taskId: sitio.taskId, huella })) {
      await sesion.registrarPregunta({ huella, destinos: finales });
      const otra = await sesion.resolverPreguntaPendiente();
      if (otra.aplicada) return { rama: sesion.estado.rama, tipo: sesion.estado.tipoRama, respuesta_del_cliente: otra.respuesta };
      sesion.tomarRespuestaLibre();
      return {
        respuesta_libre_del_cliente: otra.respuesta,
        nota: "El cliente ya contestó a esta misma pregunta sin elegir una opción. Cambia la propuesta (otro nombre de rama u otra recomendación) según lo que dijo.",
      };
    }
    const solicitud = await sitio.approvals.request({
      workspaceId: ctx.workspaceId,
      taskId: sitio.taskId,
      siteId: sitio.siteId,
      huella,
      // Se registra como pregunta: la web la pinta con botones y el bucle se detiene.
      toolSlug: "preguntar_al_cliente",
      motivo: "elegir dónde van los cambios",
      resumen: pregunta,
      entrada,
    });
    await sesion.registrarPregunta({ huella, destinos: finales });
    return {
      requiere_aprobacion: true,
      es_pregunta: true,
      solicitud_id: solicitud.id,
      motivo: "pregunta al cliente",
      opciones: entrada.opciones,
      mensaje:
        "Pregunta enviada con botones. Detente aquí y no hagas nada más: cuando el cliente pulse, la rama quedará puesta y retomarás el encargo.",
    };
  },
});

// ---------------------------------------------------------------------------
// Editar (la copia del encargo, no el repositorio)
// ---------------------------------------------------------------------------

export const repoEditar = defineTool({
  slug: "repo_editar",
  label: "Editar un archivo",
  description:
    "Reemplaza un fragmento EXACTO de un archivo por otro. «buscar» tiene que aparecer tal cual (espacios y sangría incluidos) y una sola vez, salvo que pidas todas. Es la forma de cambiar código: mínima, precisa y revisable.",
  whenToUse: "para cualquier cambio en un archivo que ya existe, después de leerlo con repo_leer",
  inputSchema: z.object({
    ruta,
    buscar: z.string().min(1).describe("Texto exacto que hay ahora, copiado del archivo SIN los números de línea."),
    reemplazar: z.string().describe("Texto que lo sustituye."),
    todas: z.boolean().default(false).describe("Reemplazar todas las apariciones."),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.repoWrite],
  effect: "write_internal",
  kind: "system",
  async execute(ctx, input) {
    const { sesion } = await trabajo(ctx, "repo_editar");
    const actual = sesion.leer(input.ruta);
    if (input.buscar === input.reemplazar) throw new Error("«buscar» y «reemplazar» son iguales: no hay cambio.");
    const veces = actual.split(input.buscar).length - 1;
    if (veces === 0) {
      const primera = input.buscar.split("\n")[0]!.trim();
      const pista = primera
        ? actual
            .split("\n")
            .map((l, i) => ({ l, i }))
            .filter(({ l }) => l.includes(primera.slice(0, 40)))
            .slice(0, 3)
            .map(({ l, i }) => `${i + 1}: ${l.trim().slice(0, 160)}`)
        : [];
      throw new Error(
        `No encontré el texto exacto en ${input.ruta}. Vuelve a leerlo con repo_leer y copia el fragmento tal cual, sin los números de línea.` +
          (pista.length ? ` Líneas parecidas: ${pista.join(" | ")}` : ""),
      );
    }
    if (veces > 1 && !input.todas) {
      throw new Error(`El texto aparece ${veces} veces en ${input.ruta}. Incluye más contexto para que sea único, o pasa todas=true.`);
    }
    const nuevo = input.todas ? actual.split(input.buscar).join(input.reemplazar) : actual.replace(input.buscar, () => input.reemplazar);
    await sesion.escribir(input.ruta, nuevo);
    return { ok: true, ruta: input.ruta, reemplazos: input.todas ? veces : 1, diff: recortar(sesion.diff(input.ruta), 4000) };
  },
});

export const repoEscribir = defineTool({
  slug: "repo_escribir",
  label: "Crear o reescribir un archivo",
  description:
    "Escribe un archivo completo: crea uno nuevo (un componente, una página, un estilo) o reemplaza entero uno existente. Para cambiar una parte de un archivo existente usa repo_editar.",
  whenToUse: "para archivos NUEVOS, o cuando de verdad cambia casi todo el archivo",
  inputSchema: z.object({
    ruta,
    contenido: z.string().max(400_000),
  }),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.repoWrite],
  effect: "write_internal",
  kind: "system",
  async execute(ctx, input) {
    const { sesion } = await trabajo(ctx, "repo_escribir");
    const existia = sesion.existe(input.ruta);
    await sesion.escribir(input.ruta, input.contenido);
    return {
      ok: true,
      ruta: input.ruta,
      accion: existia ? "reescrito" : "creado",
      lineas: input.contenido.split("\n").length,
      ...(existia ? { diff: recortar(sesion.diff(input.ruta), 4000) } : {}),
    };
  },
});

export const repoBorrar = defineTool({
  slug: "repo_borrar",
  label: "Borrar un archivo",
  description: "Marca un archivo para borrarlo en el próximo commit. Subir un borrado pide aprobación del cliente.",
  whenToUse: "solo si el encargo lo pide o el archivo quedó sin uso por tu cambio (y lo comprobaste con repo_buscar)",
  inputSchema: z.object({ ruta }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.repoWrite],
  effect: "write_internal",
  kind: "system",
  async execute(ctx, input) {
    const { sesion } = await trabajo(ctx, "repo_borrar");
    await sesion.borrar(input.ruta);
    return { ok: true, ruta: input.ruta, borrado: "pendiente de subir" };
  },
});

export const repoMover = defineTool({
  slug: "repo_mover",
  label: "Mover o renombrar un archivo",
  description: "Mueve o renombra un archivo de texto. No actualiza los imports: búscalos con repo_buscar y corrígelos.",
  whenToUse: "para renombrar o reubicar un archivo",
  inputSchema: z.object({ de: ruta, a: ruta }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.repoWrite],
  effect: "write_internal",
  kind: "system",
  async execute(ctx, input) {
    const { sesion } = await trabajo(ctx, "repo_mover");
    if (sesion.existe(input.a)) throw new Error(`Ya existe «${input.a}».`);
    const texto = sesion.leer(input.de);
    await sesion.escribir(input.a, texto);
    await sesion.borrar(input.de);
    const nombre = input.de.split("/").pop()!.replace(/\.[^.]+$/, "");
    const usos = sesion.buscar(new RegExp(`['"/]${nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`), () => true, 30);
    return {
      ok: true,
      de: input.de,
      a: input.a,
      ...(usos.length ? { revisa_imports: usos.map((u) => `${u.ruta}:${u.linea}: ${u.texto}`) } : {}),
    };
  },
});

export const repoDescartar = defineTool({
  slug: "repo_descartar",
  label: "Descartar cambios sin subir",
  description: "Deshace tus cambios sin subir en un archivo (o en todos) y lo deja como está en la rama.",
  whenToUse: "cuando un cambio tuyo sin subir salió mal y prefieres empezar ese archivo de nuevo",
  inputSchema: z.object({ ruta: z.string().max(400).optional() }),
  sensitive: false,
  creditCost: 0,
  scopes: [SCOPES.repoWrite],
  effect: "write_internal",
  kind: "system",
  async execute(ctx, input) {
    const { sesion } = await trabajo(ctx, "repo_descartar");
    const quitadas = await sesion.descartar(input.ruta?.replace(/^\.?\/+/, ""));
    return { descartados: quitadas };
  },
});

const MIME_A_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

export const repoAgregarImagen = defineTool({
  slug: "repo_agregar_imagen",
  label: "Añadir una imagen al repositorio",
  description:
    "Descarga una imagen que el cliente adjuntó al encargo y la añade al repositorio en la ruta indicada (normalmente dentro de public/ o de la carpeta de assets del proyecto).",
  whenToUse: "cuando el encargo trae una imagen del cliente para ponerla en el sitio",
  inputSchema: z.object({
    url: z.url(),
    ruta: ruta.describe("Dónde guardarla, p. ej. public/images/banner-verano.webp"),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.repoWrite],
  effect: "write_internal",
  kind: "http",
  async execute(ctx, input) {
    const { sitio, sesion } = await trabajo(ctx, "repo_agregar_imagen");
    const port = sitio.referencias;
    if (!port) throw new Error("Esta ejecución no tiene almacén de archivos del cliente configurado.");
    // Solo del almacén de la plataforma: una URL arbitraria haría de esto un
    // lector de la red interna del servidor.
    if (!port.hostsPermitidos.includes(new URL(input.url).host)) {
      throw new Error("Solo se pueden añadir imágenes adjuntadas en la plataforma.");
    }
    const { mimeType, bytes } = await port.descargar(input.url);
    const tipo = mimeType.split(";")[0]!.trim();
    if (!MIME_A_EXTENSION[tipo]) throw new Error(`No es una imagen (${mimeType}).`);
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("La imagen pesa más de 5 MB: pídele al cliente una más ligera.");
    const extension = input.ruta.split(".").pop()?.toLowerCase();
    const esperada = MIME_A_EXTENSION[tipo]!;
    const valida = extension === esperada || (esperada === "jpg" && extension === "jpeg");
    if (!valida) throw new Error(`La imagen es ${esperada} y la ruta termina en .${extension}: usa .${esperada}.`);
    if (tipo === "image/svg+xml") await sesion.escribir(input.ruta, Buffer.from(bytes).toString("utf8"));
    else await sesion.escribirBinario(input.ruta, Buffer.from(bytes).toString("base64"));
    return {
      ok: true,
      ruta: input.ruta,
      bytes: bytes.byteLength,
      nota: input.ruta.startsWith("public/")
        ? `Se sirve en /${input.ruta.slice("public/".length)}`
        : "Impórtala desde el componente como hace el resto del proyecto.",
    };
  },
});

export const repoDeshacer = defineTool({
  slug: "repo_deshacer",
  label: "Deshacer un cambio publicado",
  description:
    "Prepara en tu rama de trabajo la reversión de un PR ya fusionado (o de un commit): deja los archivos que cambió como estaban antes. Luego repo_ver_cambios, repo_guardar_cambios y, según la rama, PR y publicar.",
  whenToUse:
    "cuando el cliente pide volver atrás un cambio: primero repo_cambios_recientes para saber el número del PR",
  inputSchema: z
    .object({
      pr: z.number().int().positive().optional(),
      commit: z.string().regex(/^[0-9a-f]{7,40}$/i).optional(),
    })
    .refine((x) => Boolean(x.pr) !== Boolean(x.commit), "Pasa el número del PR o el commit, uno de los dos."),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.repoWrite],
  effect: "write_internal",
  kind: "http",
  async execute(ctx, input) {
    const { creds, opciones, sesion } = await trabajo(ctx, "repo_deshacer");
    sesion.ramaDeTrabajo();
    let sha: string;
    let archivos: gh.ArchivoCambiado[];
    if (input.pr) {
      const p = await gh.leerPR(creds, input.pr, opciones);
      if (p.estado !== "fusionado" || !p.shaFusion) {
        throw new Error(`El PR #${input.pr} no está fusionado (${p.estado}): no hay nada publicado que deshacer. Si está abierto, basta con cerrarlo.`);
      }
      sha = p.shaFusion;
      archivos = await gh.archivosDePR(creds, input.pr, opciones);
    } else {
      sha = input.commit!;
      archivos = await gh.archivosDeCommit(creds, sha, opciones);
    }
    const [padre] = await gh.padresDe(creds, sha, opciones);
    if (!padre) throw new Error("Ese commit no tiene padre: es el primero del repositorio.");

    const hechos: string[] = [];
    const omitidos: string[] = [];
    for (const a of archivos) {
      if (motivoProhibido(a.ruta)) {
        omitidos.push(a.ruta);
        continue;
      }
      if (a.estado === "added") {
        await sesion.restaurar(a.ruta, null);
      } else if (a.estado === "renamed" && a.rutaAnterior) {
        await sesion.restaurar(a.ruta, null);
        await sesion.restaurar(a.rutaAnterior, await gh.archivoEn(creds, a.rutaAnterior, padre, opciones));
      } else {
        await sesion.restaurar(a.ruta, await gh.archivoEn(creds, a.ruta, padre, opciones));
      }
      hechos.push(a.ruta);
    }

    // Si esos archivos cambiaron DESPUÉS, volver al estado anterior también
    // se lleva esos cambios. Hay que decirlo, no descubrirlo en producción.
    const despues = await gh.comparar(creds, sha, sesion.commitCargado, opciones).catch(() => null);
    const tocadosDespues = despues ? despues.archivos.map((f) => f.ruta).filter((r) => hechos.includes(r)) : [];
    return {
      ok: true,
      revertidos: hechos,
      ...(omitidos.length ? { no_revertidos: omitidos, motivo: "son lockfiles o archivos protegidos" } : {}),
      ...(tocadosDespues.length
        ? {
            aviso: `Estos archivos cambiaron después de ese PR: ${tocadosDespues.join(", ")}. Revertirlos también deshace esos cambios posteriores. Revisa el diff con repo_ver_cambios y, si no es lo que se quiere, reconstruye a mano con repo_editar.`,
          }
        : {}),
      siguiente: "repo_ver_cambios → repo_guardar_cambios",
    };
  },
});

// ---------------------------------------------------------------------------
// Subir, PR, build y publicar (efecto externo)
// ---------------------------------------------------------------------------

function huellaDeCambios(cambios: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(JSON.stringify(Object.entries(cambios).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
}

export const repoGuardarCambios = defineTool({
  slug: "repo_guardar_cambios",
  label: "Subir los cambios",
  description:
    "Sube TODOS tus cambios pendientes a la rama de trabajo en un solo commit (crea la rama si es nueva). Si la rama es la principal, esto publica en vivo. Si los cambios tocan despliegue, dependencias, acceso o pagos, o borran archivos, espera la aprobación del cliente.",
  whenToUse: "cuando el cambio completo está hecho y revisado con repo_ver_cambios; no subas trabajo a medias",
  inputSchema: z.object({
    mensaje: z
      .string()
      .min(8)
      .max(500)
      .describe("Mensaje del commit, al estilo del repositorio (mira repo_historial). Primera línea corta."),
  }),
  sensitive: false,
  creditCost: 3,
  scopes: [SCOPES.repoWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, sesion, creds } = await trabajo(ctx, "repo_guardar_cambios");
    const rama = sesion.ramaDeTrabajo();
    const cambios = sesion.estado.cambios;
    if (Object.keys(cambios).length === 0) throw new Error("No hay cambios pendientes que subir.");

    const sensibilidad = sensibilidadDeCambios(cambios, (r) => sesion.original(r));
    // La aprobación vale para ESTOS cambios exactos: si el agente cambia un
    // carácter después del clic, la huella cambia y hace falta otro.
    const bloqueo = await puertaDeAprobacion(
      ctx,
      sitio,
      "repo_guardar_cambios",
      { mensaje: input.mensaje, rama, cambios: huellaDeCambios(cambios) },
      sensibilidad,
    );
    if (bloqueo) return bloqueo;

    const pendientes = sesion.pendientes();
    const r = await sesion.subir(input.mensaje);
    return {
      ok: true,
      commit: r.sha.slice(0, 12),
      rama: r.rama,
      ...(r.creada ? { rama_creada: true } : {}),
      archivos: pendientes.map((p) => `${p.accion} ${p.ruta} (+${p.mas} −${p.menos})`),
      url: `https://github.com/${creds.owner}/${creds.repo}/commit/${r.sha}`,
      siguiente:
        sesion.estado.tipoRama === "principal"
          ? "Está en la rama principal: comprueba el despliegue de producción con repo_estado_despliegue y el sitio en vivo con el navegador."
          : sesion.estado.pr
            ? `El PR #${sesion.estado.pr} ya incluye este commit. Comprueba el build con repo_estado_despliegue.`
            : "Abre el PR con repo_abrir_pr y comprueba el build con repo_estado_despliegue.",
    };
  },
  async simulate(ctx) {
    const { sesion } = await trabajo(ctx, "repo_guardar_cambios");
    return {
      simulado: true,
      rama: sesion.estado.rama,
      archivos: sesion.pendientes(),
      diff: recortar(sesion.diff(), 12_000),
      nota: "Simulación: no se subió nada. Este es el diff que se subiría.",
    };
  },
});

export const repoAbrirPr = defineTool({
  slug: "repo_abrir_pr",
  label: "Abrir el pull request",
  description:
    "Abre (o actualiza, si ya existe) el pull request de la rama de trabajo hacia la principal, con un título y una descripción para quien lo revise.",
  whenToUse: "después del primer repo_guardar_cambios en una rama que no es la principal",
  inputSchema: z.object({
    titulo: z.string().min(5).max(200),
    descripcion: z
      .string()
      .min(20)
      .max(8000)
      .describe("Qué cambia y por qué, dónde se ve, cómo se verificó y qué revisar. En markdown."),
    borrador: z.boolean().default(false),
    hacia: z.string().max(100).optional().describe("Rama destino; por defecto la principal."),
  }),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.repoWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { creds, opciones, sesion } = await trabajo(ctx, "repo_abrir_pr");
    const rama = sesion.ramaDeTrabajo();
    if (sesion.estado.tipoRama === "principal") {
      throw new Error("Trabajas directo en la rama principal: no hay PR que abrir, los cambios ya están ahí.");
    }
    const hacia = input.hacia ?? creds.ramaPrincipal;
    if (hacia === rama) throw new Error("El PR no puede ir de una rama a sí misma.");
    if (!(await gh.shaDeRama(creds, rama, opciones))) {
      throw new Error(`La rama «${rama}» aún no existe en GitHub: sube primero los cambios con repo_guardar_cambios.`);
    }
    const cuerpo = `${input.descripcion}\n\n---\n_Hecho por el Webmaster de Strappy en un encargo del cliente._`;
    const existente = sesion.estado.pr
      ? await gh.leerPR(creds, sesion.estado.pr, opciones)
      : (await gh.listarPRs(creds, { estado: "open", rama }, opciones))[0];
    const pr =
      existente && existente.estado === "abierto"
        ? await gh.actualizarPR(creds, existente.numero, { titulo: input.titulo, cuerpo }, opciones)
        : await gh.crearPR(creds, { titulo: input.titulo, cuerpo, rama, base: hacia, borrador: input.borrador }, opciones);
    await sesion.anotar({ pr: pr.numero });
    return {
      ok: true,
      pr: pr.numero,
      url: pr.url,
      accion: existente && existente.estado === "abierto" ? "actualizado" : "abierto",
      siguiente: "Comprueba el build y la vista previa con repo_estado_despliegue (esperar_segundos) y repo_ver_vista_previa.",
    };
  },
  simulate(_ctx, input) {
    return { simulado: true, titulo: input.titulo, nota: "Simulación: no se abrió el PR." };
  },
});

const PLATAFORMAS_DE_PREVIEW = /\.(vercel\.app|netlify\.app|pages\.dev|onrender\.com|web\.app|firebaseapp\.com|amplifyapp\.com|surge\.sh|fly\.dev|railway\.app|up\.railway\.app)$/i;

function resumirEstado(comprobaciones: readonly gh.Comprobacion[], despliegues: readonly gh.Despliegue[]) {
  const todos = [...comprobaciones.map((c) => c.estado), ...despliegues.map((d) => d.estado)];
  if (todos.length === 0) return "sin_comprobaciones";
  if (todos.includes("fallo")) return "fallo";
  if (todos.includes("en_curso")) return "en_curso";
  return "exito";
}

function esperar(ms: number, señal?: AbortSignal): Promise<void> {
  return new Promise((resolver, rechazar) => {
    const t = setTimeout(resolver, ms);
    señal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        rechazar(new Error("El encargo se detuvo."));
      },
      { once: true },
    );
  });
}

export const repoEstadoDespliegue = defineTool({
  slug: "repo_estado_despliegue",
  label: "Comprobar el build y el despliegue",
  description:
    "Estado del build, los checks (GitHub Actions, Vercel, Netlify…) y los despliegues del último commit de la rama de trabajo o de la principal. Si algo falló, trae el final del log con el error. Si hay vista previa, da su URL y deja el navegador listo para verla. Puede esperar a que termine.",
  whenToUse:
    "después de cada repo_guardar_cambios: un cambio no está hecho hasta que el build pasa. Tras publicar, con de=principal, para ver el despliegue de producción",
  inputSchema: z.object({
    de: z.enum(["trabajo", "principal"]).default("trabajo"),
    esperar_segundos: z
      .number()
      .int()
      .min(0)
      .max(240)
      .default(90)
      .describe("Cuánto esperar, como mucho, a que terminen los checks en curso."),
  }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.repoRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sitio, creds, opciones, sesion } = await trabajo(ctx, "repo_estado_despliegue");
    const rama = input.de === "principal" ? creds.ramaPrincipal : sesion.ramaDeTrabajo();
    const sha = await gh.shaDeRama(creds, rama, opciones);
    if (!sha) throw new Error(`La rama «${rama}» aún no existe en GitHub: sube primero con repo_guardar_cambios.`);

    const limite = Date.now() + input.esperar_segundos * 1000;
    let comprobaciones: gh.Comprobacion[] = [];
    let despliegues: gh.Despliegue[] = [];
    let estado = "sin_comprobaciones";
    // Las plataformas tardan unos segundos en registrar el commit: sin nada
    // todavía, se espera un poco antes de concluir que no hay checks.
    for (let vuelta = 0; ; vuelta++) {
      [comprobaciones, despliegues] = await Promise.all([
        gh.comprobacionesDe(creds, sha, opciones),
        gh.desplieguesDe(creds, sha, opciones),
      ]);
      estado = resumirEstado(comprobaciones, despliegues);
      const seguir = estado === "en_curso" || (estado === "sin_comprobaciones" && vuelta < 2);
      if (!seguir || Date.now() + 10_000 > limite) break;
      await esperar(10_000, ctx.abortSignal);
    }

    // La vista previa: la URL la da GitHub (el despliegue o el estado de la
    // plataforma), nunca el modelo.
    const candidatas = [
      ...despliegues.filter((d) => d.url && !/^production$/i.test(d.entorno)).map((d) => d.url!),
      ...comprobaciones
        .map((c) => c.url)
        .filter((u): u is string => Boolean(u && PLATAFORMAS_DE_PREVIEW.test(new URL(u).hostname))),
    ];
    const vista = input.de === "trabajo" ? candidatas[0] : undefined;
    if (vista) {
      VISTAS_PREVIAS.set(sitio, { url: vista.replace(/\/+$/, ""), conBypass: false });
      sitio.browser?.permitirHost?.(new URL(vista).host);
    }

    const fallos = comprobaciones.filter((c) => c.estado === "fallo");
    const logs: { check: string; log: string }[] = [];
    for (const f of fallos.filter((x) => x.jobId).slice(0, 2)) {
      try {
        logs.push({ check: f.nombre, log: await gh.colaDeLogs(creds, f.jobId!, opciones) });
      } catch {
        /* sin permiso sobre Actions: queda el resumen del check */
      }
    }

    return {
      rama,
      commit: sha.slice(0, 12),
      estado,
      checks: comprobaciones.map((c) => ({
        nombre: c.nombre,
        estado: c.estado,
        ...(c.estado === "fallo" && c.resumen ? { resumen: recortar(c.resumen, 1200) } : {}),
        ...(c.url ? { url: c.url } : {}),
      })),
      despliegues: despliegues.map((d) => ({ entorno: d.entorno, estado: d.estado, ...(d.url ? { url: d.url } : {}) })),
      ...(vista ? { vista_previa: vista, siguiente: "Mírala con repo_ver_vista_previa." } : {}),
      ...(logs.length ? { logs_de_fallos: logs } : {}),
      ...(estado === "fallo"
        ? {
            que_hacer:
              "El build falló. Lee el error, corrígelo con repo_editar, revisa con repo_ver_cambios y vuelve a subir. Si el fallo no es por tu cambio (ya fallaba antes), dilo en el RESUMEN y no publiques.",
          }
        : {}),
      ...(estado === "en_curso" ? { nota: "Sigue en curso. Vuelve a consultar en un rato; mientras, revisa otra cosa." } : {}),
      ...(estado === "sin_comprobaciones"
        ? {
            nota:
              "El repositorio no tiene checks ni despliegues conectados a GitHub: no hay build que mirar. Revisa el diff con especial cuidado y dilo en el RESUMEN.",
          }
        : {}),
    };
  },
});

export const repoVerVistaPrevia = defineTool({
  slug: "repo_ver_vista_previa",
  label: "Ver la vista previa",
  description:
    "Abre en el navegador la vista previa de la rama de trabajo (la que dio repo_estado_despliegue) en la ruta indicada. Después puedes usar navegador_click, navegador_leer y navegador_consola sobre ella.",
  whenToUse: "para VER el cambio antes de publicarlo, después de que repo_estado_despliegue dé una vista previa",
  inputSchema: z.object({
    ruta: z.string().startsWith("/", "Ruta relativa, p. ej. /contacto").default("/"),
    pagina_completa: z.boolean().default(false),
  }),
  sensitive: false,
  creditCost: 2,
  scopes: [SCOPES.navegador],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { sitio } = entorno(ctx, "repo_ver_vista_previa");
    const creds = requireRepo(sitio, "repo_ver_vista_previa");
    const vista = VISTAS_PREVIAS.get(sitio);
    if (!vista) {
      throw new Error("No hay vista previa todavía: llama antes a repo_estado_despliegue; es quien la encuentra.");
    }
    if (input.ruta.startsWith("//")) throw new Error("La ruta no puede apuntar a otro dominio.");
    const nav = requireBrowser(sitio, "repo_ver_vista_previa");
    const url = new URL(`${vista.url}${input.ruta}`);
    // Las vistas previas de Vercel pueden estar protegidas. Con el secreto de
    // «Protection Bypass», la primera visita deja una cookie y ya no hace falta.
    const secreto = creds.bypassVistaPrevia;
    if (secreto && !vista.conBypass) {
      url.searchParams.set("x-vercel-protection-bypass", secreto);
      url.searchParams.set("x-vercel-set-bypass-cookie", "true");
      VISTAS_PREVIAS.set(sitio, { ...vista, conBypass: true });
    }
    const r = await nav.ir(url.toString(), input.pagina_completa);
    const limpia = secreto ? r.url.split(secreto).join("«oculto»") : r.url;
    sitio.capturas?.push({ herramienta: "repo_ver_vista_previa", base64: r.base64, mimeType: r.mimeType, url: limpia, titulo: r.titulo });
    const protegida = r.status === 401 || /vercel\.com\/(login|sso)/.test(r.url);
    return {
      url: limpia,
      titulo: r.titulo,
      status: r.status,
      captura_guardada: true,
      ...(protegida
        ? {
            aviso:
              "La vista previa está protegida con login. Para verla hace falta el secreto de «Protection Bypass for Automation» de Vercel en los ajustes del repositorio en Strappy. Dilo en el RESUMEN.",
          }
        : {}),
    };
  },
});

export const repoLeerRevision = defineTool({
  slug: "repo_leer_revision",
  label: "Leer la revisión del PR",
  description:
    "Lee lo que se dijo en el PR: comentarios, revisiones (aprobado, cambios pedidos) y comentarios en líneas concretas del código. Por defecto, el PR del encargo.",
  whenToUse: "cuando el encargo es atender los comentarios de un PR, o antes de publicar para ver si alguien pidió cambios",
  inputSchema: z.object({ pr: z.number().int().positive().optional() }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.repoRead],
  effect: "read",
  kind: "http",
  async execute(ctx, input) {
    const { creds, opciones, sesion } = await trabajo(ctx, "repo_leer_revision");
    const numero = input.pr ?? sesion.estado.pr;
    if (!numero) throw new Error("No hay PR en este encargo: pasa su número (míralo con repo_cambios_recientes).");
    const [p, comentarios] = await Promise.all([gh.leerPR(creds, numero, opciones), gh.comentariosDePR(creds, numero, opciones)]);
    return {
      pr: numero,
      titulo: p.titulo,
      estado: p.estado,
      rama: p.rama,
      fusionable: p.fusionable,
      estado_de_fusion: p.estadoFusion,
      comentarios: comentarios.map((c) => ({ ...c, texto: recortar(c.texto, 1500) })),
    };
  },
});

export const repoComentarPr = defineTool({
  slug: "repo_comentar_pr",
  label: "Comentar en el PR",
  description: "Deja un comentario en el PR del encargo: responder a una revisión o explicar un cambio.",
  whenToUse: "para contestar a quien revisó el PR, después de atender sus comentarios",
  inputSchema: z.object({ texto: z.string().min(5).max(4000), pr: z.number().int().positive().optional() }),
  sensitive: false,
  creditCost: 1,
  scopes: [SCOPES.repoWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { creds, opciones, sesion } = await trabajo(ctx, "repo_comentar_pr");
    const numero = input.pr ?? sesion.estado.pr;
    if (!numero) throw new Error("No hay PR en este encargo: pasa su número.");
    return { ok: true, url: await gh.comentarPR(creds, numero, input.texto, opciones) };
  },
  simulate(_ctx, input) {
    return { simulado: true, texto: input.texto };
  },
});

export const repoPublicar = defineTool({
  slug: "repo_publicar",
  label: "Publicar el PR",
  description:
    "Fusiona el PR en la rama principal: el cambio sale en vivo. Siempre espera el clic del cliente. Solo se fusiona el commit que se revisó, y nunca con el build en rojo.",
  whenToUse:
    "al final, con el build en verde y la vista previa verificada, si el encargo es que el cambio quede publicado",
  inputSchema: z.object({
    pr: z.number().int().positive(),
    metodo: z.enum(["squash", "merge", "rebase"]).default("squash"),
  }),
  sensitive: true,
  creditCost: 2,
  scopes: [SCOPES.repoWrite],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { creds, opciones } = soloApi(ctx, "repo_publicar");
    const p = await gh.leerPR(creds, input.pr, opciones);
    if (p.estado !== "abierto") throw new Error(`El PR #${input.pr} está ${p.estado}: no hay nada que publicar.`);
    if (p.base !== creds.ramaPrincipal) {
      throw new Error(`El PR #${input.pr} va hacia «${p.base}», no hacia la principal: eso lo fusiona el equipo.`);
    }
    const checks = await gh.comprobacionesDe(creds, p.shaCabeza, opciones);
    const rojos = checks.filter((c) => c.estado === "fallo").map((c) => c.nombre);
    if (rojos.length) throw new Error(`No publico con checks en rojo: ${rojos.join(", ")}. Arréglalos primero.`);
    if (p.fusionable === false) {
      throw new Error(`GitHub dice que el PR #${input.pr} tiene conflictos (${p.estadoFusion ?? "?"}). Hay que resolverlos antes.`);
    }
    const r = await gh.fusionarPR(creds, input.pr, { metodo: input.metodo, sha: p.shaCabeza }, opciones);
    return {
      ok: true,
      publicado: true,
      pr: input.pr,
      commit: r.sha.slice(0, 12),
      siguiente: `Comprueba el despliegue de producción con repo_estado_despliegue (de=principal) y mira ${creds.urlProduccion} con el navegador.`,
    };
  },
  simulate(_ctx, input) {
    return { simulado: true, pr: input.pr, nota: "Simulación: no se publicó nada." };
  },
});

export const HERRAMIENTAS_REPO: readonly ToolDef<never, unknown>[] = [
  repoInfo,
  repoArbol,
  repoLeer,
  repoBuscar,
  repoRamas,
  repoHistorial,
  repoCambiosRecientes,
  repoVerCambios,
  repoElegirRama,
  repoEditar,
  repoEscribir,
  repoBorrar,
  repoMover,
  repoDescartar,
  repoAgregarImagen,
  repoDeshacer,
  repoGuardarCambios,
  repoAbrirPr,
  repoEstadoDespliegue,
  repoVerVistaPrevia,
  repoLeerRevision,
  repoComentarPr,
  repoPublicar,
] as unknown as readonly ToolDef<never, unknown>[];
