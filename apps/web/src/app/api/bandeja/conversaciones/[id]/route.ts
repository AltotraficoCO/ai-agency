/** Un hilo completo: mensajes, notas internas, eventos y política de envío. */
import { exigirUsuarioActual } from "@/lib/identidad";
import { leerHilo } from "@/lib/bandeja/consultas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_peticion: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const usuario = await exigirUsuarioActual();
  const hilo = await leerHilo({
    workspaceId: usuario.workspaceId,
    usuarioId: usuario.id,
    conversacionId: id,
  });
  if (!hilo) return Response.json({ error: "No encontramos esa conversación." }, { status: 404 });
  return Response.json({ hilo });
}
