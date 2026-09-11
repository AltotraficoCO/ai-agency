"use server";

import { revalidatePath } from "next/cache";
import { exigirUsuarioActual } from "@/lib/identidad";
import type { Resultado } from "@/lib/negocio/acciones";
import { crearEncargo, decidirAprobacion, eliminarEncargo, esWebmaster, vaciarEncargos } from "./encargos";

export async function accionEliminarEncargo(agentId: string, taskId: string): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_QUE_ENCARGAN.has(usuario.rol)) {
    return { ok: false, error: "Tu papel en este espacio no permite borrar encargos." };
  }
  const resultado = await eliminarEncargo({ workspaceId: usuario.workspaceId, agentId, taskId });
  if (!resultado.ok) return resultado;
  revalidatePath(`/agentes/${agentId}/probar`);
  return { ok: true, mensaje: "Encargo eliminado." };
}

export async function accionVaciarEncargos(agentId: string): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_QUE_ENCARGAN.has(usuario.rol)) {
    return { ok: false, error: "Tu papel en este espacio no permite borrar encargos." };
  }
  const { borrados, enCurso } = await vaciarEncargos({ workspaceId: usuario.workspaceId, agentId });
  revalidatePath(`/agentes/${agentId}/probar`);
  return {
    ok: true,
    mensaje:
      enCurso > 0
        ? `Borré ${borrados} encargos. ${enCurso} sigue trabajando y se queda hasta que termine.`
        : `Borré ${borrados} encargos.`,
  };
}

/** Quién puede pedir cambios en el sitio o aprobarlos: los papeles con `agents.write`. */
const PAPELES_QUE_ENCARGAN = new Set(["owner", "admin", "builder"]);

export async function accionEncargar(agentId: string, datos: FormData): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_QUE_ENCARGAN.has(usuario.rol)) {
    return { ok: false, error: "Tu papel en este espacio no permite pedir cambios en el sitio." };
  }
  if (!(await esWebmaster(usuario.workspaceId, agentId))) {
    return { ok: false, error: "Este agente no trabaja sobre tu sitio web." };
  }

  const resultado = await crearEncargo({
    workspaceId: usuario.workspaceId,
    agentId,
    usuarioId: usuario.id,
    texto: String(datos.get("texto") ?? ""),
  });
  if (!resultado.ok) return resultado;

  revalidatePath(`/agentes/${agentId}/probar`);
  return { ok: true, mensaje: "Encargo recibido." };
}

export async function accionDecidirAprobacion(
  agentId: string,
  aprobacionId: string,
  aprobada: boolean,
): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_QUE_ENCARGAN.has(usuario.rol)) {
    return { ok: false, error: "Tu papel en este espacio no permite aprobar cambios en el sitio." };
  }

  const resultado = await decidirAprobacion({
    workspaceId: usuario.workspaceId,
    usuarioId: usuario.id,
    aprobacionId,
    aprobada,
  });
  if (!resultado.ok) return resultado;

  revalidatePath(`/agentes/${agentId}/probar`);
  return { ok: true, mensaje: aprobada ? "Aprobado. Sigo con el encargo." : "Rechazado. No lo haré." };
}
