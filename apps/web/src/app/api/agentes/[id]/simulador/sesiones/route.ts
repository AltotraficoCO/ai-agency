/**
 * «Nueva prueba»: abre otra sesión del simulador sin borrar las anteriores.
 */
import { exigirUsuarioActual } from "@/lib/identidad";
import { leerAgente } from "@/lib/agentes";
import { abrirSesion } from "@/lib/motor/simulador";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await ctx.params;
  const usuario = await exigirUsuarioActual();
  if (!(await leerAgente(usuario.workspaceId, agentId))) {
    return Response.json({ error: "Ese agente no existe." }, { status: 404 });
  }
  const id = await abrirSesion({ workspaceId: usuario.workspaceId, agentId });
  return Response.json({ id });
}
