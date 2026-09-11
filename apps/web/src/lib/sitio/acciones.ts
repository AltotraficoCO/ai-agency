"use server";

import { revalidatePath } from "next/cache";
import { exigirUsuarioActual } from "@/lib/identidad";
import type { Resultado } from "@/lib/negocio/acciones";
import { probarYGuardarSitio } from "./sitio";

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
