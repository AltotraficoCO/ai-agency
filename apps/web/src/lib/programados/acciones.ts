"use server";

/**
 * Programar trabajo es encargarlo muchas veces, así que pide el mismo permiso
 * que encargarlo una: los papeles con `agents.write`.
 */
import { revalidatePath } from "next/cache";
import type { Frecuencia } from "@strappy/core";
import { exigirUsuarioActual } from "@/lib/identidad";
import type { Resultado } from "@/lib/negocio/acciones";
import { agenteDeEncargos } from "@/lib/encargos/encargos";
import { cambiarEstadoProgramado, crearProgramado, quitarProgramado } from "./programados";

const PAPELES_QUE_ENCARGAN = new Set(["owner", "admin", "builder"]);

const FRECUENCIAS = new Set<Frecuencia>(["diaria", "semanal", "mensual"]);

function entero(datos: FormData, campo: string, porDefecto: number): number {
  const n = Number(datos.get(campo));
  return Number.isFinite(n) ? Math.trunc(n) : porDefecto;
}

export async function accionProgramar(agentId: string, datos: FormData): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_QUE_ENCARGAN.has(usuario.rol)) {
    return { ok: false, error: "Tu papel en este espacio no permite programar trabajo." };
  }
  const agente = await agenteDeEncargos(usuario.workspaceId, agentId);
  if (!agente) {
    return { ok: false, error: "Este agente no trabaja por encargos: se prueba conversando." };
  }

  const frecuencia = String(datos.get("frecuencia") ?? "diaria") as Frecuencia;
  if (!FRECUENCIAS.has(frecuencia)) return { ok: false, error: "Esa frecuencia no existe." };

  const resultado = await crearProgramado({
    workspaceId: usuario.workspaceId,
    agentId,
    usuarioId: usuario.id,
    agente,
    texto: String(datos.get("texto") ?? ""),
    frecuencia,
    hora: entero(datos, "hora", 8),
    minuto: 0,
    ...(frecuencia === "semanal" ? { diaSemana: entero(datos, "dia_semana", 1) } : {}),
    ...(frecuencia === "mensual" ? { diaMes: entero(datos, "dia_mes", 1) } : {}),
    // La del navegador del cliente: «a las 8» es a las 8 de SU reloj.
    zona: String(datos.get("zona") ?? "America/Bogota"),
  });
  if (!resultado.ok) return resultado;

  revalidatePath(`/agentes/${agentId}/probar`);
  return { ok: true, mensaje: "Listo. Lo haré solo cuando toque." };
}

export async function accionCambiarEstadoProgramado(
  agentId: string,
  id: string,
  activa: boolean,
): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_QUE_ENCARGAN.has(usuario.rol)) {
    return { ok: false, error: "Tu papel en este espacio no permite cambiar el trabajo programado." };
  }
  const resultado = await cambiarEstadoProgramado({
    workspaceId: usuario.workspaceId,
    agentId,
    id,
    activa,
  });
  if (!resultado.ok) return resultado;

  revalidatePath(`/agentes/${agentId}/probar`);
  return { ok: true, mensaje: activa ? "Reanudado." : "En pausa. No lo haré hasta que lo reanudes." };
}

export async function accionQuitarProgramado(agentId: string, id: string): Promise<Resultado> {
  const usuario = await exigirUsuarioActual();
  if (!PAPELES_QUE_ENCARGAN.has(usuario.rol)) {
    return { ok: false, error: "Tu papel en este espacio no permite quitar trabajo programado." };
  }
  const resultado = await quitarProgramado({ workspaceId: usuario.workspaceId, agentId, id });
  if (!resultado.ok) return resultado;

  revalidatePath(`/agentes/${agentId}/probar`);
  return { ok: true, mensaje: "Quitado." };
}
