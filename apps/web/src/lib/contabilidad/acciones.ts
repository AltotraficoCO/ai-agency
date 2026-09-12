"use server";

import { revalidatePath } from "next/cache";
import { exigirUsuarioActual } from "@/lib/identidad";
import type { Resultado } from "@/lib/negocio/acciones";
import { probarYGuardarContabilidad } from "./contabilidad";

const PAPELES_DE_MANDO = new Set(["owner", "admin"]);

export async function accionConectarContabilidad(datos: FormData): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_DE_MANDO.has(usuario.rol)) {
    return {
      ok: false,
      error: "Solo el propietario o un administrador pueden conectar la facturación.",
    };
  }

  const resultado = await probarYGuardarContabilidad({
    workspaceId: usuario.workspaceId,
    usuarioId: usuario.id,
    usuario: String(datos.get("usuario") ?? ""),
    token: String(datos.get("token") ?? ""),
    soloLectura: datos.get("solo_lectura") === "on",
  });
  if (!resultado.ok) return { ok: false, error: resultado.error };

  // Contratar pinta «Alegra» como pendiente hasta que esto existe.
  revalidatePath("/ajustes/contabilidad");
  revalidatePath("/contratar");
  return {
    ok: true,
    mensaje: resultado.puedeEmitir
      ? `Conectado a ${resultado.nombre}. Tu agente financiero ya puede ver tus cuentas y, con tu aprobación, emitir facturas.`
      : `Conectado a ${resultado.nombre} en modo solo lectura: puede analizar y proponer, pero no emitir nada.`,
  };
}
