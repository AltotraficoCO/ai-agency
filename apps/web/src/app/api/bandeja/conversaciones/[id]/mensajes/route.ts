/**
 * Escribir en la conversación.
 *
 * La ruta de los MENSAJES AL CLIENTE, y solo esa. Las notas internas entran
 * por `acciones` con `tipo: "nota"`, contra otra tabla y por otro camino: no
 * existe ningún parámetro en esta ruta capaz de convertir un mensaje en nota ni
 * al revés, que es lo que hace imposible equivocarse de destinatario.
 */
import { exigirUsuarioActual } from "@/lib/identidad";
import { enviarAlCliente } from "@/lib/bandeja/acciones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request, params: { params: Promise<{ id: string }> }) {
  const { id } = await params.params;
  const usuario = await exigirUsuarioActual();
  const cuerpo = (await peticion.json()) as { texto?: string };

  const resultado = await enviarAlCliente(
    { workspaceId: usuario.workspaceId, usuarioId: usuario.id, conversacionId: id },
    cuerpo.texto ?? "",
  );

  return Response.json(resultado, { status: resultado.ok ? 200 : 409 });
}
