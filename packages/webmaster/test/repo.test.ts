/**
 * El Webmaster de repositorios contra un GitHub de mentira.
 *
 * Lo que de verdad importa comprobar aquí no es que cada llamada a la API
 * tenga la forma correcta, sino las promesas que le hacemos al cliente:
 *  - la rama la elige él con un botón, y «directo a main» solo con SU botón;
 *  - nada llega a GitHub hasta que el agente sube, y llega en un commit;
 *  - lo que el encargo lleva hecho sobrevive a una pausa;
 *  - no se pisa el trabajo de otra persona, no se escriben secretos ni
 *    lockfiles, y publicar exige build en verde.
 */
import { describe, expect, it } from "vitest";
import { executeToolDef, type ToolContext } from "@strappy/tools";
import {
  SCOPES_REPO,
  ejecutarTareaWebmaster,
  webmasterRepo,
  webmasterToolRegistry,
  type SitioContext,
} from "../src/index.js";
import {
  API_GITHUB_FALSA,
  AprobacionesEnMemoria,
  BackupsEnMemoria,
  NavegadorFalso,
  RepoEstadoEnMemoria,
  crearDobleGithub,
  crearTarball,
  modeloGuionizado,
  type DobleGithub,
} from "../src/testing/index.js";
import { leerTarball } from "../src/repo/tar.js";
import { diffUnificado } from "../src/repo/diff.js";
import { motivoProhibido, sensibilidadDeCambios } from "../src/repo/reglas.js";

type Montaje = {
  gh: DobleGithub;
  aprobaciones: AprobacionesEnMemoria;
  estadoRepo: RepoEstadoEnMemoria;
  navegador: NavegadorFalso;
  sitio: SitioContext;
  ctx: ToolContext;
  /** Otra ejecución del mismo encargo, como tras una pausa: sesión nueva, mismo estado guardado. */
  reanudar(): { sitio: SitioContext; ctx: ToolContext };
  usar(slug: string, entrada?: unknown, ctx?: ToolContext): Promise<Record<string, unknown>>;
};

function montar(opciones: { dryRun?: boolean; otrasRamas?: string[]; bypass?: string } = {}): Montaje {
  const gh = crearDobleGithub({ ...(opciones.otrasRamas ? { otrasRamas: opciones.otrasRamas } : {}) });
  const aprobaciones = new AprobacionesEnMemoria();
  const estadoRepo = new RepoEstadoEnMemoria();
  const navegador = new NavegadorFalso("https://acme.test", () => ({ titulo: "Acme", texto: "Diseñamos espacios", status: 200 }));

  const hacer = () => {
    const sitio: SitioContext = {
      siteId: "site_repo",
      taskId: "task_r",
      tipo: "repo",
      repo: {
        proveedor: "github",
        owner: "acme",
        repo: "web",
        ramaPrincipal: "main",
        token: gh.estado.token,
        urlProduccion: "https://acme.test",
        apiBase: API_GITHUB_FALSA,
        ...(opciones.bypass ? { bypassVistaPrevia: opciones.bypass } : {}),
      },
      repoEstado: estadoRepo,
      backups: new BackupsEnMemoria(),
      approvals: aprobaciones,
      browser: navegador,
      fetch: gh.fetch,
    };
    const ctx = {
      workspaceId: "ws_1",
      dryRun: Boolean(opciones.dryRun),
      scopes: SCOPES_REPO,
      ports: {},
      now: () => new Date(),
      sitio,
    } as unknown as ToolContext;
    return { sitio, ctx };
  };

  const { sitio, ctx } = hacer();
  return {
    gh,
    aprobaciones,
    estadoRepo,
    navegador,
    sitio,
    ctx,
    reanudar: hacer,
    async usar(slug, entrada = {}, c = ctx) {
      return (await executeToolDef(webmasterToolRegistry.get(slug), c, entrada as never)) as Record<string, unknown>;
    },
  };
}

const PROPUESTA = {
  recomendacion: "nueva",
  rama_nueva: "strappy/telefono-hero",
  motivo: "así ves el cambio en una vista previa antes de publicarlo",
};

/** Pregunta la rama y la contesta con el botón cuya etiqueta cumple `elegir`. */
async function elegirRama(m: Montaje, elegir: (etiqueta: string) => boolean, propuesta: unknown = PROPUESTA) {
  const r = await m.usar("repo_elegir_rama", propuesta);
  expect(r.requiere_aprobacion).toBe(true);
  const solicitud = m.aprobaciones.solicitudes.at(-1)!;
  const etiqueta = (solicitud.entrada as { opciones: string[] }).opciones.find(elegir)!;
  m.aprobaciones.responder(solicitud.huella, etiqueta);
  return m.reanudar();
}

describe("piezas del repositorio", () => {
  it("lee el tarball de GitHub: carpeta raíz fuera, nombres largos y el commit", () => {
    const larga = `src/${"muy-larga/".repeat(12)}archivo.ts`;
    const tar = crearTarball(
      "acme-web-abc1234",
      "abc1234def",
      new Map([
        ["a.txt", { bytes: new TextEncoder().encode("hola"), modo: "100644" }],
        [larga, { bytes: new TextEncoder().encode("x"), modo: "100755" }],
      ]),
    );
    const leido = leerTarball(tar);
    expect(leido.commit).toBe("abc1234def");
    expect(leido.archivos.map((a) => a.ruta)).toEqual(["a.txt", larga]);
    expect(new TextDecoder().decode(leido.archivos[0]!.bytes)).toBe("hola");
    expect(leido.archivos[1]!.modo).toBe("100755");
  });

  it("el diff unificado dice qué líneas cambiaron", () => {
    const d = diffUnificado("x.ts", "a\nb\nc\nd", "a\nB\nc\nd\ne");
    expect(d).toContain("--- a/x.ts");
    expect(d).toContain("-b");
    expect(d).toContain("+B");
    expect(d).toContain("+e");
    expect(d).not.toContain("-a");
  });

  it("no deja escribir secretos, lockfiles ni carpetas generadas", () => {
    expect(motivoProhibido(".env")).toMatch(/secretos/);
    expect(motivoProhibido("apps/web/.env.local")).toMatch(/secretos/);
    expect(motivoProhibido(".env.example")).toBeNull();
    expect(motivoProhibido("pnpm-lock.yaml")).toMatch(/lockfile/);
    expect(motivoProhibido("node_modules/x/index.js")).not.toBeNull();
    expect(motivoProhibido("../fuera.txt")).not.toBeNull();
    expect(motivoProhibido("src/app/page.tsx")).toBeNull();
  });

  it("pide aprobación para despliegue, dependencias, pagos y borrados, no para un texto", () => {
    const original = () => JSON.stringify({ dependencies: { next: "15" } });
    expect(sensibilidadDeCambios({ "src/components/hero.tsx": { texto: "x" } }, original).sensible).toBe(false);
    expect(sensibilidadDeCambios({ "vercel.json": { texto: "{}" } }, original).motivo).toMatch(/despliega/);
    expect(sensibilidadDeCambios({ "src/app/checkout/page.tsx": { texto: "x" } }, original).motivo).toMatch(/pagos/);
    expect(sensibilidadDeCambios({ "src/viejo.ts": null }, original).motivo).toMatch(/borra/);
    const conDep = JSON.stringify({ dependencies: { next: "15", lodash: "4" } });
    expect(sensibilidadDeCambios({ "package.json": { texto: conDep } }, original).motivo).toMatch(/dependencias/);
    const soloScript = JSON.stringify({ scripts: { dev: "x" }, dependencies: { next: "15" } });
    expect(sensibilidadDeCambios({ "package.json": { texto: soloScript } }, original).sensible).toBe(false);
  });
});

describe("herramientas del repositorio", () => {
  it("repo_info reconoce el proyecto y dice que falta elegir rama", async () => {
    const m = montar();
    const r = await m.usar("repo_info");
    const proyecto = r.proyecto as { frameworks: string[]; estilos: string[]; gestor: string };
    expect(proyecto.frameworks.join(" ")).toMatch(/Next\.js 15/);
    expect(proyecto.estilos).toContain("Tailwind CSS");
    expect(proyecto.gestor).toBe("pnpm");
    expect(String(r.rama_de_trabajo)).toMatch(/sin elegir/);
  });

  it("buscar, leer y ver el árbol encuentran el texto que pidió el cliente", async () => {
    const m = montar();
    const b = await m.usar("repo_buscar", { patron: "600 000 000" });
    expect(b.resultados).toEqual([expect.stringMatching(/^src\/components\/hero\.tsx:2:/)]);
    const l = await m.usar("repo_leer", { ruta: "src/components/hero.tsx" });
    expect(String(l.contenido)).toMatch(/^\s+1 {2}export function Hero/);
    const a = await m.usar("repo_arbol", { ruta: "src", profundidad: 1 });
    expect(a.archivos).toEqual(["src/app/", "src/components/"]);
    await expect(m.usar("repo_leer", { ruta: "public/logo.png" })).rejects.toThrow(/binario/);
  });

  it("no edita nada antes de que el cliente elija la rama", async () => {
    const m = montar();
    await expect(
      m.usar("repo_editar", { ruta: "src/components/hero.tsx", buscar: "600 000 000", reemplazar: "611 222 333" }),
    ).rejects.toThrow(/repo_elegir_rama/);
  });

  it("la rama se pregunta con botones, la recomendada primero, y al volver ya está puesta", async () => {
    const m = montar({ otrasRamas: ["develop"] });
    const r = await m.usar("repo_elegir_rama", { ...PROPUESTA, otras_existentes: ["develop"] });
    expect(r.es_pregunta).toBe(true);
    const s = m.aprobaciones.solicitudes[0]!;
    expect(s.toolSlug).toBe("preguntar_al_cliente");
    const entrada = s.entrada as { opciones: string[]; permite_texto: boolean };
    expect(entrada.permite_texto).toBe(false);
    expect(entrada.opciones).toEqual([
      "Rama nueva «strappy/telefono-hero» · recomendado",
      "Directo a «main» (se publica en vivo)",
      "Rama existente «develop»",
    ]);

    // Sin respuesta, preguntar otra vez no duplica el botón.
    await m.usar("repo_elegir_rama", { ...PROPUESTA, otras_existentes: ["develop"] });
    expect(m.aprobaciones.solicitudes).toHaveLength(1);

    m.aprobaciones.responder(s.huella, entrada.opciones[0]!);
    const tras = m.reanudar();
    const info = await m.usar("repo_info", {}, tras.ctx);
    expect(info.rama_de_trabajo).toBe("strappy/telefono-hero");
    expect(info.tipo_de_rama).toBe("nueva");
  });

  it("«directo a main» solo vale con su botón, nunca con un texto libre", async () => {
    const m = montar();
    await m.usar("repo_elegir_rama", PROPUESTA);
    const s = m.aprobaciones.solicitudes[0]!;
    m.aprobaciones.responder(s.huella, "sí, mételo en main directamente");
    const tras = m.reanudar();
    const r = await m.usar("repo_elegir_rama", PROPUESTA, tras.ctx);
    expect(r.respuesta_libre_del_cliente).toMatch(/main/);
    const info = await m.usar("repo_info", {}, tras.ctx);
    expect(String(info.rama_de_trabajo)).toMatch(/sin elegir/);

    // Si el modelo repite la misma pregunta, no se queda esperando un clic ya dado.
    const repetida = await m.usar("repo_elegir_rama", PROPUESTA, tras.ctx);
    expect(repetida.requiere_aprobacion).toBeUndefined();
    expect(String(repetida.nota)).toMatch(/Cambia la propuesta/);
    expect(m.aprobaciones.solicitudes).toHaveLength(1);
  });

  it("de la edición al PR publicado: un commit, build, vista previa y merge", async () => {
    const m = montar();
    const { ctx } = await elegirRama(m, (e) => e.startsWith("Rama nueva"));

    const ed = await m.usar(
      "repo_editar",
      { ruta: "src/components/hero.tsx", buscar: "600 000 000", reemplazar: "611 222 333" },
      ctx,
    );
    expect(String(ed.diff)).toContain("+  return <section");
    // Nada ha salido todavía hacia GitHub.
    expect(m.gh.estado.ramas.has("strappy/telefono-hero")).toBe(false);

    const cambios = await m.usar("repo_ver_cambios", {}, ctx);
    expect(cambios.pendientes).toEqual([{ ruta: "src/components/hero.tsx", accion: "modificar", mas: 1, menos: 1 }]);

    const subida = await m.usar("repo_guardar_cambios", { mensaje: "Actualiza el teléfono del hero" }, ctx);
    expect(subida.rama_creada).toBe(true);
    expect(m.gh.archivos("strappy/telefono-hero")["src/components/hero.tsx"]).toContain("611 222 333");
    expect(m.gh.archivos("main")["src/components/hero.tsx"]).toContain("600 000 000");

    const pr = await m.usar("repo_abrir_pr", { titulo: "Nuevo teléfono en el hero", descripcion: "Cambia el teléfono de la portada por el nuevo." }, ctx);
    expect(pr.pr).toBe(1);

    // La plataforma de hosting registra un despliegue de vista previa y un check verde.
    const cabeza = m.gh.estado.ramas.get("strappy/telefono-hero")!;
    m.gh.estado.checks.set(cabeza, [{ name: "Vercel", status: "completed", conclusion: "success" }]);
    m.gh.estado.despliegues.set(cabeza, [{ id: 7, environment: "Preview", url: "https://web-git-telefono.vercel.app", state: "success" }]);
    const build = await m.usar("repo_estado_despliegue", { esperar_segundos: 0 }, ctx);
    expect(build.estado).toBe("exito");
    expect(build.vista_previa).toBe("https://web-git-telefono.vercel.app");

    const vista = await m.usar("repo_ver_vista_previa", { ruta: "/" }, ctx);
    expect(vista.status).toBe(200);
    expect(m.navegador.visitadas.at(-1)).toBe("https://web-git-telefono.vercel.app/");

    const publicado = await m.usar("repo_publicar", { pr: 1 }, ctx);
    expect(publicado.publicado).toBe(true);
    expect(m.gh.archivos("main")["src/components/hero.tsx"]).toContain("611 222 333");
  });

  it("un build en rojo trae el log del fallo y bloquea publicar", async () => {
    const m = montar();
    const { ctx } = await elegirRama(m, (e) => e.startsWith("Rama nueva"));
    await m.usar("repo_escribir", { ruta: "src/components/nuevo.tsx", contenido: "export const X = (" }, ctx);
    await m.usar("repo_guardar_cambios", { mensaje: "Añade componente nuevo" }, ctx);
    await m.usar("repo_abrir_pr", { titulo: "Componente nuevo", descripcion: "Añade un componente nuevo a la portada." }, ctx);
    const cabeza = m.gh.estado.ramas.get("strappy/telefono-hero")!;
    m.gh.estado.checks.set(cabeza, [
      {
        name: "build",
        status: "completed",
        conclusion: "failure",
        app: { slug: "github-actions" },
        details_url: "https://github.com/acme/web/actions/runs/1/job/99",
      },
    ]);
    m.gh.estado.logs.set(99, "2026-09-01T00:00:00.000Z Type error: ')' expected. src/components/nuevo.tsx:1:20\n");

    const build = await m.usar("repo_estado_despliegue", { esperar_segundos: 0 }, ctx);
    expect(build.estado).toBe("fallo");
    expect(JSON.stringify(build.logs_de_fallos)).toMatch(/Type error: '\)' expected/);
    await expect(m.usar("repo_publicar", { pr: 1 }, ctx)).rejects.toThrow(/en rojo/);
  });

  it("no escribe .env ni lockfiles, aunque tenga rama", async () => {
    const m = montar();
    const { ctx } = await elegirRama(m, (e) => e.startsWith("Rama nueva"));
    await expect(m.usar("repo_escribir", { ruta: ".env", contenido: "CLAVE=1" }, ctx)).rejects.toThrow(/secretos/);
    await expect(m.usar("repo_escribir", { ruta: "pnpm-lock.yaml", contenido: "x" }, ctx)).rejects.toThrow(/lockfile/);
  });

  it("subir un cambio de dependencias espera el clic, y el clic vale para esos cambios exactos", async () => {
    const m = montar();
    const { ctx } = await elegirRama(m, (e) => e.startsWith("Rama nueva"));
    const pkg = JSON.parse(m.gh.archivos("main")["package.json"]!) as { dependencies: Record<string, string> };
    pkg.dependencies["framer-motion"] = "11.0.0";
    await m.usar("repo_escribir", { ruta: "package.json", contenido: JSON.stringify(pkg, null, 2) }, ctx);

    const r = await m.usar("repo_guardar_cambios", { mensaje: "Añade framer-motion" }, ctx);
    expect(r.requiere_aprobacion).toBe(true);
    expect(String(r.motivo)).toMatch(/dependencias/);
    expect(m.gh.estado.ramas.has("strappy/telefono-hero")).toBe(false);

    const solicitud = m.aprobaciones.solicitudes.find((s) => s.toolSlug === "repo_guardar_cambios")!;
    m.aprobaciones.decidir(solicitud.huella, "aprobada");
    const tras = m.reanudar();
    const subida = await m.usar("repo_guardar_cambios", { mensaje: "Añade framer-motion" }, tras.ctx);
    expect(subida.ok).toBe(true);
    expect(m.gh.archivos("strappy/telefono-hero")["package.json"]).toContain("framer-motion");
  });

  it("los cambios sin subir sobreviven a la pausa del encargo", async () => {
    const m = montar();
    const primera = await elegirRama(m, (e) => e.startsWith("Rama nueva"));
    await m.usar("repo_editar", { ruta: "src/components/hero.tsx", buscar: "600 000 000", reemplazar: "611 222 333" }, primera.ctx);
    const segunda = m.reanudar();
    const cambios = await m.usar("repo_ver_cambios", {}, segunda.ctx);
    expect(cambios.pendientes).toHaveLength(1);
    const l = await m.usar("repo_leer", { ruta: "src/components/hero.tsx" }, segunda.ctx);
    expect(String(l.contenido)).toContain("611 222 333");
  });

  it("no pisa a una persona que cambió el mismo archivo en la rama", async () => {
    const m = montar({ otrasRamas: ["develop"] });
    const { ctx } = await elegirRama(m, (e) => e.includes("develop"), {
      recomendacion: "existente",
      rama_nueva: "strappy/telefono-hero",
      rama_existente: "develop",
      motivo: "el equipo integra en develop antes de publicar",
    });
    await m.usar("repo_editar", { ruta: "src/components/hero.tsx", buscar: "600 000 000", reemplazar: "611 222 333" }, ctx);
    m.gh.empujar("develop", { "src/components/hero.tsx": "export function Hero() { return null; }" });
    await expect(m.usar("repo_guardar_cambios", { mensaje: "Teléfono nuevo" }, ctx)).rejects.toThrow(/no subo para no pisar/i);

    // En otro archivo sí sigue encima de lo suyo.
    await m.usar("repo_descartar", {}, ctx);
    await m.usar("repo_escribir", { ruta: "src/components/aviso.tsx", contenido: "export const Aviso = () => null;\n" }, ctx);
    const subida = await m.usar("repo_guardar_cambios", { mensaje: "Añade aviso" }, ctx);
    expect(subida.ok).toBe(true);
    const develop = m.gh.archivos("develop");
    expect(develop["src/components/aviso.tsx"]).toBeDefined();
    expect(develop["src/components/hero.tsx"]).toBe("export function Hero() { return null; }");
  });

  it("deshacer un PR publicado deja los archivos como estaban", async () => {
    const m = montar();
    const primera = await elegirRama(m, (e) => e.startsWith("Rama nueva"));
    await m.usar("repo_editar", { ruta: "src/components/hero.tsx", buscar: "600 000 000", reemplazar: "611 222 333" }, primera.ctx);
    await m.usar("repo_guardar_cambios", { mensaje: "Teléfono nuevo" }, primera.ctx);
    await m.usar("repo_abrir_pr", { titulo: "Teléfono nuevo", descripcion: "Cambia el teléfono del hero de la portada." }, primera.ctx);
    await m.usar("repo_publicar", { pr: 1 }, primera.ctx);

    // Otro encargo: «déjalo como estaba».
    const otro = montar();
    Object.assign(otro, { gh: m.gh });
    const sitio = { ...otro.sitio, taskId: "task_deshacer", fetch: m.gh.fetch, repo: { ...otro.sitio.repo!, token: m.gh.estado.token } };
    const ctx = { ...(otro.ctx as object), sitio } as unknown as ToolContext;
    await otro.usar("repo_elegir_rama", { ...PROPUESTA, rama_nueva: "strappy/volver-telefono" }, ctx);
    const s = otro.aprobaciones.solicitudes.at(-1)!;
    otro.aprobaciones.responder(s.huella, (s.entrada as { opciones: string[] }).opciones[0]!);
    const ctx2 = { ...(ctx as object), sitio: { ...sitio } } as unknown as ToolContext;

    const recientes = await otro.usar("repo_cambios_recientes", {}, ctx2);
    expect((recientes.prs as { numero: number; estado: string }[])[0]).toMatchObject({ numero: 1, estado: "fusionado" });
    const r = await otro.usar("repo_deshacer", { pr: 1 }, ctx2);
    expect(r.revertidos).toEqual(["src/components/hero.tsx"]);
    await otro.usar("repo_guardar_cambios", { mensaje: "Revierte el teléfono" }, ctx2);
    expect(m.gh.archivos("strappy/volver-telefono")["src/components/hero.tsx"]).toContain("600 000 000");
  });

  it("en simulación edita la copia y enseña el diff, pero no sube ni pregunta", async () => {
    const m = montar({ dryRun: true });
    const pregunta = await m.usar("repo_elegir_rama", PROPUESTA);
    expect(pregunta.simulado).toBe(true);
    expect(m.aprobaciones.solicitudes).toHaveLength(0);
  });

  it("la vista previa protegida se abre con el secreto de Vercel sin que salga en la evidencia", async () => {
    const m = montar({ bypass: "secreto-bypass-1234567890" });
    const { ctx, sitio } = await elegirRama(m, (e) => e.startsWith("Rama nueva"));
    await m.usar("repo_escribir", { ruta: "src/components/aviso.tsx", contenido: "export const Aviso = () => null;\n" }, ctx);
    await m.usar("repo_guardar_cambios", { mensaje: "Añade aviso" }, ctx);
    const cabeza = m.gh.estado.ramas.get("strappy/telefono-hero")!;
    m.gh.estado.despliegues.set(cabeza, [{ id: 8, environment: "Preview", url: "https://web-abc.vercel.app", state: "success" }]);
    await m.usar("repo_estado_despliegue", { esperar_segundos: 0 }, ctx);
    const capturas: { url: string }[] = [];
    const conColector = { ...(ctx as object), sitio: Object.assign(sitio, { capturas: { push: (c: { url: string }) => capturas.push(c) } }) } as unknown as ToolContext;
    const r = await m.usar("repo_ver_vista_previa", { ruta: "/" }, conColector);
    expect(m.navegador.visitadas.at(-1)).toContain("x-vercel-protection-bypass=secreto-bypass-1234567890");
    expect(String(r.url)).not.toContain("secreto-bypass");
    expect(capturas[0]!.url).not.toContain("secreto-bypass");
  });

  it("un encargo que pregunta la rama se queda esperando al cliente", async () => {
    const m = montar();
    const { modelo, llamadas } = modeloGuionizado([
      { llama: "repo_info" },
      { llama: "repo_buscar", con: { patron: "600 000 000" } },
      { llama: "repo_ramas" },
      { llama: "repo_elegir_rama", con: PROPUESTA },
      // Si el bucle no parara aquí, el modelo editaría sin rama.
      { llama: "repo_editar", con: { ruta: "src/components/hero.tsx", buscar: "600 000 000", reemplazar: "611 222 333" } },
      { dice: "RESUMEN: no debería llegar aquí." },
    ]);
    const resultado = await ejecutarTareaWebmaster({
      agent: webmasterRepo,
      model: modelo,
      modelId: "prueba/modelo",
      rates: { models: {}, fallback: { input: 1, output: 2 } },
      workspaceId: "ws_1",
      agentName: "Max",
      sitio: m.sitio,
      tarea: { id: "task_r", titulo: "Cambia el teléfono de la portada", detalle: null },
    });
    expect(resultado.estado).toBe("esperando_aprobacion");
    expect(llamadas).not.toContain("repo_editar");
  });
});
