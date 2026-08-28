import { exigirUsuarioActual } from "@/lib/identidad";
import { reiniciarSesion } from "@/lib/motor/simulador";

export const runtime = "nodejs";

export async function POST(peticion: Request) {
  const usuario = await exigirUsuarioActual();
  const { conversationId } = (await peticion.json()) as { conversationId?: string };
  if (!conversationId) {
    return Response.json({ error: "Falta la conversación." }, { status: 400 });
  }
  await reiniciarSesion({ workspaceId: usuario.workspaceId, conversationId });
  return Response.json({ ok: true });
}
