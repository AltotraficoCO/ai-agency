"use server";

/**
 * Guardar y probar los avisos del Webmaster.
 *
 * El espacio sale SIEMPRE de la sesión: una acción de servidor es un endpoint
 * público y aceptar un identificador de fuera sería regalar el aislamiento
 * entre clientes.
 */
import { revalidatePath } from "next/cache";
import { exigirUsuarioActual } from "@/lib/identidad";
import type { Resultado } from "@/lib/negocio/acciones";
import { enviarAvisoDePrueba, guardarAvisos } from "./avisos";

const PAPELES_DE_MANDO = new Set(["owner", "admin"]);

export async function accionGuardarAvisos(datos: FormData): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_DE_MANDO.has(usuario.rol)) {
    return {
      ok: false,
      error: "Solo el propietario o un administrador pueden cambiar los avisos.",
    };
  }

  const resultado = await guardarAvisos({
    workspaceId: usuario.workspaceId,
    destino: String(datos.get("destino") ?? ""),
    plantilla: String(datos.get("plantilla") ?? ""),
    idioma: String(datos.get("idioma") ?? ""),
    activo: datos.get("activo") === "on",
  });
  if (!resultado.ok) return { ok: false, error: resultado.error };

  revalidatePath("/ajustes/avisos");
  return { ok: true, mensaje: resultado.mensaje };
}

/**
 * Envía la prueba con lo que hay escrito en el formulario, no con lo guardado:
 * así se puede comprobar una plantilla antes de dejarla puesta.
 */
export async function accionProbarAviso(datos: FormData): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_DE_MANDO.has(usuario.rol)) {
    return { ok: false, error: "Solo el propietario o un administrador pueden enviar la prueba." };
  }

  const resultado = await enviarAvisoDePrueba({
    workspaceId: usuario.workspaceId,
    destino: String(datos.get("destino") ?? ""),
    plantilla: String(datos.get("plantilla") ?? ""),
    idioma: String(datos.get("idioma") ?? ""),
  });
  return resultado.ok
    ? { ok: true, mensaje: resultado.mensaje }
    : { ok: false, error: resultado.error };
}
