/**
 * Subir, PR, build y publicar (repo:write, efecto externo). Estas sí tocan
 * GitHub, se simulan en seco y pasan por la aprobación cuando toca.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { defineTool } from "@strappy/tools";
import { SCOPES } from "../../context.js";
import { entorno, recortar } from "../comun.js";
import { requireBrowser, requireRepo } from "../../ports.js";
import { puertaDeAprobacion, type Bloqueo } from "../../aprobacion.js";
import * as gh from "../../repo/github.js";
import { sensibilidadDeCambios } from "../../repo/reglas.js";
import { VISTAS_PREVIAS, trabajo, soloApi } from "./sesion.js";

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
