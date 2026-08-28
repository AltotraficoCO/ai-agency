/**
 * Abrir un hilo con Strap.
 *
 * Un hilo es una fila de `agent_drafts`. Se crea antes del primer mensaje para
 * que el borrador exista desde el segundo cero: si se creara al terminar la
 * conversación, cerrar el navegador a mitad perdería todo, que es justo lo que
 * este diseño existe para evitar.
 */
import { z } from "zod";
import { obtenerUsuarioActual } from "@/lib/identidad";
import { crearHilo } from "@/lib/meta/borradores";

export const runtime = "nodejs";

const cuerpo = z.object({
  capacidad: z.string().optional(),
  titulo: z.string().max(80).optional(),
});

export async function POST(peticion: Request): Promise<Response> {
  const usuario = await obtenerUsuarioActual();
  if (!usuario) {
    return Response.json({ error: "No hay ninguna sesión iniciada." }, { status: 401 });
  }

  const leido = cuerpo.safeParse(await peticion.json().catch(() => ({})));
  if (!leido.success) {
    return Response.json({ error: "La petición no tiene la forma esperada." }, { status: 400 });
  }

  const id = await crearHilo({
    workspaceId: usuario.workspaceId,
    usuarioId: usuario.id,
    ...(leido.data.capacidad ? { capacidad: leido.data.capacidad } : {}),
    ...(leido.data.titulo ? { titulo: leido.data.titulo } : {}),
  });

  return Response.json({ id });
}
