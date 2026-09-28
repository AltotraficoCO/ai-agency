/**
 * Editar la copia del encargo, no el repositorio (repo:write, efecto interno).
 * Por eso funcionan también en simulación: el plan de un primer contacto puede
 * enseñar el diff exacto sin haber subido nada.
 */
import { z } from "zod";
import { defineTool } from "@strappy/tools";
import { SCOPES } from "../../context.js";
import { recortar } from "../comun.js";
import * as gh from "../../repo/github.js";
import { motivoProhibido } from "../../repo/reglas.js";
import { trabajo, ruta } from "./sesion.js";

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
