"use server";

import { revalidatePath } from "next/cache";
import { exigirUsuarioActual } from "@/lib/identidad";
import type { Resultado } from "@/lib/negocio/acciones";
import { probarYGuardarSitio } from "./sitio";
import { conectarRepoConApp, conectarRepoConToken, desconectarRepo } from "./repositorio";

const PAPELES_DE_MANDO = new Set(["owner", "admin"]);

export async function accionConectarSitio(datos: FormData): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_DE_MANDO.has(usuario.rol)) {
    return { ok: false, error: "Solo el propietario o un administrador pueden conectar el sitio." };
  }

  const resultado = await probarYGuardarSitio({
    workspaceId: usuario.workspaceId,
    usuarioId: usuario.id,
    url: String(datos.get("url") ?? ""),
    usuario: String(datos.get("usuario") ?? ""),
    contrasena: String(datos.get("contrasena") ?? ""),
  });
  if (!resultado.ok) return { ok: false, error: resultado.error };

  // Contratar pinta «Tu sitio web» como pendiente hasta que esto existe.
  revalidatePath("/ajustes/sitio");
  revalidatePath("/contratar");
  return { ok: true, mensaje: `Conectado a ${resultado.nombre}. El Webmaster ya puede trabajar en tu sitio.` };
}

/**
 * Conecta el repositorio de GitHub de un sitio hecho a medida. `acceso` dice
 * si viene de la GitHub App recién instalada o de un token personal.
 */
export async function accionConectarRepo(datos: FormData): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_DE_MANDO.has(usuario.rol)) {
    return { ok: false, error: "Solo el propietario o un administrador pueden conectar el repositorio." };
  }
  const entrada = {
    workspaceId: usuario.workspaceId,
    usuarioId: usuario.id,
    repositorio: String(datos.get("repositorio") ?? ""),
    url: String(datos.get("url") ?? ""),
    rama: String(datos.get("rama") ?? ""),
    bypass: String(datos.get("bypass") ?? ""),
  };
  const resultado =
    datos.get("acceso") === "app"
      ? await conectarRepoConApp(entrada)
      : await conectarRepoConToken({ ...entrada, token: String(datos.get("token") ?? "") });
  if (!resultado.ok) return { ok: false, error: resultado.error };

  revalidarSitio(datos);
  return {
    ok: true,
    mensaje: `Conectado a ${resultado.nombre}. El Webmaster ya puede trabajar en el código de tu sitio: te preguntará en qué rama guarda cada cambio.`,
  };
}

export async function accionDesconectarRepo(datos: FormData): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_DE_MANDO.has(usuario.rol)) {
    return { ok: false, error: "Solo el propietario o un administrador pueden desconectar el repositorio." };
  }
  await desconectarRepo(usuario.workspaceId);
  revalidarSitio(datos);
  return { ok: true, mensaje: "Repositorio desconectado. El Webmaster ya no puede tocar su código." };
}

/** Ajustes, Contratar y, si se conectó desde ahí, la ficha del agente. */
function revalidarSitio(datos: FormData): void {
  revalidatePath("/ajustes/sitio");
  revalidatePath("/contratar");
  const agente = String(datos.get("agente") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(agente)) {
    revalidatePath(`/agentes/${agente}/instrucciones`);
    revalidatePath(`/agentes/${agente}/probar`);
  }
}
